// @vitest-environment jsdom
//
// UI smoke test: boot the real game against a jsdom document with a stubbed
// 2D canvas, then open every panel, card, and screen the desktop UI and the
// companion can show. It asserts almost nothing about *content* — the point
// is that no panel throws, on a fresh pond and on one a few days old.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../game';
import { Renderer } from '../render/renderer';
import { UI, type PanelKind } from './ui';
import { keyCaptureActive } from './settingsPanel';
import { events } from '../events';
import { CHAPTERS } from '../sim/goals';
import { pushEgg } from '../testFixtures';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_SEASON } from '../sim/time';
import { FESTIVAL_DAY } from '../sim/calendar';
import { SEASONS } from '../types';
import { SYNC_META_KEY } from '../sync/syncMeta';

// ---- canvas stub -------------------------------------------------------------

// jsdom has no canvas. Every context method becomes a no-op; the few that
// must hand something back (gradients, transforms, text metrics, image
// data) return the minimal shape the painters read.
function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  const special: Record<string, unknown> = {
    canvas,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
    createPattern: () => ({ setTransform: noop }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getLineDash: () => [],
    isPointInPath: () => false,
    isPointInStroke: () => false,
  };
  const props = new Map<string | symbol, unknown>();
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, key) {
      if (typeof key === 'string' && key in special) return special[key];
      if (props.has(key)) return props.get(key);
      if (typeof key === 'symbol') return undefined;
      return noop;
    },
    set(_t, key, value) {
      props.set(key, value);
      return true;
    },
  });
}

// Node 22+ ships its own (file-backed, here unusable) `localStorage` global
// that shadows jsdom's, so the test brings a Map-backed one.
function installStorage(): void {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
  for (const target of new Set<object>([globalThis, window])) {
    Object.defineProperty(target, 'localStorage', { value: storage, configurable: true, writable: true });
  }
}

// ---- helpers -----------------------------------------------------------------

function mountDom(): void {
  document.body.innerHTML = '<div id="app"><canvas id="pond-canvas"></canvas><div id="ui-root"></div></div>';
  document.body.className = '';
}

function canvasEl(): HTMLCanvasElement {
  return document.getElementById('pond-canvas') as HTMLCanvasElement;
}

function bootUi(): { game: Game; renderer: Renderer; ui: UI } {
  const game = new Game();
  const renderer = new Renderer(canvasEl(), game);
  const ui = new UI(game, renderer);
  return { game, renderer, ui };
}

const MODALS: Exclude<PanelKind, 'duck'>[] = ['breeding', 'shop', 'roster', 'save', 'book', 'settings', 'goals'];

// Click every tab-like button a panel shows (tab bars, roster filters,
// settings toggles) and pick every option of its selects, rebuilding after
// each, so each tab's body renders at least once. Re-queried each time: a
// click rebuilds the panel and the old buttons are gone. Deliberately not
// every `roster-chip`: the settings panel's "Change" key buttons start a
// module-level key capture that would eat the next test's keystrokes.
function clickTabs(host: () => Element | null, refresh: () => void): void {
  const selector = 'button[aria-pressed], button.shop-tab, .roster-filters button.roster-chip';
  const count = host()?.querySelectorAll(selector).length ?? 0;
  for (let i = 0; i < count; i += 1) {
    const buttons = host()?.querySelectorAll<HTMLElement>(selector);
    buttons?.[i]?.click();
    refresh();
  }
  const selects = host()?.querySelectorAll('select').length ?? 0;
  for (let i = 0; i < selects; i += 1) {
    const options = host()?.querySelectorAll('select')[i]?.options.length ?? 0;
    for (let j = 0; j < options; j += 1) {
      const select = host()?.querySelectorAll('select')[i];
      if (!select) break;
      select.selectedIndex = j;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      refresh();
    }
  }
}

// Open a modal, render it, walk its tabs, close it.
function exerciseModal(ui: UI, kind: Exclude<PanelKind, 'duck'>): void {
  ui.openPanel(kind);
  ui.refreshPanel();
  const host = () => document.querySelector('.modal-host');
  expect(host()?.firstElementChild, `${kind} panel rendered nothing`).toBeTruthy();
  clickTabs(host, () => ui.refreshPanel());
  ui.closeModal();
}

