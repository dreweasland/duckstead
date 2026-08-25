import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { createNewGame } from '../state';
import { breedingValue, childBreedKeys, keepVerdict, verdictReason } from './advisor';
import { breedKey, recordBreed } from './breedBook';
import { createDuck } from './duck';
import { randomCommonGenome, type Genome } from './genetics';

function plainGenome(rngSeed = 1): Genome {
  const rng = createRng(rngSeed);
  const g = randomCommonGenome(rng);
  g.baseColor = ['M', 'M'];
  g.dilution = ['D', 'D'];
  g.pattern = ['S', 'S'];
  g.crest = ['n', 'n'];
  return g;
}

describe('childBreedKeys', () => {
  it('two crest carriers can reach the crested breed', () => {
    const a = plainGenome(1);
    const b = plainGenome(2);
    a.crest = ['n', 'R'];
    b.crest = ['n', 'R'];
    const keys = childBreedKeys(a, b);
    expect(keys.has('M|D|solid|c')).toBe(true);
    expect(keys.has('M|D|solid|n')).toBe(true);
  });

  it('homozygous plain pairs reach only their own breed', () => {
    const keys = childBreedKeys(plainGenome(3), plainGenome(4));
    expect([...keys]).toEqual(['M|D|solid|n']);
  });
});

describe('breedingValue', () => {
  it('flags the only carrier of a rare gene as a key breeder', () => {
    const { state, rng } = createNewGame(61);
    state.ducks = [];
    const carrierGenome = plainGenome(5);
    carrierGenome.baseColor = ['B', 'M'];
    const carrier = createDuck(rng, { genome: carrierGenome, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
    const plain = createDuck(rng, { genome: plainGenome(6), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    state.ducks.push(carrier, plain);
    const value = breedingValue(state, carrier);
    expect(value.uniqueAlleles).toContain('blue');
    expect(keepVerdict(value)).toBe('key');
  });

  it('marks duplicated, exhausted ducks as covered', () => {
    const { state, rng } = createNewGame(62);
    state.ducks = [];
    state.breedBook = {};
    const twinsGenome = plainGenome(7);
    const a = createDuck(rng, { genome: { ...twinsGenome }, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    const b = createDuck(rng, { genome: { ...twinsGenome }, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
    state.ducks.push(a, b);
    // Their only reachable breed is already discovered.
    recordBreed(state, a, true);
    expect(breedKey(a.genome)).toBe('M|D|solid|n');
    const value = breedingValue(state, a);
    expect(value.newBreeds).toEqual([]);
    expect(value.duplicates).toEqual([b.name]);
    expect(verdictReason(value)).toBe(`${b.name} carries identical Book genes.`);
    expect(keepVerdict(value)).toBe('covered');
  });

  it('counts undiscovered breeds reachable with the current flock', () => {
    const { state, rng } = createNewGame(63);
    state.ducks = [];
    state.breedBook = {};
    const a = createDuck(rng, { genome: plainGenome(8), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    const bGenome = plainGenome(9);
    bGenome.pattern = ['p', 'p'];
    const b = createDuck(rng, { genome: bGenome, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
    state.ducks.push(a, b);
    const value = breedingValue(state, a);
    // Spotted-carrier offspring breed (M|D|spotted... no — child of SS×pp is
    // Sp → expresses solid). Only solid reachable, but undiscovered.
    expect(value.newBreeds).toContain('M|D|solid|n');
    expect(keepVerdict(value)).toBe('useful');
  });
});

describe('marginal value', () => {
  it('a duck whose reach another duck fully covers is "covered", not "worth keeping"', () => {
    const { state, rng } = createNewGame(95);
    // Two identical drakes: each covers the other.
    const genome = randomCommonGenome(rng);
    const a = createDuck(rng, { genome: { ...genome }, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    const b = createDuck(rng, { genome: { ...genome }, stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M' });
    const hen = createDuck(rng, { genome: randomCommonGenome(rng), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
    state.ducks = [a, b, hen];
    const va = breedingValue(state, a);
    expect(va.newBreeds.length).toBeGreaterThan(0);
    expect(va.marginalBreeds).toHaveLength(0);
    expect(va.coveredBy).toEqual([b.name]);
    // Identical twins hit the more specific duplicates line first.
    expect(verdictReason(va)).toBe(`${b.name} carries identical Book genes.`);
    // Identical genomes tie on standard, so neither is best of breed.
    expect(keepVerdict(va)).toBe('covered');
    // Remove the twin: now a is the only route to those breeds.
    state.ducks = [a, hen];
    const alone = breedingValue(state, a);
    expect(alone.marginalBreeds.length).toBe(alone.newBreeds.length);
    expect(['useful', 'key']).toContain(keepVerdict(alone));
  });
});
