import { describe, expect, it } from 'vitest';
import { GROUND_TOP, WORLD_H, WORLD_W } from '../state';
import { createNewGame } from '../newGame';
import { advanceTicks, newGameWithPair } from '../testFixtures';
import { createStarterDuck, layEgg } from './duck';
import { pondDistance } from './pond';
import { tickBehavior } from './behavior';
import { tickLifecycle } from './lifecycle';
import { tickNeeds } from './needs';
import { seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

// Regression: ducks must keep roaming the map, not pile up in a corner.
describe('duck distribution', () => {
  it('ducks do not collect in a corner over two game-days', () => {
    const { state, rng } = createNewGame(99);
    state.inventory.feed = 10000;
    for (const d of state.ducks) d.needs.hunger = 100;

    advanceTicks(state, rng, TICKS_PER_DAY * 2, [
      (s) => { s.seasonCache = seasonOf(s.clock); },
      tickNeeds,
      tickLifecycle,
      tickBehavior,
      // Keep them fed so hunger never dominates behavior.
      (s) => { for (const d of s.ducks) d.needs.hunger = Math.max(d.needs.hunger, 80); },
    ]);

    for (const duck of state.ducks) {
      // Not jammed against the top or right boundary.
      expect(duck.pos.y).toBeGreaterThan(165);
      expect(duck.pos.x).toBeLessThan(WORLD_W - 25);
      expect(duck.pos.x).toBeGreaterThan(25);
      expect(duck.pos.y).toBeLessThan(WORLD_H - 15);
    }
  });
});

describe('night roost', () => {
  it('every duck is asleep on the bank within two hours of nightfall, at every pond size', () => {
    for (const level of [0, 1, 2, 3]) {
      for (const seed of [1, 2, 3]) {
        const { state, rng } = createNewGame(seed);
        state.upgrades.pondExpansion = level;
        for (let i = 0; i < 10; i += 1) state.ducks.push(createStarterDuck(rng, { x: 300 + i * 40, y: 420 }));
        state.clock.totalTicks = 21 * TICKS_PER_HOUR;
        advanceTicks(state, rng, TICKS_PER_HOUR * 2, [tickNeeds, tickBehavior]);
        for (const d of state.ducks) {
          expect(d.activity).toBe('sleep');
          expect(pondDistance(state, d.pos)).toBeGreaterThan(1.2);
          expect(d.pos.y).toBeGreaterThanOrEqual(GROUND_TOP);
        }
      }
    }
  });


  it('broods roost beside their mother instead of jogging between her and their own spot', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { state, rng, hen: m, drake: f } = newGameWithPair(seed);
      for (let i = 0; i < 4; i += 1) {
        const e = layEgg(rng, m, f, { x: 400 + i * 30, y: 450 });
        e.stage = 'duckling';
        e.activity = 'idle';
        state.ducks.push(e);
      }
      state.clock.totalTicks = 21 * TICKS_PER_HOUR;
      advanceTicks(state, rng, TICKS_PER_HOUR * 2, [tickNeeds, tickBehavior]);
      for (const d of state.ducks) expect(d.activity).toBe('sleep');
      for (const d of state.ducks.filter((x) => x.stage === 'duckling')) {
        expect(Math.hypot(d.pos.x - m.pos.x, d.pos.y - m.pos.y)).toBeLessThan(120);
      }
    }
  });
});
