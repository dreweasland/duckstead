// The festival calendar: which festival falls on which season's day. Pulled
// out of festivals.ts so the economy (market-day prices) and needs (spring
// viability) can ask "is it a festival today?" without importing the whole
// festival machinery — festivals.ts itself imports both of them.
import type { Season } from '../types';
import { dayOfSeason, seasonOf, type GameClock } from './time';

export type FestivalKind = 'eggShow' | 'grandPrix' | 'marketDay' | 'winterLights';

export const FESTIVAL_DAY = 4; // of each 6-day season

export const BY_SEASON: Record<Season, FestivalKind> = {
  spring: 'eggShow',
  summer: 'grandPrix',
  autumn: 'marketDay',
  winter: 'winterLights',
};

export function festivalToday(clock: GameClock): FestivalKind | null {
  return dayOfSeason(clock) === FESTIVAL_DAY ? BY_SEASON[seasonOf(clock)] : null;
}
