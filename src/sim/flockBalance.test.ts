import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { advanceTicks, newGameWithPair } from '../testFixtures';
import { createStarterDuck } from './duck';
import { drakePressure, flockBalance, HENS_PER_DRAKE } from './flockBalance';
import { eggViability, tickNeeds } from './needs';
import { tickLaying } from './laying';
import { duckCapacity } from './economy';
import { TICKS_PER_HOUR } from './time';

describe('flock balance', () => {
  it('every pond size fits a balanced flock exactly', () => {
    const { state } = createNewGame(90);
    for (const level of [0, 1, 2, 3]) {
      state.upgrades.pondExpansion = level;
      const cap = duckCapacity(state);
      expect(cap % (HENS_PER_DRAKE + 1)).toBe(0); // 8/12/16/20 → 2/3/4/5 drakes
    }
  });

  it('surplus drakes harry the hens, cut viability, and suppress laying', () => {
    const { state, rng, hen, drake } = newGameWithPair(91);
    // 2 drakes, 2 hens: a pair of drakes is always tolerated.
    expect(flockBalance(state).excess).toBe(0);
    for (let i = 0; i < 4; i += 1) state.ducks.push(createStarterDuck(rng, { x: 0, y: 0 }, 'M'));
    const b = flockBalance(state);
    expect(b.drakes).toBe(6);
    expect(b.excess).toBe(4);
    expect(b.status).toBe('rowdy');
    hen.needs.happiness = 100;
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) tickNeeds(state, rng);
    expect(hen.needs.happiness).toBeLessThan(100 - 2 - 2); // base 2/h plus harried drain
    expect(eggViability(hen, drake, false, drakePressure(state))).toBeLessThan(eggViability(hen, drake, false, 0));
    // Laying over a day with 4 surplus drakes: most hens skip.
    state.clock.totalTicks = 7 * TICKS_PER_HOUR;
    for (const d of state.ducks) { d.needs.hunger = 90; d.needs.happiness = 90; }
    let eggs = 0;
    for (let trial = 0; trial < 20; trial += 1) {
      state.bugs = [];
      for (const d of state.ducks) delete d.lastLayDay;
      state.clock.totalTicks = 7 * TICKS_PER_HOUR + trial * 24 * TICKS_PER_HOUR;
      advanceTicks(state, rng, 10 * TICKS_PER_HOUR, [tickLaying]);
      eggs += state.bugs.filter((x) => x.kind === 'henEgg').length;
    }
    expect(eggs).toBeLessThan(20); // 2 hens × 20 days = 40 possible
  });

  it('a balanced flock is unaffected', () => {
    const { state, rng } = createNewGame(92);
    for (let i = 0; i < 4; i += 1) state.ducks.push(createStarterDuck(rng, { x: 0, y: 0 }, 'F'));
    const b = flockBalance(state);
    expect(b.hens).toBe(6);
    expect(b.drakes).toBe(2);
    void rng;
    expect(b.excess).toBe(0);
    expect(b.status).toBe('balanced');
    expect(drakePressure(state)).toBe(0);
  });
});
