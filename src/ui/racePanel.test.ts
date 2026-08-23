import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createDuck } from '../sim/duck';
import { randomCommonGenome, type Genome } from '../sim/genetics';
import { boostPower, racedToday, raceSpeed } from './racePanel';

function duckWithVigor(vigor: '+' | '-'): ReturnType<typeof createDuck> {
  const rng = createRng(3);
  const genome: Genome = randomCommonGenome(rng);
  genome.vigor1 = [vigor, vigor];
  genome.vigor2 = [vigor, vigor];
  return createDuck(rng, { genome, stage: 'adult', pos: { x: 0, y: 0 }, name: 'x' });
}

describe('race speed', () => {
  it('vigorous ducks are faster than frail ones', () => {
    const fast = duckWithVigor('+');
    const slow = duckWithVigor('-');
    // Same id-derived personality (same rng seed path), so vigor dominates.
    expect(raceSpeed(fast)).toBeGreaterThan(raceSpeed(slow));
  });

  it('speeds land in a sane range', () => {
    const rng = createRng(9);
    for (let i = 0; i < 50; i += 1) {
      const duck = createDuck(rng, {
        genome: randomCommonGenome(rng),
        stage: 'adult',
        pos: { x: 0, y: 0 },
      });
      const speed = raceSpeed(duck);
      expect(speed).toBeGreaterThan(25);
      expect(speed).toBeLessThan(110);
    }
  });
});

describe('race fairness', () => {
  it('paddle power rewards precision and punishes mashing', () => {
    expect(boostPower(0.5)).toBe(1);
    expect(boostPower(0.35)).toBeCloseTo(0.49);
    expect(boostPower(0.1)).toBeCloseTo(0.1); // floor
    expect(boostPower(0)).toBeCloseTo(0.1);
  });

  it('a duck races the derby once per day', () => {
    const duck = duckWithVigor('+');
    expect(racedToday(duck, 3)).toBe(false);
    duck.lastRaceDay = 3;
    expect(racedToday(duck, 3)).toBe(true);
    expect(racedToday(duck, 4)).toBe(false);
  });
});
