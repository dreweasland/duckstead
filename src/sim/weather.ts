// Weather: rolled each dawn by season, and read by the systems it touches —
// rain freshens the pond and chills eggs, snow chills them harder and makes
// the flock hungrier, wind frays tempers a little, fog keeps the bugs down.
// The renderer draws what's in state, so what you see is what's happening.
import type { GameState } from '../state';
import type { Rng } from '../rng';
import type { Season } from '../types';
import { clamp } from '../types';
import { events } from '../events';
import { dayOf, seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

type WeatherKind = 'clear' | 'rain' | 'snow' | 'fog' | 'wind';

export interface Weather {
  kind: WeatherKind;
  day: number; // the day it was rolled for
}

export const WEATHER_NAMES: Record<WeatherKind, string> = {
  clear: 'clear skies',
  rain: 'rain',
  snow: 'snow',
  fog: 'fog',
  wind: 'a stiff wind',
};

// Odds per season, in order; the remainder is clear.
const ODDS: Record<Season, Array<[WeatherKind, number]>> = {
  spring: [['rain', 0.35], ['wind', 0.12], ['fog', 0.08]],
  summer: [['rain', 0.1], ['wind', 0.15]],
  autumn: [['wind', 0.25], ['rain', 0.2], ['fog', 0.15]],
  winter: [['snow', 0.4], ['fog', 0.12], ['wind', 0.1]],
};

export function rollWeather(season: Season, rng: Rng): WeatherKind {
  let roll = rng.next();
  for (const [kind, p] of ODDS[season]) {
    if (roll < p) return kind;
    roll -= p;
  }
  return 'clear';
}

export function weatherOf(state: GameState): WeatherKind {
  return state.weather?.kind ?? 'clear';
}

export function tickWeather(state: GameState, rng: Rng): void {
  const day = dayOf(state.clock);
  if (state.clock.totalTicks % TICKS_PER_DAY === 6 * TICKS_PER_HOUR || state.weather.day !== day) {
    if (state.weather.day !== day) {
      const kind = rollWeather(seasonOf(state.clock), rng);
      state.weather = { kind, day };
      if (kind !== 'clear' && state.clock.totalTicks % TICKS_PER_DAY === 6 * TICKS_PER_HOUR) {
        events.emit('toast', `Dawn brings ${WEATHER_NAMES[kind]}.`);
      }
    }
  }
  // Rain freshens the water a little every hour it falls.
  if (state.weather.kind === 'rain') {
    state.pond.cleanliness = clamp(state.pond.cleanliness + 1.5 / TICKS_PER_HOUR, 0, 100);
  }
}

// --- Effects, read by the systems they touch ---

export function weatherWarmthScale(state: GameState): number {
  const k = weatherOf(state);
  return k === 'snow' ? 1.4 : k === 'rain' ? 1.2 : 1;
}

export function weatherHungerScale(state: GameState): number {
  return weatherOf(state) === 'snow' ? 1.2 : 1;
}

export function weatherHappyScale(state: GameState): number {
  const k = weatherOf(state);
  return k === 'wind' ? 1.15 : k === 'rain' ? 1.05 : 1;
}

export function weatherBugScale(state: GameState): number {
  const k = weatherOf(state);
  return k === 'rain' ? 0.5 : k === 'fog' ? 0.6 : k === 'snow' ? 0.3 : 1;
}

// Ducks love a swim in the rain: a little cheer for anyone on the water.
export function weatherSwimCheer(state: GameState): number {
  return weatherOf(state) === 'rain' ? 0.6 : 0;
}
