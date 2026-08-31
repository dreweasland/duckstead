import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { bondedPair, eggViability } from './needs';
import { train, TRAINING } from './training';
import { TUNING } from './tuning';

function pair(seed: number) {
  const { state, rng } = createNewGame(seed);
  const a = state.ducks.find((d) => d.sex === 'F')!;
  const b = state.ducks.find((d) => d.sex === 'M')!;
  return { state, rng, a, b };
}

describe('inseparable ducks', () => {
  it('a bonded pair courts 5% better; one-sided fondness does not count', () => {
    const { a, b } = pair(60);
    const base = eggViability(a, b, false);
    a.friendId = b.id;
    expect(eggViability(a, b, false)).toBeCloseTo(base, 5);
    b.friendId = a.id;
    expect(bondedPair(a, b)).toBe(true);
    expect(eggViability(a, b, false)).toBeCloseTo(base + TUNING.needs.bondedViabilityBonus, 5);
  });

  it('a friend watching a drill adds a point and enjoys the show', () => {
    // Same ducks, same drill — the only difference is where the friend stands.
    const far = pair(61);
    far.a.friendId = far.b.id;
    far.b.friendId = far.a.id;
    far.b.pos = { x: far.a.pos.x + 500, y: far.a.pos.y };
    const gainFar = train(far.state, far.a.id, 'stamina', 0);
    const near = pair(61);
    near.a.friendId = near.b.id;
    near.b.friendId = near.a.id;
    near.b.pos = { ...near.a.pos };
    const happy = near.b.needs.happiness;
    const gainNear = train(near.state, near.a.id, 'stamina', 0);
    expect(gainNear).toBe(gainFar + TRAINING.friendBonus);
    expect(near.b.needs.happiness).toBe(Math.min(100, happy + TRAINING.friendCheer));
    expect(far.b.needs.happiness).toBeLessThanOrEqual(happy); // no cheer from afar
  });
});
