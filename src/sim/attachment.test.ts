import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { personalityLabels, tickBehavior } from './behavior';
import { tickNeeds } from './needs';
import { TICKS_PER_HOUR } from './time';

describe('decorations', () => {
  it('give a capped happiness aura', () => {
    const plain = createNewGame(51);
    const decorated = createNewGame(51); // same seed → same flock
    decorated.state.decorations = [
      { kind: 'lantern', pos: { x: 100, y: 300 } },
      { kind: 'bench', pos: { x: 140, y: 320 } },
      { kind: 'gnome', pos: { x: 180, y: 300 } },
    ];
    for (const setup of [plain, decorated]) {
      for (const d of setup.state.ducks) {
        d.needs.happiness = 60;
        d.needs.hunger = 100;
        d.activity = 'idle';
      }
    }
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) {
      tickNeeds(plain.state, plain.rng);
      tickNeeds(decorated.state, decorated.rng);
    }
    expect(decorated.state.ducks[0].needs.happiness).toBeGreaterThan(
      plain.state.ducks[0].needs.happiness,
    );
  });
});

describe('personality labels', () => {
  it('produces consistent, bounded tags', () => {
    const { state } = createNewGame(52);
    for (const duck of state.ducks) {
      const labels = personalityLabels(duck);
      expect(labels.length).toBeLessThanOrEqual(2);
      expect(personalityLabels(duck)).toEqual(labels); // deterministic
    }
  });
});

describe('friendships', () => {
  it('two ducks that stay together become friends', () => {
    const { state, rng } = createNewGame(53);
    // Keep just two ducks, pinned near each other.
    state.ducks = state.ducks.slice(0, 2);
    const [a, b] = state.ducks;
    for (let i = 0; i < 8 * TICKS_PER_HOUR; i += 1) {
      state.clock.totalTicks += 1;
      // Pin positions so the hourly sample always sees them together.
      a.pos = { x: 300, y: 300 };
      b.pos = { x: 330, y: 300 };
      tickBehavior(state, rng);
    }
    expect(a.friendId).toBe(b.id);
    expect(b.friendId).toBe(a.id);
  });
});
