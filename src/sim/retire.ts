// Retiring the pond: found the next one from a chosen pair. Split from
// heritage.ts (the rules: mutation and pond-slot bonuses) because this half
// needs createNewGame, and the economy asks heritage.ts for the pond bonus —
// together they were the last import cycle through the whole sim.
import type { GameState } from '../state';
import { createNewGame } from '../newGame';
import type { Rng } from '../rng';
import type { Duck } from './duck';
import { createDuck, dedupeName } from './duck';
import { chronicle } from './chronicle';
import { founderLineage } from './lineage';
import { recordBreed } from './breedBook';
import { WORLD_W } from '../state';

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
    cupWins: old.stats.cupWins,
    cupEntries: old.stats.cupEntries,
    studsUsed: old.stats.studsUsed,
  };
  // The rival ponds carry on regardless; so does an open Cup.
  s.rivals = old.rivals;
  s.cup = old.cup;
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
