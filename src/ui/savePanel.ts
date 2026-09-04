import type { PanelCtx } from './ui';
import { confirmButton, el, panelHeader } from './dom';
import { icon } from './icons';
import { deserialize, serialize } from '../save/save';
import { canRetire } from '../sim/heritage';
import { pedigreeScore } from '../sim/pedigree';
import { duckPortrait } from './portrait';
import { attachCloudSync, detachCloudSync } from '../sync/sync';
import { claimSave, pairStart, rotateSecret } from '../sync/syncClient';
import { isSyncConfigured, loadSyncMeta, newDeviceId, saveSyncMeta, unlinkSync } from '../sync/syncMeta';

let confirmingNewGame = false;
// The exported JSON survives the 500ms panel rebuild (the rebuild guard only
// protects a *focused* textarea, and you must unfocus it to hit Copy).
let exportedJson = '';

// Armed destructive confirmations must not survive closing the panel —
// otherwise reopening presents "Really abandon this flock?" one click deep.
export function resetSavePanelState(): void {
  confirmingNewGame = false;
  confirmingUnlink = false;
  confirmingRetire = false;
  exportedJson = '';
}

export function renderSavePanel(ctx: PanelCtx): HTMLElement {
  const { game } = ctx;
  const panel = el('aside', { class: 'panel save' });
  panel.append(
    panelHeader('disk', 'Save & Load', ctx.close),
  );

  const textarea = el('textarea', { class: 'save-textarea', rows: 6 }) as HTMLTextAreaElement;
  textarea.value = exportedJson;

  // The armed pair sits in its own row.
  const newGame = confirmButton({
    armed: confirmingNewGame,
    cls: 'danger-btn',
    label: 'New game',
    confirmLabel: 'Really abandon this flock?',
    arm: () => {
      confirmingNewGame = true;
      ctx.ui.refreshPanel();
    },
    onConfirm: () => {
      confirmingNewGame = false;
      game.newGame();
      ctx.close();
    },
    cancel: () => {
      confirmingNewGame = false;
      ctx.ui.refreshPanel();
    },
  });
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
      confirmingNewGame ? el('span', { class: 'actions' }, ...newGame) : newGame[0],
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
              exportedJson = serialize(game.snapshotState());
              textarea.value = exportedJson;
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
              } catch (err) {
                console.warn('Save import failed', err);
                ctx.ui.toast('That save data could not be read.');
              }
            },
          },
          'Import',
        ),
      ),
    ),
  );
  panel.append(linkDeviceSection(ctx));
  panel.append(heritageSection(ctx));
  return panel;
}

// ---- Cloud sync / companion pairing ----------------------------------------
let pairInfo: { code: string; expiresAt: number } | null = null;
let pairBusy = false;
let confirmingUnlink = false;
let confirmingCutOff = false;

