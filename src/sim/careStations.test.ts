import { afterEach, describe, expect, it } from 'vitest';
import { newGameWithPair } from '../testFixtures';
import { events } from '../events';
import { runBathHouse, runTreatDispenser, tickNeeds } from './needs';
import { favouriteTreat, TREATS, type TreatKind } from './food';
import { TUNING } from './tuning';
import { TICKS_PER_HOUR } from './time';
import { BALANCE } from './economy';

const offs: Array<() => void> = [];
afterEach(() => offs.splice(0).forEach((off) => off()));

describe('bath house', () => {
  it('scrubs only the ducks below the threshold, one soap each', () => {
    const { state, hen, drake } = newGameWithPair(7);
    state.upgrades.bathHouse = 1;
    state.inventory.soap = 10;
    hen.needs.cleanliness = 20;
    drake.needs.cleanliness = 95;
    const result = runBathHouse(state);
    expect(result).toEqual({ scrubbed: 1, unwashed: 0 }); // the others start at 80, above the threshold
    expect(hen.needs.cleanliness).toBe(20 + BALANCE.cleanRestore);
    expect(drake.needs.cleanliness).toBe(95);
    expect(state.inventory.soap).toBe(9);
  });

  it('stops when the soap runs out and reports who went unwashed', () => {
    const { state } = newGameWithPair(8);
    state.upgrades.bathHouse = 1;
    state.inventory.soap = 1;
    for (const d of state.ducks) d.needs.cleanliness = 10;
    expect(runBathHouse(state)).toEqual({ scrubbed: 1, unwashed: 3 });
    expect(state.inventory.soap).toBe(0);
  });

  it('runs at dawn from tickNeeds and announces itself', () => {
    const { state, rng } = newGameWithPair(9);
    state.upgrades.bathHouse = 1;
    state.inventory.soap = 10;
    for (const d of state.ducks) d.needs.cleanliness = 10;
    const toasts: string[] = [];
    offs.push(events.on('toast', (m) => toasts.push(String(m))));
    state.clock.totalTicks = 6 * TICKS_PER_HOUR - 1;
    tickNeeds(state, rng); // 05:59:54 — not yet
    expect(state.inventory.soap).toBe(10);
    state.clock.totalTicks = 6 * TICKS_PER_HOUR;
    tickNeeds(state, rng);
    expect(state.inventory.soap).toBe(6);
    expect(toasts).toContain('The bath house scrubbed 4 ducks');
  });
});

describe('treat dispenser', () => {
  it('feeds the gloomiest duck first, one per level, from the fullest treat', () => {
    const { state, hen, drake } = newGameWithPair(10);
    state.upgrades.treatDispenser = 1;
    state.inventory.peas = 0;
    state.inventory.worms = 3;
    state.inventory.berries = 1;
    hen.needs.happiness = 30;
    drake.needs.happiness = 40;
    for (const d of state.ducks) if (d !== hen && d !== drake) d.needs.happiness = 90;
    const result = runTreatDispenser(state);
    expect(result.given).toBe(1);
    expect(state.inventory.worms).toBe(2);
    expect(hen.needs.happiness).toBeGreaterThan(30);
    expect(drake.needs.happiness).toBe(40);
    state.upgrades.treatDispenser = 2;
    expect(runTreatDispenser(state).given).toBe(2);
  });

  it('prefers a known favourite while it is in stock', () => {
    const { state, hen } = newGameWithPair(11);
    state.upgrades.treatDispenser = 1;
    const fav = favouriteTreat(hen);
    const other = TREATS.find((t) => t !== fav) as TreatKind;
    state.inventory[fav] = 1;
    state.inventory[other] = 9;
    hen.needs.happiness = 20;
    for (const d of state.ducks) if (d !== hen) d.needs.happiness = 90;
    hen.favouriteKnown = true;
    runTreatDispenser(state);
    expect(state.inventory[fav]).toBe(0); // the favourite went first despite the bigger stock of the other
    expect(state.inventory[other]).toBe(9);
    // Now out of the favourite: falls back to what there is.
    hen.needs.happiness = 20;
    runTreatDispenser(state);
    expect(state.inventory[other]).toBe(8);
  });

  it('can discover a favourite on its own and says so at the hour', () => {
    const { state, rng, hen } = newGameWithPair(12);
    state.upgrades.treatDispenser = 1;
    const fav = favouriteTreat(hen);
    for (const t of TREATS) state.inventory[t] = 0;
    state.inventory[fav] = 5;
    hen.needs.happiness = 20;
    hen.favouriteKnown = false;
    for (const d of state.ducks) if (d !== hen) d.needs.happiness = 90;
    const toasts: string[] = [];
    offs.push(events.on('toast', (m) => toasts.push(String(m))));
    state.clock.totalTicks = 10 * TICKS_PER_HOUR; // 10:00, on the hour, by day
    tickNeeds(state, rng);
    expect(hen.favouriteKnown).toBe(true);
    expect(toasts.some((m) => m.startsWith(`The dispenser found ${hen.name}'s favourite`))).toBe(true);
  });

  it('does nothing when the hopper is empty, above the threshold, or at night', () => {
    const { state, rng, hen } = newGameWithPair(13);
    state.upgrades.treatDispenser = 2;
    for (const t of TREATS) state.inventory[t] = 0;
    hen.needs.happiness = 10;
    expect(runTreatDispenser(state).given).toBe(0);
    state.inventory.peas = 5;
    for (const d of state.ducks) d.needs.happiness = TUNING.care.dispenserThreshold;
    expect(runTreatDispenser(state).given).toBe(0);
    hen.needs.happiness = 10;
    state.clock.totalTicks = 23 * TICKS_PER_HOUR; // night: the hourly run is skipped
    tickNeeds(state, rng);
    expect(state.inventory.peas).toBe(5);
  });
});

describe('care station placement', () => {
  it('both stations stay on dry land at every pond expansion level', async () => {
    const { bathHousePos, pondDistance, treatDispenserPos } = await import('./pond');
    const { state } = newGameWithPair(14);
    for (let level = 0; level <= 3; level += 1) {
      state.upgrades.pondExpansion = level;
      // 1.0 is the water's edge; the drawn shore wobbles to about 1.08.
      expect(pondDistance(state, bathHousePos(state))).toBeGreaterThan(1.1);
      expect(pondDistance(state, treatDispenserPos())).toBeGreaterThan(1.1);
    }
  });
});
