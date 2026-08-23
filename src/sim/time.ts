import type { Season } from '../types';
import { SEASONS } from '../types';

// 1 real second = 1 game-minute at 1x speed.
// 10 ticks/sec -> 10 ticks per game-minute -> 600 ticks per game-hour.
export const TICKS_PER_MINUTE = 10;
export const TICKS_PER_HOUR = 600;
export const TICKS_PER_DAY = TICKS_PER_HOUR * 24;
export const DAYS_PER_SEASON = 6;
export const TICKS_PER_SEASON = TICKS_PER_DAY * DAYS_PER_SEASON;
export const TICKS_PER_YEAR = TICKS_PER_SEASON * 4;

export const NIGHT_START = 21;
export const NIGHT_END = 6;

export interface GameClock {
  totalTicks: number;
}

export function hourOf(clock: GameClock): number {
  return (clock.totalTicks % TICKS_PER_DAY) / TICKS_PER_HOUR;
}

export function dayOf(clock: GameClock): number {
  return Math.floor(clock.totalTicks / TICKS_PER_DAY);
}

export function seasonOf(clock: GameClock): Season {
  const idx = Math.floor((clock.totalTicks % TICKS_PER_YEAR) / TICKS_PER_SEASON);
  return SEASONS[idx];
}

export function yearOf(clock: GameClock): number {
  return Math.floor(clock.totalTicks / TICKS_PER_YEAR) + 1;
}

export function dayOfSeason(clock: GameClock): number {
  return (dayOf(clock) % DAYS_PER_SEASON) + 1;
}

export function isNight(clock: GameClock): boolean {
  const h = hourOf(clock);
  return h >= NIGHT_START || h < NIGHT_END;
}

export function formatClock(clock: GameClock): string {
  const h = Math.floor(hourOf(clock));
  const m = Math.floor((hourOf(clock) - h) * 60);
  const season = seasonOf(clock);
  const label = season.charAt(0).toUpperCase() + season.slice(1);
  return `Y${yearOf(clock)} ${label} ${dayOfSeason(clock)} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
