// The Goals panel: the whole path, chapter by chapter. The current chapter
// is open; finished and future ones fold to a heading with their count. Every
// goal shows its hint, its progress, and — when it can be attempted now —
// a "Show me" that opens the right panel.
import type { PanelCtx } from './ui';
import { el, panelHeader } from './dom';
import { icon } from './icons';
import {
  CHAPTERS,
  chapterGoals,
  chapterProgress,
  currentChapter,
  goalDone,
  goalLater,
  goalProgress,
  goalsOverview,
  type ChapterId,
} from '../sim/goals';
import { UNLOCK_LABELS } from '../sim/unlocks';

// Which chapters the player has opened by hand; the current one is always
// open unless they close it.
const opened = new Set<ChapterId>();
const closed = new Set<ChapterId>();

export function renderGoalsPanel(ctx: PanelCtx): HTMLElement {
  const state = ctx.game.state;
  const panel = el('aside', { class: 'panel wide goals-panel' });
  const overview = goalsOverview(state);
  panel.append(
    panelHeader('flag', 'Goals', ctx.close, el('span', { class: 'goals-overview' }, `${overview.done} / ${overview.total}`)),
  );
  const fill = el('div', { class: 'goal-bar-fill' });
  fill.style.width = `${(overview.done / overview.total) * 100}%`;
  panel.append(el('div', { class: 'goals-total-bar goal-bar' }, fill));
  panel.append(el('div', { class: 'muted small shop-tab-hint' }, 'Eight chapters. Each goal pays coins when it lands; a finished chapter pays a purse. Locked goals open parts of the game.'));

  const current = currentChapter(state);
  CHAPTERS.forEach((ch, i) => {
    const progress = chapterProgress(state, ch.id);
    const done = progress.done >= progress.total;
    const isCurrent = ch.id === current.id;
    const open = closed.has(ch.id) ? false : opened.has(ch.id) || isCurrent;
    const head = el(
      'button',
      {
        class: `chapter-head${done ? ' done' : ''}${isCurrent ? ' current' : ''}`,
        onclick: () => {
          if (open) {
            opened.delete(ch.id);
            closed.add(ch.id);
          } else {
            closed.delete(ch.id);
            opened.add(ch.id);
          }
          ctx.ui.refreshPanel();
        },
      },
      el('span', { class: 'chapter-num' }, done ? icon('check', 12) : String(i + 1)),
      el('span', { class: 'chapter-title' }, ch.title),
      el('span', { class: 'chapter-count' }, `${progress.done} / ${progress.total}`),
      el('span', { class: `chapter-reward with-icon${state.goals[`chapter:${ch.id}`] ? ' paid' : ''}` }, icon('coin', 10), `${ch.reward}`),
      el('span', { class: 'chapter-caret' }, open ? '▾' : '▸'),
    );
    const barFill = el('div', { class: 'goal-bar-fill' });
    barFill.style.width = `${(progress.done / progress.total) * 100}%`;
    const section = el('section', { class: `chapter${open ? ' open' : ''}` }, head, el('div', { class: 'goal-bar chapter-bar' }, barFill));
    if (open) {
      section.append(el('div', { class: 'muted small chapter-blurb' }, ch.blurb));
      const list = el('div', { class: 'chapter-goals' });
      for (const goal of chapterGoals(ch.id)) list.append(goalLine(ctx, goal));
      section.append(list);
    }
    panel.append(section);
  });
  return panel;
}

function goalLine(ctx: PanelCtx, goal: ReturnType<typeof chapterGoals>[number]): HTMLElement {
  const state = ctx.game.state;
  const done = goalDone(state, goal);
  const later = done ? undefined : goalLater(state, goal);
  const progress = goalProgress(state, goal);
  const status = done
    ? el('span', { class: 'goal-status done' }, icon('check', 11))
    : goal.unlocks
      ? el('span', { class: 'goal-status lock' }, icon('lock', 10))
      : el('span', { class: `goal-status${later ? ' later' : ''}` });
  const body = el('div', { class: 'goal-body' }, el('div', { class: 'goal-name' }, goal.label));
  if (goal.unlocks && !done) body.append(el('span', { class: 'goal-unlock' }, `unlocks ${UNLOCK_LABELS[goal.unlocks]}`));
  if (!done) body.append(el('div', { class: 'muted small goal-hint' }, goal.hint));
  if (later) body.append(el('div', { class: 'goal-later-tag' }, later));
  if (!done && goal.target > 1) {
    const fill = el('div', { class: 'goal-bar-fill' });
    fill.style.width = `${(progress / goal.target) * 100}%`;
    body.append(el('div', { class: 'goal-progress-row' }, el('div', { class: 'goal-bar' }, fill), el('span', { class: 'goal-progress' }, `${progress} / ${goal.target}`)));
  }
  const side = el('div', { class: 'goal-side' }, el('span', { class: `goal-reward with-icon${done ? ' paid' : ''}` }, icon('coin', 10), `${goal.reward}`));
  if (!done && !later && goal.go) {
    const go = goal.go;
    side.append(el('button', { class: 'small-btn goal-go', onclick: () => ctx.ui.goTo(go) }, 'Show me'));
  }
  return el('div', { class: `goal-line${done ? ' done' : ''}${later ? ' later' : ''}` }, status, body, side);
}
