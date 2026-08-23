import type { PanelCtx } from './ui';
import { el } from './dom';
import { icon } from './icons';
import { deserialize, serialize } from '../save/save';
import { canRetire } from '../sim/heritage';
import { pedigreeScore } from '../sim/pedigree';
import { duckPortrait } from './portrait';

let confirmingNewGame = false;

export function renderSavePanel(ctx: PanelCtx): HTMLElement {
  const { game } = ctx;
  const panel = el('aside', { class: 'panel' });
  panel.append(
    el(
      'div',
      { class: 'panel-header' },
      el('strong', { class: 'with-icon' }, icon('disk'), 'Save & Load'),
      el('button', { class: 'close-btn', onclick: ctx.close }, icon('close', 13)),
    ),
  );

  const textarea = el('textarea', { class: 'save-textarea', rows: 6 }) as HTMLTextAreaElement;

  panel.append(
    el(
      'div',
      { class: 'section actions' },
      el(
        'button',
        {
          class: 'action-btn',
          onclick: () => {
            game.save();
            ctx.ui.toast('Game saved!');
          },
        },
        'Save now',
      ),
      confirmingNewGame
        ? el(
            'span',
            { class: 'actions' },
            el(
              'button',
              {
                class: 'danger-btn',
                onclick: () => {
                  confirmingNewGame = false;
                  game.newGame();
                  ctx.close();
                },
              },
              'Really abandon this flock?',
            ),
            el(
              'button',
              {
                class: 'action-btn',
                onclick: () => {
                  confirmingNewGame = false;
                  ctx.ui.refreshPanel();
                },
              },
              'Cancel',
            ),
          )
        : el(
            'button',
            {
              class: 'danger-btn',
              onclick: () => {
                confirmingNewGame = true;
                ctx.ui.refreshPanel();
              },
            },
            'New game',
          ),
    ),
    el(
      'div',
      { class: 'section' },
      el('div', { class: 'muted small' }, 'Export / import save data (JSON):'),
      textarea,
      el(
        'div',
        { class: 'actions' },
        el(
          'button',
          {
            class: 'action-btn',
            onclick: () => {
              textarea.value = serialize(game.snapshotState());
              textarea.select();
            },
          },
          'Export',
        ),
        el(
          'button',
          {
            class: 'action-btn',
            onclick: () => {
              try {
                const state = deserialize(textarea.value);
                game.loadState(state);
                game.save();
                ctx.ui.toast('Save imported!');
                ctx.close();
              } catch {
                ctx.ui.toast('That save data could not be read.');
              }
            },
          },
          'Import',
        ),
      ),
    ),
  );
  panel.append(heritageSection(ctx));
  return panel;
}

// Retire the pond: pick a founding pair and carry the legacy into a new pond.
let retireDrake: string | null = null;
let retireHen: string | null = null;
let confirmingRetire = false;

function heritageSection(ctx: PanelCtx): HTMLElement {
  const { game } = ctx;
  const state = game.state;
  const box = el(
    'div',
    { class: 'section heritage' },
    el('strong', { class: 'with-icon' }, icon('star'), state.heritage > 0 ? `Heritage pond ${state.heritage}` : 'Heritage'),
    el(
      'div',
      { class: 'muted small' },
      'Retire this pond and found the next with one drake and one hen. The Breed Book, awards, Society standing, chronicle, and records carry over. Each retirement adds +1 nest slot, +1% mutation (new genes), and a better-stocked start.',
    ),
  );
  const gate = canRetire(state);
  if (!gate.ok) {
    box.append(el('div', { class: 'muted small warn-text' }, gate.reason ?? ''));
    return box;
  }
  const adults = state.ducks.filter((d) => d.stage === 'adult' || d.stage === 'elder').sort((a, b) => pedigreeScore(b) - pedigreeScore(a));
  const picker = (sex: 'M' | 'F', chosen: string | null, set: (id: string) => void) => {
    const row = el('div', { class: 'heritage-picker' });
    for (const d of adults.filter((x) => x.sex === sex)) {
      row.append(
        el(
          'button',
          { class: `br-cand${chosen === d.id ? ' chosen' : ''}`, onclick: () => { set(d.id); confirmingRetire = false; ctx.ui.refreshPanel(); } },
          duckPortrait(d, 36),
          el('span', { class: 'br-cand-info' }, el('span', { class: 'br-cand-name' }, d.name), el('span', { class: 'muted small' }, `★ ${pedigreeScore(d)}`)),
        ),
      );
    }
    return row;
  };
  box.append(el('div', { class: 'muted small' }, 'Founding drake'), picker('M', retireDrake, (id) => { retireDrake = id; }));
  box.append(el('div', { class: 'muted small' }, 'Founding hen'), picker('F', retireHen, (id) => { retireHen = id; }));
  const ready = retireDrake && retireHen && state.ducks.some((d) => d.id === retireDrake) && state.ducks.some((d) => d.id === retireHen);
  box.append(
    el(
      'button',
      {
        class: `action-btn ${confirmingRetire ? 'primary' : ''}`,
        disabled: !ready,
        onclick: () => {
          if (!confirmingRetire) {
            confirmingRetire = true;
            ctx.ui.refreshPanel();
            return;
          }
          game.retire(retireDrake!, retireHen!);
          retireDrake = null;
          retireHen = null;
          confirmingRetire = false;
          ctx.ui.toast('A new pond. The Book remembers everything.');
          ctx.close();
        },
      },
      confirmingRetire ? 'Really retire the pond? Every other duck is rehomed.' : 'Retire the pond',
    ),
  );
  return box;
}
