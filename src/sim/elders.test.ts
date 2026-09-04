import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { createDuck, createStarterDuck } from './duck';
import { randomCommonGenome } from './genetics';
import { broodyWarmthScale, elderDaysLeft, mentorNearby, passingPoints } from './elders';
import { pondOccupancy } from './economy';
import { breedingValue, keepVerdict } from './advisor';
import { flockBalance } from './flockBalance';
import { tickLifecycle } from './lifecycle';
import { tickNeeds } from './needs';
import { STAGE_DAYS } from './duck';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

function setup(seed = 60) {
  const { state, rng } = createNewGame(seed);
  state.clock.totalTicks = 12 * TICKS_PER_HOUR; // midday: normal decay rates
  return { state, rng };
}

describe('elders and the pond', () => {
  it('do not count toward capacity or drake pressure', () => {
    const { state } = setup();
    const before = pondOccupancy(state);
    const drake = state.ducks.find((d) => d.sex === 'M')!;
    drake.stage = 'elder';
    expect(pondOccupancy(state)).toBe(before - 1);
    expect(flockBalance(state).drakes).toBe(1); // the other starter drake only
  });
});

describe('broody grannies', () => {
  it('slow egg-warmth decay, capped at two hens', () => {
    const { state } = setup();
    expect(broodyWarmthScale(state)).toBe(1);
    const hens = state.ducks.filter((d) => d.sex === 'F');
    hens[0].stage = 'elder';
    expect(broodyWarmthScale(state)).toBe(0.75);
    hens[1].stage = 'elder';
    expect(broodyWarmthScale(state)).toBe(0.5);
    // A third hen (or a penned one) adds nothing.
    hens[0].penned = true;
    expect(broodyWarmthScale(state)).toBe(0.75);
  });

  it('an elder hen keeps a nest egg warmer over an hour', () => {
    const run = (withElder: boolean): number => {
      const { state, rng } = setup(61);
      if (withElder) state.ducks.find((d) => d.sex === 'F')!.stage = 'elder';
      const egg = createDuck(rng, { genome: randomCommonGenome(rng), stage: 'egg', pos: { x: 0, y: 0 } });
      egg.warmth = 80;
      state.ducks.push(egg);
      for (let i = 0; i < TICKS_PER_HOUR; i += 1) tickNeeds(state, rng);
      return egg.warmth!;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });
});

describe('the mentor', () => {
  it('a duckling near an elder holds happiness better', () => {
    const run = (withElder: boolean): number => {
      const { state, rng } = setup(62);
      const young = createStarterDuck(rng, { x: 300, y: 300 });
      young.stage = 'duckling';
      young.needs.happiness = 70;
      young.needs.hunger = 100;
      young.activity = 'idle';
      state.ducks.push(young);
      if (withElder) {
        const elder = createStarterDuck(rng, { x: 340, y: 300 });
        elder.stage = 'elder';
        state.ducks.push(elder);
      }
      // Park the rest far away so only the elder matters.
      for (const d of state.ducks) if (d !== young && d.stage !== 'elder') d.pos = { x: 900, y: 100 };
      expect(mentorNearby(state, young)).toBe(withElder);
      for (let i = 0; i < TICKS_PER_HOUR * 2; i += 1) tickNeeds(state, rng);
      return young.needs.happiness;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });

  it('adults are past mentoring', () => {
    const { state, rng } = setup(63);
    const elder = createStarterDuck(rng, { x: 0, y: 0 });
    elder.stage = 'elder';
    state.ducks.push(elder);
    const adult = state.ducks.find((d) => d.stage === 'adult')!;
    adult.pos = { x: 10, y: 0 };
    expect(mentorNearby(state, adult)).toBe(false);
  });
});

describe('elders leave the breeding math', () => {
  it('an elder is never a key breeder, and cannot preserve a gene for an adult', () => {
    const { state } = setup(67);
    const adults = state.ducks.filter((d) => d.stage === 'adult');
    // Give one adult and one (soon-to-be) elder the only blue alleles.
    adults[0].genome.baseColor = ['B', 'M'];
    adults[1].genome.baseColor = ['B', 'M'];
    // Both adults carry it: neither is the sole carrier... until one retires.
    expect(breedingValue(state, adults[0]).uniqueAlleles).not.toContain('blue');
    adults[1].stage = 'elder';
    // The elder can't pass its copy on, so the adult is now the key carrier —
    // and the elder itself never counts as one.
    expect(breedingValue(state, adults[0]).uniqueAlleles).toContain('blue');
    expect(keepVerdict(breedingValue(state, adults[1]))).not.toBe('key');
    expect(breedingValue(state, adults[1]).newBreeds).toEqual([]);
  });
});

describe('an honoured passing', () => {
  it('grants society points and a feather; a sold elder forfeits both', () => {
    const { state, rng } = setup(64);
    const elder = state.ducks[0];
    elder.stage = 'elder';
    elder.ageTicks = STAGE_DAYS.elder * TICKS_PER_DAY;
    const expected = passingPoints(elder);
    expect(expected).toBeGreaterThanOrEqual(2);
    const feathers = { ...state.featherAlbum };
    tickLifecycle(state, rng);
    expect(state.ducks).not.toContain(elder);
    expect(state.society.points).toBe(expected);
    expect(state.society.lifetimePoints).toBe(expected);
    expect(state.featherAlbum[elder.phenotype.bodyColor]).toBe(
      (feathers[elder.phenotype.bodyColor] ?? 0) + 1,
    );
  });

  it('a duck dying young earns no honours', () => {
    const { state, rng } = setup(65);
    const adult = state.ducks[0];
    adult.needs.health = 0;
    tickLifecycle(state, rng);
    expect(state.ducks).not.toContain(adult);
    expect(state.society.points).toBe(0);
  });

  it('elderDaysLeft counts down to the passing', () => {
    const { state } = setup(66);
    const elder = state.ducks[0];
    elder.stage = 'elder';
    elder.ageTicks = 0;
    expect(elderDaysLeft(elder)).toBe(STAGE_DAYS.elder);
    elder.ageTicks = STAGE_DAYS.elder * TICKS_PER_DAY - 10;
    expect(elderDaysLeft(elder)).toBe(1);
  });
});
