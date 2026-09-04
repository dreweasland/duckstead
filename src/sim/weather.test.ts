import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../newGame';
import { rollWeather, tickWeather, weatherBugScale, weatherHungerScale, weatherWarmthScale } from './weather';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

describe('weather', () => {
  it('rolls by season: snow only in winter, rain mostly in spring', () => {
    const rng = createRng(3);
    const count = (season: 'spring' | 'summer' | 'autumn' | 'winter') => {
      const c: Record<string, number> = {};
      for (let i = 0; i < 1000; i += 1) {
        const k = rollWeather(season, rng);
        c[k] = (c[k] ?? 0) + 1;
      }
      return c;
    };
    const winter = count('winter');
    const spring = count('spring');
    const summer = count('summer');
    expect(winter.snow).toBeGreaterThan(300);
    expect(spring.snow).toBeUndefined();
    expect(spring.rain).toBeGreaterThan(250);
    expect(summer.clear).toBeGreaterThan(600);
  });

  it('is rolled once a day at dawn and rain freshens the pond', () => {
    const { state, rng } = createNewGame(5);
    state.clock.totalTicks = TICKS_PER_DAY + 6 * TICKS_PER_HOUR;
    tickWeather(state, rng);
    expect(state.weather.day).toBe(1);
    const kind = state.weather.kind;
    state.clock.totalTicks += 1;
    tickWeather(state, rng);
    expect(state.weather.kind).toBe(kind); // no re-roll within the day
    state.weather = { kind: 'rain', day: 1 };
    state.pond.cleanliness = 50;
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) tickWeather(state, rng);
    expect(state.pond.cleanliness).toBeCloseTo(51.5, 1);
  });

  it('effects read as documented', () => {
    const { state } = createNewGame(6);
    state.weather = { kind: 'snow', day: 0 };
    expect(weatherWarmthScale(state)).toBe(1.4);
    expect(weatherHungerScale(state)).toBe(1.2);
    expect(weatherBugScale(state)).toBe(0.3);
    state.weather = { kind: 'clear', day: 0 };
    expect(weatherWarmthScale(state)).toBe(1);
  });
});
