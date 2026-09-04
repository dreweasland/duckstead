import { describe, expect, it } from 'vitest';
import { newGameWithPair } from '../testFixtures';
import { bondedPair, eggViability } from './needs';
import { train, TRAINING } from './training';
import { TUNING } from './tuning';

describe('inseparable ducks', () => {
  it('a bonded pair courts 5% better; one-sided fondness does not count', () => {
    const { hen: a, drake: b } = newGameWithPair(60);
    const base = eggViability(a, b, false);
    a.friendId = b.id;
    expect(eggViability(a, b, false)).toBeCloseTo(base, 5);
    b.friendId = a.id;
    expect(bondedPair(a, b)).toBe(true);
    expect(eggViability(a, b, false)).toBeCloseTo(base + TUNING.needs.bondedViabilityBonus, 5);
  });

  it('a friend watching a drill adds a point and enjoys the show', () => {
    // Same ducks, same drill — the only difference is where the friend stands.
    const far = newGameWithPair(61);
    far.hen.friendId = far.drake.id;
    far.drake.friendId = far.hen.id;
    far.drake.pos = { x: far.hen.pos.x + 500, y: far.hen.pos.y };
    const gainFar = train(far.state, far.hen.id, 'stamina', 0);
    const near = newGameWithPair(61);
    near.hen.friendId = near.drake.id;
    near.drake.friendId = near.hen.id;
    near.drake.pos = { ...near.hen.pos };
    const happy = near.drake.needs.happiness;
    const gainNear = train(near.state, near.hen.id, 'stamina', 0);
    expect(gainNear).toBe(gainFar + TRAINING.friendBonus);
    expect(near.drake.needs.happiness).toBe(Math.min(100, happy + TRAINING.friendCheer));
    expect(far.drake.needs.happiness).toBeLessThanOrEqual(happy); // no cheer from afar
  });
});
