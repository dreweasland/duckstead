// Elder ducks: the flock's memory. They can't breed, but they've earned a
// place — a free spot on the bank, a seat by the nest, and an honoured
// passing when their time comes. Every role here is a carrot for keeping
// them; selling an elder stays legal, it just stops being strictly optimal.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { STAGE_DAYS } from './duck';
import { pedigreeScore } from './pedigree';
import { TICKS_PER_DAY } from './time';

// Broody grannies: elder hens sit with the clutch, slowing egg-warmth decay.
// Each hen is worth 25% less decay, two at most (a nest only has so much room).
export const BROODY_PER_HEN = 0.25;
export const BROODY_MAX_HENS = 2;

export function elderHensOnPond(state: GameState): number {
  return state.ducks.filter((d) => d.stage === 'elder' && d.sex === 'F' && !d.penned).length;
}

export function broodyWarmthScale(state: GameState): number {
  return 1 - BROODY_PER_HEN * Math.min(BROODY_MAX_HENS, elderHensOnPond(state));
}

// The mentor: ducklings and juveniles keeping company with an elder hold
// their happiness better — grandparents raising the brood.
export const MENTOR_RADIUS = 140;
export const MENTOR_HAPPY_SCALE = 0.7;

export function mentorNearby(state: GameState, duck: Duck): boolean {
  if (duck.stage !== 'duckling' && duck.stage !== 'juvenile') return false;
  return state.ducks.some(
    (d) =>
      d.stage === 'elder' &&
      !d.penned &&
      Math.hypot(d.pos.x - duck.pos.x, d.pos.y - duck.pos.y) <= MENTOR_RADIUS,
  );
}

// An honoured passing: Society points scale with the life's pedigree.
export function passingPoints(duck: Duck): number {
  return 2 + Math.floor(pedigreeScore(duck) / 4); // 2..5
}

// How long an elder has left, in whole days (for the sell-button conscience).
export function elderDaysLeft(duck: Duck): number {
  const remaining = STAGE_DAYS.elder * TICKS_PER_DAY - duck.ageTicks;
  return Math.max(0, Math.ceil(remaining / TICKS_PER_DAY));
}
