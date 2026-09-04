// Feed and treats. Plain feed and premium feed are the staples; peas, worms,
// and berries are treats, and every duck secretly favours one of them. Find
// it (by feeding) and that treat restores more and cheers the duck up — a
// small discovery loop that fills the waits between eggs.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { clamp } from '../types';
import { TUNING } from './tuning';
import { treatCheerScale, upbringingOf } from './marks';
import { hashString } from '../rng';

export type FoodKind = 'feed' | 'premiumFeed' | 'peas' | 'worms' | 'berries';
export type TreatKind = 'peas' | 'worms' | 'berries';

interface FoodDef {
  kind: FoodKind;
  name: string;
  restore: number;
  happiness: number;
  cost: number; // per pack of 10
  color: string; // pellet color in the world
  treat: boolean;
}

export const FOODS: Record<FoodKind, FoodDef> = {
  feed: { kind: 'feed', name: 'Feed', restore: TUNING.food.feedRestore, happiness: 0, cost: 5, color: '#b08d4f', treat: false },
  premiumFeed: { kind: 'premiumFeed', name: 'Premium feed', restore: TUNING.food.premiumFeedRestore, happiness: TUNING.food.premiumFeedHappiness, cost: 15, color: '#e8b83a', treat: false },
  peas: { kind: 'peas', name: 'Peas', restore: 40, happiness: 2, cost: 8, color: '#7cc15a', treat: true },
  worms: { kind: 'worms', name: 'Worms', restore: 45, happiness: 2, cost: 10, color: '#c97a6a', treat: true },
  berries: { kind: 'berries', name: 'Berries', restore: 40, happiness: 3, cost: 10, color: '#8e4fb8', treat: true },
};

export const TREATS: TreatKind[] = ['peas', 'worms', 'berries'];
const FAVOURITE_RESTORE_SCALE = 1.5;
const FAVOURITE_HAPPINESS = 8;

// A duck's favourite treat is fixed for life, derived from its id so old
// saves need no migration.
export function favouriteTreat(duck: Duck): TreatKind {
  return TREATS[(hashString(duck.id, 33, 7) >>> 4) % TREATS.length];
}

export function stockOf(state: GameState, kind: FoodKind): number {
  return state.inventory[kind] ?? 0;
}

export function takeStock(state: GameState, kind: FoodKind, n = 1): boolean {
  if (stockOf(state, kind) < n) return false;
  state.inventory[kind] = stockOf(state, kind) - n;
  return true;
}

export interface EatResult {
  favourite: boolean;
  discovered: boolean; // first time the favourite was found
}

// Apply a food's effects to a duck. Favourites restore more, cheer the duck,
// and are remembered on the duck once found.
export function eatFood(state: GameState, duck: Duck, kind: FoodKind): EatResult {
  const def = FOODS[kind];
  const favourite = def.treat && favouriteTreat(duck) === kind;
  const restore = favourite ? def.restore * FAVOURITE_RESTORE_SCALE : def.restore;
  duck.needs.hunger = clamp(duck.needs.hunger + restore, 0, 100);
  const cheer = (def.happiness + (favourite ? FAVOURITE_HAPPINESS : 0)) * (def.treat ? treatCheerScale(duck) : 1);
  if (cheer > 0) duck.needs.happiness = clamp(duck.needs.happiness + cheer, 0, 100);
  // Treats while young count toward a 'spoiled' upbringing.
  if (def.treat && (duck.stage === 'duckling' || duck.stage === 'juvenile')) upbringingOf(duck).treats += 1;
  let discovered = false;
  if (favourite && !duck.favouriteKnown) {
    duck.favouriteKnown = true;
    state.stats.favouritesFound += 1;
    discovered = true;
  }
  return { favourite, discovered };
}
