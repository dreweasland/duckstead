// The Breeding Advisor: decision support for keep-vs-sell. For any duck it
// answers: which undiscovered Breed Book entries could this duck help unlock
// with the current flock, which alleles would leave the pond forever if it
// were sold, and is it genetically redundant?
import type { GameState } from '../state';
import type { Duck } from './duck';
import { breedKey, breedLabel, representativeGenome } from './breedBook';
import { standardMatch } from './standards';
import type { Allele, Genome, LocusId } from './genetics';

// The loci that define a Breed Book entry.
const BOOK_LOCI: LocusId[] = ['baseColor', 'dilution', 'pattern', 'crest'];

// Every breed key a pairing could produce (mutation excluded — it's a bonus,
// not a plan). Exact enumeration: ≤4 child genotypes per locus, 4 loci.
export function childBreedKeys(a: Genome, b: Genome): Set<string> {
  const keys = new Set<string>();
  const child: Genome = { ...representativeGenome('M|D|solid|n') };
  const options = BOOK_LOCI.map((id) => {
    const pairs: Array<[Allele, Allele]> = [];
    for (const x of a[id]) for (const y of b[id]) pairs.push([x, y]);
    return pairs;
  });
  const walk = (i: number): void => {
    if (i === BOOK_LOCI.length) {
      keys.add(breedKey(child));
      return;
    }
    for (const pair of options[i]) {
      child[BOOK_LOCI[i]] = pair;
      walk(i + 1);
    }
  };
  walk(0);
  return keys;
}

// Alleles worth tracking as "would be lost if this duck leaves".
const WATCHED_ALLELES: Array<{ locus: LocusId; allele: Allele; name: string }> = [
  { locus: 'baseColor', allele: 'W', name: 'white' },
  { locus: 'baseColor', allele: 'k', name: 'black' },
  { locus: 'baseColor', allele: 'B', name: 'blue' },
  { locus: 'dilution', allele: 'd', name: 'pastel' },
  { locus: 'pattern', allele: 'p', name: 'spotted' },
  { locus: 'pattern', allele: 'c', name: 'capped' },
  { locus: 'crest', allele: 'R', name: 'crest' },
  { locus: 'billColor', allele: 'P', name: 'pink bill' },
];

export interface BreedingValue {
  // Undiscovered breed keys reachable by pairing this duck within the flock.
  newBreeds: string[];
  // Of those, the ones nobody else on the pond could reach without this duck —
  // the real measure of what selling it would cost.
  marginalBreeds: string[];
  // Genes only this duck carries in the whole flock.
  uniqueAlleles: string[];
  // Another living duck has identical genes at every book locus.
  duplicated: boolean;
  // Closest to its breed's show standard of all ducks of that breed.
  bestOfBreed: boolean;
  standardPct: number;
  // How many other ducks could do everything this one can (same-sex cover).
  coveredBy: number;
}

// --- Caches ---------------------------------------------------------------
// Genomes never change after creation, so a pair's reachable keys are cached
// by id forever (bounded: cleared when it grows past a few thousand pairs).
const pairCache = new Map<string, Set<string>>();
function pairKeys(a: Duck, b: Duck): Set<string> {
  const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
  let v = pairCache.get(k);
  if (!v) {
    if (pairCache.size > 4000) pairCache.clear();
    v = childBreedKeys(a.genome, b.genome);
    pairCache.set(k, v);
  }
  return v;
}
const standardCache = new Map<string, number>();
function standardPctOf(d: Duck, key: string): number {
  const k = `${d.id}|${key}`;
  let v = standardCache.get(k);
  if (v === undefined) {
    if (standardCache.size > 4000) standardCache.clear();
    v = standardMatch(d, key).pct;
    standardCache.set(k, v);
  }
  return v;
}

// The whole flock's values are computed together (one pass over all pairs)
// and memoised on a flock signature, so the Flock panel's twenty cards and
// filter counts cost one evaluation per refresh, not hundreds.
let flockSig = '';
let flockValues = new Map<string, BreedingValue>();

function flockSignature(state: GameState): string {
  let s = `${Object.keys(state.breedBook).length}:`;
  for (const d of state.ducks) if (d.stage !== 'egg') s += `${d.id}${d.stage[0]},`;
  return s;
}

