import type { GameState } from '../state';
import type { Rng } from '../rng';
import { layEgg, type Duck } from './duck';
import { heritageMutationRate } from './heritage';
import { drakePressure } from './flockBalance';
import { MUTATION_RATE } from './genetics';
import { events } from '../events';
import { canBreedPair, eggViability } from './needs';
import { nestPos } from './pond';
import { seasonOf } from './time';
import { studFather } from './rivals';
import type { Genome } from './genetics';
import { duckById } from '../state';
import { BREEDING_COOLDOWN_TICKS, COURTSHIP_TICKS, nestFull, NEST_FULL_REASON, nestSlotOffset } from './nest';

// The nest's numbers live in nest.ts; re-exported so callers keep one import.
export { BREEDING_COOLDOWN_TICKS, COURTSHIP_TICKS, eggsIncubating, nestFull, nestUsed, NEST_FULL_REASON, nestSlotOffset } from './nest';

export interface PendingClutch {
  motherId: string;
  fatherId: string;
  ticksRemaining: number;
  // A hired sire from a rival pond (see rivals.ts): not on the pond, so his
  // genome rides along with the clutch.
  stud?: { rivalId: string; name: string; genome: Genome };
}

// The sire of a clutch: a duck on the pond, or a rebuilt stud.
export function clutchFather(state: GameState, clutch: PendingClutch): Duck | undefined {
  return clutch.stud ? studFather(state, clutch) : duckById(state, clutch.fatherId);
}

// The viability the pair would roll right now, for the Breed panel.
export function pairViability(state: GameState, a: Duck, b: Duck): number {
  return eggViability(a, b, seasonOf(state.clock) === 'spring', drakePressure(state));
}

export function nestPair(state: GameState, aId: string, bId: string): { ok: boolean; reason?: string } {
  const a = duckById(state, aId);
  const b = duckById(state, bId);
  if (!a || !b) return { ok: false, reason: 'Duck not found' };
  const check = canBreedPair(a, b);
  if (!check.ok) return check;
  if (nestFull(state)) return { ok: false, reason: NEST_FULL_REASON };
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

    const mother = duckById(state, clutch.motherId);
    const father = clutchFather(state, clutch);
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
      events.emit('toast', `${mother.name} laid an egg!`);
    } else {
      events.emit(
        'toast',
        `${mother.name}'s clutch didn't take — a happier, healthier pair has better odds`,
      );
    }
  }
}

