import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { activeStyle, addSocietyPoints, advanceRank, allTitles, canAdvance, championTitle, grantLineMilestones, hasPerk, HONOUR_TITLES, LINE_MILESTONES, lineTitles, RANKS } from './society';
import { ALL_BREED_KEYS, recordBreed, representativeGenome } from './breedBook';
import { createDuck } from './duck';
import { MASTER_COUNT, tickAwards } from './awards';
import { TICKS_PER_HOUR } from './time';
import { duckCapacity, henEggPrice } from './economy';

describe('society ladder', () => {
  it('needs both coins and points; grants styles, titles, and perks in order', () => {
    const { state } = createNewGame(60);
    state.money = 200000;
    expect(canAdvance(state).ok).toBe(false);
    expect(canAdvance(state).reason).toContain('points');
    addSocietyPoints(state, 3);
    expect(advanceRank(state)).toBe(true);
    expect(state.society.rank).toBe(1);
    expect(state.money).toBe(200000 - RANKS[0].cost);
    expect(state.society.points).toBe(0);
    expect(activeStyle(state, 'water')?.id).toBe('water:clear');
    expect(championTitle(state, state.ducks[0]) === null || typeof championTitle(state, state.ducks[0]) === 'string').toBe(true);
    // Coins alone can't climb.
    expect(advanceRank(state)).toBe(false);
    addSocietyPoints(state, 2000);
    const pondBefore = duckCapacity(state);
    const eggBefore = henEggPrice(state);
    while (advanceRank(state)) { /* climb */ }
    expect(state.society.rank).toBe(RANKS.length);
    expect(hasPerk(state, 'pondSlot')).toBe(true);
    expect(duckCapacity(state)).toBe(pondBefore + 1);
    expect(hasPerk(state, 'goldenBasket')).toBe(true);
    expect(henEggPrice(state)).toBe(eggBefore * 2);
    expect(state.society.unlockedStyles.length).toBe(RANKS.filter((r) => r.style).length);
    expect(state.chronicle.filter((c) => c.kind === 'society').length).toBe(RANKS.length);
  });

  it('the top-pedigree adult holds the latest title', () => {
    const { state } = createNewGame(61);
    state.money = 100000;
    addSocietyPoints(state, 3);
    advanceRank(state);
    const holders = state.ducks.filter((d) => championTitle(state, d));
    expect(holders).toHaveLength(1);
    expect(championTitle(state, holders[0])).toBe('Fancier’s Pick');
  });
});

describe("the line's ladder", () => {
  it('names the line at champion milestones, once each, and champions wear the latest title', () => {
    const { state } = createNewGame(62);
    const drake = state.ducks.find((d) => d.sex === 'M' && d.stage === 'adult')!;
    state.line.championsTotal = 1;
    grantLineMilestones(state);
    expect(state.line.milestones).toEqual([1]);
    expect(state.society.points).toBe(LINE_MILESTONES[0].points);
    grantLineMilestones(state);
    expect(state.society.points).toBe(LINE_MILESTONES[0].points); // once
    state.line.championsTotal = 3;
    grantLineMilestones(state);
    expect(state.line.milestones).toEqual([1, 3]);
    expect(lineTitles(state)).toEqual(['Champion Breeder', 'Line Founder']);
    // A champion wears the line's title; a non-champion never does.
    expect(championTitle(state, drake)).toBeNull();
    drake.champion = 2;
    expect(championTitle(state, drake)).toBe('Line Founder');
    // The rank title still goes to the top-pedigree adult, whoever that is.
    state.money = 100000;
    addSocietyPoints(state, 3);
    advanceRank(state);
    const rankHolders = state.ducks.filter((d) => d.champion === undefined && championTitle(state, d) === 'Fancier’s Pick');
    expect(rankHolders.length).toBeLessThanOrEqual(1);
    expect(allTitles(state)).toContain('Fancier’s Pick');
  });

  it('a full Book and a full award sheet each earn an honour, once', () => {
    const { state, rng } = createNewGame(63);
    for (const k of ALL_BREED_KEYS.slice(1)) state.breedBook[k] = { firstName: 'x', day: 1, count: 1 };
    const last = createDuck(rng, { genome: representativeGenome(ALL_BREED_KEYS[0]), stage: 'adult', pos: { x: 0, y: 0 } });
    const points = state.society.points;
    recordBreed(state, last);
    expect(state.line.honours).toContain('book');
    expect(state.society.points).toBeGreaterThanOrEqual(points + HONOUR_TITLES.book.points);
    expect(lineTitles(state)).toContain('Keeper of the Book');
    recordBreed(state, last);
    expect(state.line.honours.filter((h) => h === 'book')).toHaveLength(1);
    // Every award but one Master is on the sheet; five of that breed alive at once closes it.
    for (const k of ALL_BREED_KEYS) state.awards[k] = { pure: 1, standard: 1, master: 1 };
    const key = ALL_BREED_KEYS[5];
    state.awards[key] = { pure: 1, standard: 1 };
    state.ducks = [];
    for (let i = 0; i < MASTER_COUNT; i += 1) state.ducks.push(createDuck(rng, { genome: representativeGenome(key), stage: 'adult', pos: { x: 0, y: 0 } }));
    state.clock.totalTicks = TICKS_PER_HOUR;
    const before = state.society.points;
    tickAwards(state);
    expect(state.awards[key]?.master).toBeDefined();
    expect(state.line.honours).toContain('awards');
    expect(state.society.points).toBe(before + 8 + HONOUR_TITLES.awards.points);
    expect(lineTitles(state)).toContain('Master of All Breeds');
  });
});
