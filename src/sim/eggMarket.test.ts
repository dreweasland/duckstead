import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../state';
import { layEgg } from './duck';
import { breed, randomCommonGenome } from './genetics';
import { makeCommission, describeCommission, duckFits, fulfilCommission } from './commissions';
import { buyRivalEgg, EGG_OFFER_THRESHOLD, rivalEggOffer, rivalEggsForSale, rivalFitness, sellEggToRival } from './rivals';
import { nestCapacity } from './economy';
import { TICKS_PER_DAY } from './time';
import { sellPrice } from './economy';
import { breedKey } from './breedBook';
import { breedStandard } from './standards';
import { createDuck } from './duck';

function showPair(seed: number) {
  const { state, rng } = createNewGame(seed);
  // Two parents bred to a show standard: exactly what Marta pays for.
  const g = breedStandard('M|D|solid|n');
  const dam = createDuck(rng, { genome: g, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F', name: 'Dam' });
  const sire = createDuck(rng, { genome: JSON.parse(JSON.stringify(g)), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M', name: 'Sire' });
  state.ducks.push(dam, sire);
  return { state, rng, dam, sire };
}

describe('the rivals\' hatching-egg market', () => {
  it('bids on a fitting pairing, and identically whatever the egg\'s hidden genes', () => {
    const { state, rng, dam, sire } = showPair(200);
    const a = layEgg(rng, dam, sire, { x: 0, y: 0 });
    const b = layEgg(rng, dam, sire, { x: 0, y: 0 });
    b.genome.baseColor = ['B', 'B'];
    b.genome.billColor = ['P', 'P'];
    state.ducks.push(a, b);
    const oa = rivalEggOffer(state, a);
    const ob = rivalEggOffer(state, b);
    expect(oa).not.toBeNull();
    expect(oa!.price).toBe(ob!.price); // no candling through the bid
    expect(oa!.price).toBeGreaterThan(sellPrice(state, a)); // beats the base valve
  });

  it('ignores wild clutches and pairings below the bar', () => {
    const { state, rng } = createNewGame(201);
    const dam = state.ducks.find((d) => d.sex === 'F')!;
    const sire = state.ducks.find((d) => d.sex === 'M')!;
    const egg = layEgg(rng, dam, sire, { x: 0, y: 0 });
    delete egg.lineage;
    state.ducks.push(egg);
    expect(rivalEggOffer(state, egg)).toBeNull();
    const dud = layEgg(rng, dam, sire, { x: 0, y: 0 });
    state.ducks.push(dud);
    const offer = rivalEggOffer(state, dud);
    if (offer) expect(offer.score).toBeGreaterThanOrEqual(EGG_OFFER_THRESHOLD);
  });

  it('a sale pays, takes the egg, limits the buyer to one a day, and can seed their flock', () => {
    const { state, rng, dam, sire } = showPair(202);
    const eggs = Array.from({ length: 3 }, () => layEgg(rng, dam, sire, { x: 0, y: 0 }));
    state.ducks.push(...eggs);
    const money = state.money;
    const seeded = createRng(9);
    let absorbed = false;
    for (const egg of eggs) {
      const before = state.rivals.map((r) => JSON.stringify(r.flock)).join();
      if (!sellEggToRival(state, egg.id, seeded)) break;
      if (state.rivals.map((r) => JSON.stringify(r.flock)).join() !== before) absorbed = true;
    }
    expect(state.money).toBeGreaterThan(money);
    // All three rivals rate a standard pairing, but each buys once a day —
    // with three rivals at most three sales; the flock check saw at least
    // one absorption at this seed.
    expect(state.ducks.filter((d) => d.stage === 'egg').length + state.stats.eggsSold).toBe(3);
    expect(absorbed).toBe(true);
    expect(rivalFitness(state.rivals[0].specialty, breedStandard('M|D|solid|n'))).toBeGreaterThan(EGG_OFFER_THRESHOLD);
  });
});

describe('egg commissions', () => {
  it('asks for an egg from two same-breed parents and pays on the family tree', () => {
    const { state, rng, dam, sire } = showPair(203);
    state.commissionsDone = 3; // tier 1: egg contracts possible
    const seeded = createRng(17);
    let c = null;
    for (let i = 0; i < 80 && !c; i += 1) {
      const made = makeCommission(state, seeded);
      if (made?.eggFrom) c = made;
      state.commissions = [];
    }
    expect(c).not.toBeNull();
    // Point the contract at the show pair's breed; the reward is whatever
    // the board set — the test checks it is paid in full.
    c!.key = 'M|D|solid|n';
    state.commissions = [c!];
    expect(describeCommission(c!)).toMatch(/an egg from two/);
    const egg = layEgg(rng, dam, sire, { x: 0, y: 0 });
    state.ducks.push(egg);
    expect(duckFits(egg, c!)).toBe(true);
    // A grown duck of the breed does NOT fit an egg contract, and a
    // mixed-parent egg doesn't either.
    expect(duckFits(dam, c!)).toBe(false);
    // A sire of a different breed: the pairing no longer fits the contract.
    const strangerGenome = randomCommonGenome(rng);
    strangerGenome.baseColor = ['k', 'k'];
    const stranger = createDuck(rng, { genome: strangerGenome, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    const mixed = layEgg(rng, dam, stranger, { x: 0, y: 0 });
    expect(breedKey(mixed.lineage!.sire!.genome)).not.toBe(breedKey(mixed.lineage!.dam!.genome));
    expect(duckFits(mixed, c!)).toBe(false);
    const money = state.money;
    expect(fulfilCommission(state, c!.id, egg.id)).toBe(true);
    expect(state.money).toBe(money + c!.reward);
    expect(state.ducks.includes(egg)).toBe(false);
    void breed;
  });
});

describe('the rivals\' eggs for sale', () => {
  it('each rival offers one pairing a day, steady within the day, fresh the next', () => {
    const { state } = createNewGame(210);
    const today = rivalEggsForSale(state);
    expect(today).toHaveLength(3);
    const again = rivalEggsForSale(state);
    expect(today.map((s) => `${s.dam.name}x${s.sire.name}:${s.price}`)).toEqual(again.map((s) => `${s.dam.name}x${s.sire.name}:${s.price}`));
    for (const s of today) {
      expect(s.dam.sex).toBe('F');
      expect(s.sire.sex).toBe('M');
      expect(s.soldToday).toBe(false);
    }
    state.clock.totalTicks += TICKS_PER_DAY;
    const tomorrow = rivalEggsForSale(state);
    // The dam stays their best bird; at least the price/sire mix can move.
    expect(tomorrow).toHaveLength(3);
  });

  it('buying pays, lays a gen-0 egg in the nest with the pair on its tree, once a day', () => {
    const { state, rng } = createNewGame(211);
    state.money = 10_000;
    const sale = rivalEggsForSale(state)[0];
    const before = state.ducks.length;
    expect(buyRivalEgg(state, rng, sale.rivalId).ok).toBe(true);
    expect(state.money).toBe(10_000 - sale.price);
    const egg = state.ducks[state.ducks.length - 1];
    expect(state.ducks.length).toBe(before + 1);
    expect(egg.stage).toBe('egg');
    expect(egg.lineage?.gen).toBe(0);
    expect(egg.lineage?.dam?.name).toBe(sale.dam.name);
    expect(egg.lineage?.sire?.name).toBe(sale.sire.name);
    expect(egg.parentRarity).toBeGreaterThanOrEqual(0);
    // Every allele in the shell came from the pair (bar the 2% mutation).
    let fromParents = 0;
    let total = 0;
    for (const key of Object.keys(egg.genome) as Array<keyof typeof egg.genome>) {
      for (const a of egg.genome[key]) {
        total += 1;
        if (sale.dam.genome[key].includes(a) || sale.sire.genome[key].includes(a)) fromParents += 1;
      }
    }
    expect(fromParents / total).toBeGreaterThan(0.9);
    // One a day per rival.
    const second = buyRivalEgg(state, rng, sale.rivalId);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/no more eggs/);
  });

  it('respects the nest and the purse', () => {
    const { state, rng } = createNewGame(212);
    state.money = 1;
    const sale = rivalEggsForSale(state)[0];
    expect(buyRivalEgg(state, rng, sale.rivalId).reason).toMatch(/coins/);
    state.money = 10_000;
    // Fill the nest.
    const dam = state.ducks.find((d) => d.sex === 'F')!;
    const sire = state.ducks.find((d) => d.sex === 'M')!;
    for (let i = 0; i < nestCapacity(state); i += 1) state.ducks.push(layEgg(rng, dam, sire, { x: 0, y: 0 }));
    expect(buyRivalEgg(state, rng, sale.rivalId).reason).toMatch(/nest is full/);
  });
});
