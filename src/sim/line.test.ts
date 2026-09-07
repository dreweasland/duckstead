import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { createDuck, layEgg } from './duck';
import { ALL_BREED_KEYS } from './breedBook';
import { breedStandard } from './standards';
import { championCheck, championProgress, closestToChampion, championedBreeds, isChampion, tickLine } from './line';
import { enterCup } from './cup';
import { TICKS_PER_HOUR } from './time';
import { TUNING } from './tuning';
import { LINE_MILESTONES } from './society';

// A purebred at the standard: two standard-genome parents and their egg,
// which the Mendelian draw keeps at the standard (every locus homozygous).
function standardFamily(seed: number, gen: number) {
  const { state, rng } = createNewGame(seed);
  const key = ALL_BREED_KEYS[0];
  const std = breedStandard(key);
  const dam = createDuck(rng, { genome: std, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
  const sire = createDuck(rng, { genome: std, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
  dam.lineage = { gen: gen - 1, sire: null, dam: null, grand: [null, null, null, null] };
  sire.lineage = { gen: gen - 1, sire: null, dam: null, grand: [null, null, null, null] };
  state.ducks = [dam, sire];
  const child = layEgg(rng, dam, sire, { x: 0, y: 0 });
  child.genome = std; // mutation could nick a locus; the test is about the bar, not the dice
  child.stage = 'adult';
  state.ducks.push(child);
  return { state, rng, key, dam, sire, child };
}

describe('the line', () => {
  it('a grown purebred at the standard of the third generation is a champion, recognised once', () => {
    const { state, key, child } = standardFamily(200, TUNING.line.championGen);
    const check = championCheck(child);
    expect(check.ok).toBe(true);
    expect(check.progress).toBe(100);
    expect(check.gaps).toEqual([]);
    const money = state.money;
    state.clock.totalTicks = TICKS_PER_HOUR;
    tickLine(state);
    expect(isChampion(child)).toBe(true);
    expect(state.line.championsTotal).toBe(1);
    expect(state.line.champions[0]).toMatchObject({ id: child.id, breedKey: key, gen: TUNING.line.championGen, era: 0 });
    expect(state.money).toBe(money + TUNING.line.championCoins);
    // The first champion also lands the first line milestone.
    const firstPoints = TUNING.line.championPoints + LINE_MILESTONES[0].points;
    expect(state.society.points).toBe(firstPoints);
    expect(state.line.milestones).toEqual([1]);
    expect(state.chronicle.filter((c) => c.kind === 'milestone').map((c) => c.text).join()).toContain(`${child.name} is a Champion`);
    expect(championedBreeds(state).has(key)).toBe(true);
    // Once only, and the parents (founders, gen 2) never qualify.
    tickLine(state);
    expect(state.line.championsTotal).toBe(1);
    expect(state.society.points).toBe(firstPoints);
  });

  it('progress climbs with each requirement and names what is missing', () => {
    const { child } = standardFamily(201, TUNING.line.championGen - 1);
    const check = championCheck(child);
    expect(check.ok).toBe(false);
    expect(check.progress).toBeLessThan(100);
    expect(check.gaps).toEqual([`gen ${TUNING.line.championGen - 1} — needs gen ${TUNING.line.championGen}+`]);
    // A duckling of the same family is further away still.
    child.stage = 'duckling';
    expect(championProgress(child)).toBeLessThan(check.progress);
    expect(championCheck(child).gaps[0]).toBe('still growing');
  });

  it('a starter duck is nowhere near: not purebred, not at standard, gen 0', () => {
    const { state } = createNewGame(202);
    const starter = state.ducks[0];
    const check = championCheck(starter);
    expect(check.ok).toBe(false);
    expect(check.gaps).toContain('parents not both its breed');
    expect(check.gaps.some((g) => g.includes('needs gen'))).toBe(true);
  });

  it('closest to champion picks the nearest living non-champion', () => {
    const { state, child } = standardFamily(203, TUNING.line.championGen - 1);
    expect(closestToChampion(state)?.duck.id).toBe(child.id);
    // Once the child is a champion, someone else is closest.
    child.lineage!.gen = TUNING.line.championGen;
    state.clock.totalTicks = TICKS_PER_HOUR;
    tickLine(state);
    expect(isChampion(child)).toBe(true);
    expect(closestToChampion(state)?.duck.id).not.toBe(child.id);
  });

  it('a champion scores for an open Cup', () => {
    const { state, child } = standardFamily(204, TUNING.line.championGen);
    state.society.points = 100;
    state.society.rank = TUNING.cup.minRank;
    expect(enterCup(state)).toBe(true);
    state.clock.totalTicks = TICKS_PER_HOUR;
    tickLine(state);
    expect(isChampion(child)).toBe(true);
    expect(state.cup?.score).toBe(TUNING.line.championPoints + TUNING.line.championCupPoints + LINE_MILESTONES[0].points);
  });
});
