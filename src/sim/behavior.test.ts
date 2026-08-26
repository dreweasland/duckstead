import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { createDuck, type Duck } from './duck';
import { randomCommonGenome } from './genetics';
import { tickBehavior } from './behavior';
import { TICKS_PER_HOUR } from './time';

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Regression: ducklings trailing their mother used to release the follow pull
// right at the outer ring, where their own wander target immediately dragged
// them back out — snapping their heading left and right in a tight loop.
describe('duckling follow hysteresis', () => {
  const setup = () => {
    const { state, rng } = createNewGame(31);
    state.clock.totalTicks = 10 * TICKS_PER_HOUR; // daytime
    const mom = createDuck(rng, { genome: randomCommonGenome(rng), stage: 'adult', pos: { x: 120, y: 320 }, sex: 'F' });
    const kid = createDuck(rng, { genome: randomCommonGenome(rng), stage: 'duckling', pos: { x: 240, y: 320 } });
    kid.parents = [mom.id, mom.id];
    mom.activity = 'idle';
    mom.activityTimer = 10_000;
    kid.activity = 'waddle';
    kid.activityTimer = 10_000;
    kid.needs.hunger = 100;
    state.ducks = [mom as Duck, kid as Duck];
    return { state, rng, mom, kid };
  };

  it('chases past the outer ring and keeps chasing until properly caught up', () => {
    const { state, rng, mom, kid } = setup();
    kid.wanderTarget = { x: 700, y: 320 }; // a stale destination away from mother
    tickBehavior(state, rng);
    expect(kid.chasingMom).toBe(true);

    let releasedAt = Infinity;
    for (let i = 0; i < 400 && kid.chasingMom; i += 1) {
      const before = dist(kid.pos, mom.pos);
      tickBehavior(state, rng);
      // While chasing, the gap only closes — no flip-flopping back out,
      // even well inside the old 70-unit release ring.
      expect(dist(kid.pos, mom.pos)).toBeLessThan(before + 0.6);
      releasedAt = dist(kid.pos, mom.pos);
    }
    expect(kid.chasingMom).toBeUndefined();
    expect(releasedAt).toBeLessThan(40); // released close in, not at the outer ring
    // The stale far-away destination was dropped so it can't re-trigger the chase.
    expect(kid.wanderTarget).toBeUndefined();
  });

  it('a duckling inside the ring is left to its own wandering', () => {
    const { state, rng, kid } = setup();
    kid.pos = { x: 170, y: 320 }; // 50 units away — inside the outer ring
    kid.wanderTarget = { x: 300, y: 340 };
    tickBehavior(state, rng);
    expect(kid.chasingMom).toBeUndefined();
    expect(kid.pos.x).toBeGreaterThan(170); // heading for its own target, not mother
  });
});
