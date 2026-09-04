import { afterEach, describe, expect, it } from 'vitest';
import {
  bestPairFor,
  commissionGap,
  commissionSpecimen,
  commissionsUnlocked,
  describeCommission,
  duckFits,
  fulfilCommission,
  makeCommission,
  tickCommissions,
  tierFor,
  type Commission,
} from './commissions';
import { events } from '../events';
import { createNewGame } from '../newGame';
import { representativeGenome } from './breedBook';
import { createDuck, layEgg, type Duck } from './duck';
import { breedKey, type Genome } from './genetics';
import { breedStandard, standardMatch } from './standards';
import { childBreedKeys } from './advisor';
import { dayOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { advanceTicks } from '../testFixtures';
import type { GameState } from '../state';
import type { Rng } from '../rng';

// The board's own numbers (not exported): three slots, six days to fill one.
const SLOTS = 3;
const DAYS = 6;
const POST_TICK = 8 * TICKS_PER_HOUR;
const EXPIRE_TICK = 6 * TICKS_PER_HOUR;

const offs: Array<() => void> = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});
function toasts(): string[] {
  const list: string[] = [];
  offs.push(events.on('toast', (p) => list.push(String(p))));
  return list;
}

// A grown duck of exactly this breed, standing on the pond.
function adultOf(state: GameState, rng: Rng, key: string, opts: { sex?: 'M' | 'F'; genome?: Genome } = {}): Duck {
  const duck = createDuck(rng, { genome: opts.genome ?? representativeGenome(key), stage: 'adult', pos: { x: 0, y: 0 }, sex: opts.sex ?? 'F' });
  state.ducks.push(duck);
  return duck;
}

function plain(key: string, extra: Partial<Commission> = {}): Commission {
  return { id: 100, client: 'Dr. Quill', key, reward: 500, points: 3, postedDay: 0, expiresDay: DAYS, ...extra };
}

// Every key the board may draw from: the flock's breeds and their children's.
function possibleKeys(state: GameState): Set<string> {
  const hatched = state.ducks.filter((d) => d.stage !== 'egg');
  const keys = new Set(hatched.map((d) => breedKey(d.genome)));
  for (const m of hatched.filter((d) => d.sex === 'M')) {
    for (const f of hatched.filter((d) => d.sex === 'F')) for (const k of childBreedKeys(m.genome, f.genome)) keys.add(k);
  }
  return keys;
}

describe('the board', () => {
  it('is open from day one', () => {
    const { state } = createNewGame(1);
    expect(commissionsUnlocked(state)).toBe(true);
  });

  it('tier climbs one step per three commissions filled', () => {
    const { state } = createNewGame(1);
    for (const [done, tier] of [[0, 0], [2, 0], [3, 1], [5, 1], [6, 2], [9, 3], [30, 10]] as const) {
      state.commissionsDone = done;
      expect(tierFor(state)).toBe(tier);
    }
  });
});

