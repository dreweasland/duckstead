import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { canEnterCup, cupOpen, cupStandings, enterCup, tickCup } from './cup';
import { addSocietyPoints } from './society';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_SEASON } from './time';
import { TUNING } from './tuning';

describe('society cup', () => {
  it('needs the rank and the stake; entering deducts the stake and starts counting', () => {
    const { state } = createNewGame(90);
    state.society.points = 100;
    expect(canEnterCup(state).ok).toBe(false);
    state.society.rank = TUNING.cup.minRank;
    expect(canEnterCup(state).ok).toBe(true);
    expect(enterCup(state)).toBe(true);
    expect(state.society.points).toBe(100 - TUNING.cup.entryPoints);
    expect(cupOpen(state)).toBe(true);
    expect(canEnterCup(state).ok).toBe(false);
    addSocietyPoints(state, 12);
    expect(state.cup?.score).toBe(12);
    expect(cupStandings(state).some((s) => s.isPlayer && s.score === 12)).toBe(true);
  });

  it('is decided on the last night of winter: the winner takes the prize', () => {
    const { state } = createNewGame(91);
    state.society.points = 100;
    state.society.rank = 10;
    enterCup(state);
    for (const r of state.rivals) r.yearPoints = 5;
    addSocietyPoints(state, 50);
    const money = state.money;
    state.clock.totalTicks = TICKS_PER_SEASON * 3 + TICKS_PER_DAY * 5 + 21 * TICKS_PER_HOUR; // winter day 6, 21:00
    tickCup(state);
    expect(state.money).toBe(money + TUNING.cup.prizeBase);
    expect(state.stats.cupWins).toBe(1);
    expect(state.cup).toBeNull();
  });

  it('a rival can take it, and their win is remembered', () => {
    const { state } = createNewGame(92);
    state.society.points = 100;
    state.society.rank = 10;
    enterCup(state);
    state.rivals[1].yearPoints = 500;
    state.clock.totalTicks = TICKS_PER_SEASON * 3 + TICKS_PER_DAY * 5 + 21 * TICKS_PER_HOUR;
    tickCup(state);
    expect(state.stats.cupWins).toBe(0);
    expect(state.rivals[1].wins).toBe(1);
    expect(state.chronicle.some((c) => c.text.includes('Old Wiggins took'))).toBe(true);
  });
});
