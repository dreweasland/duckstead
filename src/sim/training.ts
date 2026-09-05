// Training: three stats a duck builds through drills, on top of what its
// genes give it. Paddle feeds race speed, stamina keeps boosts going, poise
// impresses show judges. Every stat fades a point a day, so a champion is
// kept, not just bred. Drills happen on training day — every few days, for
// several times the points — and each drill trains a squad: the duck you
// pick plus its nearest eligible pond-mates, one more per Training Perch
// level. Daily drills across a big flock were a treadmill.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { clamp, dist } from '../types';
import { BALANCE, upgradeLevel } from './economy';
import { dayOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { events } from '../events';
import { duckById } from '../state';

export type TrainStat = 'paddle' | 'stamina' | 'poise';
export const TRAIN_STATS: TrainStat[] = ['paddle', 'stamina', 'poise'];

export interface Training {
  paddle: number; // 0..100
  stamina: number;
  poise: number;
  day?: number; // day of the last drill
  sessions?: number; // drills run that day
}

export const TRAINING = {
  max: 100,
  decayPerDay: 1,
  cadenceDays: 3, // a training day every this many days (day 0 is one)
  gainScale: 3, // a training-day drill is worth this many daily drills
  baseDrills: 1, // drills per duck per training day
  perchDrills: 1, // ...plus this per Training Perch level
  squadPerPerch: 1, // extra ducks trained by one drill, per Training Perch level
  hungerCost: 8,
  happiness: 3, // drills are play
  gainMin: 2, // a fumbled drill
  gainMax: 16, // a perfect one — form is most of the gain
  minHunger: 30,
  friendBonus: 1, // extra point when the duck's best friend watches the drill
  friendRange: 110,
  friendCheer: 3, // the watching friend enjoys the show
  // How far a full stat moves things.
  paddleSpeed: 0.15, // +15% race speed at 100 paddle
  staminaSpeed: 0.05, // +5% race speed at 100 stamina
  staminaHold: 0.35, // boosts fade 35% slower at 100 stamina
  poiseCare: 0.5, // egg-show parent care ×(1 + poise/100 × this)
} as const;

export const TRAIN_STAT_META: Record<TrainStat, { label: string; blurb: string }> = {
  paddle: { label: 'Paddle', blurb: 'Sprint power — the derby\'s base speed.' },
  stamina: { label: 'Stamina', blurb: 'Boosts carry further down the track.' },
  poise: { label: 'Poise', blurb: 'Show-ring presence — judges score its eggs higher.' },
};

export function trainingOf(duck: Duck): Training {
  return duck.training ?? { paddle: 0, stamina: 0, poise: 0 };
}

export function drillsPerDay(state: GameState): number {
  return TRAINING.baseDrills + upgradeLevel(state, 'trainingPerch') * TRAINING.perchDrills;
}

export function isTrainingDay(state: GameState): boolean {
  return dayOf(state.clock) % TRAINING.cadenceDays === 0;
}

// Days until the next training day; 0 when today is one.
export function nextTrainingDayIn(state: GameState): number {
  const c = TRAINING.cadenceDays;
  return (c - (dayOf(state.clock) % c)) % c;
}

// How many ducks one drill trains: the one you picked plus its squad.
export function squadSize(state: GameState): number {
  return 1 + upgradeLevel(state, 'trainingPerch') * TRAINING.squadPerPerch;
}

// The pond-mates that join a duck's drill: the nearest ducks that could
// drill right now, penned ducks excluded, up to the squad size.
export function squadFor(state: GameState, leader: Duck): Duck[] {
  return state.ducks
    .filter((d) => d.id !== leader.id && !d.penned && canDrill(state, d).ok)
    .sort((a, b) => dist(a.pos, leader.pos) - dist(b.pos, leader.pos))
    .slice(0, squadSize(state) - 1);
}

export function drillsLeft(state: GameState, duck: Duck): number {
  const t = duck.training;
  const today = dayOf(state.clock);
  const used = t && t.day === today ? (t.sessions ?? 0) : 0;
  return Math.max(0, drillsPerDay(state) - used);
}

export function canDrill(state: GameState, duck: Duck): { ok: boolean; reason?: string } {
  if (duck.stage === 'egg' || duck.stage === 'duckling') return { ok: false, reason: 'Too young to train' };
  if (!isTrainingDay(state)) {
    const n = nextTrainingDayIn(state);
    return { ok: false, reason: n === 1 ? 'Training day is tomorrow' : `Training day is in ${n} days` };
  }
  if (duck.sick) return { ok: false, reason: `${duck.name} is sick` };
  if (duck.needs.hunger < TRAINING.minHunger) return { ok: false, reason: `${duck.name} is too hungry to train` };
  if (drillsLeft(state, duck) <= 0) return { ok: false, reason: `${duck.name} has trained enough for today` };
  return { ok: true };
}

// Temperament shapes what a duck takes to: bold ducks throw themselves into
// sprints, timid ones settle into poise. ±20% at the extremes.
export function trainingAptitude(duck: Duck, stat: TrainStat): number {
  const b = duck.phenotype.boldness - 0.5;
  if (stat === 'paddle') return 1 + b * 0.4;
  if (stat === 'poise') return 1 - b * 0.4;
  return 1;
}

// Apply a drill's result. `quality` is 0..1 from the minigame. Returns the
// points gained (0 when the duck couldn't train).
export function train(state: GameState, duckId: string, stat: TrainStat, quality: number): number {
  const duck = duckById(state, duckId);
  if (!duck) return 0;
  const gate = canDrill(state, duck);
  if (!gate.ok) return 0;
  const t = (duck.training ??= { paddle: 0, stamina: 0, poise: 0 });
  const today = dayOf(state.clock);
  if (t.day !== today) {
    t.day = today;
    t.sessions = 0;
  }
  t.sessions = (t.sessions ?? 0) + 1;
  const q = clamp(quality, 0, 1);
  // Diminishing returns near the top: the last 20 points take real work.
  const headroom = 1 - (t[stat] / TRAINING.max) * 0.5;
  const raw = (TRAINING.gainMin + (TRAINING.gainMax - TRAINING.gainMin) * q) * trainingAptitude(duck, stat) * headroom * TRAINING.gainScale;
  let gain = Math.max(1, Math.round(raw));
  // A training partner: the duck's best friend watching from close by is
  // worth a point — and the friend enjoys the show.
  const friend = duck.friendId ? duckById(state, duck.friendId) : undefined;
  if (friend && friend.stage !== 'egg' && !friend.penned && dist(duck.pos, friend.pos) <= TRAINING.friendRange) {
    gain += TRAINING.friendBonus * TRAINING.gainScale;
    friend.needs.happiness = clamp(friend.needs.happiness + TRAINING.friendCheer, 0, 100);
  }
  t[stat] = clamp(t[stat] + gain, 0, TRAINING.max);
  duck.needs.hunger = clamp(duck.needs.hunger - TRAINING.hungerCost, 0, 100);
  duck.needs.happiness = clamp(duck.needs.happiness + TRAINING.happiness, 0, 100);
  if (duck.stage === 'juvenile') (duck.upbringing ??= { tended: 0.7, youngTicks: 0, mentorTicks: 0, treats: 0, raced: false }).raced = true;
  state.stats.drills += 1;
  // Pocket money for a good drill, up to a daily cap.
  if (state.drillPurse.day !== today) state.drillPurse = { day: today, earned: 0 };
  const coins = Math.min(Math.round(BALANCE.drillCoins * q), BALANCE.drillCoinsDailyCap - state.drillPurse.earned);
  if (coins > 0) {
    state.money += coins;
    state.drillPurse.earned += coins;
  }
  return gain;
}

// One drill, whole squad: the leader and each squad member run the same
// drill at the same form. Returns what each gained (0 for anyone who
// couldn't train after all).
export function trainSquad(
  state: GameState,
  leaderId: string,
  stat: TrainStat,
  quality: number,
): { gain: number; squad: Array<{ duck: Duck; gain: number }> } {
  const leader = duckById(state, leaderId);
  if (!leader) return { gain: 0, squad: [] };
  const squad = squadFor(state, leader);
  const gain = train(state, leaderId, stat, quality);
  if (gain === 0) return { gain: 0, squad: [] };
  return { gain, squad: squad.map((duck) => ({ duck, gain: train(state, duck.id, stat, quality) })) };
}

// Coins a drill can still pay today.
export function drillCoinsLeft(state: GameState): number {
  const today = dayOf(state.clock);
  return state.drillPurse.day === today ? Math.max(0, BALANCE.drillCoinsDailyCap - state.drillPurse.earned) : BALANCE.drillCoinsDailyCap;
}

// Dawn: every trained stat slips a point. Drills are a habit, not a purchase.
export function tickTraining(state: GameState): void {
  if (state.clock.totalTicks % TICKS_PER_DAY !== 6 * TICKS_PER_HOUR) return;
  let faded = 0;
  for (const duck of state.ducks) {
    const t = duck.training;
    if (!t) continue;
    for (const stat of TRAIN_STATS) {
      if (t[stat] > 0) {
        t[stat] = Math.max(0, t[stat] - TRAINING.decayPerDay);
        faded += 1;
      }
    }
  }
  if (faded > 0 && state.clock.totalTicks % (TICKS_PER_DAY * 6) === 6 * TICKS_PER_HOUR) {
    events.emit('toast', `Untrained stats fade a point a day — training day comes round every ${TRAINING.cadenceDays} days.`);
  }
}

// Race-speed multiplier from training alone.
export function raceTrainingScale(duck: Duck): number {
  const t = trainingOf(duck);
  return 1 + (t.paddle / TRAINING.max) * TRAINING.paddleSpeed + (t.stamina / TRAINING.max) * TRAINING.staminaSpeed;
}

// How much slower a boost fades: 0 (untrained) .. TRAINING.staminaHold.
export function staminaHold(duck: Duck): number {
  return (trainingOf(duck).stamina / TRAINING.max) * TRAINING.staminaHold;
}

export function poiseOf(duck: Duck): number {
  return trainingOf(duck).poise;
}
