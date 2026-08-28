import { describe, expect, it } from 'vitest';
import { createNewGame } from '../state';
import { createDuck } from './duck';
import { randomCommonGenome } from './genetics';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import {
  matchesRequest,
  sellToBuyer,
  tickVisitors,
  treatVisitor,
  TREATS_TO_RECRUIT,
  type BuyerRequest,
  VISITOR_FLY_TICKS,
  visitorFlightPos,
  visitorInFlight,
} from './visitors';

function runDays(days: number, setup: ReturnType<typeof createNewGame>): void {
  const { state, rng } = setup;
  for (let i = 0; i < days * TICKS_PER_DAY; i += 1) {
    state.clock.totalTicks += 1;
    tickVisitors(state, rng);
  }
}

describe('buyer requests', () => {
  it('posts requests at the 09:00 roll again (reconnected alongside the Board), and they expire', () => {
    const { state, rng } = createNewGame(31);
    // A 35% daily chance: within a couple of weeks one must post. (Checking
    // at the end alone is a coin flip — active periods last ~3 days.)
    let seen: BuyerRequest | null = null;
    for (let i = 0; i < 14 * TICKS_PER_DAY && !seen; i += 1) {
      state.clock.totalTicks += 1;
      tickVisitors(state, rng);
      if (state.request) seen = state.request;
    }
    expect(seen).not.toBeNull();
    expect(seen!.multiplier).toBeGreaterThanOrEqual(2.5);
    // Run well past its expiry: it must be gone or replaced by a fresh one.
    for (let i = 0; i < 4 * TICKS_PER_DAY; i += 1) {
      state.clock.totalTicks += 1;
      tickVisitors(state, rng);
    }
    expect(state.request === null || state.request !== seen).toBe(true);
  });

  it('matcher enforces every requested trait', () => {
    const { rng } = createNewGame(32);
    const genome = randomCommonGenome(rng);
    genome.baseColor = ['W', 'W'];
    genome.pattern = ['p', 'p'];
    genome.crest = ['n', 'n'];
    const duck = createDuck(rng, { genome, stage: 'adult', pos: { x: 0, y: 0 } });

    const want = (wants: BuyerRequest['wants']): BuyerRequest => ({
      wants,
      multiplier: 3,
      expiresDay: 99,
    });
    expect(matchesRequest(duck, want({ pattern: 'spotted' }))).toBe(true);
    expect(matchesRequest(duck, want({ pattern: 'spotted', colorKey: 'W' }))).toBe(true);
    expect(matchesRequest(duck, want({ pattern: 'capped' }))).toBe(false);
    expect(matchesRequest(duck, want({ colorKey: 'M' }))).toBe(false);
    expect(matchesRequest(duck, want({ crested: true }))).toBe(false);
  });

  it('selling to the buyer pays the multiplier and clears the request', () => {
    const setup = createNewGame(33);
    const { state } = setup;
    const duck = state.ducks[0];
    state.request = {
      wants: { pattern: duck.phenotype.pattern },
      multiplier: 3,
      expiresDay: 99,
    };
    const money = state.money;
    expect(sellToBuyer(state, duck.id)).toBe(true);
    expect(state.money).toBeGreaterThan(money);
    expect(state.request).toBeNull();
    expect(state.ducks.find((d) => d.id === duck.id)).toBeUndefined();
  });
});