function linkDeviceSection(ctx: PanelCtx): HTMLElement {
  const { game } = ctx;
  const box = el(
    'div',
    { class: 'section' },
    el('strong', { class: 'with-icon' }, icon('sparkle'), 'Companion & cloud sync'),
  );

  const showCode = async (existing: { syncId: string; secret: string } | null): Promise<void> => {
    if (pairBusy) return;
    pairBusy = true;
    try {
      const res = await pairStart(existing);
      if (!existing) {
        // First link: this browser becomes the sync's founding device.
        const meta = {
          syncId: res.syncId,
          secret: res.secret,
          deviceId: newDeviceId(),
          lastSyncedSeq: 0,
          dirty: true,
        };
        // Prove the claim works before persisting credentials — persisting
        // first left the device half-linked (cloud chip on, nothing pushing)
        // when the claim failed.
        await claimSave(meta);
        saveSyncMeta(meta);
        game.save(); // triggers the first push via attachCloudSync
        attachCloudSync(game);
      }
      pairInfo = { code: res.code, expiresAt: res.expiresAt };
    } catch {
      ctx.ui.toast('Could not reach the cloud — try again in a moment.');
    }
    pairBusy = false;
    ctx.ui.refreshPanel();
  };

  if (!isSyncConfigured()) {
    box.append(
      el(
        'div',
        { class: 'muted small' },
        'Link a phone (or another computer) to check on the pond from anywhere. The companion at /companion watches the pond while you play here, and can take the reins for feeding, petting, egg care and the day\'s decisions — then hands it back when you put the phone down. Anyone with the code can play your pond, so share it like a house key.',
      ),
      el(
        'button',
        { class: 'action-btn', disabled: pairBusy, onclick: () => void showCode(null) },
        pairBusy ? 'Linking…' : 'Link a device',
      ),
    );
  } else {
    const meta = loadSyncMeta()!;
    // A lost or lent phone keeps the shared secret forever; rotating it is
    // the only way to revoke. This device stores the new secret and stays
    // linked; everyone else must pair again with a fresh code.
    const cutOff = async (): Promise<void> => {
      if (pairBusy) return;
      pairBusy = true;
      confirmingCutOff = false;
      try {
        const secret = await rotateSecret(meta);
        saveSyncMeta({ ...meta, secret });
        detachCloudSync();
        attachCloudSync(game);
        ctx.ui.toast('Other devices are cut off. Show a new code to link one again.');
      } catch {
        ctx.ui.toast('Could not reach the cloud — try again in a moment.');
      }
      pairBusy = false;
      ctx.ui.refreshPanel();
    };
    box.append(
      el(
        'div',
        { class: 'muted small' },
        `Cloud sync is on (save #${meta.lastSyncedSeq}${meta.dirty ? ', pending push' : ', up to date'}). Companion: ${location.origin}/companion`,
      ),
      el(
        'div',
        { class: 'actions' },
        el(
          'button',
          { class: 'action-btn', disabled: pairBusy, onclick: () => void showCode({ syncId: meta.syncId, secret: meta.secret }) },
          'Show a pairing code',
        ),
        ...confirmButton({
          armed: confirmingCutOff,
          cls: 'action-btn',
          confirmCls: 'danger-btn',
          disabled: pairBusy,
          title: 'Revoke access for every other linked device (a lost phone, a shared code). This one stays linked.',
          label: 'Cut off other devices',
          confirmLabel: 'Really cut off every other device?',
          arm: () => {
            confirmingCutOff = true;
            ctx.ui.refreshPanel();
          },
          onConfirm: () => void cutOff(),
        }),
        ...confirmButton({
          armed: confirmingUnlink,
          cls: 'danger-btn',
          label: 'Unlink',
          confirmLabel: 'Really unlink this device?',
          arm: () => {
            confirmingUnlink = true;
            ctx.ui.refreshPanel();
          },
          onConfirm: () => {
            detachCloudSync(); // kill the old push/poll closures first
            unlinkSync();
            confirmingUnlink = false;
            pairInfo = null;
            ctx.ui.toast('Unlinked. The cloud copy still exists; relink anytime.');
            ctx.ui.refreshPanel();
          },
        }),
      ),
    );
  }

  if (pairInfo) {
    const minsLeft = Math.max(0, Math.ceil((pairInfo.expiresAt - Date.now()) / 60_000));
    if (minsLeft === 0) pairInfo = null;
    else {
      box.append(
        el(
          'div',
          { class: 'pair-code-box' },
          el('div', { class: 'pair-code' }, pairInfo.code),
          el(
            'div',
            { class: 'muted small' },
            `On the other device, open ${location.origin}/companion and enter this code. Expires in ${minsLeft} min, works once.`,
          ),
        ),
      );
    }
  }
  return box;
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
      'Retire this pond and found the next with one drake and one hen. The Breed Book, awards, Society standing, chronicle, and records carry over. Each retirement adds +1 pond slot, +1% mutation (new genes), and a better-stocked start.',
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
    ...confirmButton({
      armed: confirmingRetire,
      cls: 'action-btn',
      confirmCls: 'action-btn primary',
      disabled: !ready,
      label: 'Retire the pond',
      confirmLabel: 'Really retire the pond? Every other duck is rehomed.',
      arm: () => {
        confirmingRetire = true;
        ctx.ui.refreshPanel();
      },
      onConfirm: () => {
        game.retire(retireDrake!, retireHen!);
        retireDrake = null;
        retireHen = null;
        confirmingRetire = false;
        ctx.ui.toast('A new pond. The Book remembers everything.');
        ctx.close();
      },
    }),
  );
  return box;
}
