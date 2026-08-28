import type { Rng } from '../rng';

export type Allele = string;
export type LocusId =
  | 'baseColor'
  | 'dilution'
  | 'pattern'
  | 'patternColor'
  | 'size1'
  | 'size2'
  | 'size3'
  | 'bill1'
  | 'bill2'
  | 'billColor'
  | 'crest'
  | 'vigor1'
  | 'vigor2';

export type Genome = Record<LocusId, [Allele, Allele]>;

interface LocusDef {
  id: LocusId;
  alleles: Allele[];
  kind: 'mendelian' | 'additive';
  // mendelian only: higher number wins; equal numbers are codominant (blend)
  dominance?: Record<Allele, number>;
  // alleles never present in starter/shop ducks — reachable only by mutation
  rare?: Allele[];
}

export const LOCI: LocusDef[] = [
  {
    id: 'baseColor',
    alleles: ['M', 'W', 'k', 'B'],
    kind: 'mendelian',
    dominance: { M: 3, B: 3, W: 2, k: 1 },
    rare: ['B'],
  },
  { id: 'dilution', alleles: ['D', 'd'], kind: 'mendelian', dominance: { D: 2, d: 1 } },
  {
    id: 'pattern',
    alleles: ['S', 'p', 'c'],
    kind: 'mendelian',
    dominance: { S: 3, p: 2, c: 1 },
  },
  { id: 'patternColor', alleles: ['A', 'a'], kind: 'mendelian', dominance: { A: 2, a: 1 } },
  { id: 'size1', alleles: ['+', '-'], kind: 'additive' },
  { id: 'size2', alleles: ['+', '-'], kind: 'additive' },
  { id: 'size3', alleles: ['+', '-'], kind: 'additive' },
  { id: 'bill1', alleles: ['+', '-'], kind: 'additive' },
  { id: 'bill2', alleles: ['+', '-'], kind: 'additive' },
  {
    id: 'billColor',
    alleles: ['O', 'y', 'P'],
    kind: 'mendelian',
    dominance: { P: 3, O: 2, y: 1 },
    rare: ['P'],
  },
  // Crest is recessive: only RR expresses (like real crested ducks).
  { id: 'crest', alleles: ['n', 'R'], kind: 'mendelian', dominance: { n: 2, R: 1 } },
  { id: 'vigor1', alleles: ['+', '-'], kind: 'additive' },
  { id: 'vigor2', alleles: ['+', '-'], kind: 'additive' },
];

export const MUTATION_RATE = 0.02;

const BASE_COLORS: Record<Allele, { body: string; head: string }> = {
  M: { body: '#8a6642', head: '#6b4f33' },
  W: { body: '#f2ede2', head: '#efe9db' },
  k: { body: '#35322f', head: '#2a2724' },
  B: { body: '#7d93b5', head: '#66799c' },
};

