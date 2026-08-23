import type { Season, Vec2 } from './types';
import type { Duck } from './sim/duck';
import { createStarterDuck, DUCK_NAMES, freshName } from './sim/duck';
import { recordBreed } from './sim/breedBook';
import type { UpgradeId } from './sim/economy';
import { BALANCE } from './sim/economy';
import type { GameClock } from './sim/time';
import type { PendingClutch } from './sim/breeding';
import { createRng, type Rng } from './rng';

// The world height is fixed; the width adapts to the window's aspect ratio so
// the scene fills the screen with no letterboxing. ES-module live bindings let
// importers see updates to WORLD_W.
export const WORLD_H = 600;
// The grass starts just below the rolling horizon (drawn around y≈195–208).
// Ducks, pellets, and decorations live at or below this line.
export const GROUND_TOP = 225;
export let WORLD_W = 960;

export function fitWorldToWindow(): void {
  const aspect = window.innerWidth / window.innerHeight;
  WORLD_W = Math.round(Math.min(2200, Math.max(700, WORLD_H * aspect)));
}

export interface FoodPellet {
  id: number;
  pos: Vec2;
  premium: boolean; // legacy flag; `kind` is authoritative when present
  kind?: import('./sim/food').FoodKind;
  age?: number; // ticks since dropped; spoils when old (absent in old saves)
}

export type BugKind = 'beetle' | 'snail' | 'firefly' | 'feather' | 'duckweed' | 'henEgg';

export interface Bug {
  id: number;
  kind: BugKind;
  pos: Vec2;
  heading: number;
  ageTicks: number;
  color?: string; // feathers: the molting duck's plumage color
  source?: string; // feathers: who dropped it
}

export interface GameStats {
  eggsSold: number;
  ducksSold: number;
  ducksBred: number;
  ducksHatched: number;
  pets: number;
  clutchesStarted: number;
  juvenilesRaised: number;
  bugsCaught: number;
  racesWon: number;
  wildVisits: number;
  eggsTucked: number;
  feathersCollected: number;
  duckweedGathered: number;
  henEggsGathered: number;
  henEggsSold: number;
  feeds: number;
  favouritesFound: number;
  wildRecruited: number;
  biggestSale: number;
  bestPedigree: number;
  deepestGen: number;
  festivalWins: number;
}

export interface DuckSummary {
  name: string;
  sex: 'M' | 'F';
  bodyColor: string;
  diedOnDay: number;
  rarityScore: number;
  diedStage?: string;
  ageDays?: number;
  gen?: number;
  pedigree?: number;
  descendants?: number;
}

export interface GameState {
  version: number;
  rngState: number;
  clock: GameClock;
  seasonCache: Season;
  money: number;
  ducks: Duck[];
  memorial: DuckSummary[];
  chronicle: import('./sim/chronicle').ChronicleEntry[];
  // Breed Book award tiers earned, by breed key.
  awards: Record<string, import('./sim/awards').BreedAwards>;
  society: {
    rank: number;
    points: number;
    lifetimePoints: number;
    unlockedStyles: string[];
    style: Partial<Record<import('./sim/society').StyleSlot, string>>;
    perks: import('./sim/society').PerkId[];
  };
  commissions: import('./sim/commissions').Commission[];
  // Festival reputation: wins per festival raise next year's tier (and purse).
  festivalWins: Record<string, number>;
  league: { tier: number; wins: number; losses: number };
  // A Winter Lights wish: the next wild visitor arrives tomorrow, bearing more.
  visitorLure: boolean;
  // Times the pond has been retired and refounded (Heritage).
  heritage: number;
  // Festivals sponsored this year (kind → true); consumed when the festival runs.
  sponsored: Record<string, boolean>;
  // Market Day's buyer queue, kept so the stall can be closed and reopened.
  market: { day: number; buyers: import('./sim/festivals').MarketBuyer[] } | null;
  nextCommissionId: number;
  commissionsDone: number;
  foodPellets: FoodPellet[];
  nextPelletId: number;
  pendingClutches: PendingClutch[];
  upgrades: Partial<Record<UpgradeId, number>>;
  // `eggs` is the basket of unfertilised hen eggs gathered from the grass.
  inventory: { feed: number; premiumFeed: number; peas: number; worms: number; berries: number; medicine: number; eggs: number };
  pond: { cleanliness: number };
  feeder: { food: number };
  bugs: Bug[];
  nextBugId: number;
  // Plumage colors collected as molted feathers → count.
  featherAlbum: Record<string, number>;
  goals: Record<string, boolean>;
  breedBook: Record<string, import('./sim/breedBook').BreedEntry>;
  request: import('./sim/visitors').BuyerRequest | null;
  visitor: import('./sim/visitors').WildVisitor | null;
  festivalDone: Record<string, number>;
  decorations: Array<{ kind: import('./sim/economy').DecorKind; pos: Vec2 }>;
  stats: GameStats;
}

// The RNG is re-created from serialized state each tick boundary; Game owns a
// live Rng and writes its state back into GameState so saves stay deterministic.
export function createNewGame(seed: number): { state: GameState; rng: Rng } {
  const rng = createRng(seed);
  const state: GameState = {
    version: 1,
    rngState: seed,
    clock: { totalTicks: 7 * 600 }, // start at 07:00, day 1 of spring
    seasonCache: 'spring',
    money: BALANCE.startingMoney,
    ducks: [],
    memorial: [],
    chronicle: [],
    awards: {},
    society: { rank: 0, points: 0, lifetimePoints: 0, unlockedStyles: [], style: {}, perks: [] },
    commissions: [],
    festivalWins: {},
    league: { tier: 0, wins: 0, losses: 0 },
    visitorLure: false,
    heritage: 0,
    sponsored: {},
    market: null,
    nextCommissionId: 1,
    commissionsDone: 0,
    foodPellets: [],
    nextPelletId: 1,
    pendingClutches: [],
    upgrades: {},
    inventory: { feed: 10, premiumFeed: 3, peas: 5, worms: 0, berries: 0, medicine: 1, eggs: 0 },
    pond: { cleanliness: 100 },
    feeder: { food: 0 },
    bugs: [],
    nextBugId: 1,
    featherAlbum: {},
    goals: {},
    breedBook: {},
    request: null,
    visitor: null,
    festivalDone: {},
    decorations: [],
    stats: {
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
    },
  };

  // Starter flock: two pairs so breeding is possible from minute one.
  const cx = WORLD_W / 2;
  const spots: Vec2[] = [
    { x: cx - 100, y: 380 },
    { x: cx + 80, y: 400 },
    { x: cx - 20, y: 330 },
    { x: cx + 40, y: 440 },
  ];
  const sexes: Array<'M' | 'F'> = ['M', 'F', 'M', 'F'];
  for (let i = 0; i < 4; i += 1) {
    const duck = createStarterDuck(rng, spots[i], sexes[i]);
    duck.name = freshName(rng, state.ducks.map((d) => d.name), DUCK_NAMES);
    duck.bornDay = 0;
    state.ducks.push(duck);
    recordBreed(state, duck, true); // starters seed the book quietly
  }
  state.rngState = rng.getState();
  return { state, rng };
}
