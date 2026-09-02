// Companion mode: the pocket pond. Runs the REAL sim (a full Game on the
// real save) behind a touch-first care UI — no canvas pond, no desktop
// panels. Reached at /companion; pairs to the cloud save via the code the
// desktop's Save panel mints.
//
// It is a visitor, not a second player. By default it *peeks*: shows the
// cloud's latest copy (whatever the desktop pushed last) and touches nothing,
// so the desktop keeps running. Tapping "Take the reins" claims the pond and
// runs the sim here — the desktop pauses — and putting the phone down hands
// it straight back, at which point the desktop picks up on its own.
import { events } from '../events';
import { Game } from '../game';
import { startLoop } from '../loop';
import { attachCloudSync, claimAndReload, detachCloudSync, handoffCloudSync, peekCloud, prepareCloudBoot, takeCloud, type SyncStatus } from '../sync/sync';
import { isSyncConfigured, loadSyncMeta } from '../sync/syncMeta';
import { formatClock } from '../sim/time';
import { el } from '../ui/dom';
import { icon } from '../ui/icons';
import { renderPairScreen } from './pairScreen';
import { attentionCount, bookScreen, dayScreen, duckScreen, flockScreen, nestScreen, pondScreen, shopScreen, type Ctx } from './screens';

type Tab = 'flock' | 'nest' | 'pond' | 'shop' | 'book' | 'day';
type Mode = 'peek' | 'play';

// How often a peeking companion looks for a newer cloud copy. The desktop
// pushes on every autosave (30s), so anything tighter just costs battery.
const PEEK_MS = 15_000;

export function runCompanion(): void {
  // Installable PWA: the service worker is registered only in companion mode,
  // so the desktop game is untouched.
  if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
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
  const meta = loadSyncMeta()!;
  // A phone still holding play the cloud never accepted (its last handoff
  // failed) goes through the full boot — the conflict question, then play —
  // so nothing is quietly thrown away. Otherwise it just looks.
  let resumePlay = false;
  if (meta.dirty) {
    await prepareCloudBoot();
    resumePlay = true;
  } else {
    try {
      await peekCloud(null);
    } catch {
      // Offline: show whatever copy this phone last saw, read-only.
    }
  }
  const game = new Game();
  game.speed = 0;
  const shell = new Shell(game, root);
  if (resumePlay) {
    attachCloudSync(game);
    shell.enterPlay();
  } else {
    shell.enterPeek();
  }
  startLoop(
    game.tick,
    () => shell.render(),
    () => shell.speed(),
  );
}

class Shell {
  private tab: Tab = 'flock';
  private mode: Mode = 'peek';
  private openDuckId: string | null = null;
  private nestPick: string | null = null; // first duck chosen for a pairing
  private lastRender = 0;
  private pointerDown = false;
  private busy = false; // a take or hand-back is in flight
  private peekInfo: { owner: string | null; savedAt: number; fetchedAt: number; offline: boolean } | null = null;
  private peekTimer: number | null = null;
  private syncStatus: SyncStatus = 'synced';
  private header: HTMLElement;
  private modebar: HTMLElement;
  private screenHost: HTMLElement;
  private nav: HTMLElement;
  private toastHost: HTMLElement;

