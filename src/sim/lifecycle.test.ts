import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { events } from '../events';
import { adultDurationTicks, createDuck, STAGE_DAYS } from './duck';
import { randomCommonGenome } from './genetics';
import { claimHatch, eggIncubationTicks, tickLifecycle } from './lifecycle';
import { BALANCE } from './economy';
import { eggSpeedFor } from './needs';
import { TICKS_PER_DAY } from './time';

describe('life stages', () => {
  it('egg hatches into a duckling after incubation', () => {
    const { state, rng } = createNewGame(1);
    const egg = createDuck(rng, {
      genome: randomCommonGenome(rng),
      stage: 'egg',
      pos: { x: 100, y: 100 },
    });
    state.ducks = [egg];
    egg.warmth = BALANCE.eggStartWarmth;
    const target = eggIncubationTicks(state);
    const speed = eggSpeedFor(BALANCE.eggStartWarmth);
    for (let i = 0; i < Math.ceil(target / speed); i += 1) tickLifecycle(state, rng);
    // Fully incubated eggs crack and wait for the player.
    expect(egg.stage).toBe('egg');
    expect(egg.readyToHatch).toBe(true);
    expect(claimHatch(state, rng, egg.id)).toBe(true);
    expect(egg.stage).toBe('duckling');
    expect(egg.readyToHatch).toBeUndefined();
    expect(state.stats.ducksHatched).toBe(1);
  });

  it('a cracked egg hatches itself after the grace period', () => {
    const { state, rng } = createNewGame(3);
    const egg = createDuck(rng, { genome: randomCommonGenome(rng), stage: 'egg', pos: { x: 100, y: 100 } });
    state.ducks = [egg];
    egg.incubationTicks = eggIncubationTicks(state);
    for (let i = 0; i <= BALANCE.eggClaimGraceTicks + 1; i += 1) tickLifecycle(state, rng);
    expect(egg.stage).toBe('duckling');
  });

  it('cold eggs incubate slower and hatch grumpier than warm ones', () => {
    const hatchWith = (warmth: number) => {
      const { state, rng } = createNewGame(4);
      const egg = createDuck(rng, { genome: randomCommonGenome(rng), stage: 'egg', pos: { x: 100, y: 100 } });
      state.ducks = [egg];
      let ticks = 0;
      while (!egg.readyToHatch) {
        egg.warmth = warmth;
        egg.warmthSum = warmth * (egg.ageTicks + 1);
        tickLifecycle(state, rng);
        ticks += 1;
      }
      claimHatch(state, rng, egg.id);
      return { ticks, happiness: egg.needs.happiness, hunger: egg.needs.hunger };
    };
    const cold = hatchWith(0);
    const warm = hatchWith(100);
    expect(warm.ticks).toBeLessThan(cold.ticks);
    expect(warm.happiness).toBeGreaterThan(cold.happiness);
    expect(warm.hunger).toBeGreaterThan(cold.hunger);
  });

  it('incubator halves incubation time', () => {
    const { state } = createNewGame(2);
    const normal = eggIncubationTicks(state);
    state.upgrades.incubator = 1;
    expect(eggIncubationTicks(state)).toBe(normal / 2);
  });

  it('duckling matures to juvenile at the stage boundary', () => {
    const { state, rng } = createNewGame(3);
    const duck = createDuck(rng, {
      genome: randomCommonGenome(rng),
      stage: 'duckling',
      pos: { x: 100, y: 100 },
    });
    state.ducks = [duck];
    for (let i = 0; i < STAGE_DAYS.duckling * TICKS_PER_DAY; i += 1) tickLifecycle(state, rng);
    expect(duck.stage).toBe('juvenile');
  });

  it('vigor extends adult lifespan by up to 40%', () => {
    expect(adultDurationTicks(1)).toBeCloseTo(adultDurationTicks(0) * 1.5, -2);
  });

  it('growing up raises fanfare: duck-grew events and chronicle entries', () => {
    const { state, rng } = createNewGame(7);
    const duck = createDuck(rng, {
      genome: randomCommonGenome(rng),
      stage: 'juvenile',
      pos: { x: 100, y: 100 },
    });
    duck.bornDay = 0;
    state.ducks = [duck];
    const grew: string[] = [];
    const off = events.on('duck-grew', (p) => grew.push((p as { to: string }).to));
    for (let i = 0; i < STAGE_DAYS.juvenile * TICKS_PER_DAY; i += 1) tickLifecycle(state, rng);
    expect(duck.stage).toBe('adult');
    expect(grew).toEqual(['adult']);
    expect(state.chronicle.some((c) => c.kind === 'ofAge' && c.text.includes(duck.name))).toBe(true);
    duck.ageTicks = adultDurationTicks(duck.phenotype.vigor);
    tickLifecycle(state, rng);
    expect(duck.stage).toBe('elder');
    expect(grew).toEqual(['adult', 'elder']);
    expect(state.chronicle.some((c) => c.kind === 'elder' && c.text.includes(duck.name))).toBe(true);
    off();
  });

  it('a passing carries a rich payload for the farewell banner', () => {
    const { state, rng } = createNewGame(8);
    const duck = state.ducks[0];
    duck.needs.health = 0;
    let payload: { duck: { name: string }; descendants: number; honoured: number } | null = null;
    const off = events.on('duck-died', (p) => { payload = p as typeof payload; });
    tickLifecycle(state, rng);
    off();
    expect(payload!.duck.name).toBe(duck.name);
    expect(payload!.descendants).toBe(0);
    expect(payload!.honoured).toBe(0); // died young — no Society honours
  });

  it('a duck at zero health dies and is memorialized', () => {
    const { state, rng } = createNewGame(4);
    const duck = state.ducks[0];
    duck.needs.health = 0;
    const before = state.ducks.length;
    tickLifecycle(state, rng);
    expect(state.ducks.length).toBe(before - 1);
    expect(state.memorial.some((m) => m.name === duck.name)).toBe(true);
  });
});
