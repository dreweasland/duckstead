// Duck comparators shared by the Flock panel and the card rail, so the two
// lists agree on what "oldest" or "hungriest" means.
import type { Duck } from '../sim/duck';
import type { IconName } from './icons';
import { pedigreeScore } from '../sim/pedigree';
import { championProgress, isChampion } from '../sim/line';

// Oldest first, for real: ageTicks resets at each stage transition, so the
// life stage is the age — elders first, eggs last — with time-in-stage
// breaking ties inside a stage.
export const STAGE_AGE: Record<Duck['stage'], number> = { elder: 0, adult: 1, juvenile: 2, duckling: 3, egg: 4 };

export const byAge = (a: Duck, b: Duck): number => STAGE_AGE[a.stage] - STAGE_AGE[b.stage] || b.ageTicks - a.ageTicks;
export const byName = (a: Duck, b: Duck): number => a.name.localeCompare(b.name);
export const byHunger = (a: Duck, b: Duck): number => a.needs.hunger - b.needs.hunger;
export const byPedigree = (a: Duck, b: Duck): number => pedigreeScore(b) - pedigreeScore(a);
// Champions first, then whoever is nearest the bar; pedigree breaks ties.
export const byChampion = (a: Duck, b: Duck): number =>
  Number(isChampion(b)) - Number(isChampion(a)) || championProgress(b) - championProgress(a) || byPedigree(a, b);

// The flock bar's sort order, cycled from the little control at its head
// and remembered between sessions (under the old rail's key, so a player's
// choice survives the rail's retirement).
export type FlockSort = 'age' | 'drakes' | 'hens' | 'hungry' | 'pedigree' | 'champion' | 'name';
export const FLOCK_SORTS: Array<{ id: FlockSort; label: string; icon: IconName }> = [
  { id: 'age', label: 'Oldest first', icon: 'list' },
  { id: 'drakes', label: 'Drakes first', icon: 'duck' },
  { id: 'hens', label: 'Hens first', icon: 'egg' },
  { id: 'hungry', label: 'Hungriest first', icon: 'wheat' },
  { id: 'pedigree', label: 'Best pedigree first', icon: 'star' },
  { id: 'champion', label: 'Closest to Champion first', icon: 'crown' },
  { id: 'name', label: 'By name', icon: 'book' },
];
const FLOCK_SORT_KEY = 'ducksim:ui:railSort';

export function loadFlockSort(): FlockSort {
  try {
    const v = localStorage.getItem(FLOCK_SORT_KEY) as FlockSort | null;
    return v && FLOCK_SORTS.some((s) => s.id === v) ? v : 'age';
  } catch {
    return 'age';
  }
}

export function saveFlockSort(sort: FlockSort): void {
  try {
    localStorage.setItem(FLOCK_SORT_KEY, sort);
  } catch {
    /* private mode */
  }
}

// Every order but "oldest" keeps the eggs at the end.
export function flockCompare(sort: FlockSort): (a: Duck, b: Duck) => number {
  const egg = (d: Duck) => (d.stage === 'egg' ? 1 : 0);
  const bySex = (first: 'M' | 'F') => (a: Duck, b: Duck) =>
    egg(a) - egg(b) || (a.sex === first ? 0 : 1) - (b.sex === first ? 0 : 1) || byAge(a, b);
  switch (sort) {
    case 'drakes':
      return bySex('M');
    case 'hens':
      return bySex('F');
    case 'hungry':
      return (a, b) => egg(a) - egg(b) || byHunger(a, b);
    case 'pedigree':
      return (a, b) => egg(a) - egg(b) || byPedigree(a, b);
    case 'champion':
      return (a, b) => egg(a) - egg(b) || byChampion(a, b);
    case 'name':
      return (a, b) => egg(a) - egg(b) || byName(a, b);
    case 'age':
    default:
      return byAge;
  }
}
