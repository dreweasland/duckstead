// Shared fixtures for the test suites. Not a test itself (no `.test.` in the
// name), so vitest never collects it.
//
// Every helper here reproduces, step for step, a snippet that used to be
// copied between files, so switching a test over changes nothing about the
// rng sequence it sees.
import type { Rng } from './rng';
import { serialize } from './save/save';
import { createDuck, type Duck } from './sim/duck';
import { randomCommonGenome, type Genome } from './sim/genetics';
import { type GameState } from './state';
import { createNewGame } from './newGame';
import type { Vec2 } from './types';

/** A fresh game plus its first starter hen and drake. */
export function newGameWithPair(seed = 1): { state: GameState; rng: Rng; hen: Duck; drake: Duck } {
  const { state, rng } = createNewGame(seed);
  const hen = state.ducks.find((d) => d.sex === 'F')!;
  const drake = state.ducks.find((d) => d.sex === 'M')!;
  return { state, rng, hen, drake };
}

type StorageGlobals = { localStorage?: unknown; window?: unknown };

/**
 * Installs a Map-backed `localStorage` and a `window` that swallows event
 * listeners — the minimum the save, sync, and Game code touch under node.
 * Returns the backing map so tests can seed and inspect it.
 */
export function installFakeStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const g = globalThis as StorageGlobals;
  g.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  g.window = { addEventListener: () => {}, removeEventListener: () => {} };
  return map;
}

export function uninstallFakeStorage(): void {
  const g = globalThis as StorageGlobals;
  delete g.localStorage;
  delete g.window;
}

export type Ticker = (state: GameState, rng: Rng) => void;

/**
 * Advances the clock `n` ticks, running `tickers` in order each tick. Tests
 * pass exactly the subsystems they mean to exercise; nothing else (not even
 * the season cache) is touched, so a loop converted to this behaves as it did.
 */
export function advanceTicks(state: GameState, rng: Rng, n: number, tickers: readonly Ticker[]): void {
  for (let i = 0; i < n; i += 1) {
    state.clock.totalTicks += 1;
    for (const tick of tickers) tick(state, rng);
  }
}

/**
 * Creates an egg at the origin and adds it to the flock. With no genome a
 * common one is drawn from `rng` first, and with no name `createDuck` draws
 * one — both exactly as the inline fixtures did.
 */
export function pushEgg(state: GameState, rng: Rng, opts: { genome?: Genome; name?: string; pos?: Vec2 } = {}): Duck {
  const genome = opts.genome ?? randomCommonGenome(rng);
  const egg = createDuck(rng, { genome, stage: 'egg', pos: opts.pos ?? { x: 0, y: 0 }, name: opts.name });
  state.ducks.push(egg);
  return egg;
}

/**
 * A real serialized save (pushes refuse unreadable blobs) whose money makes
 * it distinguishable from its siblings.
 */
export function realBlob(money: number): string {
  const { state } = createNewGame(1);
  state.money = money;
  return serialize(state);
}
