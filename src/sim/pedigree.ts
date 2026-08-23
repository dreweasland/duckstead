// Pedigree: one comparable number per duck. Generations of breeding on this
// pond, fixed (homozygous) Book genes, rare alleles, and pure breeding all
// add up; it feeds prices, sorting, and — later — standards and awards.
import type { Duck } from './duck';
import type { LocusId } from './genetics';
import { breedKey } from './breedBook';
import { generationOf } from './lineage';

const BOOK_LOCI: LocusId[] = ['baseColor', 'dilution', 'pattern', 'crest'];

export interface PedigreeBreakdown {
  score: number;
  gen: number; // capped contribution
  fixed: number; // homozygous Book loci (0–4)
  rare: number; // rare alleles carried (B, P, R), capped at 4
  pure: boolean; // both parents share this duck's breed
}

export const PEDIGREE_MAX = 15;

export function homozygousBookLoci(duck: Duck): number {
  let n = 0;
  for (const id of BOOK_LOCI) if (duck.genome[id][0] === duck.genome[id][1]) n += 1;
  return n;
}

export function rareAlleleCount(duck: Duck): number {
  let n = 0;
  for (const a of duck.genome.baseColor) if (a === 'B') n += 1;
  for (const a of duck.genome.billColor) if (a === 'P') n += 1;
  for (const a of duck.genome.crest) if (a === 'R') n += 1;
  return Math.min(4, n);
}

export function isPureBred(duck: Duck): boolean {
  const l = duck.lineage;
  if (!l?.sire || !l.dam) return false;
  const key = breedKey(duck.genome);
  return breedKey(l.sire.genome) === key && breedKey(l.dam.genome) === key;
}

export function pedigree(duck: Duck): PedigreeBreakdown {
  const gen = Math.min(6, generationOf(duck));
  const fixed = homozygousBookLoci(duck);
  const rare = rareAlleleCount(duck);
  const pure = isPureBred(duck);
  return { score: gen + fixed + rare + (pure ? 1 : 0), gen, fixed, rare, pure };
}

export function pedigreeScore(duck: Duck): number {
  return pedigree(duck).score;
}
