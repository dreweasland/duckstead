// The Breed Book: a collection log of every phenotype combination ("breed")
// ever hatched on this pond. Keys cover expressed base color, dilution,
// pattern, and crest — 60 collectible combos. Bill color and polygenic
// traits are deliberately excluded so the collection is finishable.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { expressedAlleles, type Genome, LOCI } from './genetics';
import { dayOf } from './time';
import { events } from '../events';
import { chronicle } from './chronicle';
import { addSocietyPoints } from './society';

export interface BreedEntry {
  firstName: string;
  day: number;
  count: number;
}

const COLOR_KEYS = ['M', 'W', 'k', 'B', 'B+M'] as const;
const COLOR_NAMES: Record<string, string> = {
  M: 'Mallard',
  W: 'White',
  k: 'Black',
  B: 'Blue',
  'B+M': 'Blue-Mallard',
};
const PATTERNS = ['solid', 'spotted', 'capped'] as const;

export function breedKey(genome: Genome): string {
  const color = [...expressedAlleles(genome, 'baseColor')].sort().join('+');
  const diluted = expressedAlleles(genome, 'dilution')[0] === 'd' ? 'd' : 'D';
  const patternAllele = expressedAlleles(genome, 'pattern')[0];
  const pattern = patternAllele === 'S' ? 'solid' : patternAllele === 'p' ? 'spotted' : 'capped';
  const crested = genome.crest[0] === 'R' && genome.crest[1] === 'R' ? 'c' : 'n';
  return `${color}|${diluted}|${pattern}|${crested}`;
}

export function breedLabel(key: string): string {
  const [color, dilution, pattern, crest] = key.split('|');
  const parts: string[] = [];
  if (dilution === 'd') parts.push('Dilute');
  if (pattern !== 'solid') parts.push(pattern === 'spotted' ? 'Spotted' : 'Capped');
  parts.push(COLOR_NAMES[color] ?? color);
  let label = parts.join(' ');
  if (crest === 'c') label += ', Crested';
  return label;
}

// All 60 collectible keys, grouped by color for a tidy book layout.
export const ALL_BREED_KEYS: string[] = COLOR_KEYS.flatMap((color) =>
  ['D', 'd'].flatMap((dilution) =>
    PATTERNS.flatMap((pattern) => ['n', 'c'].map((crest) => `${color}|${dilution}|${pattern}|${crest}`)),
  ),
);

// A homozygous genome that expresses exactly this breed key — used to render
// the book's representative portraits.
export function representativeGenome(key: string): Genome {
  const [color, dilution, pattern, crest] = key.split('|');
  const genome = {} as Genome;
  for (const def of LOCI) {
    // Neutral defaults; additive loci get a mixed pair for mid-range traits.
    genome[def.id] = def.kind === 'additive' ? ['+', '-'] : [def.alleles[0], def.alleles[0]];
  }
  genome.baseColor = color === 'B+M' ? ['B', 'M'] : [color, color];
  genome.dilution = dilution === 'd' ? ['d', 'd'] : ['D', 'D'];
  genome.pattern =
    pattern === 'solid' ? ['S', 'S'] : pattern === 'spotted' ? ['p', 'p'] : ['c', 'c'];
  genome.patternColor = ['A', 'A'];
  genome.billColor = ['O', 'O'];
  genome.crest = crest === 'c' ? ['R', 'R'] : ['n', 'n'];
  return genome;
}

// Record a duck in the book. First-ever sighting of a breed pays a discovery
// reward (unless silent, used for save backfills).
export function recordBreed(state: GameState, duck: Duck, silent = false): boolean {
  const key = breedKey(duck.genome);
  const entry = state.breedBook[key];
  if (entry) {
    entry.count += 1;
    return false;
  }
  state.breedBook[key] = { firstName: duck.name, day: dayOf(state.clock), count: 1 };
  if (!silent) {
    const reward = 10 + duck.phenotype.rarityScore * 3;
    state.money += reward;
    events.emit('toast', `New breed discovered: ${breedLabel(key)}! (+${reward} coins)`);
    addSocietyPoints(state, 1 + Math.floor(duck.phenotype.rarityScore / 3));
    const n = Object.keys(state.breedBook).length;
    chronicle(state, 'breed', `${duck.name} hatched — the pond's first ${breedLabel(key)} (${n}/${ALL_BREED_KEYS.length} breeds).`);
    if (n === ALL_BREED_KEYS.length) chronicle(state, 'milestone', 'Every breed in the Book has hatched on this pond.');
  }
  return true;
}

export function breedsDiscovered(state: GameState): number {
  return Object.keys(state.breedBook).length;
}