// Open one duck's floating card, walk its tabs, close it.
function exerciseDuckCard(ui: UI, game: Game, id: string): void {
  game.selectedDuckId = id;
  ui.openPanel('duck');
  ui.refreshPanel();
  const host = () => document.querySelector('.float-host');
  expect(host()?.firstElementChild, `duck card for ${id} rendered nothing`).toBeTruthy();
  clickTabs(host, () => ui.refreshPanel());
  ui.closeDuckCard();
}

function closeOverlay(): void {
  document.querySelector<HTMLElement>('.race-overlay .close-btn')?.click();
  document.querySelector('.race-overlay')?.remove();
}

function key(k: string, opts: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
}

// Noon on a season's festival day.
function festivalNoon(seasonIndex: number): number {
  return seasonIndex * TICKS_PER_SEASON + (FESTIVAL_DAY - 1) * TICKS_PER_DAY + 12 * TICKS_PER_HOUR;
}

// Advance the real sim `days` days through Game.tick (the loop's tick).
function runDays(game: Game, days: number): void {
  game.speed = 1;
  game.state.inventory.feed = 100_000;
  for (let i = 0; i < days * TICKS_PER_DAY; i += 1) game.tick();
}

// ---- setup -------------------------------------------------------------------

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  // No timer may fire on its own: the Game and the UI both start intervals
  // in their constructors, and a stray tick against a torn-down DOM would
  // fail an unrelated test. Tests advance time explicitly where they want a
  // refresh to run.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  installStorage();
  mountDom();
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    return fakeContext(this);
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // Animation frames never run: nothing in a smoke test waits on one.
  let raf = 0;
  window.requestAnimationFrame = () => (raf += 1);
  window.cancelAnimationFrame = () => undefined;
  window.innerWidth = 1280;
  window.innerHeight = 800;
  // The game logs on purpose (corrupt saves, sync); none of it is a failure.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy?.mockRestore();
  warnSpy = null;
  vi.useRealTimers();
});

// ---- tests -------------------------------------------------------------------

