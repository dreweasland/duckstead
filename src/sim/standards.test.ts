import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { advanceTicks } from '../testFixtures';
import { createDuck, createStarterDuck, layEgg } from './duck';
import { ALL_BREED_KEYS, breedKey, representativeGenome } from './breedBook';
import { breedStandard, standardMatch, standardTargets } from './standards';
import { checkHatchAwards, tickAwards, MASTER_COUNT } from './awards';
import { bestPairFor, duckFits, fulfilCommission, makeCommission, tickCommissions } from './commissions';
import { createRng } from '../rng';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

describe('breed standards', () => {
  it('every breed has a deterministic 13-locus standard that expresses that breed', () => {
    for (const key of ALL_BREED_KEYS) {
      const std = breedStandard(key);
      expect(breedStandard(key)).toEqual(std);
      expect(breedKey(std)).toBe(key);
      const t = standardTargets(key);
      expect([0, 2, 3, 4, 6]).toContain(t.size);
    }
    // Standards differ from one another in their builds.
    const builds = new Set(ALL_BREED_KEYS.map((k) => JSON.stringify(standardTargets(k))));
    expect(builds.size).toBeGreaterThan(10);
  });

  it('a duck carrying the standard genome matches 100%; a representative matches partially', () => {
    const rng = createRng(1);
    const key = ALL_BREED_KEYS[7];
    const perfect = createDuck(rng, { genome: breedStandard(key), stage: 'adult', pos: { x: 0, y: 0 } });
    expect(standardMatch(perfect, key).pct).toBe(100);
    const rep = createDuck(rng, { genome: representativeGenome(key), stage: 'adult', pos: { x: 0, y: 0 } });
    const m = standardMatch(rep, key);
    expect(m.pct).toBeGreaterThan(30);
    expect(m.pct).toBeLessThan(100);
    expect(m.slots.length).toBe(10);
  });
});

describe('awards', () => {
  it('pure on hatch, standard and master from the living flock, each once', () => {
    const { state, rng } = createNewGame(50);
    const key = ALL_BREED_KEYS[0];
    const std = breedStandard(key);
    const dam = createDuck(rng, { genome: std, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
    const sire = createDuck(rng, { genome: std, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    state.ducks = [dam, sire];
    const egg = layEgg(rng, dam, sire, { x: 0, y: 0 });
    egg.stage = 'duckling';
    state.ducks.push(egg);
    const money = state.money;
    checkHatchAwards(state, egg);
    expect(state.awards[key]?.pure).toBeDefined();
    expect(state.money).toBeGreaterThan(money);
    expect(state.society.points).toBe(2);
    checkHatchAwards(state, egg);
    expect(state.society.points).toBe(2); // once
    // Standard: dam matches 100%.
    state.clock.totalTicks = TICKS_PER_HOUR;
    tickAwards(state);
    expect(state.awards[key]?.standard).toBeDefined();
    expect(state.awards[key]?.master).toBeUndefined();
    for (let i = 0; i < MASTER_COUNT; i += 1) state.ducks.push(createDuck(rng, { genome: std, stage: 'adult', pos: { x: 0, y: 0 } }));
    tickAwards(state);
    expect(state.awards[key]?.master).toBeDefined();
    expect(state.society.points).toBe(2 + 4 + 8);
    expect(state.chronicle.filter((c) => c.kind === 'award').length).toBe(3);
  });
});

describe('commissions', () => {
  it('are generated from what the flock can breed, escalate, and pay on delivery', () => {
    const { state, rng } = createNewGame(51);
    state.stats.ducksHatched = 3;
    const c = makeCommission(state, rng)!;
    expect(c).not.toBeNull();
    expect(c.minGen).toBeUndefined(); // tier 0
    expect(c.reward).toBeGreaterThan(100);
    state.commissions.push(c);
    // A duck of that breed fills it.
    const duck = createDuck(rng, { genome: representativeGenome(c.key), stage: 'adult', pos: { x: 0, y: 0 }, sex: c.sex ?? 'F' });
    state.ducks.push(duck);
    expect(duckFits(duck, c)).toBe(true);
    const money = state.money;
    expect(fulfilCommission(state, c.id, duck.id)).toBe(true);
    expect(state.money).toBe(money + c.reward);
    expect(state.commissions).toHaveLength(0);
    expect(state.commissionsDone).toBe(1);
    expect(state.society.points).toBe(c.points);
    // Tier climbs with fulfilment.
    state.commissionsDone = 6;
    const hard = makeCommission(state, rng)!;
    expect(hard.minGen).toBe(2);
    expect(hard.minStandard).toBe(60);
    const founder = createDuck(rng, { genome: representativeGenome(hard.key), stage: 'adult', pos: { x: 0, y: 0 }, sex: hard.sex ?? 'M' });
    expect(duckFits(founder, hard)).toBe(false); // gen 0
  });

  it('posts one a morning once unlocked and expires them', () => {
    const { state, rng } = createNewGame(52);
    state.stats.ducksHatched = 3;
    state.clock.totalTicks = 8 * TICKS_PER_HOUR - 1;
    advanceTicks(state, rng, TICKS_PER_DAY * 3, [tickCommissions]);
    expect(state.commissions.length).toBe(3);
    state.clock.totalTicks += TICKS_PER_DAY * 7;
    state.clock.totalTicks -= state.clock.totalTicks % TICKS_PER_DAY;
    state.clock.totalTicks += 6 * TICKS_PER_HOUR;
    tickCommissions(state, rng);
    expect(state.commissions.length).toBe(0);
    void createStarterDuck;
  });
});

describe('breeding hints', () => {
  it('names the pair most likely to hatch a commissioned breed, with exact odds', () => {
    const { state, rng } = createNewGame(53);
    const key = 'M|D|spotted|n';
    // Two spotted carriers (Mp) → 25% per egg; a pure spotted pair → 100%.
    const carrierGenome = () => { const g = representativeGenome('M|D|solid|n'); g.pattern = ['S', 'p']; return g; };
    const dam = createDuck(rng, { genome: carrierGenome(), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
    const sire = createDuck(rng, { genome: carrierGenome(), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    state.ducks = [dam, sire];
    const hint = bestPairFor(state, key)!;
    expect(hint.dam.id).toBe(dam.id);
    expect(hint.chance).toBeCloseTo(0.25);
    const pure = createDuck(rng, { genome: representativeGenome(key), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    state.ducks.push(pure);
    expect(bestPairFor(state, key)!.chance).toBeCloseTo(0.5); // Mp dam × pp sire
    expect(bestPairFor(state, 'B|D|solid|c')).toBeNull(); // no blue, no crest genes anywhere
  });
});
