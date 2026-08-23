import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../state';
import { createStarterDuck } from './duck';
import {
  breedReadiness,
  brushStroke,
  canBreedPair,
  dropFood,
  eggSpeedFor,
  eggViability,
  eggWarmth,
  FEEDER_CAPACITY,
  fillFeeder,
  petStroke,
  tickNeeds,
  tuckEgg,
} from './needs';
import { createDuck } from './duck';
import { randomCommonGenome } from './genetics';
import { BALANCE } from './economy';
import { tickBehavior } from './behavior';
import { FEEDER_POS, tickPond } from './pond';
import { TICKS_PER_HOUR } from './time';

function setup() {
  const { state, rng } = createNewGame(42);
  return { state, rng };
}

describe('need decay', () => {
  it('hunger drops ~6 per daytime game-hour', () => {
    const { state, rng } = setup();
    const duck = state.ducks[0];
    duck.needs.hunger = 100;
    duck.activity = 'idle';
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) tickNeeds(state, rng);
    expect(duck.needs.hunger).toBeCloseTo(94, 0);
  });

  it('starvation drains health', () => {
    const { state, rng } = setup();
    const duck = state.ducks[0];
    duck.needs.hunger = 10;
    duck.needs.health = 100;
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) tickNeeds(state, rng);
    expect(duck.needs.health).toBeLessThan(100);
  });

  it('sick ducks lose health and happiness', () => {
    const { state, rng } = setup();
    const duck = state.ducks[0];
    duck.sick = true;
    const h0 = duck.needs.health;
    const p0 = duck.needs.happiness;
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) tickNeeds(state, rng);
    expect(duck.needs.health).toBeCloseTo(h0 - 4, 0);
    expect(duck.needs.happiness).toBeLessThan(p0);
  });
});

describe('food pellets', () => {
  it('clamps sky-dropped food onto walkable ground', () => {
    const { state } = setup();
    expect(dropFood(state, { x: 900, y: 40 }, false)).toBe(true);
    const pellet = state.foodPellets[0];
    expect(pellet.pos.y).toBeGreaterThanOrEqual(175);
  });

  it('spoils uneaten pellets after two game-hours', () => {
    const { state, rng } = setup();
    dropFood(state, { x: 500, y: 400 }, false);
    for (let i = 0; i <= 2 * TICKS_PER_HOUR; i += 1) tickNeeds(state, rng);
    expect(state.foodPellets.length).toBe(0);
  });

  it('fillFeeder requires owning the trough upgrade', () => {
    const { state } = setup();
    state.inventory.feed = 50;
    expect(fillFeeder(state)).toBe(0);
    expect(state.feeder.food).toBe(0);
  });

  it('fillFeeder moves inventory feed into the trough up to capacity', () => {
    const { state } = setup();
    state.upgrades.feedingTrough = 1;
    state.inventory.feed = 50;
    expect(fillFeeder(state)).toBe(FEEDER_CAPACITY);
    expect(state.feeder.food).toBe(FEEDER_CAPACITY);
    expect(state.inventory.feed).toBe(50 - FEEDER_CAPACITY);
    expect(fillFeeder(state)).toBe(0); // already full
  });

  it('hungry ducks eat from a stocked feeder', () => {
    const { state, rng } = setup();
    state.feeder.food = 5;
    const duck = state.ducks[0];
    duck.needs.hunger = 30;
    duck.pos = { ...FEEDER_POS };
    duck.prevPos = { ...FEEDER_POS };
    for (let i = 0; i < 10; i += 1) tickBehavior(state, rng);
    expect(state.feeder.food).toBeLessThan(5);
    expect(duck.needs.hunger).toBeGreaterThan(30);
  });
});

describe('stroke care gestures', () => {
  it('petting fills happiness in steps, then triggers the cooldown', () => {
    const { state } = setup();
    const duck = state.ducks[0];
    duck.needs.happiness = 50;
    let total = 0;
    let guard = 0;
    while (duck.petCooldownTicks === 0 && guard < 50) {
      total += petStroke(state, duck.id, 2);
      guard += 1;
    }
    expect(total).toBe(BALANCE.petHappiness);
    expect(duck.needs.happiness).toBe(50 + BALANCE.petHappiness);
    expect(duck.petCooldownTicks).toBeGreaterThan(0);
    // On cooldown: no further gain.
    expect(petStroke(state, duck.id, 2)).toBe(0);
  });

  it('brushing restores cleanliness and caps at 100', () => {
    const { state } = setup();
    const duck = state.ducks[0];
    duck.needs.cleanliness = 96;
    expect(brushStroke(state, duck.id, 6)).toBe(4);
    expect(duck.needs.cleanliness).toBe(100);
    expect(brushStroke(state, duck.id, 6)).toBe(0);
  });
});

describe('waterfall', () => {
  it('slows pond dirt buildup and cheers swimming ducks', () => {
    const plain = setup();
    const upgraded = setup();
    upgraded.state.upgrades.waterfall = 1;
    for (const { state } of [plain, upgraded]) {
      for (const d of state.ducks) d.activity = 'swim';
    }
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) {
      tickPond(plain.state);
      tickPond(upgraded.state);
      tickNeeds(plain.state, plain.rng);
      tickNeeds(upgraded.state, upgraded.rng);
    }
    expect(upgraded.state.pond.cleanliness).toBeGreaterThan(plain.state.pond.cleanliness);
    expect(upgraded.state.ducks[0].needs.happiness).toBeGreaterThan(
      plain.state.ducks[0].needs.happiness,
    );
  });
});

