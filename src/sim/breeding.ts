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
import { releaseDuck } from './pen';
import type { Genome } from './genetics';
import { duckById } from '../state';
import { BREEDING_COOLDOWN_TICKS, CLUTCH_SIZE, COURTSHIP_TICKS, nestFull, NEST_FULL_REASON, nestSlotOffset } from './nest';
import { plural } from '../text';

// The nest's numbers live in nest.ts; re-exported so callers keep one import.
export { BREEDING_COOLDOWN_TICKS, CLUTCH_SIZE, COURTSHIP_TICKS, eggsIncubating, nestFull, nestHasRoom, nestUsed, NEST_FULL_REASON, nestSlotOffset } from './nest';

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

// The viability the pair would roll right now, for the Breed panel — with
// any penned mate counted as out, since nesting lets it out.
export function pairViability(state: GameState, a: Duck, b: Duck): number {
  return eggViability(a, b, seasonOf(state.clock) === 'spring', drakePressure(state, [a.id, b.id]));
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
  // A mate from the pen walks out to court and stays out until rested —
  // that rest is what keeps the pen from being a free stud (see canPen).
  for (const d of [a, b]) if (d.penned) releaseDuck(state, d.id);
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
    // Every egg of the clutch rolls viability on its own, so the pair's
    // condition reads as "how much of the clutch takes" rather than a coin
    // flip. A player's very first clutch always yields at least one egg —
    // nobody's first nesting should silently come to nothing.
    const viability = eggViability(mother, father, spring, drakePressure(state));
    const guaranteed = state.stats.ducksBred === 0;
    let laid = 0;
    for (let n = 0; n < CLUTCH_SIZE; n += 1) {
      if (!(guaranteed && n === 0) && !rng.chance(viability)) continue;
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
      laid += 1;
    }
    if (laid === CLUTCH_SIZE) events.emit('toast', `${mother.name} laid a clutch of ${laid}!`);
    else if (laid > 0) events.emit('toast', `${mother.name} laid ${plural(laid, 'egg')} — ${CLUTCH_SIZE - laid} of the clutch didn't take`);
    else {
      events.emit(
        'toast',
        `${mother.name}'s clutch didn't take — a happier, healthier pair has better odds`,
      );
    }
  }
}

