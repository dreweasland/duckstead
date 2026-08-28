import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { breed, completeGenome, computePhenotype, LOCI, randomCommonGenome, type Genome } from './genetics';
import { createDuck } from './duck';
import { personality, personalityLabels } from './behavior';
import { layHappinessNeeded } from './laying';
import { describeStandard, standardMatch, standardTargets } from './standards';
import { ALL_BREED_KEYS } from './breedBook';

function genomeWithTemper(plus: number): Genome {
  const g = randomCommonGenome(createRng(1));
  g.temper1 = [plus > 0 ? '+' : '-', plus > 1 ? '+' : '-'];
  g.temper2 = [plus > 2 ? '+' : '-', plus > 3 ? '+' : '-'];
  return g;
}

describe('temperament loci', () => {
  it('boldness counts the + alleles across temper1-2', () => {
    for (let n = 0; n <= 4; n += 1) expect(computePhenotype(genomeWithTemper(n)).boldness).toBeCloseTo(n / 4);
  });

  it('is inherited additively: bold × bold breeds bold, timid × timid breeds timid', () => {
    const rng = createRng(8);
    const bold = genomeWithTemper(4);
    const timid = genomeWithTemper(0);
    let boldSum = 0;
    let timidSum = 0;
    let mixSum = 0;
    const N = 2000;
    for (let i = 0; i < N; i += 1) {
      boldSum += computePhenotype(breed(bold, bold, rng)).boldness;
      timidSum += computePhenotype(breed(timid, timid, rng)).boldness;
      mixSum += computePhenotype(breed(bold, timid, rng)).boldness;
    }
    expect(boldSum / N).toBeGreaterThan(0.95);
    expect(timidSum / N).toBeLessThan(0.05);
    expect(mixSum / N).toBeGreaterThan(0.45);
    expect(mixSum / N).toBeLessThan(0.55);
  });

  it('drives energy and the temperament label', () => {
    const rng = createRng(2);
    const bold = createDuck(rng, { genome: genomeWithTemper(4), stage: 'adult', pos: { x: 0, y: 0 } });
    const timid = createDuck(rng, { genome: genomeWithTemper(0), stage: 'adult', pos: { x: 0, y: 0 } });
    expect(personality(bold).energy).toBeGreaterThan(personality(timid).energy);
    expect(personalityLabels(bold)).toContain('bold');
    expect(personalityLabels(timid)).toContain('timid');
    expect(personalityLabels(createDuck(rng, { genome: genomeWithTemper(2), stage: 'adult', pos: { x: 0, y: 0 } }))).toContain('steady');
  });

  it('bold hens lay through a worse mood than timid ones', () => {
    const rng = createRng(2);
    const bold = createDuck(rng, { genome: genomeWithTemper(4), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
    const timid = createDuck(rng, { genome: genomeWithTemper(0), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'F' });
    expect(layHappinessNeeded(bold)).toBeLessThan(layHappinessNeeded(timid));
  });

  it('every breed standard names a temperament and judges it', () => {
    for (const key of ALL_BREED_KEYS) {
      const t = standardTargets(key);
      expect([0, 2, 4]).toContain(t.temper);
      expect(describeStandard(key)).toMatch(/timid|steady|bold/);
    }
    const rng = createRng(3);
    const duck = createDuck(rng, { genome: genomeWithTemper(4), stage: 'adult', pos: { x: 0, y: 0 } });
    expect(standardMatch(duck).slots.some((s) => s.label === 'temper')).toBe(true);
  });

  it('completeGenome fills missing loci and leaves present ones alone', () => {
    const g = randomCommonGenome(createRng(4));
    const before = [...g.baseColor];
    delete (g as Partial<Genome>).temper1;
    delete (g as Partial<Genome>).temper2;
    completeGenome(g);
    for (const def of LOCI) expect(g[def.id]).toHaveLength(2);
    expect(g.baseColor).toEqual(before);
    expect(g.temper1).toEqual(['+', '-']);
    const h = randomCommonGenome(createRng(4));
    delete (h as Partial<Genome>).temper1;
    completeGenome(h, createRng(9));
    expect(['+', '-']).toContain(h.temper1[0]);
  });
});