describe('makeCommission', () => {
  it('at tier 0 asks plainly for a breed the pond could produce, and numbers itself', () => {
    const { state, rng } = createNewGame(3);
    const day = dayOf(state.clock);
    const c = makeCommission(state, rng)!;
    expect(c).not.toBeNull();
    expect(c.id).toBe(1);
    expect(state.nextCommissionId).toBe(2);
    expect(c.client).toEqual(expect.any(String));
    expect(c.client.length).toBeGreaterThan(0);
    expect(possibleKeys(state).has(c.key)).toBe(true);
    expect(c.postedDay).toBe(day);
    expect(c.expiresDay).toBe(day + DAYS);
    expect(c.reward).toBeGreaterThan(0);
    expect(Number.isInteger(c.reward)).toBe(true);
    expect(c.points).toBe(3);
    expect(c.sex).toBeUndefined();
    expect(c.minGen).toBeUndefined();
    expect(c.minStandard).toBeUndefined();
    expect(c.pinkBill).toBeUndefined();
    expect(c.eggFrom).toBeUndefined();
    // Making one doesn't post it: that's tickCommissions' job.
    expect(state.commissions).toHaveLength(0);
  });

  it('never repeats a breed already on the board, and gives up when none is left', () => {
    const { state, rng } = createNewGame(4);
    const keys = possibleKeys(state);
    for (let i = 0; i < keys.size; i += 1) {
      const c = makeCommission(state, rng)!;
      expect(c).not.toBeNull();
      expect(state.commissions.some((x) => x.key === c.key)).toBe(false);
      state.commissions.push(c);
    }
    expect(new Set(state.commissions.map((c) => c.key)).size).toBe(keys.size);
    expect(makeCommission(state, rng)).toBeNull();
  });

  it('has nothing to ask for from an empty pond', () => {
    const { state, rng } = createNewGame(5);
    state.ducks = [];
    expect(makeCommission(state, rng)).toBeNull();
  });

  it('demands grow with the tier and pay more for them', () => {
    const { state, rng } = createNewGame(6);
    state.commissionsDone = 0;
    const easy = makeCommission(state, rng)!;
    state.commissionsDone = 9; // tier 3
    let hard: Commission | null = null;
    for (let i = 0; i < 20 && !hard; i += 1) {
      const c = makeCommission(state, rng)!;
      if (!c.eggFrom) hard = c;
    }
    expect(hard).not.toBeNull();
    expect(hard!.minGen).toBe(3);
    expect(hard!.minStandard).toBe(80);
    expect(hard!.points).toBe(3 + 3 * 3);
    if (hard!.key === easy.key) expect(hard!.reward).toBeGreaterThan(easy.reward);
  });
});

describe('tickCommissions', () => {
  it('posts one commission at 08:00 each day until the slots are full', () => {
    const { state, rng } = createNewGame(7);
    state.clock.totalTicks = POST_TICK - 1;
    const list = toasts();
    advanceTicks(state, rng, 1, [tickCommissions]);
    expect(state.commissions).toHaveLength(1);
    expect(list.at(-1)).toMatch(/^New commission from /);
    // Nothing else during the day.
    advanceTicks(state, rng, TICKS_PER_DAY - 1, [tickCommissions]);
    expect(state.commissions).toHaveLength(1);
    advanceTicks(state, rng, 1, [tickCommissions]);
    expect(state.commissions).toHaveLength(2);
    advanceTicks(state, rng, TICKS_PER_DAY, [tickCommissions]);
    expect(state.commissions).toHaveLength(SLOTS);
    advanceTicks(state, rng, TICKS_PER_DAY * 2, [tickCommissions]);
    expect(state.commissions).toHaveLength(SLOTS); // full: no more posted
    expect(new Set(state.commissions.map((c) => c.id)).size).toBe(SLOTS);
    expect(new Set(state.commissions.map((c) => c.key)).size).toBe(SLOTS);
  });

  it('expires a commission at the dawn of its expiry day, and says so', () => {
    const { state, rng } = createNewGame(8);
    state.clock.totalTicks = POST_TICK - 1;
    advanceTicks(state, rng, 1, [tickCommissions]);
    const [c] = state.commissions;
    expect(c.expiresDay).toBe(c.postedDay + DAYS);
    const list = toasts();

    // The dawn before expiry keeps it.
    state.clock.totalTicks = (c.expiresDay - 1) * TICKS_PER_DAY + EXPIRE_TICK;
    tickCommissions(state, rng);
    expect(state.commissions).toContain(c);
    expect(list).toHaveLength(0);

    // A non-dawn tick on the expiry day does nothing either.
    state.clock.totalTicks = c.expiresDay * TICKS_PER_DAY + EXPIRE_TICK + 1;
    tickCommissions(state, rng);
    expect(state.commissions).toContain(c);

    state.clock.totalTicks = c.expiresDay * TICKS_PER_DAY + EXPIRE_TICK;
    tickCommissions(state, rng);
    expect(state.commissions).not.toContain(c);
    expect(list).toEqual(['A commission expired unfilled.']);
  });

  it('a slot freed by expiry is refilled the same morning', () => {
    const { state, rng } = createNewGame(9);
    state.clock.totalTicks = POST_TICK - 1;
    advanceTicks(state, rng, TICKS_PER_DAY * SLOTS, [tickCommissions]);
    expect(state.commissions).toHaveLength(SLOTS);
    const firstId = state.commissions[0].id;
    const expiry = state.commissions[0].expiresDay;
    state.clock.totalTicks = expiry * TICKS_PER_DAY + EXPIRE_TICK - 1;
    advanceTicks(state, rng, 1, [tickCommissions]);
    expect(state.commissions.map((c) => c.id)).not.toContain(firstId);
    expect(state.commissions).toHaveLength(SLOTS - 1);
    advanceTicks(state, rng, POST_TICK - EXPIRE_TICK, [tickCommissions]);
    expect(state.commissions).toHaveLength(SLOTS);
  });
});

