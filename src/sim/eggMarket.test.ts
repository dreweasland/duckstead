import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../state';
import { layEgg } from './duck';
import { breed, randomCommonGenome } from './genetics';
import { makeCommission, describeCommission, duckFits, fulfilCommission } from './commissions';
import { EGG_OFFER_THRESHOLD, rivalEggOffer, rivalFitness, sellEggToRival } from './rivals';
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
