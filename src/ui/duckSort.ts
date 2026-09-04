// Duck comparators shared by the Flock panel and the card rail, so the two
// lists agree on what "oldest" or "hungriest" means.
import type { Duck } from '../sim/duck';
import { pedigreeScore } from '../sim/pedigree';

// Oldest first, for real: ageTicks resets at each stage transition, so the
// life stage is the age — elders first, eggs last — with time-in-stage
// breaking ties inside a stage.
export const STAGE_AGE: Record<Duck['stage'], number> = { elder: 0, adult: 1, juvenile: 2, duckling: 3, egg: 4 };

export const byAge = (a: Duck, b: Duck): number => STAGE_AGE[a.stage] - STAGE_AGE[b.stage] || b.ageTicks - a.ageTicks;
export const byName = (a: Duck, b: Duck): number => a.name.localeCompare(b.name);
export const byHunger = (a: Duck, b: Duck): number => a.needs.hunger - b.needs.hunger;
export const byPedigree = (a: Duck, b: Duck): number => pedigreeScore(b) - pedigreeScore(a);
