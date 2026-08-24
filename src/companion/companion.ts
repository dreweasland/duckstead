// Companion mode: the pocket pond. Runs the REAL sim (a full Game on the
// real save) behind a touch-first care UI — no canvas pond, no desktop
// panels. Reached at /companion; pairs to the cloud save via the code the
// desktop's Save panel mints.
import { events } from '../events';
import { Game } from '../game';
import { startLoop } from '../loop';
import { attachCloudSync, claimAndReload, prepareCloudBoot } from '../sync/sync';
import { isSyncConfigured } from '../sync/syncMeta';
import { formatClock } from '../sim/time';
import { el } from '../ui/dom';
import { renderPairScreen } from './pairScreen';
import { dayScreen, duckScreen, flockScreen, pondScreen } from './screens';

type Tab = 'flock' | 'pond' | 'day';

export function runCompanion(): void {
  document.getElementById('pond-canvas')?.remove();
  const root = document.getElementById('ui-root') ?? document.body;
  root.classList.add('companion-root');

  if (!isSyncConfigured()) {
    renderPairScreen(root, () => void bootCompanion(root));
    return;
  }
  void bootCompanion(root);
}

async function bootCompanion(root: HTMLElement): Promise<void> {
  root.replaceChildren(el('div', { class: 'comp-loading' }, 'Fetching the pond…'));
  await prepareCloudBoot();
  const game = new Game();
  attachCloudSync(game);
  const shell = new Shell(game, root);
  startLoop(
    game.tick,
    () => shell.render(),
    () => game.speed,
  );
}

class Shell {
  private tab: Tab = 'flock';
  private openDuckId: string | null = null;
  private lastRender = 0;
  private pointerDown = false;
  private header: HTMLElement;
  private screenHost: HTMLElement;
  private nav: HTMLElement;
  private toastHost: HTMLElement;

  constructor(
    private game: Game,
    root: HTMLElement,
  ) {
    this.header = el('header', { class: 'comp-header' });
    this.screenHost = el('main', { class: 'comp-screen' });
    this.nav = el('nav', { class: 'comp-nav' });
    this.toastHost = el('div', { class: 'comp-toasts' });
    root.replaceChildren(this.header, this.screenHost, this.nav, this.toastHost);

    const navBtn = (tab: Tab, label: string): HTMLElement =>
      el(
        'button',
        {
          class: 'comp-nav-btn',
          'data-tab': tab,
          onclick: () => {
            this.tab = tab;
            this.openDuckId = null;
            this.forceRender();
          },
        },
        label,
      );
    this.nav.append(navBtn('flock', '🦆 Flock'), navBtn('pond', '🌾 Chores'), navBtn('day', '📖 Day'));

    // Never rebuild mid-touch: it would destroy the control under the finger
    // (and interrupt scrolling).
    this.screenHost.addEventListener('pointerdown', () => {
      this.pointerDown = true;
    });
    window.addEventListener('pointerup', () => {
      this.pointerDown = false;
    });
    window.addEventListener('pointercancel', () => {
      this.pointerDown = false;
    });

    events.on('toast', (msg) => this.toast(String(msg)));
    events.on('takeover', (payload) =>
      this.showTakeover(Boolean((payload as { remote?: boolean } | undefined)?.remote)),
    );
    events.on('sync-status', () => this.forceRender());
  }

  private toast(msg: string): void {
    const node = el('div', { class: 'comp-toast' }, msg);
    this.toastHost.append(node);
    setTimeout(() => node.remove(), 3500);
  }

  private showTakeover(remote: boolean): void {
    document.querySelector('.comp-takeover')?.remove();
    document.body.append(
      el(
        'div',
        { class: 'comp-takeover' },
        el(
          'div',
          { class: 'comp-takeover-card' },
          el('strong', {}, remote ? 'Pond opened on another device' : 'Pond opened in another tab'),
          el('p', { class: 'comp-muted' }, 'This one has paused so the saves cannot clash.'),
          el(
            'button',
            {
              class: 'comp-btn primary',
              onclick: () => {
                if (remote) void claimAndReload();
                else location.reload();
              },
            },
            'Play here instead',
          ),
        ),
      ),
    );
  }

  private forceRender(): void {
    this.lastRender = 0;
    this.render();
  }

  // Called every animation frame by startLoop; the DOM refreshes at 1 Hz.
  render(): void {
    const now = performance.now();
    if (now - this.lastRender < 1000 || this.pointerDown) return;
    this.lastRender = now;
    this.renderHeader();
    this.renderScreen();
    for (const btn of this.nav.querySelectorAll('.comp-nav-btn')) {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === this.tab);
    }
  }

  private renderHeader(): void {
    const s = this.game.state;
    this.header.replaceChildren(
      el('span', { class: 'comp-clock' }, formatClock(s.clock)),
      el('span', { class: 'comp-chip' }, `🪙 ${s.money}`),
      el('span', { class: 'comp-chip' }, `🥣 ${s.inventory.feed}`),
      el('span', { class: 'comp-chip' }, `🥚 ${s.inventory.eggs}`),
      el(
        'button',
        {
          class: `comp-chip comp-pause${this.game.speed === 0 ? ' paused' : ''}`,
          onclick: () => {
            this.game.speed = this.game.speed === 0 ? 1 : 0;
            this.forceRender();
          },
        },
        this.game.speed === 0 ? '▶' : '⏸',
      ),
    );
  }

  private renderScreen(): void {
    const scroll = this.screenHost.scrollTop;
    let screen: HTMLElement;
    if (this.tab === 'flock' && this.openDuckId) {
      screen = duckScreen(this.game, this.openDuckId, () => {
        this.openDuckId = null;
        this.forceRender();
      });
    } else if (this.tab === 'flock') {
      screen = flockScreen(this.game, (id) => {
        this.openDuckId = id;
        this.forceRender();
      });
    } else if (this.tab === 'pond') {
      screen = pondScreen(this.game);
    } else {
      screen = dayScreen(this.game);
    }
    this.screenHost.replaceChildren(screen);
    this.screenHost.scrollTop = scroll;
  }
}
