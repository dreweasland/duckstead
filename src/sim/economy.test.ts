import { describe, expect, it } from 'vitest';
import { createNewGame } from '../newGame';
import { newGameWithPair, pushEgg } from '../testFixtures';
import { createDuck, createStarterDuck } from './duck';
import { nestPair } from './breeding';
import { randomCommonGenome } from './genetics';
import {
  buyUpgrade,
  duckCapacity,
  eggWarmthDecayScale,
  isOvercrowded,
  nestCapacity,
  overcrowding,
  pondHasRoom,
  pondOccupancy,
  sellDuck,
  sellPrice,
  UPGRADES,
} from './economy';

describe('pricing', () => {
  it('rarer ducks sell for more', () => {
    const { state, rng } = createNewGame(1);
    const plainGenome = randomCommonGenome(rng);
    const fancyGenome = randomCommonGenome(rng);
    fancyGenome.baseColor = ['B', 'B'];
    fancyGenome.crest = ['R', 'R'];
    const plain = createDuck(rng, { genome: plainGenome, stage: 'adult', pos: { x: 0, y: 0 } });
    const fancy = createDuck(rng, { genome: fancyGenome, stage: 'adult', pos: { x: 0, y: 0 } });
    expect(sellPrice(state, fancy)).toBeGreaterThan(sellPrice(state, plain));
  });

  it('adults sell for more than eggs of the same genes', () => {
    const { state, rng } = createNewGame(2);
    const genome = randomCommonGenome(rng);
    const egg = createDuck(rng, { genome, stage: 'egg', pos: { x: 0, y: 0 } });
    const adult = createDuck(rng, { genome, stage: 'adult', pos: { x: 0, y: 0 } });
    expect(sellPrice(state, adult)).toBeGreaterThan(sellPrice(state, egg));
  });
});

describe('selling', () => {
  it('removes the duck and credits coins', () => {
    const { state } = createNewGame(3);
    const duck = state.ducks[0];
    const money = state.money;
    expect(sellDuck(state, duck.id)).toBe(true);
    expect(state.money).toBeGreaterThan(money);
    expect(state.ducks.find((d) => d.id === duck.id)).toBeUndefined();
  });
});

describe('upgrades', () => {
  it('cannot overspend', () => {
    const { state } = createNewGame(4);
    state.money = 10;
    expect(buyUpgrade(state, 'incubator')).toBe(false);
    expect(state.money).toBe(10);
  });

  it('level effects apply and respect max level', () => {
    const { state } = createNewGame(5);
    state.money = 10_000;
    expect(nestCapacity(state)).toBe(2);
    expect(duckCapacity(state)).toBe(8);
    buyUpgrade(state, 'nestingBox');
    expect(nestCapacity(state)).toBe(4);
    buyUpgrade(state, 'pondExpansion');
    expect(duckCapacity(state)).toBe(12);

    const def = UPGRADES.find((u) => u.id === 'nestingBox')!;
    for (let i = 0; i < 10; i += 1) buyUpgrade(state, 'nestingBox');
    expect(state.upgrades.nestingBox).toBe(def.maxLevel);
  });
});

describe('pond capacity', () => {
  it('counts hatched ducks only; the nest keeps running at a full pond', () => {
    const { state, rng, hen: f, drake: m } = newGameWithPair(21);
    // 4 starters + 4 adopted = 8 = capacity.
    for (let i = 0; i < 4; i += 1) state.ducks.push(createStarterDuck(rng, { x: 0, y: 0 }, i % 2 ? 'M' : 'F'));
    expect(pondHasRoom(state)).toBe(false);
    expect(overcrowding(state)).toBe(0);
    expect(nestPair(state, m.id, f.id).ok).toBe(true);
    // Eggs don't occupy the pond…
    pushEgg(state, rng);
    expect(pondOccupancy(state)).toBe(8);
    // …but a hatched duck over the limit overcrowds it.
    state.ducks.push(createStarterDuck(rng, { x: 0, y: 0 }));
    expect(overcrowding(state)).toBe(1);
    expect(isOvercrowded(state)).toBe(true);
    sellDuck(state, state.ducks[state.ducks.length - 1].id);
    expect(isOvercrowded(state)).toBe(false);
  });

  it('nesting boxes slow egg warmth loss', () => {
    const { state } = createNewGame(22);
    expect(eggWarmthDecayScale(state)).toBe(1);
    state.upgrades.nestingBox = 2;
    expect(eggWarmthDecayScale(state)).toBe(0.5);
  });
});
