import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { henEggPrice, sponsorCost, sponsorFestival, UPGRADES } from './economy';
import { feederCapacity, fillFeeder, tickNeeds } from './needs';
import { growthScale } from './lifecycle';
import { festivalTier, markFestivalEntered } from './festivals';
import { tickBugs } from './bugs';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

describe('late-game upgrades', () => {
  it('total upgrade spend is now a real sink', () => {
    const total = UPGRADES.reduce((s, u) => s + u.costs.reduce((a, b) => a + b, 0), 0);
    expect(total).toBeGreaterThan(20000);
  });

  it('egg cooler, silo, brooder lamp each scale with level', () => {
    const { state, rng } = createNewGame(100);
    const base = henEggPrice(state);
    state.upgrades.eggCooler = 2;
    expect(henEggPrice(state)).toBe(Math.round(base * 1.5));
    state.upgrades.feedingTrough = 1;
    state.upgrades.feedSilo = 2;
    expect(feederCapacity(state)).toBe(60);
    state.inventory.feed = 100;
    expect(fillFeeder(state)).toBe(60);
    // Dawn auto-pour.
    state.feeder.food = 0;
    state.clock.totalTicks = 6 * TICKS_PER_HOUR;
    tickNeeds(state, rng);
    expect(state.feeder.food).toBe(40);
    state.upgrades.brooderLamp = 2;
    expect(growthScale(state)).toBeCloseTo(1.4);
  });

  it('reed beds raise forage caps', () => {
    const { state, rng } = createNewGame(101);
    state.ducks = [];
    state.upgrades.reedBeds = 3;
    state.clock.totalTicks = 8 * TICKS_PER_HOUR;
    for (let i = 0; i < TICKS_PER_DAY; i += 1) { state.clock.totalTicks += 1; tickBugs(state, rng); }
    const critters = state.bugs.filter((b) => b.kind === 'beetle' || b.kind === 'snail').length;
    expect(critters).toBeGreaterThan(3); // above the unupgraded cap
  });

  it('sponsorship raises the next festival a tier for one edition', () => {
    const { state } = createNewGame(102);
    state.money = 5000;
    expect(festivalTier(state, 'eggShow')).toBe(0);
    const cost = sponsorCost(state, 'eggShow');
    expect(sponsorFestival(state, 'eggShow')).toBe(true);
    expect(state.money).toBe(5000 - cost);
    expect(festivalTier(state, 'eggShow')).toBe(1);
    expect(sponsorFestival(state, 'eggShow')).toBe(false); // already
    markFestivalEntered(state, 'eggShow');
    expect(festivalTier(state, 'eggShow')).toBe(0);
  });
});