describe('duckFits and commissionGap', () => {
  it('a grown duck of the breed fits a plain contract; eggs and ducklings do not', () => {
    const { state, rng } = createNewGame(10);
    const key = breedKey(state.ducks[0].genome);
    const c = plain(key);
    const duck = adultOf(state, rng, key);
    expect(duckFits(duck, c)).toBe(true);
    expect(commissionGap(duck, c)).toEqual([]);
    duck.stage = 'duckling';
    expect(duckFits(duck, c)).toBe(false);
    expect(commissionGap(duck, c)).toEqual(['still a duckling']);
    duck.stage = 'egg';
    expect(duckFits(duck, c)).toBe(false);
    duck.stage = 'elder';
    expect(duckFits(duck, c)).toBe(true);
  });

  it('the wrong breed never fits and gets no gap list', () => {
    const { state, rng } = createNewGame(11);
    const c = plain('k|D|solid|n');
    const duck = adultOf(state, rng, 'W|D|solid|n');
    expect(breedKey(duck.genome)).not.toBe(c.key);
    expect(duckFits(duck, c)).toBe(false);
    expect(commissionGap(duck, c)).toBeNull();
  });

  it('sex, generation, standard, and pink bill are each enforced and each named', () => {
    const { state, rng } = createNewGame(12);
    const key = 'k|D|solid|n';
    const duck = adultOf(state, rng, key, { sex: 'F', genome: breedStandard(key) });
    const pct = standardMatch(duck, key).pct;
    expect(duckFits(duck, plain(key, { sex: 'F' }))).toBe(true);
    expect(duckFits(duck, plain(key, { sex: 'M' }))).toBe(false);
    expect(commissionGap(duck, plain(key, { sex: 'M' }))).toEqual(['must be a drake']);

    expect(duckFits(duck, plain(key, { minGen: 1 }))).toBe(false); // a founder is gen 0
    expect(commissionGap(duck, plain(key, { minGen: 1 }))).toEqual(['gen 0 — needs gen 1+']);
    duck.lineage = { gen: 2, dam: null, sire: null, grand: [null, null, null, null] };
    expect(duckFits(duck, plain(key, { minGen: 2 }))).toBe(true);
    expect(duckFits(duck, plain(key, { minGen: 3 }))).toBe(false);

    expect(duckFits(duck, plain(key, { minStandard: pct }))).toBe(true);
    expect(duckFits(duck, plain(key, { minStandard: pct + 1 }))).toBe(false);
    expect(commissionGap(duck, plain(key, { minStandard: pct + 1 }))).toEqual([`${pct}% to standard — needs ${pct + 1}%`]);

    duck.genome.billColor = ['O', 'O'];
    expect(duckFits(duck, plain(key, { pinkBill: true }))).toBe(false);
    expect(commissionGap(duck, plain(key, { pinkBill: true }))).toEqual(['needs a pink bill']);
    duck.genome.billColor = ['O', 'P']; // one copy shows
    expect(duckFits(duck, plain(key, { pinkBill: true }))).toBe(true);

    // Several misses list together, in demand order.
    duck.genome.billColor = ['O', 'O'];
    expect(commissionGap(duck, plain(key, { sex: 'M', minGen: 5, pinkBill: true }))).toEqual([
      'must be a drake',
      'gen 2 — needs gen 5+',
      'needs a pink bill',
    ]);
  });

  it('an egg contract is judged on the parents in the family tree', () => {
    const { state, rng } = createNewGame(13);
    const key = 'k|D|solid|n';
    const c = plain(key, { eggFrom: true, points: 2 });
    const dam = adultOf(state, rng, key, { sex: 'F' });
    const sire = adultOf(state, rng, key, { sex: 'M' });
    const egg = layEgg(rng, dam, sire, { x: 0, y: 0 });
    state.ducks.push(egg);
    expect(duckFits(egg, c)).toBe(true);
    expect(commissionGap(egg, c)).toBeNull(); // egg contracts say nothing
    // Hatched already: no longer an egg contract's business.
    egg.stage = 'duckling';
    expect(duckFits(egg, c)).toBe(false);
    egg.stage = 'egg';
    // A generation ask counts the egg's own gen.
    expect(egg.lineage?.gen).toBe(1);
    expect(duckFits(egg, plain(key, { eggFrom: true, minGen: 1 }))).toBe(true);
    expect(duckFits(egg, plain(key, { eggFrom: true, minGen: 2 }))).toBe(false);
    // One parent of another breed spoils it.
    const other = adultOf(state, rng, 'W|D|solid|n', { sex: 'M' });
    const mixed = layEgg(rng, dam, other, { x: 0, y: 0 });
    expect(duckFits(mixed, c)).toBe(false);
    // An egg with no lineage (a bought-in founder) can't be judged.
    const orphan = createDuck(rng, { genome: representativeGenome(key), stage: 'egg', pos: { x: 0, y: 0 } });
    expect(duckFits(orphan, c)).toBe(false);
    // And a grown duck of the breed is not what an egg contract wants.
    expect(duckFits(dam, c)).toBe(false);
  });
});

