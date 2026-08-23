import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { createDuck } from './duck';
import { breedStandard } from './standards';
import { consumableCost, sellPrice, SHOP_ITEMS } from './economy';
import {
  EGG_SHOW_PRIZES,
  FESTIVAL_DAY,
  festivalToday,
  generateMarketBuyers,
  HAGGLE_BONUS,
  marketHaggle,
  marketSell,
  runEggShow,
  upcomingFestival,
  winterCeremonyFinale,
} from './festivals';
import { randomCommonGenome } from './genetics';
import { tickNeeds } from './needs';
import { DAYS_PER_SEASON, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

function onDay(state: ReturnType<typeof createNewGame>['state'], day: number): void {
  state.clock.totalTicks = day * TICKS_PER_DAY + 12 * TICKS_PER_HOUR;
}

describe('festival calendar', () => {
  it('day 4 of each season hosts the right festival', () => {
    const { state } = createNewGame(41);
    const expected = ['eggShow', 'grandPrix', 'marketDay', 'winterLights'];
    for (let season = 0; season < 4; season += 1) {
      onDay(state, season * DAYS_PER_SEASON + (FESTIVAL_DAY - 1));
      expect(festivalToday(state.clock)).toBe(expected[season]);
      onDay(state, season * DAYS_PER_SEASON); // day 1 — no festival
      expect(festivalToday(state.clock)).toBeNull();
    }
  });

  it('upcoming festival counts down correctly', () => {
    const { state } = createNewGame(42);
    onDay(state, 0); // spring day 1
    expect(upcomingFestival(state.clock)).toEqual({ kind: 'eggShow', inDays: 3 });
    onDay(state, 4); // spring day 5 — egg show passed, summer next
    expect(upcomingFestival(state.clock).kind).toBe('grandPrix');
  });
});

describe('market day', () => {
  it('raises sale prices and discounts consumables', () => {
    const { state, rng } = createNewGame(43);
    const duck = createDuck(rng, {
      genome: randomCommonGenome(rng),
      stage: 'adult',
      pos: { x: 0, y: 0 },
    });
    onDay(state, 2 * DAYS_PER_SEASON); // autumn day 1
    const normal = sellPrice(state, duck);
    const normalFeed = consumableCost(state, SHOP_ITEMS[0]);
    onDay(state, 2 * DAYS_PER_SEASON + (FESTIVAL_DAY - 1)); // market day
    expect(sellPrice(state, duck)).toBeGreaterThan(normal);
    expect(consumableCost(state, SHOP_ITEMS[0])).toBeLessThan(normalFeed);
  });
});

describe('winter lights', () => {
  it('pauses happiness decay for the day', () => {
    const { state, rng } = createNewGame(44);
    onDay(state, 3 * DAYS_PER_SEASON + (FESTIVAL_DAY - 1)); // winter lights
    const duck = state.ducks[0];
    duck.needs.happiness = 70;
    duck.needs.hunger = 100;
    duck.activity = 'idle';
    for (let i = 0; i < TICKS_PER_HOUR; i += 1) tickNeeds(state, rng);
    expect(duck.needs.happiness).toBeCloseTo(70, 1);
  });
});

describe('market day stall', () => {
  it('buyers appear only on market day and open above list price', () => {
    const setup = createNewGame(48);
    const { state, rng } = setup;
    onDay(state, 0);
    expect(generateMarketBuyers(state, rng).length).toBe(0);

    onDay(state, 2 * DAYS_PER_SEASON + (FESTIVAL_DAY - 1)); // market day
    const buyers = generateMarketBuyers(state, rng);
    expect(buyers.length).toBeGreaterThan(0);
    expect(buyers.length).toBeLessThanOrEqual(3);
    for (const buyer of buyers) {
      const duck = state.ducks.find((d) => d.id === buyer.duckId)!;
      expect(buyer.offer).toBeGreaterThanOrEqual(sellPrice(state, duck));
    }
    // Distinct target ducks.
    expect(new Set(buyers.map((b) => b.duckId)).size).toBe(buyers.length);
  });

  it('haggling raises the offer on success and selling pays it', () => {
    const { state, rng } = createNewGame(49);
    onDay(state, 2 * DAYS_PER_SEASON + (FESTIVAL_DAY - 1));
    const buyers = generateMarketBuyers(state, rng);
    const buyer = buyers[0];
    const before = buyer.offer;
    // Force outcomes by trying until each branch is seen (seeded rng).
    const won = marketHaggle(buyer, rng);
    if (won) expect(buyer.offer).toBe(Math.round(before * (1 + HAGGLE_BONUS)));
    else expect(buyer.offer).toBe(before);
    expect(buyer.haggled).toBe(true);

    const money = state.money;
    expect(marketSell(state, buyer)).toBe(true);
    expect(state.money).toBe(money + buyer.offer);
    expect(state.ducks.find((d) => d.id === buyer.duckId)).toBeUndefined();
  });
});

describe('winter ceremony', () => {
  it('finale rewards once and cheers the flock', () => {
    const { state } = createNewGame(50);
    onDay(state, 3 * DAYS_PER_SEASON + (FESTIVAL_DAY - 1)); // winter lights
    for (const d of state.ducks) d.needs.happiness = 50;
    const money = state.money;
    const feed = state.inventory.premiumFeed;
    const reward = winterCeremonyFinale(state);
    expect(reward).not.toBeNull();
    expect(state.money).toBe(money + reward!.coins);
    expect(state.inventory.premiumFeed).toBe(feed + reward!.premiumFeed);
    expect(state.ducks[0].needs.happiness).toBe(62);
    // Once per festival.
    expect(winterCeremonyFinale(state)).toBeNull();
  });

  it('refuses outside the festival', () => {
    const { state } = createNewGame(51);
    onDay(state, 0);
    expect(winterCeremonyFinale(state)).toBeNull();
  });
});

describe('egg show', () => {
  it('runs a full field, ranks entries, and pays by placement once', () => {
    const { state, rng } = createNewGame(45);
    onDay(state, FESTIVAL_DAY - 1); // spring egg show day
    const egg = createDuck(rng, {
      genome: randomCommonGenome(rng),
      stage: 'egg',
      pos: { x: 0, y: 0 },
      name: 'Egg',
    });
    state.ducks.push(egg);
    const money = state.money;
    const result = runEggShow(state, egg.id, rng);
    expect(result).not.toBeNull();
    // Player + four rivals, ranked descending, each with commentary + breed.
    expect(result!.entries.length).toBe(5);
    expect(result!.entries.filter((e) => e.isPlayer).length).toBe(1);
    for (let i = 1; i < result!.entries.length; i += 1) {
      expect(result!.entries[i - 1].score).toBeGreaterThanOrEqual(result!.entries[i].score);
    }
    for (const entry of result!.entries) {
      expect(entry.comment.length).toBeGreaterThan(0);
      expect(entry.breed.length).toBeGreaterThan(0);
    }
    expect(result!.entries[result!.playerPlace].isPlayer).toBe(true);
    expect(result!.prize).toBe(EGG_SHOW_PRIZES[result!.playerPlace]);
    expect(state.money).toBe(money + result!.prize);
    // Second entry the same day is refused.
    expect(runEggShow(state, egg.id, rng)).toBeNull();
  });

  it('refuses entries outside the festival', () => {
    const { state, rng } = createNewGame(46);
    onDay(state, 0);
    const egg = createDuck(rng, {
      genome: randomCommonGenome(rng),
      stage: 'egg',
      pos: { x: 0, y: 0 },
      name: 'Egg',
    });
    state.ducks.push(egg);
    expect(runEggShow(state, egg.id, rng)).toBeNull();
  });

  it('a rare egg bred to its show standard beats the field', () => {
    const { state, rng } = createNewGame(47);
    onDay(state, FESTIVAL_DAY - 1);
    // Judges weigh standard match as much as rarity now, so the sure winner
    // is a rare breed that also hits its standard.
    const genome = breedStandard('B|d|solid|c');
    const egg = createDuck(rng, { genome, stage: 'egg', pos: { x: 0, y: 0 }, name: 'Egg' });
    state.ducks.push(egg);
    const result = runEggShow(state, egg.id, rng);
    expect(result!.playerPlace).toBe(0);
    expect(result!.prize).toBe(EGG_SHOW_PRIZES[0]);
  });
});
