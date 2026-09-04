// The Society Cup: a year-long standing against the rival ponds. Enter in
// any season for a stake of Society points; from then on every point you
// earn that year counts, and at the turn of the year the pond with the most
// takes the Cup — coins, a chronicle line, and a win on the record. It is
// the sink Society points needed once the ladder is climbed.
import type { GameState } from '../state';
import { ordinal } from '../text';
import { chronicle } from './chronicle';
import { events } from '../events';
import { dayOfSeason, seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR, yearOf } from './time';
import { TUNING } from './tuning';

export interface CupState {
  year: number;
  score: number; // the player's points earned since entering, this year
}

export function cupOpen(state: GameState): boolean {
  return state.cup?.year === yearOf(state.clock);
}

export function canEnterCup(state: GameState): { ok: boolean; reason?: string } {
  if (cupOpen(state)) return { ok: false, reason: 'Already entered this year' };
  if (state.society.rank < TUNING.cup.minRank) return { ok: false, reason: `Society rank ${TUNING.cup.minRank} required` };
  if (state.society.points < TUNING.cup.entryPoints) return { ok: false, reason: `Need ${TUNING.cup.entryPoints} Society points to enter` };
  if (seasonOf(state.clock) === 'winter' && dayOfSeason(state.clock) === 6) return { ok: false, reason: 'The year is over — enter next spring' };
  return { ok: true };
}

export function enterCup(state: GameState): boolean {
  if (!canEnterCup(state).ok) return false;
  state.society.points -= TUNING.cup.entryPoints;
  state.cup = { year: yearOf(state.clock), score: 0 };
  state.stats.cupEntries += 1;
  chronicle(state, 'society', `The pond entered the year ${yearOf(state.clock)} Society Cup.`);
  events.emit('toast', `Entered the Society Cup — every point you earn this year now counts against the rival ponds.`);
  events.emit('purchase');
  return true;
}

// Called by addSocietyPoints: points earned while entered count.
export function noteCupPoints(state: GameState, n: number): void {
  if (n > 0 && cupOpen(state)) state.cup!.score += n;
}

interface CupStanding {
  name: string;
  score: number;
  isPlayer: boolean;
}

export function cupStandings(state: GameState): CupStanding[] {
  const rows: CupStanding[] = state.rivals.map((r) => ({ name: r.name, score: r.yearPoints, isPlayer: false }));
  rows.push({ name: 'Your pond', score: state.cup?.score ?? 0, isPlayer: true });
  return rows.sort((a, b) => b.score - a.score);
}

export function cupPrize(state: GameState): number {
  return TUNING.cup.prizeBase * yearOf(state.clock);
}

// The last evening of winter: the Cup is decided.
export function tickCup(state: GameState): void {
  if (state.clock.totalTicks % TICKS_PER_DAY !== 21 * TICKS_PER_HOUR) return;
  if (seasonOf(state.clock) !== 'winter' || dayOfSeason(state.clock) !== 6) return;
  if (!cupOpen(state)) return;
  const standings = cupStandings(state);
  const place = standings.findIndex((s) => s.isPlayer);
  const winner = standings[0];
  if (place === 0) {
    const prize = cupPrize(state);
    state.money += prize;
    state.stats.cupWins += 1;
    chronicle(state, 'society', `The pond won the year ${yearOf(state.clock)} Society Cup with ${standings[0].score} points — ${prize} coins.`);
    events.emit('toast', `Society Cup champions! +${prize} coins`);
  } else {
    const rival = state.rivals.find((r) => r.name === winner.name);
    if (rival) rival.wins += 1;
    chronicle(state, 'society', `${winner.name} took the year ${yearOf(state.clock)} Society Cup; the pond placed ${ordinal(place + 1)}.`);
    events.emit('toast', `${winner.name} won the Society Cup — you placed ${ordinal(place + 1)}.`);
  }
  state.cup = null;
}
