import type { GameState } from '../state';
import type { Rng } from '../rng';
import { layEgg, type Duck } from './duck';
import { nestCapacity } from './economy';
import { heritageMutationRate } from './heritage';
import { drakePressure } from './flockBalance';
import { MUTATION_RATE } from './genetics';
import { events } from '../events';
import { canBreedPair, eggViability } from './needs';
import { nestPos } from './pond';
import { seasonOf, TICKS_PER_MINUTE } from './time';

// Long enough that feeding and petting the pair mid-courtship can swing the
// viability roll made when the egg is laid.
export const COURTSHIP_TICKS = 60 * TICKS_PER_MINUTE; // 1 game-hour
export const BREEDING_COOLDOWN_TICKS = 12 * 600; // 12 game-hours

export interface PendingClutch {
  motherId: string;
  fatherId: string;
  ticksRemaining: number;
}

// The viability the pair would roll right now, for the Breed panel.
export function pairViability(state: GameState, a: Duck, b: Duck): number {
  return eggViability(a, b, seasonOf(state.clock) === 'spring', drakePressure(state));
}

export function eggsIncubating(state: GameState): number {
  return state.ducks.filter((d) => d.stage === 'egg').length;
}

export function nestPair(state: GameState, aId: string, bId: string): { ok: boolean; reason?: string } {
  const a = state.ducks.find((d) => d.id === aId);
  const b = state.ducks.find((d) => d.id === bId);
  if (!a || !b) return { ok: false, reason: 'Duck not found' };
  const check = canBreedPair(a, b);
  if (!check.ok) return check;
  if (eggsIncubating(state) + state.pendingClutches.length >= nestCapacity(state)) {
    return { ok: false, reason: 'The nest is full — sell or hatch some eggs first' };
  }
  const mother = a.sex === 'F' ? a : b;
  const father = a.sex === 'F' ? b : a;
  state.pendingClutches.push({
    motherId: mother.id,
    fatherId: father.id,
    ticksRemaining: COURTSHIP_TICKS,
  });
  a.breedingCooldownTicks = BREEDING_COOLDOWN_TICKS;
  b.breedingCooldownTicks = BREEDING_COOLDOWN_TICKS;
  state.stats.clutchesStarted += 1;
  events.emit('toast', `${mother.name} and ${father.name} are courting`);
  return { ok: true };
}

export function tickBreeding(state: GameState, rng: Rng): void {
  for (let i = state.pendingClutches.length - 1; i >= 0; i -= 1) {
    const clutch = state.pendingClutches[i];
    clutch.ticksRemaining -= 1;
    if (clutch.ticksRemaining > 0) continue;
    state.pendingClutches.splice(i, 1);

    const mother = state.ducks.find((d) => d.id === clutch.motherId);
    const father = state.ducks.find((d) => d.id === clutch.fatherId);
    if (!mother || !father) continue; // a parent was sold or died mid-courtship

    const spring = seasonOf(state.clock) === 'spring';
    // A player's very first clutch always takes — nobody's first egg should
    // silently fail a dice roll.
    const guaranteed = state.stats.ducksBred === 0;
    if (guaranteed || rng.chance(eggViability(mother, father, spring, drakePressure(state)))) {
      const nest = nestPos();
      const offset = nestSlotOffset(state, rng);
      const egg = layEgg(rng, mother, father, {
        x: nest.x + offset.x,
        y: nest.y + offset.y,
      }, heritageMutationRate(state.heritage, MUTATION_RATE));
      // The nest is anchored to the world edge, which tracks window width —
      // eggs remember their offset so they ride along instead of stranding.
      egg.nestOffset = offset;
      state.ducks.push(egg);
      state.stats.ducksBred += 1;
      events.emit('egg-laid', egg);
      events.emit('toast', `${mother.name} laid an egg!`);
    } else {
      events.emit(
        'toast',
        `${mother.name}'s clutch didn't take — a happier, healthier pair has better odds`,
      );
    }
  }
}

// Eggs settle into spread-out spots in the straw instead of a random pile —
// a big egg landing on a small one made the back egg unclickable. Each new
// egg takes the candidate spot farthest from every egg already in the nest.
function nestSlotOffset(state: GameState, rng: Rng): { x: number; y: number } {
  const existing = state.ducks
    .filter((d) => d.stage === 'egg' && d.nestOffset)
    .map((d) => d.nestOffset!);
  const candidates: Array<{ x: number; y: number }> = [];
  for (const x of [-33, -11, 11, 33]) candidates.push({ x, y: -13 });
  for (const x of [-22, 0, 22]) candidates.push({ x, y: 3 });
  for (const x of [-33, -11, 11, 33]) candidates.push({ x, y: 13 });
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