describe('fulfilCommission', () => {
  it('delivering a fitting duck pays coins and Society points, removes the duck, and clears the slot', () => {
    const { state, rng } = createNewGame(14);
    const key = breedKey(state.ducks[0].genome);
    const c = plain(key, { reward: 777, points: 5 });
    state.commissions.push(c);
    const duck = adultOf(state, rng, key);
    const money = state.money;
    const flockBefore = state.ducks.length;
    const list = toasts();

    expect(fulfilCommission(state, c.id, duck.id)).toBe(true);
    expect(state.money).toBe(money + 777);
    expect(state.society.points).toBe(5);
    expect(state.society.lifetimePoints).toBe(5);
    expect(state.ducks).toHaveLength(flockBefore - 1);
    expect(state.ducks).not.toContain(duck);
    expect(state.commissions).toHaveLength(0);
    expect(state.commissionsDone).toBe(1);
    expect(state.stats.ducksSold).toBe(1);
    expect(state.stats.biggestSale).toBe(777);
    expect(state.chronicle.some((e) => e.kind === 'sale' && e.text.includes(duck.name) && e.text.includes('777'))).toBe(true);
    expect(list).toEqual([`Dr. Quill paid 777 coins for ${duck.name} (+5 Society)`]);

    // A smaller sale later doesn't dent the record.
    const c2 = plain(key, { id: 101, reward: 50 });
    state.commissions.push(c2);
    const another = adultOf(state, rng, key);
    expect(fulfilCommission(state, c2.id, another.id)).toBe(true);
    expect(state.stats.biggestSale).toBe(777);
    expect(state.commissionsDone).toBe(2);
  });

  it('refuses a duck that does not fit, and leaves everything as it was', () => {
    const { state, rng } = createNewGame(15);
    const c = plain('k|D|solid|n', { sex: 'M' });
    state.commissions.push(c);
    const wrongBreed = adultOf(state, rng, 'W|D|solid|n', { sex: 'M' });
    const wrongSex = adultOf(state, rng, 'k|D|solid|n', { sex: 'F' });
    const money = state.money;
    const flock = [...state.ducks];
    expect(fulfilCommission(state, c.id, wrongBreed.id)).toBe(false);
    expect(fulfilCommission(state, c.id, wrongSex.id)).toBe(false);
    expect(state.money).toBe(money);
    expect(state.ducks).toEqual(flock);
    expect(state.commissions).toEqual([c]);
    expect(state.commissionsDone).toBe(0);
    expect(state.society.points).toBe(0);
  });

  it('refuses an unknown commission or an unknown duck', () => {
    const { state, rng } = createNewGame(16);
    const key = breedKey(state.ducks[0].genome);
    const c = plain(key);
    state.commissions.push(c);
    const duck = adultOf(state, rng, key);
    expect(fulfilCommission(state, 999, duck.id)).toBe(false);
    expect(fulfilCommission(state, c.id, 'nobody')).toBe(false);
    expect(state.ducks).toContain(duck);
    expect(state.commissions).toEqual([c]);
  });

  it('an egg contract takes the egg off the nest', () => {
    const { state, rng } = createNewGame(17);
    const key = 'k|D|solid|n';
    const c = plain(key, { eggFrom: true, reward: 300, points: 2 });
    state.commissions.push(c);
    const dam = adultOf(state, rng, key, { sex: 'F' });
    const sire = adultOf(state, rng, key, { sex: 'M' });
    const egg = layEgg(rng, dam, sire, { x: 0, y: 0 });
    state.ducks.push(egg);
    const money = state.money;
    expect(fulfilCommission(state, c.id, egg.id)).toBe(true);
    expect(state.ducks).not.toContain(egg);
    expect(state.money).toBe(money + 300);
    expect(state.society.points).toBe(2);
  });
});