  constructor(
    private game: Game,
    root: HTMLElement,
  ) {
    this.header = el('header', { class: 'comp-header' });
    this.modebar = el('div', { class: 'comp-modebar' });
    this.screenHost = el('main', { class: 'comp-screen' });
    this.nav = el('nav', { class: 'comp-nav' });
    this.toastHost = el('div', { class: 'comp-toasts' });
    root.replaceChildren(this.header, this.modebar, this.screenHost, this.nav, this.toastHost);

    const navBtn = (tab: Tab, iconName: Parameters<typeof icon>[0], label: string): HTMLElement =>
      el(
        'button',
        {
          class: 'comp-nav-btn',
          'data-tab': tab,
          onclick: () => {
            this.tab = tab;
            this.openDuckId = null;
            this.nestPick = null;
            this.forceRender();
          },
        },
        icon(iconName, 15),
        label,
        el('span', { class: 'comp-nav-dot', hidden: true }),
      );
    this.nav.append(
      navBtn('flock', 'duck', 'Flock'),
      navBtn('nest', 'egg', 'Nest'),
      navBtn('pond', 'broom', 'Chores'),
      navBtn('shop', 'cart', 'Shop'),
      navBtn('book', 'book', 'Book'),
      navBtn('day', 'flag', 'Day'),
    );

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

    // Putting the phone down hands the pond back. visibilitychange is the
    // signal that fires reliably on mobile (pagehide is the backstop for a
    // real unload); while hidden the page is still alive, so the push is a
    // normal fetch and isn't bound by the keepalive body cap.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.handBack(true);
      else if (this.mode === 'peek') void this.refreshPeek();
    });
    window.addEventListener('pagehide', () => void this.handBack(true));

    events.on('toast', (msg) => this.toast(String(msg)));
    // The main UI shows banners for these; the companion keeps to toasts.
    events.on('duck-grew', (payload) => {
      const { duck, to } = payload as { duck: { name: string }; to: string };
      if (to === 'adult') this.toast(`${duck.name} is all grown up — ready to nest`);
      else if (to === 'elder') this.toast(`${duck.name} has become a wise old elder`);
    });
    events.on('duck-died', (payload) => {
      const { duck } = payload as { duck: { name: string } };
      this.toast(`${duck.name} has passed away`);
    });
    events.on('takeover', (payload) => {
      const remote = Boolean((payload as { remote?: boolean } | undefined)?.remote);
      if (!remote) {
        this.showTakeover();
        return;
      }
      // The desktop took the pond back while we held it: step aside and
      // just watch. Nothing to click — that's the whole point.
      if (this.mode === 'play') {
        detachCloudSync();
        this.game.stale = false;
        this.toast('The desktop took the pond back — watching from here.');
        this.enterPeek();
      }
    });
    events.on('sync-status', (status) => {
      this.syncStatus = status as SyncStatus;
      this.renderModebar();
    });
  }

  // The loop's speed: the sim only runs while this device holds the pond.
  speed(): number {
    return this.mode === 'play' ? this.game.speed : 0;
  }

  // ---- modes -----------------------------------------------------------------

  enterPeek(): void {
    this.mode = 'peek';
    this.game.speed = 0;
    if (this.peekTimer === null) this.peekTimer = window.setInterval(() => void this.refreshPeek(), PEEK_MS);
    void this.refreshPeek();
    this.forceRender();
  }

  enterPlay(): void {
    this.mode = 'play';
    if (this.peekTimer !== null) {
      clearInterval(this.peekTimer);
      this.peekTimer = null;
    }
    this.game.speed = 1;
    this.forceRender();
  }

  private async refreshPeek(): Promise<void> {
    if (this.mode !== 'peek' || this.busy) return;
    try {
      const peek = await peekCloud(this.game);
      this.peekInfo = { owner: peek.owner, savedAt: peek.savedAt, fetchedAt: Date.now(), offline: false };
      if (peek.changed) {
        this.openDuckId = this.openDuckId && this.game.state.ducks.some((d) => d.id === this.openDuckId) ? this.openDuckId : null;
        this.forceRender();
      } else this.renderModebar();
    } catch {
      this.peekInfo = { ...(this.peekInfo ?? { owner: null, savedAt: 0, fetchedAt: 0 }), offline: true };
      this.renderModebar();
    }
  }

  private async takeReins(): Promise<void> {
    if (this.mode === 'play' || this.busy) return;
    this.busy = true;
    this.renderModebar();
    try {
      await takeCloud(this.game);
      this.enterPlay();
      this.toast('You have the pond. The desktop waits until you put the phone down.');
    } catch {
      this.toast('Could not reach the pond — check your connection and try again.');
    }
    this.busy = false;
    this.forceRender();
  }

  // Hand the pond back. `leaving` means the page is going away (hidden or
  // unloading): the push may use keepalive and there's nobody to toast at.
  private async handBack(leaving: boolean): Promise<void> {
    if (this.mode !== 'play' || this.busy) return;
    this.busy = true;
    this.mode = 'peek';
    this.game.speed = 0;
    const ok = await handoffCloudSync(leaving);
    // A failed handoff leaves the attachment alive: its poll keeps retrying
    // the release, and this phone stays the owner until it lands.
    if (ok) detachCloudSync();
    this.busy = false;
    if (!leaving) this.toast(ok ? 'Handed back — the desktop picks up from here.' : 'Could not reach the pond — will keep trying.');
    this.enterPeek();
  }

  // A pond-changing tap while peeking: offer the reins instead.
  private act = (fn: () => unknown): (() => void) => () => {
    if (this.mode !== 'play') {
      this.offerReins();
      return;
    }
    fn();
    this.forceRender();
  };

  private offerReins(): void {
    document.querySelector('.comp-takeover')?.remove();
    const offline = this.peekInfo?.offline ?? false;
    const sheet = el(
      'div',
      { class: 'comp-takeover', onclick: (e: Event) => { if (e.target === sheet) sheet.remove(); } },
      el(
        'div',
        { class: 'comp-takeover-card' },
        el('strong', {}, 'Take the pond?'),
        el(
          'p',
          { class: 'comp-muted' },
          offline
            ? 'The pond cannot be reached right now, so this copy is read-only.'
            : 'The desktop pauses while you have it and carries on by itself once you put the phone down.',
        ),
        el('button', { class: 'comp-btn primary', disabled: offline, onclick: () => { sheet.remove(); void this.takeReins(); } }, 'Take the reins'),
        el('button', { class: 'comp-btn ghost', onclick: () => sheet.remove() }, 'Just looking'),
      ),
    );
    document.body.append(sheet);
  }

  // ---- chrome ----------------------------------------------------------------

  private toast(msg: string): void {
    const node = el('div', { class: 'comp-toast' }, msg);
    this.toastHost.append(node);
    setTimeout(() => node.remove(), 3500);
  }

  // Another tab in this same browser opened the companion.
  private showTakeover(): void {
    document.querySelector('.comp-takeover')?.remove();
    document.body.append(
      el(
        'div',
        { class: 'comp-takeover' },
        el(
          'div',
          { class: 'comp-takeover-card' },
          el('strong', {}, 'Pond opened in another tab'),
          el('p', { class: 'comp-muted' }, 'This one has paused so the saves cannot clash.'),
          el(
            'button',
            {
              class: 'comp-btn primary',
              onclick: () => {
                if (this.mode === 'play') claimAndReload().catch(() => this.toast('Could not reach the cloud — try again in a moment.'));
                else location.reload();
              },
            },
            'Use this tab instead',
          ),
        ),
      ),
    );
  }

  private forceRender(): void {
    this.lastRender = 0;
    this.render();
  }

  // Called every animation frame by startLoop; the DOM refreshes at 1 Hz
  // while playing. Peeking, nothing moves between cloud pulls, so the
  // screen is only rebuilt when something changed (see refreshPeek).
  render(): void {
    const now = performance.now();
    if (this.pointerDown) return;
    const forced = this.lastRender === 0;
    if (!forced && now - this.lastRender < 1000) return;
    if (!forced && this.mode === 'peek') {
      // Only the modebar's "updated 40s ago" moves between cloud pulls.
      this.lastRender = now;
      this.renderModebar();
      return;
    }
    this.lastRender = now;
    this.renderHeader();
    this.renderModebar();
    this.renderScreen();
    const attention = attentionCount(this.game);
    for (const btn of this.nav.querySelectorAll('.comp-nav-btn')) {
      const b = btn as HTMLElement;
      b.classList.toggle('active', b.dataset.tab === this.tab);
      const dot = b.querySelector('.comp-nav-dot') as HTMLElement | null;
      if (dot) dot.hidden = !(b.dataset.tab === 'day' && attention > 0);
    }
  }

  private renderHeader(): void {
    const s = this.game.state;
    this.header.replaceChildren(
      el('span', { class: 'comp-clock' }, formatClock(s.clock)),
      el('span', { class: 'comp-chip chip-coin' }, icon('coin', 13), String(s.money)),
      el('span', { class: 'comp-chip chip-feed' }, icon('wheat', 13), String(s.inventory.feed)),
      el('span', { class: 'comp-chip chip-eggs' }, icon('egg', 13), String(s.inventory.eggs)),
      this.mode === 'play'
        ? el(
            'button',
            {
              class: `comp-chip comp-pause${this.game.speed === 0 ? ' paused' : ''}`,
              title: this.game.speed === 0 ? 'Resume time' : 'Pause time',
              onclick: () => {
                this.game.speed = this.game.speed === 0 ? 1 : 0;
                this.forceRender();
              },
            },
            icon(this.game.speed === 0 ? 'play' : 'pause', 13),
          )
        : el('span'),
    );
  }

  private renderModebar(): void {
    const meta = loadSyncMeta();
    let text: string;
    let cls = '';
    let button: HTMLElement;
    if (this.mode === 'play') {
      const st = this.syncStatus;
      text = st === 'offline' ? 'You have the pond · not reaching the cloud' : st === 'syncing' ? 'You have the pond · saving…' : 'You have the pond · the desktop is paused';
      cls = st === 'offline' ? 'warn' : 'live';
      button = el('button', { class: 'comp-btn small', disabled: this.busy, onclick: () => void this.handBack(false) }, 'Hand back');
    } else {
      const p = this.peekInfo;
      const who = !p || p.savedAt === 0
        ? 'nothing in the cloud yet'
        : p.owner === null
          ? 'nobody is at the pond'
          : p.owner === meta?.deviceId
            ? 'last played here'
            : 'the desktop is playing';
      const ago = p && p.savedAt > 0 ? ` · updated ${agoLabel(Date.now() - p.savedAt)}` : '';
      text = p?.offline ? `Can't reach the pond · showing the last copy${ago}` : `Watching · ${who}${ago}`;
      cls = p?.offline ? 'warn' : '';
      button = el(
        'button',
        { class: 'comp-btn small primary', disabled: this.busy || (p?.offline ?? false), onclick: () => void this.takeReins() },
        this.busy ? 'Taking…' : 'Take the reins',
      );
    }
    this.modebar.className = `comp-modebar ${cls}`;
    this.modebar.replaceChildren(el('span', { class: 'comp-modebar-text' }, text), button);
  }

  private renderScreen(): void {
    const scroll = this.screenHost.scrollTop;
    const ctx: Ctx = { game: this.game, act: this.act };
    const openDuck = (id: string): void => {
      this.tab = 'flock';
      this.openDuckId = id;
      this.forceRender();
    };
    let screen: HTMLElement;
    // A duck that was sold or died while its sheet was open drops back to
    // the grid without a blank frame.
    const open = this.openDuckId ? this.game.state.ducks.find((d) => d.id === this.openDuckId) : undefined;
    if (this.tab === 'flock' && this.openDuckId && !open) this.openDuckId = null;
    if (this.tab === 'flock' && open) {
      screen = duckScreen(ctx, open, () => {
        this.openDuckId = null;
        this.forceRender();
      });
    } else if (this.tab === 'flock') {
      screen = flockScreen(ctx, openDuck);
    } else if (this.tab === 'pond') {
      screen = pondScreen(ctx);
    } else if (this.tab === 'nest') {
      screen = nestScreen(ctx, this.nestPick, (id) => {
        this.nestPick = id;
        this.forceRender();
      });
    } else if (this.tab === 'shop') {
      screen = shopScreen(ctx);
    } else if (this.tab === 'book') {
      screen = bookScreen(ctx);
    } else {
      screen = dayScreen(ctx, openDuck);
    }
    this.screenHost.replaceChildren(screen);
    this.screenHost.scrollTop = scroll;
  }
}

function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'just now';
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
