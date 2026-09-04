import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../newGame';
import { makeCommission, tierFor } from './commissions';
import { recordLeagueResult } from './league';
import { heritageMutationRate, heritagePondBonus } from './heritage';
import { basketValue, BALANCE, henEggPrice, TUNING } from './economy';
import { train } from './training';

describe('commission demands keep growing', () => {
  it('tiers no longer stop at 3, but the asks have ceilings', () => {
    const { state } = createNewGame(110);
    state.commissionsDone = 30;
    expect(tierFor(state)).toBe(10);
    const rng = createRng(3);
    for (let i = 0; i < 20; i += 1) {
      const c = makeCommission(state, rng);
      if (!c) continue;
      if (c.eggFrom) {
        // Egg contracts carry their own lighter demands.
        state.commissions = [];
        continue;
      }
      expect(c.minGen).toBeLessThanOrEqual(5);
      expect(c.minStandard).toBe(90);
      expect(c.points).toBe(3 + 6 * 3);
      state.commissions = [];
    }
  });

  it('rivals post to the board once you have a reputation', () => {
    const { state } = createNewGame(111);
    state.commissionsDone = 6;
    const rng = createRng(9);
    const clients = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const c = makeCommission(state, rng);
      if (c) clients.add(c.client);
      state.commissions = [];
    }
    expect([...clients].some((c) => state.rivals.some((r) => r.name === c))).toBe(true);
  });
});

describe('league standings', () => {
  it('second place is neutral only in the Pond Derby', () => {
    const { state } = createNewGame(112);
    recordLeagueResult(state, 1);
    expect(state.league.losses).toBe(0);
    state.league.tier = 1;
    recordLeagueResult(state, 1);
    expect(state.league.losses).toBe(1);
  });
});

describe('heritage past five', () => {
  it('keeps paying, less steeply, to a ceiling', () => {
    expect(heritageMutationRate(5, 0.02)).toBeCloseTo(0.07);
    expect(heritageMutationRate(9, 0.02)).toBeCloseTo(0.08);
    expect(heritageMutationRate(40, 0.02)).toBeCloseTo(0.095);
    const { state } = createNewGame(113);
    state.heritage = 5;
    expect(heritagePondBonus(state)).toBe(5);
    state.heritage = 9;
    expect(heritagePondBonus(state)).toBe(6);
    state.heritage = 50;
    expect(heritagePondBonus(state)).toBe(8);
  });
});

describe('economy pressure', () => {
  it('a basket tapers past a dozen eggs', () => {
    const { state } = createNewGame(114);
    const price = henEggPrice(state);
    expect(basketValue(state, 12)).toBe(12 * price);
    expect(basketValue(state, 24)).toBeLessThan(24 * price);
    expect(basketValue(state, 24)).toBe(Math.round(12 * price + 12 * price * BALANCE.basketTaper));
  });

  it('drills pay pocket money up to a daily cap', () => {
    const { state } = createNewGame(115);
    state.upgrades.trainingPerch = 3;
    const money = state.money;
    let paid = 0;
    for (const duck of state.ducks) {
      for (let i = 0; i < 4; i += 1) {
        const before = state.money;
        train(state, duck.id, 'paddle', 1);
        paid += state.money - before;
      }
    }
    expect(paid).toBe(BALANCE.drillCoinsDailyCap);
    expect(state.money).toBe(money + BALANCE.drillCoinsDailyCap);
  });

  it('tuning numbers are reachable from the economy table', () => {
    expect(TUNING.needs.hungerDecay).toBe(6);
    expect(TUNING.race.baseSpeed).toBe(52);
  });
});
