// The notices column: things that need a hand — a decision, a foul pond,
// sick or hungry ducks, cold or cracking eggs, a wild visitor, a contract
// about to lapse — wait on the right edge until handled, the way a colony
// game keeps its letters. Toasts stack at the top of the same column so
// everything the pond says arrives in one place. Cards rebuild only when
// the situation changes, never under the pointer.
import type { Game } from '../game';
import type { Renderer } from '../render/renderer';
import { liveNotices, type LiveNotice } from '../sim/daybook';
import { cleanPond } from '../sim/pond';
import { claimHatch } from '../sim/lifecycle';
import { tuckEgg } from '../sim/needs';
import { treatVisitor } from '../sim/visitors';
import { dayOf } from '../sim/time';
import { play } from '../audio/audio';
import { el } from './dom';
import { icon } from './icons';
import type { ToastTone } from './notices';
import type { PanelKind } from './ui';

interface NoticeColumnHost {
  game: Game;
  renderer: Renderer;
  toast(msg: string, tone?: ToastTone): void;
  openLifeEvent(): void;
  selectDuck(id: string): void;
  openPanel(kind: PanelKind): void;
  refreshPanel(): void;
}

// Kinds a player may put off until tomorrow; the rest stay until handled.
const SNOOZABLE = new Set<LiveNotice['kind']>(['visitor', 'commission', 'soap', 'feed-low', 'pond', 'overcrowded']);

export class NoticeColumn {
  readonly element: HTMLElement;
  readonly toastHost: HTMLElement;
  private stack: HTMLElement;
  // null forces the next refresh to rebuild (an action just changed things).
  private lastSig: string | null = null;
  private pointerDown = false;
  private snoozed = new Map<string, number>(); // key → day it was snoozed

  constructor(private host: NoticeColumnHost) {
    this.toastHost = el('div', { class: 'toast-host' });
    this.stack = el('div', { class: 'notice-stack' });
    this.element = el('div', { class: 'notice-column' }, this.toastHost, this.stack);
    this.stack.addEventListener('pointerdown', () => {
      this.pointerDown = true;
    });
    window.addEventListener('pointerup', () => {
      this.pointerDown = false;
    });
  }

  refresh(): void {
    const state = this.host.game.state;
    // Another device owns the pond: nothing here may act on a stale copy.
    if (this.host.game.stale) {
      if (this.lastSig !== null) this.stack.replaceChildren();
      this.lastSig = null;
      return;
    }
    const today = dayOf(state.clock);
    const notices = liveNotices(state).filter((n) => n.urgent || this.snoozed.get(n.key) !== today);
    const sig = notices.map((n) => `${n.key}|${n.count ?? ''}|${n.urgent ? '!' : ''}|${n.duckId ?? ''}|${n.title}`).join(';');
    if (this.lastSig !== null && (sig === this.lastSig || this.pointerDown)) return;
    this.lastSig = sig;
    this.stack.replaceChildren(...notices.map((n) => this.card(n)));
  }

  snooze(key: string): void {
    this.snoozed.set(key, dayOf(this.host.game.state.clock));
    this.lastSig = null;
    this.refresh();
  }

  private card(n: LiveNotice): HTMLElement {
    const act = () => {
      this.act(n);
      this.lastSig = null;
      this.host.refreshPanel();
    };
    const card = el(
      'div',
      {
        class: `notice-card${n.urgent ? ' urgent' : ''}`,
        'data-notice': n.kind,
        'data-key': n.key,
        role: 'button',
        tabindex: '0',
        title: n.detail ?? n.title,
        onclick: act,
        onkeydown: (e) => {
          if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
            e.preventDefault();
            act();
          }
        },
      },
      el('span', { class: 'notice-badge' }, icon(n.icon, 14)),
      el('span', { class: 'notice-text' }, el('div', { class: 'notice-title' }, n.title), n.detail ? el('div', { class: 'notice-detail' }, n.detail) : null),
    );
    if (!n.urgent && SNOOZABLE.has(n.kind)) {
      card.append(
        el(
          'button',
          {
            class: 'notice-snooze',
            title: 'Not today',
            onclick: (e) => {
              e.stopPropagation();
              this.snooze(n.key);
            },
          },
          icon('close', 10),
        ),
      );
    }
    return card;
  }

  private act(n: LiveNotice): void {
    const { game, renderer } = this.host;
    const state = game.state;
    switch (n.kind) {
      case 'life':
        this.host.openLifeEvent();
        return;
      case 'pond':
        cleanPond(state);
        play('splash');
        this.host.toast('You scrubbed the pond sparkling clean!');
        return;
      case 'visitor': {
        const result = treatVisitor(state);
        if (result === 'no-feed') this.host.toast('It wants premium feed — buy some at the shop!');
        else if (result === 'landing') this.host.toast('Let it land first!');
        return;
      }
      case 'egg-ready': {
        if (!n.duckId) return;
        const egg = state.ducks.find((d) => d.id === n.duckId);
        if (egg && claimHatch(state, game.rng, egg.id)) {
          for (let i = 0; i < 5; i += 1) renderer.spawnParticle(egg.pos.x, egg.pos.y - 10, 'heart');
          this.host.selectDuck(egg.id);
        }
        return;
      }
      case 'egg-cold': {
        let tucked = 0;
        for (const egg of state.ducks) {
          if (egg.stage === 'egg' && tuckEgg(state, egg.id)) {
            renderer.spawnParticle(egg.pos.x, egg.pos.y - 14, 'heart');
            tucked += 1;
          }
        }
        if (tucked > 0) this.host.toast(tucked === 1 ? 'Tucked in' : `Tucked in ${tucked} eggs`);
        return;
      }
      case 'sick':
      case 'hungry':
      case 'commission':
        if (n.duckId) this.host.selectDuck(n.duckId);
        else this.host.openPanel('roster');
        return;
      case 'overcrowded':
        this.host.openPanel('roster');
        return;
      case 'soap':
      case 'feed-low':
        this.host.openPanel('shop');
        return;
    }
  }
}
