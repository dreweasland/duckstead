import type { GameState, GameStats } from '../state';
import { GROUND_TOP, WORLD_H, WORLD_W } from '../state';
import { computePhenotype } from '../sim/genetics';
import { recordBreed } from '../sim/breedBook';
import { nestPos } from '../sim/pond';
import { clamp } from '../types';

export const SAVE_KEY = 'ducksim:save:v1';
export const SAVE_VERSION = 1;
// Where an unreadable save blob is stashed before a fresh pond may begin —
// a corrupt save must never be silently autosaved over.
export const CORRUPT_KEY = 'ducksim:save:corrupt';
// Which browser tab currently owns the save. Only the owner may write —
// otherwise two open tabs silently clobber each other's autosaves.
export const OWNER_KEY = 'ducksim:owner';

interface SaveEnvelope {
  version: number;
  savedAt: number;
  state: GameState;
}

export function serialize(state: GameState): string {
  const envelope: SaveEnvelope = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    state,
  };
  return JSON.stringify(envelope);
}

export function deserialize(json: string): GameState {
  const envelope = JSON.parse(json) as SaveEnvelope;
  const state = migrate(envelope);
  // Recompute derived caches, pull ducks saved under a different window
  // aspect back inside the current world, and reset interpolation state.
  const nest = nestPos();
  for (const duck of state.ducks) {
    duck.phenotype = computePhenotype(duck.genome);
    duck.pos.x = clamp(duck.pos.x, 20, WORLD_W - 20);
    if (duck.stage !== 'egg') duck.pos.y = clamp(duck.pos.y, GROUND_TOP, WORLD_H - 20);
    // Old-save eggs lack a nest offset; derive one (clamped onto the nest)
    // so eggs stranded by past window-width changes snap back where they belong.
    if (duck.stage === 'egg' && !duck.nestOffset) {
      duck.nestOffset = {
        x: clamp(duck.pos.x - nest.x, -30, 30),
        y: clamp(duck.pos.y - nest.y, -15, 15),
      };
      duck.pos = { x: nest.x + duck.nestOffset.x, y: nest.y + duck.nestOffset.y };
    }
    duck.prevPos = { ...duck.pos };
  }
  // Saves from before the feeder/goals/bugs existed lack those fields.
  // Container objects first — the member backfills below dereference them.
  state.upgrades ??= {};
  state.inventory ??= { feed: 0, premiumFeed: 0, peas: 0, worms: 0, berries: 0, medicine: 0, eggs: 0 };
  state.foodPellets ??= [];
  state.memorial ??= [];
  state.pendingClutches ??= [];
  state.pond ??= { cleanliness: 100 };
  state.feeder ??= { food: 0 };
  // The trough became a purchasable upgrade; players who were already using
  // one keep it rather than having it repossessed.
  if (state.feeder.food > 0 && !state.upgrades.feedingTrough) {
    state.upgrades.feedingTrough = 1;
  }
  state.bugs ??= [];
  state.nextBugId ??= 1;
  state.featherAlbum ??= {};
  state.chronicle ??= [];
  state.awards ??= {};
  state.society ??= { rank: 0, points: 0, lifetimePoints: 0, unlockedStyles: [], style: {}, perks: [] };
  state.society.unlockedStyles ??= [];
  state.society.style ??= {};
  state.society.perks ??= [];
  // The rank-10 perk was renamed when it moved from nest to pond capacity.
  state.society.perks = state.society.perks.map((p) => ((p as string) === 'nestSlot' ? 'pondSlot' : p));
  state.commissions ??= [];
  state.festivalWins ??= {};
  state.league ??= { tier: 0, wins: 0, losses: 0 };
  state.visitorLure ??= false;
  state.heritage ??= 0;
  state.sponsored ??= {};
  state.market ??= null;
  if (state.market) {
    state.market.sold ??= 0;
    state.market.earned ??= 0;
  }
  state.lastFestival ??= null;
  state.nextCommissionId ??= 1;
  state.commissionsDone ??= 0;
  state.inventory.eggs ??= 0;
  state.inventory.peas ??= 0;
  state.inventory.worms ??= 0;
  state.inventory.berries ??= 0;
  state.goals ??= {};
  // Backfill the breed book from the living flock, but only on the first
  // migration — re-running on every load would inflate the counts.
  if (state.breedBook === undefined) {
    state.breedBook = {};
    for (const duck of state.ducks) {
      if (duck.stage !== 'egg') recordBreed(state, duck, true);
    }
  }
  const statDefaults: GameStats = {
    eggsSold: 0,
    ducksSold: 0,
    ducksBred: 0,
    ducksHatched: 0,
    pets: 0,
    clutchesStarted: 0,
    juvenilesRaised: 0,
    bugsCaught: 0,
    racesWon: 0,
    wildVisits: 0,
    eggsTucked: 0,
    feathersCollected: 0,
    duckweedGathered: 0,
    henEggsGathered: 0,
    henEggsSold: 0,
    feeds: 0,
    favouritesFound: 0,
    wildRecruited: 0,
    biggestSale: 0,
    bestPedigree: 0,
    deepestGen: 0,
    festivalWins: 0,
  };
  state.stats = { ...statDefaults, ...(state.stats as Partial<GameStats>) };
  state.request ??= null;
  state.visitor ??= null;
  state.festivalDone ??= {};
  state.decorations ??= [];
  if (state.visitor) {
    state.visitor.duck.phenotype = computePhenotype(state.visitor.duck.genome);
    state.visitor.duck.prevPos = { ...state.visitor.duck.pos };
  }
  // Pull any stray pellets (e.g. dropped in the sky by an older build) back
  // into reach so they can't strand the flock against a world edge.
  for (const pellet of state.foodPellets) {
    pellet.pos.x = clamp(pellet.pos.x, 30, WORLD_W - 30);
    pellet.pos.y = clamp(pellet.pos.y, GROUND_TOP, WORLD_H - 25);
  }
  return state;
}

function migrate(envelope: SaveEnvelope): GameState {
  const state = envelope?.state;
  switch (envelope?.version) {
    case 1:
      // Minimal shape guard: without a flock and a clock this isn't a save,
      // and the backfills below would half-mutate it before crashing.
      if (!state || !Array.isArray(state.ducks) || typeof state.clock?.totalTicks !== 'number') {
        throw new Error('Save blob is not a recognizable game state');
      }
      return state;
    default:
      throw new Error(`Unknown save version ${envelope?.version}`);
  }
}

// Returns false when the write failed (storage full, private mode) so the
// caller can tell the player instead of reporting a save that never landed.
export function saveToStorage(state: GameState): boolean {
  try {
    localStorage.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

export type LoadedSave =
  | { kind: 'loaded'; state: GameState }
  | { kind: 'empty' }
  // Unreadable: the raw blob has been copied to CORRUPT_KEY, so the fresh
  // pond that replaces it can autosave without destroying the original.
  | { kind: 'corrupt' };

export function loadFromStorage(): LoadedSave {
  let json: string | null = null;
  try {
    json = localStorage.getItem(SAVE_KEY);
  } catch {
    return { kind: 'empty' }; // storage unavailable: writes would fail too
  }
  if (!json) return { kind: 'empty' };
  try {
    return { kind: 'loaded', state: deserialize(json) };
  } catch {
    try {
      localStorage.setItem(CORRUPT_KEY, json);
    } catch {
      // Quota exhausted: the stash failed — but then the autosave that would
      // clobber SAVE_KEY will fail for the same reason, so the blob survives.
    }
    return { kind: 'corrupt' };
  }
}

export function clearStorage(): void {
  localStorage.removeItem(SAVE_KEY);
}