describe('breeding gate', () => {
  it('accepts a healthy adult pair and rejects violations', () => {
    const rng = createRng(9);
    const male = createStarterDuck(rng, { x: 0, y: 0 }, 'M');
    const female = createStarterDuck(rng, { x: 0, y: 0 }, 'F');
    expect(canBreedPair(male, female).ok).toBe(true);

    const sameSex = createStarterDuck(rng, { x: 0, y: 0 }, 'M');
    expect(canBreedPair(male, sameSex).ok).toBe(false);

    female.stage = 'duckling';
    expect(canBreedPair(male, female).ok).toBe(false);
    female.stage = 'adult';

    female.sick = true;
    expect(canBreedPair(male, female).ok).toBe(false);
    female.sick = false;

    female.needs.happiness = 40;
    expect(canBreedPair(male, female).ok).toBe(false);
    female.needs.happiness = 80;

    male.needs.health = 50;
    expect(canBreedPair(male, female).ok).toBe(false);
    male.needs.health = 100;

    male.breedingCooldownTicks = 100;
    expect(canBreedPair(male, female).ok).toBe(false);
  });

  it('solo readiness reports the rest countdown', () => {
    const rng = createRng(12);
    const duck = createStarterDuck(rng, { x: 0, y: 0 }, 'F');
    expect(breedReadiness(duck).ok).toBe(true);
    duck.breedingCooldownTicks = 3 * TICKS_PER_HOUR;
    const check = breedReadiness(duck);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('3h');
    duck.breedingCooldownTicks = 300; // half a game-hour
    expect(breedReadiness(duck).reason).toContain('30m');
  });

  it('egg viability multiplies parents happiness and health, plus a small spring bonus', () => {
    const rng = createRng(10);
    const a = createStarterDuck(rng, { x: 0, y: 0 }, 'M');
    const b = createStarterDuck(rng, { x: 0, y: 0 }, 'F');
    a.needs.happiness = 80;
    a.needs.health = 80;
    b.needs.happiness = 80;
    b.needs.health = 80;
    expect(eggViability(a, b, false)).toBeCloseTo(0.64);
    expect(eggViability(a, b, true)).toBeCloseTo(0.69);
    // A fresh starter pair is a real gamble, and tending them closes it.
    for (const d of [a, b]) d.needs = { hunger: 80, cleanliness: 80, happiness: 70, health: 100 };
    expect(eggViability(a, b, true)).toBeCloseTo(0.75);
    for (const d of [a, b]) d.needs.happiness = 100;
    expect(eggViability(a, b, true)).toBe(1);
  });
});

describe('overcrowding', () => {
  it('drains happiness faster and fouls the pond when over capacity', () => {
    const { state, rng } = createNewGame(12);
    for (const d of state.ducks) d.needs.happiness = 100;
    const baseline = createNewGame(12);
    for (const d of baseline.state.ducks) d.needs.happiness = 100;
    // Ten ducks on an 8-duck pond.
    for (let i = 0; i < 6; i += 1) state.ducks.push(createStarterDuck(rng, { x: 0, y: 0 }));
    for (let i = 0; i < TICKS_PER_HOUR * 6; i += 1) {
      tickNeeds(state, rng);
      tickPond(state);
      tickNeeds(baseline.state, baseline.rng);
      tickPond(baseline.state);
    }
    expect(state.ducks[0].needs.happiness).toBeLessThan(baseline.state.ducks[0].needs.happiness);
    // Pond dirt: 10 ducks × 1.5 vs 4 ducks.
    expect(state.pond.cleanliness).toBeLessThan(baseline.state.pond.cleanliness);
  });
});

describe('egg tending', () => {
  function eggSetup() {
    const { state, rng } = createNewGame(7);
    const egg = createDuck(rng, { genome: randomCommonGenome(rng), stage: 'egg', pos: { x: 0, y: 0 } });
    state.ducks.push(egg);
    return { state, rng, egg };
  }

  it('warmth drifts down and tucking restores it on a cooldown', () => {
    const { state, rng, egg } = eggSetup();
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) tickNeeds(state, rng);
    expect(eggWarmth(egg)).toBeCloseTo(BALANCE.eggStartWarmth - BALANCE.eggWarmthDecay, 0);
    expect(tuckEgg(state, egg.id)).toBe(true);
    expect(eggWarmth(egg)).toBeCloseTo(BALANCE.eggStartWarmth - BALANCE.eggWarmthDecay + BALANCE.eggTuckWarmth, 0);
    expect(tuckEgg(state, egg.id)).toBe(false); // cooling off
    expect(state.stats.eggsTucked).toBe(1);
  });

  it('the incubator holds warmth at full', () => {
    const { state, rng, egg } = eggSetup();
    state.upgrades.incubator = 1;
    for (let i = 0; i < TICKS_PER_HOUR * 5; i += 1) tickNeeds(state, rng);
    expect(eggWarmth(egg)).toBe(100);
  });

  it('warmth scales incubation speed', () => {
    expect(eggSpeedFor(0)).toBe(BALANCE.eggWarmthSpeedMin);
    expect(eggSpeedFor(100)).toBe(BALANCE.eggWarmthSpeedMax);
    expect(eggSpeedFor(50)).toBeGreaterThan(eggSpeedFor(20));
  });
});
