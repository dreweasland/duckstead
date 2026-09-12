// The nest itself: courtship timing, how many eggs it holds, and where the
// next egg goes. Shared by breeding.ts (the pond's own pairs) and rivals.ts
// (hired studs, bought eggs) — kept apart from both so neither has to import
// the other for a constant.
import type { GameState } from '../state';
import type { Rng } from '../rng';
import { nestCapacity } from './economy';
import { TICKS_PER_MINUTE } from './time';
import { TUNING } from './tuning';

// Long enough that feeding and petting the pair mid-courtship can swing the
// viability roll made when the egg is laid.
export const COURTSHIP_TICKS = 60 * TICKS_PER_MINUTE; // 1 game-hour
export const BREEDING_COOLDOWN_TICKS = 12 * 600; // 12 game-hours

export function eggsIncubating(state: GameState): number {
  return state.ducks.filter((d) => d.stage === 'egg').length;
}

export const CLUTCH_SIZE = TUNING.nest.clutchSize;

// Eggs on the nest plus clutches on the way — what counts against
// nestCapacity. A courting pair reserves a whole clutch's worth of straw, so
// the eggs always have somewhere to land when the hour is up.
export function nestUsed(state: GameState): number {
  return eggsIncubating(state) + state.pendingClutches.length * CLUTCH_SIZE;
}

// Straw for `eggs` more eggs? A pair needs a clutch's worth; a bought egg, one.
export function nestHasRoom(state: GameState, eggs: number): boolean {
  return nestUsed(state) + eggs <= nestCapacity(state);
}

// No room for another clutch.
export function nestFull(state: GameState): boolean {
  return !nestHasRoom(state, CLUTCH_SIZE);
}

export const NEST_FULL_REASON = 'The nest is full — sell or hatch some eggs first';

// Eggs settle into spread-out spots in the straw instead of a random pile —
// a big egg landing on a small one made the back egg unclickable. Each new
// egg takes the candidate spot farthest from every egg already in the nest.
export function nestSlotOffset(state: GameState, rng: Rng): { x: number; y: number } {
  const existing = state.ducks
    .filter((d) => d.stage === 'egg' && d.nestOffset)
    .map((d) => d.nestOffset!);
  // Twelve spots: the nest holds four clutches of three at the top box level.
  const candidates: Array<{ x: number; y: number }> = [];
  for (const x of [-36, -12, 12, 36]) candidates.push({ x, y: -13 });
  for (const x of [-36, -12, 12, 36]) candidates.push({ x, y: 1 });
  for (const x of [-36, -12, 12, 36]) candidates.push({ x, y: 14 });
  let best = candidates[0];
  let bestClearance = -1;
  for (const c of candidates) {
    let nearest = Infinity;
    for (const e of existing) nearest = Math.min(nearest, Math.hypot(c.x - e.x, c.y - e.y));
    if (nearest > bestClearance) {
      bestClearance = nearest;
      best = c;
    }
  }
  return { x: best.x + rng.range(-2, 2), y: best.y + rng.range(-2, 2) };
}