describe('describeCommission and commissionSpecimen', () => {
  it('spells out the breed and every demand', () => {
    const key = 'k|D|solid|n';
    expect(describeCommission(plain(key))).toBe('a Black');
    expect(describeCommission(plain(key, { sex: 'F' }))).toBe('a Black hen');
    expect(describeCommission(plain(key, { sex: 'M', minGen: 2, minStandard: 60, pinkBill: true }))).toBe(
      'a Black drake · gen 2+ · 60% to standard · pink bill',
    );
    expect(describeCommission(plain(key, { eggFrom: true }))).toBe('an egg from two Black parents');
    expect(describeCommission(plain(key, { eggFrom: true, minGen: 3 }))).toBe('an egg from two Black parents · gen 3+');
  });

  it('the specimen is a grown duck of the breed, an egg for egg contracts, and stable per commission', () => {
    const key = 'W|d|spotted|c';
    const shown = commissionSpecimen(plain(key, { sex: 'M' }));
    expect(shown.stage).toBe('adult');
    expect(shown.sex).toBe('M');
    expect(breedKey(shown.genome)).toBe(key);
    expect(commissionSpecimen(plain(key)).sex).toBe('F');
    expect(commissionSpecimen(plain(key, { eggFrom: true })).stage).toBe('egg');
    expect(commissionSpecimen(plain(key))).toEqual(commissionSpecimen(plain(key)));
  });
});

describe('bestPairFor', () => {
  it('names the surest pair and its odds, and nothing when no pair could', () => {
    const { state, rng } = createNewGame(18);
    state.ducks = [];
    expect(bestPairFor(state, 'k|D|solid|n')).toBeNull();
    const key = 'k|D|solid|n';
    const dam = adultOf(state, rng, key, { sex: 'F' });
    const sire = adultOf(state, rng, key, { sex: 'M' });
    const best = bestPairFor(state, key)!;
    expect(best).not.toBeNull();
    expect(best.sire).toBe(sire);
    expect(best.dam).toBe(dam);
    expect(best.chance).toBe(1);
    // A penned drake is out of the running.
    sire.penned = true;
    expect(bestPairFor(state, key)).toBeNull();
    sire.penned = false;
    // Two true-breeding blacks can't throw a white.
    expect(bestPairFor(state, 'W|D|solid|n')).toBeNull();
  });
});