export interface Phenotype {
  bodyColor: string;
  headColor: string;
  pattern: 'solid' | 'spotted' | 'capped';
  patternColor: string;
  sizeScale: number; // 0.75 - 1.30
  billLength: number; // 0..1
  billWidth: number; // 0..1
  billColor: string;
  crested: boolean;
  vigor: number; // 0..1
  rarityScore: number;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Memoized: the duck painter derives ~10 shades per duck per frame from a
// handful of fixed inputs — parsing hex strings 12,000 times a second was
// pure garbage. Continuous inputs (sky tints) churn the cache, so it clears
// wholesale at a bound instead of growing forever.
const mixCache = new Map<string, string>();

export function mixColors(a: string, b: string, t: number): string {
  const key = `${a}|${b}|${t}`;
  const hit = mixCache.get(key);
  if (hit !== undefined) return hit;
  if (mixCache.size > 4000) mixCache.clear();
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const out = rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
  mixCache.set(key, out);
  return out;
}

export function lighten(hex: string, amount: number): string {
  return mixColors(hex, '#ffffff', amount);
}

export function darken(hex: string, amount: number): string {
  return mixColors(hex, '#000000', amount);
}

function locusDef(id: LocusId): LocusDef {
  const def = LOCI.find((l) => l.id === id);
  if (!def) throw new Error(`unknown locus ${id}`);
  return def;
}

// Mendelian resolution: returns the expressed allele(s). One allele when a
// clear dominant exists, both when codominant (equal dominance ranks).
export function expressedAlleles(genome: Genome, id: LocusId): Allele[] {
  const def = locusDef(id);
  const [a, b] = genome[id];
  const dom = def.dominance!;
  if (dom[a] > dom[b]) return [a];
  if (dom[b] > dom[a]) return [b];
  return a === b ? [a] : [a, b];
}

function additiveCount(genome: Genome, ids: LocusId[]): number {
  let n = 0;
  for (const id of ids) {
    for (const allele of genome[id]) if (allele === '+') n += 1;
  }
  return n;
}

export function computePhenotype(genome: Genome): Phenotype {
  // Base color, possibly a codominant blend (e.g. M/B).
  const baseExpr = expressedAlleles(genome, 'baseColor');
  let body = BASE_COLORS[baseExpr[0]].body;
  let head = BASE_COLORS[baseExpr[0]].head;
  if (baseExpr.length === 2) {
    body = mixColors(body, BASE_COLORS[baseExpr[1]].body, 0.5);
    head = mixColors(head, BASE_COLORS[baseExpr[1]].head, 0.5);
  }

  const diluted = expressedAlleles(genome, 'dilution')[0] === 'd';
  if (diluted) {
    body = lighten(body, 0.4);
    head = lighten(head, 0.4);
  }

  const patternAllele = expressedAlleles(genome, 'pattern')[0];
  const pattern = patternAllele === 'S' ? 'solid' : patternAllele === 'p' ? 'spotted' : 'capped';
  const patternColor =
    expressedAlleles(genome, 'patternColor')[0] === 'A' ? darken(body, 0.45) : '#f7f3e8';

  const sizeUnits = additiveCount(genome, ['size1', 'size2', 'size3']); // 0..6
  const sizeScale = 0.75 + (sizeUnits / 6) * 0.55;

  const billUnits = additiveCount(genome, ['bill1', 'bill2']); // 0..4
  const billLength = billUnits / 4;
  const billWidth = 1 - billUnits / 4;

  const billAllele = expressedAlleles(genome, 'billColor')[0];
  const billColor = billAllele === 'O' ? '#e8912d' : billAllele === 'y' ? '#e7c94f' : '#e89bb0';

  const crested = genome.crest[0] === 'R' && genome.crest[1] === 'R';

  const vigor = additiveCount(genome, ['vigor1', 'vigor2']) / 4; // 0..1

  // Rarity: expressed rare alleles + polygenic extremes + crest.
  let rarityScore = 0;
  for (const def of LOCI) {
    if (!def.rare) continue;
    for (const allele of def.rare) {
      if (expressedAlleles(genome, def.id).includes(allele)) rarityScore += 2;
    }
  }
  if (crested) rarityScore += 2;
  if (sizeUnits === 0 || sizeUnits === 6) rarityScore += 1;
  if (billUnits === 0 || billUnits === 4) rarityScore += 1;
  if (diluted) rarityScore += 1;

  return {
    bodyColor: body,
    headColor: head,
    pattern,
    patternColor,
    sizeScale,
    billLength,
    billWidth,
    billColor,
    crested,
    vigor,
    rarityScore,
  };
}

// One random allele from each parent per locus, with a small chance each
// inherited allele mutates to a different allele of the same locus. Mutation
// is the only way rare alleles (B, P) enter a fresh flock.
export function breed(a: Genome, b: Genome, rng: Rng, mutationRate = MUTATION_RATE): Genome {
  const child = {} as Genome;
  for (const def of LOCI) {
    const fromA = a[def.id][rng.int(2)];
    const fromB = b[def.id][rng.int(2)];
    child[def.id] = [mutate(fromA, def, rng, mutationRate), mutate(fromB, def, rng, mutationRate)];
  }
  return child;
}

function mutate(allele: Allele, def: LocusDef, rng: Rng, rate: number): Allele {
  if (!rng.chance(rate)) return allele;
  const others = def.alleles.filter((x) => x !== allele);
  return rng.pick(others);
}

// Random genome from common (non-rare) alleles, for starter/shop ducks.
export function randomCommonGenome(rng: Rng): Genome {
  const genome = {} as Genome;
  for (const def of LOCI) {
    const common = def.alleles.filter((x) => !def.rare?.includes(x));
    genome[def.id] = [rng.pick(common), rng.pick(common)];
  }
  return genome;
}

// Starter ducks each carry at least one hidden recessive so early breeding
// produces surprises (white, black, capped, crested...).
export function starterGenome(rng: Rng): Genome {
  const genome = randomCommonGenome(rng);
  const surprises: Array<() => void> = [
    () => (genome.baseColor = ['M', rng.pick(['W', 'k'])]),
    () => (genome.dilution = ['D', 'd']),
    () => (genome.pattern = ['S', rng.pick(['p', 'c'])]),
    () => (genome.crest = ['n', 'R']),
  ];
  rng.pick(surprises)();
  return genome;
}

export function formatGenotype(genome: Genome): string {
  const order: LocusId[] = ['baseColor', 'dilution', 'pattern', 'patternColor', 'billColor', 'crest'];
  const mendel = order.map((id) => genome[id].join('')).join(' ');
  const size = additiveCount(genome, ['size1', 'size2', 'size3']);
  const bill = additiveCount(genome, ['bill1', 'bill2']);
  const vigor = additiveCount(genome, ['vigor1', 'vigor2']);
  return `${mendel} | size ${size}/6 · bill ${bill}/4 · vigor ${vigor}/4`;
}
