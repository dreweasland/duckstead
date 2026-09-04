import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../newGame';
import {
  ALL_BREED_KEYS,
  breedKey,
  breedLabel,
  breedsDiscovered,
  recordBreed,
  representativeGenome,
} from './breedBook';
import { createDuck } from './duck';
import { randomCommonGenome } from './genetics';

describe('breed keys', () => {
  it('has exactly 60 collectible breeds', () => {
    expect(ALL_BREED_KEYS.length).toBe(60);
    expect(new Set(ALL_BREED_KEYS).size).toBe(60);
  });

  it('every representative genome round-trips to its own key', () => {
    for (const key of ALL_BREED_KEYS) {
      expect(breedKey(representativeGenome(key))).toBe(key);
    }
  });

  it('labels read naturally', () => {
    expect(breedLabel('M|D|solid|n')).toBe('Mallard');
    expect(breedLabel('B|d|spotted|c')).toBe('Dilute Spotted Blue, Crested');
    expect(breedLabel('B+M|D|capped|n')).toBe('Capped Blue-Mallard');
  });

  it('random genomes always map to a catalogued key', () => {
    const rng = createRng(11);
    for (let i = 0; i < 300; i += 1) {
      expect(ALL_BREED_KEYS).toContain(breedKey(randomCommonGenome(rng)));
    }
  });
});

describe('recording', () => {
  it('pays a discovery reward once, then only counts', () => {
    const { state, rng } = createNewGame(21);
    state.breedBook = {};
    const duck = createDuck(rng, {
      genome: representativeGenome('W|D|solid|n'),
      stage: 'adult',
      pos: { x: 0, y: 0 },
    });
    const money = state.money;
    expect(recordBreed(state, duck)).toBe(true);
    expect(state.money).toBeGreaterThan(money);
    const after = state.money;
    expect(recordBreed(state, duck)).toBe(false);
    expect(state.money).toBe(after);
    expect(state.breedBook[breedKey(duck.genome)].count).toBe(2);
  });

  it('starter flock seeds the book without rewards', () => {
    const { state } = createNewGame(22);
    expect(breedsDiscovered(state)).toBeGreaterThan(0);
  });
});
