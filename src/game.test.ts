import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from './game';
import { events } from './events';
import { createNewGame } from './newGame';
import { deserialize, OWNER_KEY, SAVE_KEY, serialize } from './save/save';
import { BALANCE } from './sim/economy';
import { NIGHT_END, NIGHT_START, TICKS_PER_DAY, TICKS_PER_HOUR } from './sim/time';
import { installFakeStorage, pushEgg, uninstallFakeStorage } from './testFixtures';

type Listener = (e: unknown) => void;

// installFakeStorage's window swallows listeners; Game's takeover check lives
// in a 'storage' listener, so this stub keeps them and can fire them.
function installWindowWithListeners(): { fire: (type: string, e: unknown) => void } {
  const listeners = new Map<string, Listener[]>();
  (globalThis as { window?: unknown }).window = {
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    removeEventListener: () => {},
  };
  return { fire: (type, e) => listeners.get(type)?.forEach((fn) => fn(e)) };
}

// Counts emissions of one event; `off` unsubscribes (events is a singleton).
function count(event: Parameters<typeof events.on>[0]): { n: () => number; payloads: unknown[]; off: () => void } {
  const payloads: unknown[] = [];
  const off = events.on(event, (p) => payloads.push(p));
  return { n: () => payloads.length, payloads, off };
}

const DAWN_TICK = NIGHT_END * TICKS_PER_HOUR;

