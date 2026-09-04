// The strip beside the pond: the current chapter's goals, then the open
// commissions and buyer request. Rebuilt on the UI's half-second refresh.
import type { Game } from '../game';
import type { GameState } from '../state';
import { CHAPTERS, chapterProgress, currentChapter, goalProgress, tickGoals, widgetGoals } from '../sim/goals';
import { describeCommission, duckFits } from '../sim/commissions';
import { describeRequest, matchesRequest } from '../sim/visitors';
import { isUnlocked, UNLOCK_LABELS } from '../sim/unlocks';
import { dayOf } from '../sim/time';
import { plural } from '../text';
import { el } from './dom';
import { icon } from './icons';
import type { PanelKind } from './ui';

interface SideWidgetsHost {
  game: Game;
  openPanel(kind: PanelKind): void;
}

export class SideWidgets {
  readonly element: HTMLElement;
  private goalsHost = el('div', { class: 'goals-widget' });
  private requestsHost = el('div', { class: 'requests-widget' });

  constructor(private host: SideWidgetsHost) {
    this.element = el('div', { class: 'side-widgets' }, this.goalsHost, this.requestsHost);
  }

  refresh(): void {
    // Goals are settled by the sim tick, but the buttons they unlock read
    // the stats directly — so while the game is paused a fourth pet opens
    // Breeding at once and the goal would sit at 4/4 until time resumed.
    // Settle them here whenever the clock isn't running.
    if (this.host.game.speed === 0 && !this.host.game.stale) tickGoals(this.host.game.state);
    const state = this.host.game.state;
    this.refreshGoalsWidget(state);
    this.refreshRequestsWidget(state);
  }

  // The current chapter, doable goals first; click anywhere to open the
  // full Goals panel with its hints.
  private refreshGoalsWidget(state: GameState): void {
    const rows = widgetGoals(state, 5);
    const chapter = currentChapter(state);
    const progress = chapterProgress(state, chapter.id);
    if (rows.length === 0) {
      this.goalsHost.replaceChildren();
      return;
    }
    const open = () => this.host.openPanel('goals');
    const children: HTMLElement[] = [
      el(
        'button',
        { class: 'goals-head', title: 'Open the Goals panel: every chapter, with hints', onclick: open },
        el('span', { class: 'goals-title' }, 'Goals'),
        el('span', { class: 'goals-chapter' }, `Chapter ${CHAPTERS.findIndex((c) => c.id === chapter.id) + 1} · ${chapter.title}`),
        el('span', { class: 'goals-count' }, `${progress.done}/${progress.total}`),
      ),
    ];
    let dividerShown = false;
    for (const row of rows) {
      const { goal, later, upNext } = row;
      if (upNext && !dividerShown) {
        dividerShown = true;
        children.push(el('div', { class: 'goals-upnext' }, 'Up next'));
      }
      const isGate = Boolean(goal.unlocks && !isUnlocked(state, goal.unlocks));
      const done = goalProgress(state, goal);
      const line = el(
        'div',
        {
          class: `goal-row${isGate ? ' unlock' : ''}${later ? ' later' : ''}`,
          title: later ? `${later}. ${goal.hint}` : goal.hint,
          onclick: open,
        },
        isGate ? el('span', { class: 'goal-lock' }, icon('lock', 10)) : el('span', { class: 'goal-dot' }),
        el(
          'span',
          { class: 'goal-label' },
          goal.label,
          isGate ? el('span', { class: 'goal-unlock' }, `unlocks ${UNLOCK_LABELS[goal.unlocks!]}`) : null,
          later ? el('span', { class: 'goal-later' }, later) : null,
        ),
        goal.target > 1 ? el('span', { class: 'goal-progress' }, `${done}/${goal.target}`) : null,
        el('span', { class: 'goal-reward with-icon' }, icon('coin', 10), `${goal.reward}`),
      );
      if (goal.target > 1) {
        const fill = el('div', { class: 'goal-bar-fill' });
        fill.style.width = `${(done / goal.target) * 100}%`;
        line.append(el('div', { class: 'goal-bar' }, fill));
      }
      children.push(line);
    }
    children.push(el('button', { class: 'goals-more', onclick: open }, 'All chapters and hints…'));
    this.goalsHost.replaceChildren(...children);
  }

  // Commissions and the buyer request: offers, not goals, so they keep
  // their own strip under the path.
  private refreshRequestsWidget(state: GameState): void {
    const request = state.request;
    const commissions = state.commissions;
    const children: Array<HTMLElement> = [];
    if (commissions.length > 0) {
      const today = dayOf(state.clock);
      children.push(el('div', { class: 'goals-title request-title' }, 'Commissions'));
      for (const c of commissions) {
        const fits = state.ducks.some((d) => duckFits(d, c));
        const left = Math.max(0, c.expiresDay - today);
        children.push(
          el(
            'div',
            { class: 'goal-row', title: `${c.client} · ${describeCommission(c)} · ${left}d left` },
            el('span', { class: `goal-dot request-dot${fits ? ' fits' : ''}` }),
            el('span', { class: 'goal-label' }, describeCommission(c)),
            el('span', { class: 'goal-reward with-icon' }, icon('coin', 10), `${c.reward}`),
          ),
        );
      }
    }
    if (request) {
      const daysLeft = Math.max(0, request.expiresDay - dayOf(state.clock));
      children.push(
        el('div', { class: 'goals-title request-title' }, 'Buyer request'),
        el(
          'div',
          { class: 'goal-row', title: 'A buyer pays this multiple of the sell price for any matching duck — sell from the duck\'s card' },
          el('span', { class: `goal-dot request-dot${state.ducks.some((d) => matchesRequest(d, request)) ? ' fits' : ''}` }),
          el('span', { class: 'goal-label' }, `wants a ${describeRequest(request)} duck`),
          el('span', { class: 'goal-reward' }, `×${request.multiplier}`),
        ),
        el(
          'div',
          { class: 'muted request-expiry' },
          daysLeft > 0 ? `${plural(daysLeft, 'day')} left` : 'leaving today',
        ),
      );
    }
    this.requestsHost.replaceChildren(...children);
  }
}
