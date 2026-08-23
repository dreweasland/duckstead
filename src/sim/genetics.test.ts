import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import {
  breed,
  computePhenotype,
  expressedAlleles,
  LOCI,
  MUTATION_RATE,
  randomCommonGenome,
  starterGenome,
  type Genome,
} from './genetics';

function baseGenome(): Genome {
  const genome = {} as Genome;
  for (const def of LOCI) {
    const common = def.alleles.filter((a) => !def.rare?.includes(a));
    genome[def.id] = [common[0], common[0]];
  }
  return genome;
}

describe('mendelian resolution', () => {
  it('dominant allele masks recessive', () => {
    const g = baseGenome();
    g.baseColor = ['M', 'W'];
    expect(expressedAlleles(g, 'baseColor')).toEqual(['M']);
    g.baseColor = ['W', 'k'];
    expect(expressedAlleles(g, 'baseColor')).toEqual(['W']);
  });

  it('codominant alleles both express (M/B blend)', () => {
    const g = baseGenome();
    g.baseColor = ['M', 'B'];
    expect(expressedAlleles(g, 'baseColor').sort()).toEqual(['B', 'M']);
    const blended = computePhenotype(g).bodyColor;
    g.baseColor = ['M', 'M'];
    const mallard = computePhenotype(g).bodyColor;
    g.baseColor = ['B', 'B'];
    const blue = computePhenotype(g).bodyColor;
    expect(blended).not.toBe(mallard);
    expect(blended).not.toBe(blue);
  });

  it('dilution lightens color only when homozygous recessive', () => {
    const g = baseGenome();
    g.baseColor = ['M', 'M'];
    g.dilution = ['D', 'd'];
    const normal = computePhenotype(g).bodyColor;
    g.dilution = ['d', 'd'];
    const pastel = computePhenotype(g).bodyColor;
    expect(normal).not.toBe(pastel);
  });

  it('crest expresses only from RR', () => {
    const g = baseGenome();
    g.crest = ['n', 'R'];
    expect(computePhenotype(g).crested).toBe(false);
    g.crest = ['R', 'R'];
    expect(computePhenotype(g).crested).toBe(true);
  });
});

describe('additive traits', () => {
  it('maps allele count to size range endpoints', () => {
    const g = baseGenome();
    for (const id of ['size1', 'size2', 'size3'] as const) g[id] = ['-', '-'];
    expect(computePhenotype(g).sizeScale).toBeCloseTo(0.75);
    for (const id of ['size1', 'size2', 'size3'] as const) g[id] = ['+', '+'];
    expect(computePhenotype(g).sizeScale).toBeCloseTo(1.3);
  });

  it('maps bill allele count to morphs', () => {
    const g = baseGenome();
    for (const id of ['bill1', 'bill2'] as const) g[id] = ['+', '+'];
    const long = computePhenotype(g);
    expect(long.billLength).toBe(1);
    expect(long.billWidth).toBe(0);
  });
});

describe('breed', () => {
  it('Mm x Mm gives ~3:1 dominant phenotype ratio', () => {
    const rng = createRng(7);
    const a = baseGenome();
    const b = baseGenome();
    a.baseColor = ['M', 'W'];
    b.baseColor = ['M', 'W'];
    let dominant = 0;
    const N = 10_000;
    for (let i = 0; i < N; i += 1) {
      const child = breed(a, b, rng);
      if (expressedAlleles(child, 'baseColor').includes('M')) dominant += 1;
    }
    // 3:1 with slack for the 2% mutation rate and sampling noise.
    expect(dominant / N).toBeGreaterThan(0.7);
    expect(dominant / N).toBeLessThan(0.8);
  });

  it('mutates at roughly MUTATION_RATE per inherited allele', () => {
    const rng = createRng(11);
    const a = baseGenome();
    const b = baseGenome();
    // crest is nn for both parents; any R in a child is a mutation.
    let mutations = 0;
    const N = 20_000;
    for (let i = 0; i < N; i += 1) {
      const child = breed(a, b, rng);
      for (const allele of child.crest) if (allele !== 'n') mutations += 1;
    }
    const rate = mutations / (N * 2);
    expect(rate).toBeGreaterThan(MUTATION_RATE * 0.8);
    expect(rate).toBeLessThan(MUTATION_RATE * 1.2);
  });
});

describe('starter genomes', () => {
  it('never contain rare alleles', () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i += 1) {
      const g = randomCommonGenome(rng);
      for (const def of LOCI) {
        for (const rare of def.rare ?? []) {
          expect(g[def.id]).not.toContain(rare);
        }
      }
    }
  });

  it('starter ducks carry at least one hidden recessive surprise', () => {
    const rng = createRng(5);
    for (let i = 0; i < 200; i += 1) {
      const g = starterGenome(rng);
      const hasSurprise =
        (g.baseColor.includes('W') || g.baseColor.includes('k')) &&
          expressedAlleles(g, 'baseColor')[0] === 'M' ||
        g.dilution.join('') === 'Dd' ||
        (g.pattern.includes('p') || g.pattern.includes('c')) &&
          expressedAlleles(g, 'pattern')[0] === 'S' ||
        g.crest.join('') === 'nR';
      expect(hasSurprise).toBe(true);
    }
  });
});

describe('rarity', () => {
  it('scores rare and extreme phenotypes higher', () => {
    const plain = baseGenome();
    plain.size1 = ['+', '-'];
    const fancy = baseGenome();
    fancy.baseColor = ['B', 'B'];
    fancy.crest = ['R', 'R'];
    fancy.billColor = ['P', 'P'];
    fancy.dilution = ['d', 'd'];
    expect(computePhenotype(fancy).rarityScore).toBeGreaterThan(
      computePhenotype(plain).rarityScore,
    );
  });
});
