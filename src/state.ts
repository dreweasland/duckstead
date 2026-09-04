import type { Season, Vec2 } from './types';
import type { Duck } from './sim/duck';
import type { UpgradeId } from './sim/economy';
import type { GameClock } from './sim/time';
import type { PendingClutch } from './sim/breeding';

// The world height is fixed; the width adapts to the window's aspect ratio so
// the scene fills the screen with no letterboxing. ES-module live bindings let
// importers see updates to WORLD_W.
export const WORLD_H = 600;
// The grass starts just below the rolling horizon (drawn around y≈195–208).
// Ducks, pellets, and decorations live at or below this line.
export const GROUND_TOP = 225;
export let WORLD_W = 960;

// The hatched flock — the predicate everyone was inlining (a dead helper,
// isWaterfowlActive, once documented the same idea in duck.ts).
export function flock(state: GameState): Duck[] {
  return state.ducks.filter((d) => d.stage !== 'egg');
}

export function duckById(state: GameState, id: string | null | undefined): Duck | undefined {
  return id ? state.ducks.find((d) => d.id === id) : undefined;
}

// The garden of remembrance is dear, but unbounded it bloats every autosave
// and cloud push (each entry carries a full genome; at 16x ducks die
// continuously). Keep the newest MEMORIAL_CAP, but never evict the record
// holders the Book celebrates.
export const MEMORIAL_CAP = 80;

export function trimMemorial(memorial: DuckSummary[]): DuckSummary[] {
  if (memorial.length <= MEMORIAL_CAP) return memorial;
  const longest = memorial.reduce((best, m) => ((m.ageDays ?? 0) > (best.ageDays ?? -1) ? m : best));
  const most = memorial.reduce((best, m) => ((m.descendants ?? 0) > (best.descendants ?? 0) ? m : best));
  // The record holders, when they fall outside the newest entries, take a
  // slot each from the tail so the result never exceeds the cap.
  const keepers = [longest, most].filter((m, i, arr) => !memorial.slice(-MEMORIAL_CAP).includes(m) && arr.indexOf(m) === i);
  return [...keepers, ...memorial.slice(-(MEMORIAL_CAP - keepers.length))];
}

export function fitWorldToWindow(): void {
  const aspect = window.innerWidth / window.innerHeight;
  WORLD_W = Math.round(Math.min(2200, Math.max(700, WORLD_H * aspect)));
}

interface FoodPellet {
  id: number;
  pos: Vec2;
  premium: boolean; // legacy flag; `kind` is authoritative when present
  kind?: import('./sim/food').FoodKind;
  age?: number; // ticks since dropped; spoils when old (absent in old saves)
}

export type BugKind = 'beetle' | 'snail' | 'firefly' | 'feather' | 'duckweed' | 'henEgg' | 'frog' | 'dragonfly';

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
  drills: number; // training drills run
  marksEarned: number; // upbringing marks granted
  lifeEventsSettled: number; // life events the player answered
  studsUsed: number; // rival drakes hired
  cupEntries: number;
  cupWins: number;
}

// One place for the zero stats: a fresh game and a save missing a counter
// both read from here.
export function defaultStats(): GameStats {
  return {
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
    drills: 0,
    marksEarned: 0,
    lifeEventsSettled: 0,
    studsUsed: 0,
    cupEntries: 0,
    cupWins: 0,
  };
}

// The save format version this state shape corresponds to (save.ts owns the
// migration chain; it reads this so the two can't drift).
export const STATE_VERSION = 2;

export interface DuckSummary {
  name: string;
  sex: 'M' | 'F';
  bodyColor: string;
  // Stored at death so the memorial can draw a real portrait; older saves
  // fall back to a coloured feather.
  genome?: import('./sim/genetics').Genome;
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
  memorial: DuckSummary[]; // capped via trimMemorial — see below
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
  market: { day: number; buyers: import('./sim/festivals').MarketBuyer[]; sold: number; earned: number } | null;
  // The most recent festival's outcome, so the chip can reopen the standings.
  lastFestival: {
    day: number;
    kind: string;
    eggShow?: import('./sim/festivals').EggShowResult;
    race?: { heatPlace: number; finalPlace?: number; prize: number };
    winter?: import('./sim/festivals').CeremonyReward;
  } | null;
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
  // The one open life event (a broody hen, a drake rivalry), if any.
  lifeEvent: import('./sim/lifeEvents').LifeEvent | null;
  nextLifeEventId: number;
  // The rival ponds and the year's Society Cup (see rivals.ts, cup.ts).
  rivals: import('./sim/rivals').Rival[];
  cup: import('./sim/cup').CupState | null;
  // Coins drills have paid today (capped — see BALANCE.drillCoinsDailyCap).
  drillPurse: { day: number; earned: number };
  // Today's weather (see weather.ts); rolled at dawn.
  weather: import('./sim/weather').Weather;
}
