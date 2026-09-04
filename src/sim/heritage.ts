// Heritage: retire the pond and start again with one founder pair, keeping
// the Breed Book, awards, Society standing, chronicle, and records. Each
// retirement adds a permanent heritage bonus: more mutation (novel genes),
// an extra pond slot, and a better-stocked start. The early game is quick
// now, so the re-climb is short and the payoff is a stronger line.
import type { GameState } from '../state';

const HERITAGE_MUTATION_BONUS = 0.01; // +1% mutation per retirement (base 2%)
// Full value for the first five retirements; a quarter as much after that,
// up to a hard ceiling — the loop keeps paying, just less steeply.
const HERITAGE_MAX = 5;
const HERITAGE_LATE_SCALE = 0.25;
const HERITAGE_MUTATION_CEILING = 0.075; // +7.5% over base, ever
const HERITAGE_POND_CEILING = 8;

export function heritageMutationRate(heritage: number, base: number): number {
  const early = Math.min(HERITAGE_MAX, heritage);
  const late = Math.max(0, heritage - HERITAGE_MAX);
  return base + Math.min(HERITAGE_MUTATION_CEILING, (early + late * HERITAGE_LATE_SCALE) * HERITAGE_MUTATION_BONUS);
}

// Extra pond capacity earned by retiring: +1 duck slot per heritage to five,
// then one per four retirements, to eight.
export function heritagePondBonus(state: GameState): number {
  const early = Math.min(HERITAGE_MAX, state.heritage);
  const late = Math.max(0, state.heritage - HERITAGE_MAX);
  return Math.min(HERITAGE_POND_CEILING, early + Math.floor(late * HERITAGE_LATE_SCALE));
}

export function canRetire(state: GameState): { ok: boolean; reason?: string } {
  const adults = state.ducks.filter((d) => d.stage === 'adult' || d.stage === 'elder');
  if (!adults.some((d) => d.sex === 'M') || !adults.some((d) => d.sex === 'F')) {
    return { ok: false, reason: 'Choose a drake and a hen to found the next pond' };
  }
  if (Object.keys(state.breedBook).length < 10) {
    return { ok: false, reason: 'The Book needs 10 breeds before the Society will register a heritage pond' };
  }
  return { ok: true };
}