describe('ui smoke', () => {
  it('boots from an empty save and renders a frame', () => {
    const { game, renderer, ui } = bootUi();
    expect(game.state.ducks.length).toBeGreaterThan(0);
    expect(() => renderer.render(0)).not.toThrow();
    expect(() => renderer.render(0.5)).not.toThrow();
    expect(document.querySelector('.hud')).toBeTruthy();
    // Let the periodic HUD / panel / rail refreshes run once.
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(ui.modalKindNow()).toBeNull();
  });

  it('renders every modal panel and its tabs on a fresh pond', () => {
    const { ui } = bootUi();
    for (const kind of MODALS) exerciseModal(ui, kind);
    expect(ui.modalKindNow()).toBeNull();
  });

  it('renders the duck card for an adult and for an egg, and a pinned copy', () => {
    const { game, ui } = bootUi();
    const adult = game.state.ducks.find((d) => d.stage === 'adult')!;
    exerciseDuckCard(ui, game, adult.id);

    const egg = pushEgg(game.state, game.rng);
    exerciseDuckCard(ui, game, egg.id);

    // The main card plus a pinned comparison copy, both live at once.
    game.selectedDuckId = adult.id;
    ui.openPanel('duck');
    const other = game.state.ducks.find((d) => d.id !== adult.id && d.stage !== 'egg')!;
    ui.pinDuck(other.id);
    expect(ui.isPinned(other.id)).toBe(true);
    ui.refreshPanel();
    expect(document.querySelector('.float-host.pinned')?.firstElementChild).toBeTruthy();
    // Card and modal open together (a pin survives opening the shop).
    ui.openPanel('shop');
    ui.refreshPanel();
    ui.unpinDuck(other.id);
    expect(ui.isPinned(other.id)).toBe(false);
    ui.closePanel();
  });

  it('shows the card rail, goals widget, dawn card, banners and overlays', () => {
    const { game, ui } = bootUi();
    // Card rail on (the toggle is what the HUD button and the 'c' key call).
    key('c');
    expect(document.querySelector('.rail-host')?.firstElementChild).toBeTruthy();
    vi.advanceTimersByTime(600); // one HUD refresh: goals + requests widgets
    expect(document.querySelector('.goals-widget')?.firstElementChild).toBeTruthy();
    key('c');

    expect(() => events.emit('dawn')).not.toThrow();
    expect(document.querySelector('.dawn-card')).toBeTruthy();

    const duck = game.state.ducks[0];
    expect(() => events.emit('duck-grew', { duck, to: 'adult' })).not.toThrow();
    expect(() => events.emit('duck-grew', { duck, to: 'elder' })).not.toThrow();
    expect(() => events.emit('duck-died', { duck, descendants: 2, honoured: 1, ageDays: 40 })).not.toThrow();
    expect(() => events.emit('chapter-done', CHAPTERS[0])).not.toThrow();
    expect(() => events.emit('favourite-found', duck)).not.toThrow();
    expect(document.querySelectorAll('.life-banner').length).toBeGreaterThan(0);

    expect(() => events.emit('takeover')).not.toThrow();
    expect(document.querySelector('.takeover-overlay')).toBeTruthy();
    expect(() => events.emit('takeover', { remote: true })).not.toThrow();
    expect(() => events.emit('resumed')).not.toThrow();
    expect(document.querySelector('.takeover-overlay')).toBeNull();
    expect(ui.modalKindNow()).toBeNull();
    // Toasts and banners time out without a fuss.
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
  });

  it('opens the race panel and each festival screen', () => {
    const { game, ui } = bootUi();
    game.state.stats.ducksHatched = 1; // unlocks the derby
    ui.openRace();
    expect(document.querySelector('.race-overlay')).toBeTruthy();
    closeOverlay();
    expect(document.querySelector('.race-overlay')).toBeNull();

    // One festival per season; the chip is the entry point the HUD uses.
    const chip = (ui as unknown as { onFestivalChip(): void }).onFestivalChip.bind(ui);
    pushEgg(game.state, game.rng); // an entry for the egg show
    for (let i = 0; i < SEASONS.length; i += 1) {
      game.state.clock.totalTicks = festivalNoon(i);
      expect(() => chip(), `festival for ${SEASONS[i]}`).not.toThrow();
      vi.advanceTimersByTime(250); // festival chip text refresh
      closeOverlay();
    }
    // Not a festival day: the chip just toasts.
    game.state.clock.totalTicks = 7 * TICKS_PER_HOUR;
    expect(() => chip()).not.toThrow();
  });

  it('handles the keyboard shortcuts', () => {
    const { game, ui } = bootUi();
    // Seasoned stats so the gated panels open instead of toasting.
    game.state.stats.pets = 4;
    game.state.stats.ducksHatched = 1;
    game.state.stats.ducksBred = 1;
    for (const k of ['1', '2', '3', '4', '5', '6', 'c', 'p', '?', '+', '-', ' ', 'Tab', 'x']) {
      expect(() => key(k), `key ${JSON.stringify(k)}`).not.toThrow();
      expect(() => ui.refreshPanel()).not.toThrow();
      expect(() => key('Escape')).not.toThrow();
    }
    // Modifier combos are ignored, and typing in a field is left alone.
    key('1', { ctrlKey: true });
    key('2', { metaKey: true });
    expect(ui.modalKindNow()).toBeNull();
    ui.openPanel('save');
    ui.refreshPanel();
    const input = document.querySelector<HTMLInputElement>('.modal-host input, .modal-host textarea');
    if (input) {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
      expect(ui.modalKindNow()).toBe('save');
    }
    key('Escape');
    key('Escape');
    expect(ui.modalKindNow()).toBeNull();
    expect(ui.duckCardIsOpen()).toBe(false);

    // Rebinding: "Change" arms a capture, Escape cancels it, and the game's
    // handler is back in charge afterwards.
    ui.openPanel('settings');
    ui.refreshPanel();
    const change = [...document.querySelectorAll<HTMLElement>('.modal-host button')].find((b) => b.textContent === 'Change');
    expect(change).toBeTruthy();
    change!.click();
    ui.refreshPanel();
    expect(keyCaptureActive()).toBe(true);
    key('Escape');
    expect(keyCaptureActive()).toBe(false);
    key('Escape');
    expect(ui.modalKindNow()).toBeNull();
  });

  it('renders everything again on a pond that has lived a few days', () => {
    const { game, renderer, ui } = bootUi();
    // Three in-game days through the real tick: hatches, growth, awards,
    // commissions, chronicle entries, rivals, weather — with the UI's event
    // handlers (dawn cards, banners) live the whole way.
    expect(() => runDays(game, 3)).not.toThrow();
    expect(Number.isFinite(game.state.money)).toBe(true);
    expect(() => renderer.render(0.3)).not.toThrow();

    // A life event rolled during the run pops its card straight away (and an
    // open overlay owns the keyboard). Take a look at it, then close it.
    if (game.state.lifeEvent) {
      closeOverlay();
      (ui as unknown as { openLifeEvent(): void }).openLifeEvent();
      expect(document.querySelector('.race-overlay .life-choice')).toBeTruthy();
    }
    closeOverlay();

    for (const kind of MODALS) exerciseModal(ui, kind);
    for (const duck of game.state.ducks) exerciseDuckCard(ui, game, duck.id);

    key('c');
    vi.advanceTimersByTime(600);
    expect(document.querySelector('.rail-host')?.firstElementChild).toBeTruthy();
    events.emit('dawn');
    expect(document.querySelector('.dawn-card')).toBeTruthy();

    // The save round-trips and boots a second UI from storage.
    game.save();
    mountDom();
    const again = bootUi();
    expect(again.game.state.clock.totalTicks).toBe(game.state.clock.totalTicks);
    for (const kind of MODALS) exerciseModal(again.ui, kind);
    expect(() => again.renderer.render(1)).not.toThrow();
  });
});

