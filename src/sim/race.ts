// The derby's rules, kept out of the race screen: who may race, how fast a
// duck is on paper, and what a result is worth. The racePanel animates the
// race and hands the place back here to settle.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { personality } from './behavior';
import { BALANCE } from './economy';
import { chronicle } from './chronicle';
import { addSocietyPoints } from './society';
import { recordLeagueResult } from './league';
import { clamp } from '../types';
import { dayOf } from './time';
import { events } from '../events';
import { raceMarkScale, upbringingOf } from './marks';
import { raceTrainingScale } from './training';
import { TUNING } from './tuning';
import { duckById } from '../state';

// Paddle power for a meter position in [0, 1]; sweet spot is 0.5.
export function boostPower(meterVal: number): number {
  const closeness = Math.max(0, 1 - Math.abs(meterVal - 0.5) * 2);
  return Math.max(0.1, closeness * closeness);
}

// Each duck races the daily derby once: racing is tiring, and it keeps the
// derby a payoff for a well-bred flock rather than a coin tap.
export function racedToday(duck: Duck, day: number): boolean {
  return duck.lastRaceDay === day;
}

export function raceRested(state: GameState, duck: Duck): boolean {
  return !racedToday(duck, dayOf(state.clock));
}

// Base speed from the duck itself: vigorous, bold, trim ducks are fast; a
// trained one faster still. The Training Perch no longer adds speed directly
// — it buys extra drills a day (see training.ts).
export function raceSpeed(duck: Duck): number {
  const p = personality(duck);
  const vigorScale = 0.85 + duck.phenotype.vigor * 0.3;
  const energyScale = 1 + (p.energy - 1) * 0.5;
  const sizePenalty = 1.06 - Math.abs(duck.phenotype.sizeScale - 0.95) * 0.25;
  return TUNING.race.baseSpeed * vigorScale * energyScale * sizePenalty * raceTrainingScale(duck) * raceMarkScale(duck);
}

// Penned ducks sit out: the pen is a paddock, not a stable.
export function raceEligible(state: GameState): Duck[] {
  return state.ducks.filter(
    (d) => (d.stage === 'adult' || d.stage === 'juvenile') && !d.sick && !d.penned && d.needs.health > 40,
  );
}

// Pay the entry fee and mark the duck as having raced today.
export function enterRace(state: GameState, duckId: string, fee: number, ignoreDailyLimit = false): boolean {
  const duck = duckById(state, duckId);
  if (!duck || state.money < fee) return false;
  state.money -= fee;
  if (!ignoreDailyLimit) duck.lastRaceDay = dayOf(state.clock);
  if (duck.stage === 'juvenile') upbringingOf(duck).raced = true;
  events.emit('purchase'); // persist the fee like any spend
  return true;
}

interface RaceSettlement {
  duckId: string;
  place: number; // 0-based
  prizes: readonly number[];
  league: boolean;
  title: string; // the race's name, for the chronicle
}

// Winnings, standings, and the racer's needs. Returns the prize paid and
// any league notice.
export function settleRace(state: GameState, r: RaceSettlement): { prize: number; notice: string | null } {
  const prize = r.prizes[r.place] ?? 0;
  state.money += prize;
  let notice: string | null = null;
  if (r.league) notice = recordLeagueResult(state, r.place);
  const duck = duckById(state, r.duckId);
  const name = duck?.name ?? 'A duck';
  if (r.place === 0) {
    state.stats.racesWon += 1;
    const isTournament = !r.title.includes('Derby —') && r.title !== 'Pond Derby' && !r.title.includes('Heat') && !r.league;
    if (isTournament) {
      addSocietyPoints(state, 6);
      chronicle(state, 'race', `${name} won the ${r.title}.`);
    } else if (state.stats.racesWon === 1 || state.stats.racesWon % 10 === 0) {
      chronicle(state, 'race', `${name} took the pond's ${state.stats.racesWon === 1 ? 'first' : `${state.stats.racesWon}th`} derby win.`);
    }
  }
  if (duck) {
    duck.needs.happiness = clamp(duck.needs.happiness + BALANCE.raceHappiness, 0, 100);
    duck.needs.hunger = clamp(duck.needs.hunger - BALANCE.raceHunger, 0, 100);
  }
  // Winnings, league standing, and racesWon are real progress: save them
  // like a shop transaction — on mobile, beforeunload often never fires.
  events.emit('purchase');
  return { prize, notice };
}
