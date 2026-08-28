// Upbringing marks: what a duck's early life left on it. Set once, at the
// duckling→juvenile and juvenile→adult transitions, from what actually
// happened while it was young — how warm the egg was kept, whether an elder
// raised it, whether it raced, whether it was spoiled with treats. Each mark
// is a small permanent bonus (or trade-off) and a line in the chronicle, so
// two ducks with identical genes can still turn out different.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { chronicle } from './chronicle';
import { events } from '../events';
import { TUNING } from './tuning';

export type Mark = 'hardy' | 'scrappy' | 'steady' | 'keen' | 'spoiled' | 'proud';

export interface MarkDef {
  label: string;
  blurb: string; // what it does, for the card tooltip
  how: string; // how it's earned, for the guide
}

export const MARKS: Record<Mark, MarkDef> = {
  hardy: { label: 'hardy', blurb: 'Kept warm as an egg: falls sick 20% less.', how: 'hatch from an egg kept at 70%+ average warmth' },
  scrappy: { label: 'scrappy', blurb: 'Hatched cold and pulled through: 10% less sickness, +2% race speed.', how: 'hatch from a cold egg (under 35% warmth) and survive' },
  steady: { label: 'steady', blurb: 'Raised beside an elder: happiness fades 10% slower.', how: 'spend a quarter of its youth within reach of an elder' },
  keen: { label: 'keen', blurb: 'Raced as a juvenile: +3% race speed for life.', how: 'enter a derby before coming of age' },
  spoiled: { label: 'spoiled', blurb: 'Treats cheer it 50% more — but it sulks 10% faster.', how: 'eat three or more treats while young' },
  proud: { label: 'proud', blurb: 'Won a rivalry: +2% race speed, shrugs off drake squabbles.', how: 'come out on top when two drakes fall out' },
};

export const MARK_LIST = Object.keys(MARKS) as Mark[];

// Running tallies kept only while the duck is young (duckling/juvenile).
export interface Upbringing {
  tended: number; // average egg warmth at hatch, 0..1
  youngTicks: number;
  mentorTicks: number;
  treats: number;
  raced: boolean;
}

export function upbringingOf(duck: Duck): Upbringing {
  return (duck.upbringing ??= { tended: 0.7, youngTicks: 0, mentorTicks: 0, treats: 0, raced: false });
}

export function hasMark(duck: Duck, mark: Mark): boolean {
  return duck.marks?.includes(mark) ?? false;
}

export function grantMark(state: GameState, duck: Duck, mark: Mark, why?: string): boolean {
  if (hasMark(duck, mark)) return false;
  (duck.marks ??= []).push(mark);
  state.stats.marksEarned += 1;
  chronicle(state, 'mark', `${duck.name} turned out ${MARKS[mark].label}${why ? ` — ${why}` : ''}.`);
  events.emit('toast', `${duck.name} is ${MARKS[mark].label}: ${MARKS[mark].blurb}`);
  return true;
}

// At the juvenile molt: the egg's warmth has shown in the bird.
export function assignJuvenileMarks(state: GameState, duck: Duck): void {
  const u = upbringingOf(duck);
  if (u.tended >= TUNING.marks.hardyWarmth) grantMark(state, duck, 'hardy', 'a snug egg makes a sturdy bird');
  else if (u.tended < TUNING.marks.scrappyWarmth) grantMark(state, duck, 'scrappy', 'a cold egg, and it pulled through');
}

// At coming of age: what its youth was like. The tallies are dropped
// afterwards — they were only ever for this.
export const STEADY_MENTOR_SHARE = TUNING.marks.steadyMentorShare;
export const SPOILED_TREATS = TUNING.marks.spoiledTreats;

export function assignAdultMarks(state: GameState, duck: Duck): void {
  const u = upbringingOf(duck);
  if (u.youngTicks > 0 && u.mentorTicks / u.youngTicks >= STEADY_MENTOR_SHARE) grantMark(state, duck, 'steady', 'raised in an elder\'s shadow');
  if (u.raced) grantMark(state, duck, 'keen', 'raced before it had its full feathers');
  if (u.treats >= SPOILED_TREATS) grantMark(state, duck, 'spoiled', 'too many treats too young');
  delete duck.upbringing;
}

// --- Effects, read by the systems they touch ---

export function sicknessScale(duck: Duck): number {
  let s = 1;
  if (hasMark(duck, 'hardy')) s *= 0.8;
  if (hasMark(duck, 'scrappy')) s *= 0.9;
  return s;
}

export function happinessDecayScale(duck: Duck): number {
  let s = 1;
  if (hasMark(duck, 'steady')) s *= 0.9;
  if (hasMark(duck, 'spoiled')) s *= 1.1;
  return s;
}

export function treatCheerScale(duck: Duck): number {
  return hasMark(duck, 'spoiled') ? 1.5 : 1;
}

export function raceMarkScale(duck: Duck): number {
  let s = 1;
  if (hasMark(duck, 'keen')) s *= 1.03;
  if (hasMark(duck, 'scrappy')) s *= 1.02;
  if (hasMark(duck, 'proud')) s *= 1.02;
  return s;
}