describe('Game', () => {
  let map: Map<string, string>;
  let win: ReturnType<typeof installWindowWithListeners>;
  const offs: Array<() => void> = [];
  const track = (event: Parameters<typeof events.on>[0]) => {
    const c = count(event);
    offs.push(c.off);
    return c;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    map = installFakeStorage();
    win = installWindowWithListeners();
  });
  afterEach(() => {
    for (const off of offs.splice(0)) off();
    vi.useRealTimers();
    uninstallFakeStorage();
  });

  describe('boot', () => {
    it('with empty storage starts a fresh pond of four and claims the save', () => {
      const toasts = track('toast');
      const game = new Game();
      expect(game.state.ducks).toHaveLength(4);
      expect(game.state.ducks.every((d) => d.stage === 'adult')).toBe(true);
      expect(toasts.payloads).toEqual(['Welcome to your new pond!']);
      expect(game.stale).toBe(false);
      expect(game.speed).toBe(1);
      expect(map.get(OWNER_KEY)).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
      // Nothing is written until a save happens.
      expect(map.has(SAVE_KEY)).toBe(false);
    });

    it('from a stored save restores that state and welcomes the player back', () => {
      const { state, rng } = createNewGame(77);
      state.money = 4242;
      state.rngState = rng.getState();
      map.set(SAVE_KEY, serialize(state));
      const toasts = track('toast');
      const game = new Game();
      expect(toasts.payloads).toEqual(['Welcome back to the pond!']);
      expect(game.state.money).toBe(4242);
      expect(game.state).toEqual(deserialize(serialize(state)));
      // The live rng picks up exactly where the save left off.
      expect(game.rng.getState()).toBe(state.rngState);
    });

    it('from an unreadable save starts fresh and says the old one is kept', () => {
      map.set(SAVE_KEY, '{"version":1,"state":{"broken":true}}');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const toasts = track('toast');
      const game = new Game();
      warn.mockRestore();
      expect(game.state.ducks).toHaveLength(4);
      expect(toasts.payloads[0]).toMatch(/could not be read/);
    });
  });

  describe('tick', () => {
    it('advances the clock one tick and stores the rng state', () => {
      const game = new Game();
      const before = game.state.clock.totalTicks;
      game.tick();
      expect(game.state.clock.totalTicks).toBe(before + 1);
      expect(game.state.rngState).toBe(game.rng.getState());
    });

    it("emits 'dawn' on the 06:00 tick and no other", () => {
      const game = new Game();
      const dawn = track('dawn');
      game.state.clock.totalTicks = TICKS_PER_DAY + DAWN_TICK - 2;
      game.tick(); // 05:59:50
      expect(dawn.n()).toBe(0);
      game.tick(); // 06:00 exactly
      expect(dawn.n()).toBe(1);
      expect(game.state.clock.totalTicks % TICKS_PER_DAY).toBe(DAWN_TICK);
      game.tick();
      expect(dawn.n()).toBe(1);
    });

    it('does nothing once the tab is stale', () => {
      const game = new Game();
      game.stale = true;
      const before = game.state.clock.totalTicks;
      game.tick();
      expect(game.state.clock.totalTicks).toBe(before);
    });
  });

  describe('sleeping', () => {
    it('sleepChunk by day sleeps nothing and reports done', () => {
      const game = new Game(); // a new pond starts at 07:00
      const before = game.state.clock.totalTicks;
      expect(game.sleepChunk(500)).toEqual({ slept: 0, done: true });
      expect(game.state.clock.totalTicks).toBe(before);
    });

    it('sleepChunk runs at most the budget, and sleepUntilDawn finishes the night on the dawn tick', () => {
      const game = new Game();
      game.state.clock.totalTicks = NIGHT_START * TICKS_PER_HOUR; // 21:00
      const dawn = track('dawn');
      const saved = track('saved');
      expect(game.sleepChunk(100)).toEqual({ slept: 100, done: false });
      expect(game.state.clock.totalTicks).toBe(NIGHT_START * TICKS_PER_HOUR + 100);
      expect(saved.n()).toBe(0); // no hatch: a chunk owes no save

      const nightTicks = (24 - NIGHT_START + NIGHT_END) * TICKS_PER_HOUR;
      expect(game.sleepUntilDawn()).toBe(nightTicks - 100);
      expect(game.state.clock.totalTicks).toBe(TICKS_PER_DAY + DAWN_TICK);
      expect(dawn.n()).toBe(1);
      expect(saved.n()).toBe(1); // the atomic sleep saves once at the end
      // Already morning: nothing more to sleep.
      expect(game.sleepUntilDawn()).toBe(0);
      expect(game.sleepChunk(10)).toEqual({ slept: 0, done: true });
    });

    it('a stale tab refuses to sleep', () => {
      const game = new Game();
      game.state.clock.totalTicks = NIGHT_START * TICKS_PER_HOUR;
      game.stale = true;
      expect(game.sleepChunk(10)).toEqual({ slept: 0, done: true });
    });
  });

  describe('saving after a hatch', () => {
    // Two cracked eggs one tick from auto-hatching: both hatch inside the
    // same tickLifecycle loop.
    function readyTwoEggs(game: Game): void {
      for (let i = 0; i < 2; i += 1) {
        const egg = pushEgg(game.state, game.rng);
        egg.readyToHatch = true;
        egg.readyTicks = BALANCE.eggClaimGraceTicks - 1;
      }
    }

    it('saves once at the end of the tick, not from inside it', () => {
      const game = new Game();
      readyTwoEggs(game);
      const saved = track('saved');
      const savedAtHatch: number[] = [];
      offs.push(events.on('egg-hatched', () => savedAtHatch.push(saved.n())));
      game.tick();
      expect(savedAtHatch).toEqual([0, 0]); // two hatches, no save yet at either
      expect(saved.n()).toBe(1);
      expect(map.has(SAVE_KEY)).toBe(true);
      expect(game.state.ducks.filter((d) => d.stage === 'duckling')).toHaveLength(2);
      game.tick();
      expect(saved.n()).toBe(1); // the debt was cleared
    });

    it('a sleep chunk batches hatch saves into one at the end of the chunk', () => {
      const game = new Game();
      game.state.clock.totalTicks = NIGHT_START * TICKS_PER_HOUR;
      readyTwoEggs(game);
      const saved = track('saved');
      const savedAtHatch: number[] = [];
      offs.push(events.on('egg-hatched', () => savedAtHatch.push(saved.n())));
      expect(game.sleepChunk(20).slept).toBe(20);
      expect(savedAtHatch).toEqual([0, 0]);
      expect(saved.n()).toBe(1);
    });
  });

  describe('save', () => {
    it('writes the current state and announces it', () => {
      const game = new Game();
      const saved = track('saved');
      game.state.money = 999;
      game.save();
      expect(saved.n()).toBe(1);
      expect(deserialize(map.get(SAVE_KEY)!).money).toBe(999);
    });

    it('returns silently when the tab is stale', () => {
      const game = new Game();
      const saved = track('saved');
      game.stale = true;
      game.save();
      expect(saved.n()).toBe(0);
      expect(map.has(SAVE_KEY)).toBe(false);
    });

    it('silent: true writes without emitting saved', () => {
      const game = new Game();
      const saved = track('saved');
      game.save({ silent: true });
      expect(saved.n()).toBe(0);
      expect(map.has(SAVE_KEY)).toBe(true);
    });

    it('the beforeunload handler saves silently', () => {
      const game = new Game();
      const saved = track('saved');
      win.fire('beforeunload', {});
      expect(saved.n()).toBe(0);
      expect(deserialize(map.get(SAVE_KEY)!).money).toBe(game.state.money);
    });

    it('a failed write warns the player instead of reporting a save', () => {
      const game = new Game();
      const saved = track('saved');
      const toasts = track('toast');
      (globalThis as unknown as { localStorage: { setItem: () => void } }).localStorage.setItem = () => {
        throw new Error('quota');
      };
      game.save();
      game.save(); // a second failure within the minute stays quiet
      expect(saved.n()).toBe(0);
      expect(toasts.payloads.filter((t) => String(t).startsWith('Saving failed'))).toHaveLength(1);
    });
  });

  describe('tab ownership', () => {
    it('another tab claiming the save makes this one stale, stops it, and says so', () => {
      const game = new Game();
      const takeover = track('takeover');
      const own = map.get(OWNER_KEY);
      // An unrelated key, and our own claim echoing back, change nothing.
      win.fire('storage', { key: SAVE_KEY, newValue: 'x' });
      win.fire('storage', { key: OWNER_KEY, newValue: own });
      expect(game.stale).toBe(false);
      expect(takeover.n()).toBe(0);

      win.fire('storage', { key: OWNER_KEY, newValue: 'some-other-tab' });
      expect(game.stale).toBe(true);
      expect(game.speed).toBe(0);
      expect(takeover.n()).toBe(1);
      // Repeated claims don't re-announce.
      win.fire('storage', { key: OWNER_KEY, newValue: 'yet-another' });
      expect(takeover.n()).toBe(1);
      // And the dormant tab no longer writes.
      const saved = track('saved');
      game.save();
      expect(saved.n()).toBe(0);
      expect(map.has(SAVE_KEY)).toBe(false);
    });
  });

  describe('autosave', () => {
    it('saves every 30 seconds', () => {
      new Game();
      const saved = track('saved');
      vi.advanceTimersByTime(29_999);
      expect(saved.n()).toBe(0);
      vi.advanceTimersByTime(1);
      expect(saved.n()).toBe(1);
      vi.advanceTimersByTime(30_000);
      expect(saved.n()).toBe(2);
      expect(map.has(SAVE_KEY)).toBe(true);
    });

    it('a purchase saves at once', () => {
      const game = new Game();
      game.state.money = 31337;
      const saved = track('saved');
      expect(map.has(SAVE_KEY)).toBe(false);
      events.emit('purchase');
      // Every Game built in this file still listens for 'purchase' (the app
      // only ever has one), so the count is "at least one"; the newest game
      // subscribed last and its state is what ends up in storage.
      expect(saved.n()).toBeGreaterThanOrEqual(1);
      expect(deserialize(map.get(SAVE_KEY)!).money).toBe(31337);
    });
  });

  describe('newGame and loadState', () => {
    it('newGame replaces the pond and saves it', () => {
      const game = new Game();
      const oldIds = game.state.ducks.map((d) => d.id);
      const saved = track('saved');
      game.selectedDuckId = oldIds[0];
      game.newGame();
      expect(game.selectedDuckId).toBeNull();
      expect(game.state.ducks.map((d) => d.id)).not.toEqual(oldIds);
      expect(saved.n()).toBe(1);
      expect(deserialize(map.get(SAVE_KEY)!).ducks.map((d) => d.id)).toEqual(game.state.ducks.map((d) => d.id));
    });

    it('loadState swaps in a state and re-seeds the rng from it without saving', () => {
      const game = new Game();
      const saved = track('saved');
      const { state, rng } = createNewGame(5);
      state.rngState = rng.getState();
      game.selectedDuckId = 'x';
      game.loadState(state);
      expect(game.state).toBe(state);
      expect(game.rng.getState()).toBe(state.rngState);
      expect(game.selectedDuckId).toBeNull();
      expect(saved.n()).toBe(0);
    });
  });
});