function computeFlockValues(state: GameState): Map<string, BreedingValue> {
  const flock = state.ducks.filter((d) => d.stage !== 'egg');
  // Elders are past breeding: they reach no new breeds, their genes can't be
  // passed on (so they neither hold nor lose "key" status), and they don't
  // cover anyone. They still compete for best-of-breed — genes are genes.
  const breeders = flock.filter((d) => d.stage !== 'elder');
  const discovered = new Set(Object.keys(state.breedBook));
  const males = breeders.filter((d) => d.sex === 'M');
  const females = breeders.filter((d) => d.sex === 'F');

  // Undiscovered reach per duck (elders keep an empty set).
  const reach = new Map<string, Set<string>>();
  for (const d of flock) reach.set(d.id, new Set());
  for (const m of males) {
    for (const f of females) {
      for (const key of pairKeys(m, f)) {
        if (discovered.has(key)) continue;
        reach.get(m.id)!.add(key);
        reach.get(f.id)!.add(key);
      }
    }
  }

  // Best-of-breed per breed key.
  const bestPct = new Map<string, number>();
  const myKeyOf = new Map<string, string>();
  for (const d of flock) {
    const key = breedKey(d.genome);
    myKeyOf.set(d.id, key);
    const pct = standardPctOf(d, key);
    if (pct > (bestPct.get(key) ?? -1)) bestPct.set(key, pct);
  }

  const signature = (d: Duck) => BOOK_LOCI.map((id) => [...d.genome[id]].sort().join('')).join('|');
  const sigCount = new Map<string, number>();
  for (const d of flock) sigCount.set(signature(d), (sigCount.get(signature(d)) ?? 0) + 1);

  const out = new Map<string, BreedingValue>();
  for (const duck of flock) {
    const mine = reach.get(duck.id)!;
    const sameSex = breeders.filter((d) => d.sex === duck.sex && d.id !== duck.id);
    const others = new Set<string>();
    let coveredBy = 0;
    for (const a of sameSex) {
      const r = reach.get(a.id)!;
      for (const k of r) others.add(k);
      let covers = true;
      for (const k of mine) if (!r.has(k)) { covers = false; break; }
      if (covers) coveredBy += 1;
    }
    const marginalBreeds = [...mine].filter((k) => !others.has(k));
    const myKey = myKeyOf.get(duck.id)!;
    const standardPct = standardPctOf(duck, myKey);
    // Best of breed: strictly the top (ties don't count, so twins aren't both "best").
    // Genes are genes: a duckling with the best match is best of breed even
    // before its colours show.
    const tiedOrBetter = flock.filter((d) => d.id !== duck.id && myKeyOf.get(d.id) === myKey && standardPctOf(d, myKey) >= standardPct).length;
    const bestOfBreed = tiedOrBetter === 0;

    const uniqueAlleles: string[] = [];
    if (duck.stage !== 'elder') {
      for (const watch of WATCHED_ALLELES) {
        if (!duck.genome[watch.locus].includes(watch.allele)) continue;
        // Only breedable carriers preserve a gene — an elder holding the
        // last copy has already lost it to the flock's future.
        const anyoneElse = breeders.some((d) => d.id !== duck.id && d.genome[watch.locus].includes(watch.allele));
        if (!anyoneElse) uniqueAlleles.push(watch.name);
      }
    }
    const duplicated = (sigCount.get(signature(duck)) ?? 0) > 1;
    out.set(duck.id, { newBreeds: [...mine], marginalBreeds, uniqueAlleles, duplicated, bestOfBreed, standardPct, coveredBy });
  }
  return out;
}

export function breedingValue(state: GameState, duck: Duck): BreedingValue {
  const sig = flockSignature(state);
  if (sig !== flockSig) {
    flockValues = computeFlockValues(state);
    flockSig = sig;
  }
  const v = flockValues.get(duck.id);
  if (v) return v;
  // Not in the flock (an egg, or a duck from another state): compute alone.
  return {
    newBreeds: [],
    marginalBreeds: [],
    uniqueAlleles: [],
    duplicated: false,
    bestOfBreed: false,
    standardPct: standardMatch(duck, breedKey(duck.genome)).pct,
    coveredBy: 0,
  };
}

export type KeepVerdict = 'key' | 'useful' | 'covered';

// The headline: is this duck worth keeping for the breeding project?
//   key     — the only carrier of a rare gene on the pond: selling loses it
//   useful  — reaches undiscovered breeds nobody else can, or is the best of
//             its breed toward the show standard
//   covered — everything it can do, another duck can do too
export function keepVerdict(value: BreedingValue): KeepVerdict {
  if (value.uniqueAlleles.length > 0) return 'key';
  if (value.marginalBreeds.length > 0 || (value.bestOfBreed && value.standardPct >= 50)) return 'useful';
  return 'covered';
}

// One line explaining the verdict.
export function verdictReason(value: BreedingValue): string {
  if (value.uniqueAlleles.length > 0) return `Only carrier of ${value.uniqueAlleles.join(', ')} — selling loses the gene.`;
  if (value.marginalBreeds.length > 0) {
    return `Reaches ${value.marginalBreeds.length} undiscovered breed${value.marginalBreeds.length === 1 ? '' : 's'} no other duck can: ${value.marginalBreeds.slice(0, 3).map(breedLabel).join(', ')}${value.marginalBreeds.length > 3 ? '…' : ''}.`;
  }
  if (value.bestOfBreed && value.standardPct >= 50) return `Best of its breed — ${value.standardPct}% to the show standard.`;
  if (value.duplicated) return 'Another duck carries identical Book genes.';
  if (value.coveredBy > 0) return `${value.coveredBy} other duck${value.coveredBy === 1 ? '' : 's'} can reach everything this one can.`;
  return 'No undiscovered breeds in reach with the current flock.';
}
