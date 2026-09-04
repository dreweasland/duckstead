import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { advanceTicks, newGameWithPair } from '../testFixtures';
import { createStarterDuck } from './duck';
import { canPen, inPen, penCapacity, penDuck, penDucks, releaseDuck } from './pen';
import { drakePressure, flockBalance } from './flockBalance';
import { breedReadiness, canBreedPair, tickNeeds } from './needs';
import { canLayToday } from './laying';
import { tickBehavior } from './behavior';
import { isInPond } from './pond';
import { TICKS_PER_HOUR } from './time';


describe('bachelor pen', () => {
  it('needs the upgrade, respects capacity, and takes drakes out of the balance', () => {
    const { state, rng, hen, drake } = newGameWithPair(110);
    for (let i = 0; i < 3; i += 1) state.ducks.push(createStarterDuck(rng, { x: 480, y: 400 }, 'M'));
    expect(flockBalance(state).excess).toBe(3);
    expect(canPen(state, drake).ok).toBe(false);
    expect(canPen(state, drake).reason).toContain('Buy');
    state.upgrades.bachelorPen = 1;
    expect(penCapacity(state)).toBe(3);
    const drakes = state.ducks.filter((d) => d.sex === 'M');
    expect(penDuck(state, drakes[0].id).ok).toBe(true);
    expect(penDuck(state, drakes[1].id).ok).toBe(true);
    expect(penDuck(state, drakes[2].id).ok).toBe(true);
    expect(penDuck(state, drakes[3].id).ok).toBe(false);
    expect(penDuck(state, drakes[3].id).reason).toContain('full');
    expect(penDucks(state)).toHaveLength(3);
    const bal = flockBalance(state);
    expect(bal.drakes).toBe(2);
    expect(bal.penned).toBe(3);
    expect(bal.excess).toBe(0);
    expect(drakePressure(state)).toBe(0);
    // Penned ducks can't breed; release restores them.
    expect(breedReadiness(drakes[0]).reason).toContain('pen');
    expect(canBreedPair(drakes[0], hen).ok).toBe(false);
    expect(releaseDuck(state, drakes[0].id)).toBe(true);
    expect(breedReadiness(drakes[0]).ok).toBe(true);
    expect(penDucks(state)).toHaveLength(2);
  });

  it('penned hens do not lay', () => {
    const { state, hen } = newGameWithPair(111);
    state.upgrades.bachelorPen = 1;
    hen.needs.hunger = 90;
    hen.needs.happiness = 90;
    expect(canLayToday(hen, 2)).toBe(true);
    penDuck(state, hen.id);
    expect(canLayToday(hen, 2)).toBe(false);
  });

  it('penned ducks walk in, then stay inside the fence day and night and never swim', () => {
    const { state, rng } = createNewGame(112);
    state.upgrades.bachelorPen = 2;
    const drakes = state.ducks.filter((d) => d.sex === 'M');
    for (const d of drakes) expect(penDuck(state, d.id).ok).toBe(true);
    // Walk in (they start in the pond).
    state.clock.totalTicks = 9 * TICKS_PER_HOUR;
    advanceTicks(state, rng, TICKS_PER_HOUR * 2, [tickNeeds, tickBehavior]);
    for (const d of drakes) expect(inPen(state, d.pos)).toBe(true);
    // A day and a night inside.
    let swims = 0;
    for (let i = 0; i < TICKS_PER_HOUR * 20; i += 1) {
      state.clock.totalTicks += 1;
      tickNeeds(state, rng);
      tickBehavior(state, rng);
      for (const d of drakes) {
        if (d.activity === 'swim' || d.activity === 'dabble' || isInPond(state, d.pos)) swims += 1;
        if (i % 50 === 0) expect(inPen(state, d.pos)).toBe(true);
      }
    }
    expect(swims).toBe(0);
    // It was night for part of that: they slept in the pen.
    expect(drakes.every((d) => d.activity === 'sleep' || d.activity === 'idle' || d.activity === 'forage' || d.activity === 'preen' || d.activity === 'waddle' || d.activity === 'flap' || d.activity === 'shake')).toBe(true);
  });
});
