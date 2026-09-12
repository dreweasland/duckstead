// The stud book: once a duck is a Champion, other breeders want its blood.
// Each dawn a champion may draw a request — a hen to be put to a champion
// drake, or a clutch wanted from a champion hen — paying a fee scaled to the
// duck's pedigree, plus a Society point. Accepting costs the champion its
// day: it goes on breeding rest exactly as if it had courted on the pond, so
// a request is always a choice between the client's coins and your own
// nest. Requests lapse at dusk.
//
// This is how the line itself earns. Forage and basket eggs pay the same
// whether the flock is founders or a sixth-generation purebred line; the
// stud book pays more the deeper and more decorated the flock is, and it
// keeps paying — which is the reason to raise the next champion once the
// pond is full.
import type { GameState } from '../state';
import { duckById } from '../state';
import type { Rng } from '../rng';
import type { Duck } from './duck';
import { events } from '../events';
import { chronicle } from './chronicle';
import { sellPrice } from './economy';
import { isChampion } from './line';
import { breedReadiness } from './needs';
import { BREEDING_COOLDOWN_TICKS } from './nest';
import { addSocietyPoints } from './society';
import { COMMISSION_CLIENTS } from './commissions';
import { dayOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { TUNING } from './tuning';

export interface StudRequest {
  id: number;
  duckId: string;
  client: string;
  fee: number;
  points: number;
  day: number;
}

// What a client pays for a champion's service: a share of what the duck
// would fetch outright, so pedigree and rarity set the fee.
export function studFee(state: GameState, duck: Duck): number {
  return Math.max(1, Math.round(sellPrice(state, duck) * TUNING.studBook.feeShare));
}

export function studRequestsFor(state: GameState, duckId: string): StudRequest[] {
  return state.studBook.filter((r) => r.duckId === duckId);
}

// The duck a request names, if it is still on the pond.
export function studRequestDuck(state: GameState, r: StudRequest): Duck | undefined {
  return duckById(state, r.duckId);
}

// "Harbour Farm asks to put a hen to Bertie" / "…asks for a clutch from Mabel".
export function describeStudRequest(state: GameState, r: StudRequest): string {
  const duck = studRequestDuck(state, r);
  const name = duck?.name ?? 'a champion';
  return duck?.sex === 'F' ? `${r.client} asks for a clutch from ${name}` : `${r.client} asks to put a hen to ${name}`;
}

export function tickStudBook(state: GameState, rng: Rng): void {
  const tick = state.clock.totalTicks % TICKS_PER_DAY;
  if (tick % TICKS_PER_HOUR !== 0) return;
  // A request for a duck that has left the pond has nobody to answer it.
  if (state.studBook.some((r) => !studRequestDuck(state, r))) state.studBook = state.studBook.filter((r) => studRequestDuck(state, r));
  if (tick === TUNING.studBook.postHour * TICKS_PER_HOUR) {
    for (const duck of state.ducks) {
      if (!isChampion(duck) || duck.stage !== 'adult') continue;
      if (!rng.chance(TUNING.studBook.dailyChance)) continue;
      // The rival ponds ask too, once they know you.
      const rival = state.rivals.length > 0 && rng.chance(0.35) ? rng.pick(state.rivals).name : null;
      state.studBook.push({
        id: state.nextStudRequestId,
        duckId: duck.id,
        client: rival ?? rng.pick(COMMISSION_CLIENTS),
        fee: studFee(state, duck),
        points: TUNING.studBook.points,
        day: dayOf(state.clock),
      });
      state.nextStudRequestId += 1;
    }
  } else if (tick === TUNING.studBook.expireHour * TICKS_PER_HOUR && state.studBook.length > 0) {
    state.studBook = [];
  }
}

// Whether the champion could serve right now — the same bar as nesting.
export function studReadiness(state: GameState, r: StudRequest): { ok: boolean; reason?: string } {
  const duck = studRequestDuck(state, r);
  if (!duck) return { ok: false, reason: 'That duck has left the pond' };
  const ready = breedReadiness(duck);
  return ready.ok ? ready : { ok: false, reason: `${duck.name} is ${ready.reason}` };
}

export function acceptStudRequest(state: GameState, id: number): { ok: boolean; reason?: string } {
  const r = state.studBook.find((x) => x.id === id);
  if (!r) return { ok: false, reason: 'That request has lapsed' };
  const ready = studReadiness(state, r);
  if (!ready.ok) return ready;
  const duck = studRequestDuck(state, r)!;
  state.studBook = state.studBook.filter((x) => x !== r);
  state.money += r.fee;
  addSocietyPoints(state, r.points);
  duck.breedingCooldownTicks = BREEDING_COOLDOWN_TICKS;
  state.stats.studFees += r.fee;
  state.stats.studServices += 1;
  chronicle(
    state,
    'sale',
    duck.sex === 'F' ? `${duck.name} laid a clutch for ${r.client}: ${r.fee} coins.` : `${duck.name} stood at stud for ${r.client}: ${r.fee} coins.`,
  );
  events.emit('toast', `${r.client} paid ${r.fee} coins for ${duck.name}'s service — +${r.points} Society. ${duck.sex === 'F' ? 'She' : 'He'} rests for the day.`);
  events.emit('purchase');
  return { ok: true };
}
