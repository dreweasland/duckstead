// Breed Standards: for every Breed Book entry, a "show standard" genotype
// across all 15 loci. The four Book loci come from the key; the other eleven
// (size, bill length, bill colour, markings, vigor, temperament) are derived
// from a hash of the key so each breed has its own build to chase — and a
// full match takes generations of selection, not luck.
import type { Duck } from './duck';
import type { Allele, Genome, LocusId } from './genetics';
import { breedKey, representativeGenome } from './breedBook';
import { fnv1a } from '../rng';

interface StandardTargets {
  size: number; // 0..6 '+' alleles across size1-3
  bill: number; // 0..4 across bill1-2
  billColor: Allele; // 'O' | 'y' | 'P'
  markings: Allele; // 'A' | 'a'
  temper: number; // 0..4 '+' alleles across temper1-2: timid, steady, bold
}

const hashKey = fnv1a;

export function standardTargets(key: string): StandardTargets {
  const h = hashKey(key);
  const size = [0, 2, 3, 4, 6][h % 5];
  const bill = [0, 2, 4][(h >>> 4) % 3];
  // Pink bills are the rare prize: about a third of standards call for one.
  const billRoll = (h >>> 8) % 9;
  const billColor: Allele = billRoll < 3 ? 'P' : billRoll < 6 ? 'y' : 'O';
  const markings: Allele = (h >>> 12) % 2 === 0 ? 'A' : 'a';
  const temper = [0, 2, 4][(h >>> 16) % 3];
  return { size, bill, billColor, markings, temper };
}

// The full target genome. Additive loci are filled left to right with '+'.
export function breedStandard(key: string): Genome {
  const g = representativeGenome(key);
  const t = standardTargets(key);
  const fill = (ids: LocusId[], plus: number) => {
    let left = plus;
    for (const id of ids) {
      const a: Allele = left > 0 ? '+' : '-';
      left -= 1;
      const b: Allele = left > 0 ? '+' : '-';
      left -= 1;
      g[id] = [a, b];
    }
  };
  fill(['size1', 'size2', 'size3'], t.size);
  fill(['bill1', 'bill2'], t.bill);
  fill(['vigor1', 'vigor2'], 4);
  fill(['temper1', 'temper2'], t.temper);
  g.billColor = [t.billColor, t.billColor];
  g.patternColor = [t.markings, t.markings];
  return g;
}

interface StandardMatch {
  key: string;
  pct: number; // 0..100
  slots: Array<{ label: string; score: number; want: string; have: string }>; // 10 judged slots, score 0..1
}

const BOOK: Array<{ id: LocusId; label: string }> = [
  { id: 'baseColor', label: 'colour' },
  { id: 'dilution', label: 'shade' },
  { id: 'pattern', label: 'pattern' },
  { id: 'crest', label: 'crest' },
];

function plusCount(g: Genome, ids: LocusId[]): number {
  let n = 0;
  for (const id of ids) for (const a of g[id]) if (a === '+') n += 1;
  return n;
}

function pairScore(have: [Allele, Allele], want: [Allele, Allele]): number {
  const h = [...have].sort().join('');
  const w = [...want].sort().join('');
  if (h === w) return 1;
  return have.some((a) => want.includes(a)) ? 0.5 : 0;
}

// How closely a duck matches a standard. Book loci and the two colour loci
// want the exact (homozygous) pair; additive traits are judged by count.
export function standardMatch(duck: Duck, key = breedKey(duck.genome)): StandardMatch {
  const std = breedStandard(key);
  const g = duck.genome;
  const slots: StandardMatch['slots'] = [];
  for (const { id, label } of BOOK) {
    slots.push({ label, score: pairScore(g[id], std[id]), want: std[id].join(''), have: g[id].join('') });
  }
  const sizeWant = plusCount(std, ['size1', 'size2', 'size3']);
  const sizeHave = plusCount(g, ['size1', 'size2', 'size3']);
  slots.push({ label: 'size', score: 1 - Math.abs(sizeWant - sizeHave) / 6, want: `${sizeWant}/6`, have: `${sizeHave}/6` });
  const billWant = plusCount(std, ['bill1', 'bill2']);
  const billHave = plusCount(g, ['bill1', 'bill2']);
  slots.push({ label: 'bill', score: 1 - Math.abs(billWant - billHave) / 4, want: `${billWant}/4`, have: `${billHave}/4` });
  const vig = plusCount(g, ['vigor1', 'vigor2']);
  slots.push({ label: 'vigor', score: vig / 4, want: '4/4', have: `${vig}/4` });
  const temperWant = plusCount(std, ['temper1', 'temper2']);
  const temperHave = plusCount(g, ['temper1', 'temper2']);
  slots.push({ label: 'temper', score: 1 - Math.abs(temperWant - temperHave) / 4, want: `${temperWant}/4`, have: `${temperHave}/4` });
  slots.push({ label: 'bill colour', score: pairScore(g.billColor, std.billColor), want: std.billColor.join(''), have: g.billColor.join('') });
  slots.push({ label: 'markings', score: pairScore(g.patternColor, std.patternColor), want: std.patternColor.join(''), have: g.patternColor.join('') });
  const pct = Math.round((slots.reduce((s, x) => s + x.score, 0) / slots.length) * 100);
  return { key, pct, slots };
}

export const STANDARD_THRESHOLD = 90;

// Human-readable build for the standard: "petite, long bill, pink bill".
export function describeStandard(key: string): string {
  const t = standardTargets(key);
  const parts: string[] = [];
  parts.push(t.size <= 2 ? 'petite' : t.size >= 4 ? 'grand' : 'mid-sized');
  parts.push(t.bill === 0 ? 'stubby bill' : t.bill === 4 ? 'long bill' : 'neat bill');
  parts.push(t.billColor === 'P' ? 'pink bill' : t.billColor === 'y' ? 'yellow bill' : 'orange bill');
  parts.push(t.markings === 'a' ? 'pale markings' : 'dark markings');
  parts.push('hardy');
  parts.push(t.temper === 0 ? 'timid' : t.temper === 4 ? 'bold' : 'steady');
  return parts.join(', ');
}