describe('wild visitors', () => {
  it('the first wild duck is guaranteed on day 2, whatever the pond looks like', () => {
    const setup = createNewGame(35);
    const { state } = setup;
    for (const d of state.ducks) d.needs.happiness = 20;
    state.pond.cleanliness = 0;
    runDays(1, setup);
    expect(state.visitor).toBeNull();
    runDays(1, setup);
    expect(state.visitor).not.toBeNull();
    expect(state.stats.wildVisits).toBe(1);
    // It arrived by air: the flight has already finished by the next morning.
    expect(visitorInFlight(state.visitor!)).toBe(false);
    expect(state.visitor!.duck.activity).toBe('idle');
  });

  it('flies in from its side of the pond and cannot be fed until it lands', () => {
    const setup = createNewGame(36);
    const { state, rng } = setup;
    state.inventory.premiumFeed = 5;
    state.clock.totalTicks = TICKS_PER_DAY + 10 * TICKS_PER_HOUR - 1; // just before day 2, 10:00
    state.clock.totalTicks += 1;
    tickVisitors(state, rng);
    const v = state.visitor!;
    expect(visitorInFlight(v)).toBe(true);
    expect(treatVisitor(state)).toBe('landing');
    const start = visitorFlightPos(v, 0);
    const end = visitorFlightPos(v, 1);
    expect(Math.sign(start.x - v.duck.pos.x)).toBe(v.side);
    expect(start.y).toBeLessThan(v.duck.pos.y - 200);
    expect(end.x).toBeCloseTo(v.duck.pos.x);
    expect(end.y).toBeCloseTo(v.duck.pos.y);
    for (let i = 0; i < VISITOR_FLY_TICKS + 20; i += 1) {
      state.clock.totalTicks += 1;
      tickVisitors(state, rng);
    }
    expect(visitorInFlight(v)).toBe(false);
    expect(v.duck.activity).toBe('idle');
    expect(treatVisitor(state)).toBe('fed');
  });

  it('visits happen only when the pond is inviting, and treats recruit', () => {
    const setup = createNewGame(34);
    const { state } = setup;
    state.stats.wildVisits = 1; // past the guaranteed first visit
    // Neglected pond: no visitors.
    for (const d of state.ducks) d.needs.happiness = 20;
    runDays(6, setup);
    expect(state.visitor).toBeNull();

    // Inviting pond: a visitor eventually shows.
    for (const d of state.ducks) d.needs.happiness = 90;
    state.pond.cleanliness = 100;
    let guard = 0;
    while (!state.visitor && guard < 30) {
      // Keep conditions inviting despite time passing.
      for (const d of state.ducks) d.needs.happiness = 90;
      state.pond.cleanliness = 100;
      runDays(1, setup);
      guard += 1;
    }
    expect(state.visitor).not.toBeNull();

    // Its genome must carry something rare.
    const genome = state.visitor!.duck.genome;
    const rare =
      genome.baseColor.includes('B') ||
      genome.billColor.includes('P') ||
      (genome.crest[0] === 'R' && genome.crest[1] === 'R');
    expect(rare).toBe(true);

    // Three premium treats recruit it.
    state.inventory.premiumFeed = 5;
    const flockBefore = state.ducks.length;
    for (let i = 0; i < TREATS_TO_RECRUIT - 1; i += 1) expect(treatVisitor(state)).toBe('fed');
    expect(treatVisitor(state)).toBe('joined');
    expect(state.ducks.length).toBe(flockBefore + 1);
    expect(state.visitor).toBeNull();
  });
});

describe('visitor gift shuffle', () => {
  it('spreads the first gift evenly across the three rare genes', async () => {
    const { createRng } = await import('../rng');
    const { createNewGame } = await import('../state');
    const { TICKS_PER_DAY, TICKS_PER_HOUR } = await import('./time');
    const counts = { blue: 0, pink: 0, crest: 0 };
    for (let seed = 0; seed < 300; seed += 1) {
      const { state } = createNewGame(seed);
      const rng = createRng(seed * 7 + 1);
      state.clock.totalTicks = TICKS_PER_DAY + 10 * TICKS_PER_HOUR;
      state.stats.wildVisits = 0;
      tickVisitors(state, rng);
      const g = state.visitor!.duck.genome;
      if (g.baseColor.includes('B')) counts.blue += 1;
      if (g.billColor.includes('P')) counts.pink += 1;
      if (g.crest[0] === 'R' && g.crest[1] === 'R') counts.crest += 1;
    }
    // A biased sort() put the same gene first far too often; a fair shuffle
    // lands each within a comfortable band of a third.
    for (const n of Object.values(counts)) {
      expect(n).toBeGreaterThan(300 / 3 - 40);
      expect(n).toBeLessThan(300 / 3 + 40);
    }
  });
});
