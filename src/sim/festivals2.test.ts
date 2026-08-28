import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { closeMarket, festivalEnteredToday, festivalTier, generateMarketBuyers, marketSell, marketTarget, tickFestivals, winterCeremonyFinale, winterParadeScore, winterParadeTarget } from './festivals';
import { sponsorFestival } from './economy';
import { TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_SEASON } from './time';

const MARKET_DAY = TICKS_PER_SEASON * 2 + TICKS_PER_DAY * 3; // autumn day 4
const WINTER_DAY = TICKS_PER_SEASON * 3 + TICKS_PER_DAY * 3;

describe('market day win path', () => {
  it('selling past the target wins the festival and raises next year\'s tier', () => {
    const { state, rng } = createNewGame(100);
    state.clock.totalTicks = MARKET_DAY + 10 * TICKS_PER_HOUR;
    state.seasonCache = 'autumn';
    const buyers = generateMarketBuyers(state, rng);
    state.market = { day: 3 + 12, buyers, sold: 0, earned: 0 };
    for (const b of [...buyers]) marketSell(state, b);
    state.market.earned = marketTarget(state) + 1;
    const result = closeMarket(state)!;
    expect(result.won).toBe(true);
    expect(festivalTier(state, 'marketDay')).toBe(1);
    expect(festivalEnteredToday(state, 'marketDay')).toBe(true);
    expect(closeMarket(state)).toBeNull(); // once
  });

  it('a sponsorship is spent by the evening even if the stall was never closed', () => {
    const { state, rng } = createNewGame(101);
    state.money = 5000;
    state.clock.totalTicks = MARKET_DAY + 10 * TICKS_PER_HOUR;
    state.seasonCache = 'autumn';
    expect(sponsorFestival(state, 'marketDay')).toBe(true);
    expect(festivalTier(state, 'marketDay')).toBe(1);
    state.market = { day: 3 + 12, buyers: generateMarketBuyers(state, rng), sold: 0, earned: 0 };
    state.clock.totalTicks = MARKET_DAY + 20 * TICKS_PER_HOUR;
    tickFestivals(state);
    expect(state.sponsored.marketDay).toBeUndefined();
    expect(festivalEnteredToday(state, 'marketDay')).toBe(true);
    expect(state.market.buyers).toHaveLength(0);
  });

  it('an untouched festival packs up at 20:00 and spends its sponsorship', () => {
    const { state } = createNewGame(102);
    state.money = 5000;
    state.clock.totalTicks = WINTER_DAY + 10 * TICKS_PER_HOUR;
    sponsorFestival(state, 'winterLights');
    state.clock.totalTicks = WINTER_DAY + 20 * TICKS_PER_HOUR;
    tickFestivals(state);
    expect(state.sponsored.winterLights).toBeUndefined();
    expect(festivalEnteredToday(state, 'winterLights')).toBe(true);
  });
});

describe('winter lights parade', () => {
  it('scores decorations, poise, and cheer; clearing the bar wins the festival', () => {
    const { state } = createNewGame(103);
    state.clock.totalTicks = WINTER_DAY + 12 * TICKS_PER_HOUR;
    const bare = winterParadeScore(state);
    for (let i = 0; i < 6; i += 1) state.decorations.push({ kind: 'lantern', pos: { x: 100 + i * 10, y: 300 } });
    for (const d of state.ducks) {
      d.training = { paddle: 0, stamina: 0, poise: 100 };
      d.needs.happiness = 100;
    }
    const dressed = winterParadeScore(state);
    expect(dressed).toBeGreaterThan(bare);
    expect(dressed).toBeGreaterThanOrEqual(winterParadeTarget(state));
    const reward = winterCeremonyFinale(state, 'society')!;
    expect(reward.parade?.won).toBe(true);
    expect(festivalTier(state, 'winterLights')).toBe(1);
  });

  it('the fortune wish is capped', () => {
    const { state } = createNewGame(104);
    state.clock.totalTicks = WINTER_DAY + 12 * TICKS_PER_HOUR;
    state.stats.biggestSale = 9999;
    const money = state.money;
    const reward = winterCeremonyFinale(state, 'fortune')!;
    expect(state.money - money).toBe(reward.coins);
    expect(reward.coins).toBeLessThanOrEqual(400 + 15);
  });
});
