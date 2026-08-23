import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { tickBehavior } from './behavior';
import { nestPair, tickBreeding } from './breeding';
import { canBreedPair } from './needs';
import { tickLifecycle } from './lifecycle';
import { tickNeeds } from './needs';
import { tickPond } from './pond';
import { dropFood } from './needs';
import { tickVisitors } from './visitors';
import { seasonOf, TICKS_PER_YEAR } from './time';
import { isOvercrowded, sellDuck } from './economy';

// Long-run stability: simulate ~1.5 game-years with a simple caretaker bot.
// Guards against NaNs, runaway values, and death-spiral balance bugs.
describe('soak', () => {
  it('survives 1.5 game-years of simulation without corruption', () => {
    const { state, rng } = createNewGame(2024);
    state.inventory.feed = 100000;

    const totalTicks = TICKS_PER_YEAR * 1.5;
    for (let i = 0; i < totalTicks; i += 1) {
      state.clock.totalTicks += 1;
      state.seasonCache = seasonOf(state.clock);
      tickNeeds(state, rng);
      tickLifecycle(state, rng);
      tickBreeding(state, rng);
      tickBehavior(state, rng);
      tickPond(state);
      tickVisitors(state, rng);

      // Caretaker bot: every game-hour, feed hungry ducks and clean the pond.
      if (i % 600 === 0) {
        for (const duck of state.ducks) {
          if (duck.stage !== 'egg' && duck.needs.hunger < 50) {
            dropFood(state, { x: duck.pos.x, y: duck.pos.y }, false);
          }
          if (duck.stage !== 'egg') {
            duck.needs.cleanliness = Math.max(duck.needs.cleanliness, 60);
            duck.needs.happiness = Math.max(duck.needs.happiness, 60);
          }
        }
        state.pond.cleanliness = 100;
        // The pond has a capacity: like a sensible keeper, sell the youngest
        // duck of whichever sex is in surplus to make room, and let elders
        // retire naturally so the memorial fills.
        if (isOvercrowded(state)) {
          const living = state.ducks.filter((d) => d.stage !== 'egg');
          const males = living.filter((d) => d.sex === 'M').length;
          const surplus = males >= living.length - males ? 'M' : 'F';
          // Never sell down the breeding core: keep two non-elders of each sex.
          const keepers = living.filter((d) => d.sex === surplus && d.stage !== 'elder');
          const victim = [...keepers]
            .sort((a, b) => (a.stage === 'adult' ? 1 : 0) - (b.stage === 'adult' ? 1 : 0) || a.ageTicks - b.ageTicks)[0];
          if (victim && keepers.length > 2) sellDuck(state, victim.id);
        }
        // Keep the flock breeding: nest the first pair that can.
        const adults = state.ducks.filter((d) => d.stage === 'adult');
        pairs: for (const m of adults.filter((d) => d.sex === 'M')) {
          for (const f of adults.filter((d) => d.sex === 'F')) {
            if (canBreedPair(m, f).ok && nestPair(state, m.id, f.id).ok) break pairs;
          }
        }
      }
    }

    // Invariants after the long run.
    for (const duck of state.ducks) {
      expect(Number.isFinite(duck.pos.x)).toBe(true);
      expect(Number.isFinite(duck.pos.y)).toBe(true);
      for (const value of Object.values(duck.needs)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
    expect(Number.isFinite(state.pond.cleanliness)).toBe(true);
    // Generations turned over: ducks hatched and elders died.
    expect(state.stats.ducksHatched).toBeGreaterThan(0);
    expect(state.memorial.length).toBeGreaterThan(0);
    // The flock survived.
    expect(state.ducks.length).toBeGreaterThan(0);
  }, 60_000);
});
