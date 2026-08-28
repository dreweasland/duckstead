import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../state';
import { tickBreeding } from './breeding';
import { LOCI } from './genetics';
import { createRivals, hireStud, rivalEggEntries, rivalRacers, rivalStrength, studOffers, tickRivals } from './rivals';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_SEASON, TICKS_PER_YEAR } from './time';
import { COURTSHIP_TICKS } from './breeding';

describe('rival ponds', () => {
  it('a fresh game has three rivals with full, complete flocks', () => {
    const { state } = createNewGame(80);
    expect(state.rivals).toHaveLength(3);
    for (const r of state.rivals) {
      expect(r.flock).toHaveLength(6);
      for (const g of r.flock) for (const def of LOCI) expect(g[def.id]).toHaveLength(2);
    }
    const again = createRivals(createRng(1));
    expect(again.map((r) => r.specialty)).toEqual(['show', 'racing', 'rare']);
  });

  it('advances a generation at the start of each season and gets stronger with the years', () => {
    const { state, rng } = createNewGame(81);
    const before = state.rivals.map((r) => ({ training: r.training, flock: r.flock.map((g) => JSON.stringify(g)) }));
    const s0 = rivalStrength(state, state.rivals[0]);
    // Summer day 1, 06:00.
    state.clock.totalTicks = TICKS_PER_SEASON + 6 * TICKS_PER_HOUR;
    tickRivals(state, rng);
    for (const [i, r] of state.rivals.entries()) expect(r.training).toBeGreaterThan(before[i].training);
    // Same tick again does nothing.
    const t = state.rivals[0].training;
    tickRivals(state, rng);
    expect(state.rivals[0].training).toBe(t);
    state.clock.totalTicks = TICKS_PER_YEAR * 2 + 6 * TICKS_PER_HOUR;
    expect(rivalStrength(state, state.rivals[0])).toBeGreaterThan(s0);
  });

  it('fields egg-show entries and a race grid from its flocks', () => {
    const { state, rng } = createNewGame(82);
    const eggs = rivalEggEntries(state, rng);
    expect(eggs).toHaveLength(3);
    expect(eggs.map((e) => e.breeder)).toContain('Old Wiggins');
    const racers = rivalRacers(state);
    expect(racers).toHaveLength(3);
    for (const r of racers) {
      expect(r.duck.training?.paddle).toBeGreaterThan(0);
      expect(r.skill).toBeGreaterThan(0.8);
    }
  });

  it('a hired stud courts a hen and the egg carries his genes and name', () => {
    const { state, rng } = createNewGame(83);
    const hen = state.ducks.find((d) => d.sex === 'F')!;
    const offer = studOffers(state)[0];
    state.money = offer.cost + 10;
    expect(hireStud(state, offer.rivalId, hen.id).ok).toBe(true);
    expect(state.money).toBe(10);
    expect(state.pendingClutches[0].stud?.name).toBe(offer.drake.name);
    expect(state.stats.studsUsed).toBe(1);
    // Refuses a second courtship for the same hen, and a broke player.
    expect(hireStud(state, offer.rivalId, hen.id).ok).toBe(false);
    state.stats.ducksBred = 0; // the first clutch always takes
    for (let i = 0; i < COURTSHIP_TICKS; i += 1) tickBreeding(state, rng);
    const egg = state.ducks.find((d) => d.stage === 'egg')!;
    expect(egg).toBeDefined();
    expect(egg.lineage?.sire?.name).toBe(offer.drake.name);
    expect(egg.parents?.[1]).toBe(offer.drake.id);
  });

  it('old saves without rivals get them on load', async () => {
    const { deserialize, serialize } = await import('../save/save');
    const { state } = createNewGame(84);
    const raw = JSON.parse(serialize(state));
    delete raw.state.rivals;
    delete raw.state.cup;
    delete raw.state.drillPurse;
    const restored = deserialize(JSON.stringify(raw));
    expect(restored.rivals).toHaveLength(3);
    expect(restored.cup).toBeNull();
    expect(restored.drillPurse.day).toBe(-1);
    void TICKS_PER_DAY;
  });
});
