import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { activeStyle, addSocietyPoints, advanceRank, canAdvance, championTitle, hasPerk, RANKS } from './society';
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