describe('companion smoke', () => {
  it('shows the pair screen when no sync is configured', async () => {
    const { runCompanion } = await import('../companion/companion');
    expect('serviceWorker' in navigator).toBe(false);
    expect(() => runCompanion()).not.toThrow();
    expect(document.getElementById('pond-canvas')).toBeNull();
    expect(document.querySelector('.comp-pair-input')).toBeTruthy();
    expect(document.querySelector('.comp-btn')).toBeTruthy();
  });

  it('boots the offline companion shell and renders every screen', async () => {
    const { runCompanion } = await import('../companion/companion');
    // Linked, clean, and the cloud unreachable: the shell shows the last
    // local copy read-only (a fresh pond here) without touching the network.
    localStorage.setItem(
      SYNC_META_KEY,
      JSON.stringify({ syncId: 'smoke', secret: 'x'.repeat(32), deviceId: 'phone', lastSyncedSeq: 0, dirty: false }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    try {
      runCompanion();
      // bootCompanion awaits the (failing) peek before building the shell.
      for (let i = 0; i < 20 && !document.querySelector('.comp-nav'); i += 1) await Promise.resolve();
      expect(document.querySelector('.comp-nav')).toBeTruthy();
      const tabs = document.querySelectorAll<HTMLElement>('.comp-nav-btn');
      expect(tabs.length).toBe(6);
      for (const tab of tabs) {
        expect(() => tab.click(), `companion tab ${tab.dataset.tab}`).not.toThrow();
        expect(document.querySelector('.comp-screen')?.firstElementChild).toBeTruthy();
      }
      // Open a duck's sheet from the flock grid.
      tabs[0].click();
      const first = document.querySelector<HTMLElement>('.comp-screen button');
      first?.click();
      expect(document.querySelector('.comp-screen')?.firstElementChild).toBeTruthy();
      // A pond-changing tap while peeking offers the reins.
      const pond = [...tabs].find((t) => t.dataset.tab === 'pond')!;
      pond.click();
      document.querySelector<HTMLElement>('.comp-screen button')?.click();
      expect(() => vi.advanceTimersByTime(20_000)).not.toThrow(); // peek timer + toasts
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
