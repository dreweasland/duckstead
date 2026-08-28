// Heritage: retire the pond and start again with one founder pair, keeping
// the Breed Book, awards, Society standing, chronicle, and records. Each
// retirement adds a permanent heritage bonus: more mutation (novel genes),
// an extra pond slot, and a better-stocked start. The early game is quick
// now, so the re-climb is short and the payoff is a stronger line.
import type { GameState } from '../state';
import { createNewGame } from '../state';
import type { Rng } from '../rng';
import type { Duck } from './duck';
import { createDuck, dedupeName } from './duck';
import { chronicle } from './chronicle';
import { founderLineage } from './lineage';
import { recordBreed } from './breedBook';
import { WORLD_W } from '../state';

export const HERITAGE_MUTATION_BONUS = 0.01; // +1% mutation per retirement (base 2%)
export const HERITAGE_MAX = 5;

export function heritageMutationRate(heritage: number, base: number): number {
  return base + Math.min(HERITAGE_MAX, heritage) * HERITAGE_MUTATION_BONUS;
}

// Extra pond capacity earned by retiring: +1 duck slot per heritage, up to 5.
export function heritagePondBonus(state: GameState): number {
  return Math.min(HERITAGE_MAX, state.heritage);
}

export function canRetire(state: GameState): { ok: boolean; reason?: string } {
  const adults = state.ducks.filter((d) => d.stage === 'adult' || d.stage === 'elder');
  if (!adults.some((d) => d.sex === 'M') || !adults.some((d) => d.sex === 'F')) {
    return { ok: false, reason: 'Choose a drake and a hen to found the next pond' };
  }
  if (Object.keys(state.breedBook).length < 10) {
    return { ok: false, reason: 'The Book needs 10 breeds before the Society will register a heritage pond' };
  }
  return { ok: true };
}

// Build the successor pond. Returns the new state + rng; the caller swaps it in.
export function retirePond(old: GameState, drakeId: string, henId: string, seed: number): { state: GameState; rng: Rng } | null {
  // The panel's Retire button re-validates only on its 500ms refresh, so a
  // founder that died or was sold in that window can still be submitted.
  const drake = old.ducks.find((d) => d.id === drakeId);
  const hen = old.ducks.find((d) => d.id === henId);
  if (!drake || !hen) return null;
  const fresh = createNewGame(seed);
  const s = fresh.state;
  const rng = fresh.rng;
  const heritage = old.heritage + 1;

  // Carry the legacy.
  s.heritage = heritage;
  s.breedBook = old.breedBook;
  s.awards = old.awards;
  s.society = old.society;
  s.chronicle = old.chronicle;
  s.featherAlbum = old.featherAlbum;
  s.festivalWins = old.festivalWins;
  s.stats = {
    ...s.stats,
    // Lifetime records survive; per-pond counters restart.
    biggestSale: old.stats.biggestSale,
    bestPedigree: old.stats.bestPedigree,
    deepestGen: old.stats.deepestGen,
    festivalWins: old.stats.festivalWins,
    wildRecruited: old.stats.wildRecruited,
    racesWon: old.stats.racesWon,
    favouritesFound: old.stats.favouritesFound,
  };
  // Goals and unlocks: a heritage pond knows the ropes.
  s.goals = old.goals;
  s.money = 50 + heritage * 100;
  s.inventory.premiumFeed += heritage * 2;

  // The founder pair, carried over whole (genes, names), as gen 0 founders.
  s.ducks = [];
  const spots = [{ x: WORLD_W / 2 - 60, y: 380 }, { x: WORLD_W / 2 + 60, y: 400 }];
  for (const [i, src] of [drake, hen].entries()) {
    const duck: Duck = createDuck(rng, { genome: src.genome, stage: 'adult', pos: spots[i], sex: src.sex, name: src.name });
    duck.name = dedupeName(duck.name, s.ducks.map((d) => d.name));
    duck.bornDay = 0;
    duck.favouriteKnown = src.favouriteKnown;
    duck.lineage = founderLineage();
    s.ducks.push(duck);
    recordBreed(s, duck, true);
  }
  chronicle(
    s,
    'milestone',
    `The old pond was retired. ${drake.name} and ${hen.name} founded a new one — heritage ${heritage}.`,
  );
  return { state: s, rng };
}
