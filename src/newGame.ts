// A fresh pond. Lives apart from state.ts so that file stays a leaf of
// types and constants: createNewGame pulls in the rivals, the breed book,
// and the economy, and every sim module imports state.ts for its types —
// keeping the two together made state.ts the hub of most import cycles.
import type { Vec2 } from './types';
import { createStarterDuck, DUCK_NAMES, freshName } from './sim/duck';
import { recordBreed } from './sim/breedBook';
import { BALANCE } from './sim/economy';
import { createRng, type Rng } from './rng';
import { createRivals } from './sim/rivals';
import { defaultStats, STATE_VERSION, WORLD_W, type GameState } from './state';

// The RNG is re-created from serialized state each tick boundary; Game owns a
// live Rng and writes its state back into GameState so saves stay deterministic.
export function createNewGame(seed: number): { state: GameState; rng: Rng } {
  const rng = createRng(seed);
  const state: GameState = {
    version: STATE_VERSION,
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
    lastFestival: null,
    nextCommissionId: 1,
    commissionsDone: 0,
    foodPellets: [],
    nextPelletId: 1,
    pendingClutches: [],
    upgrades: {},
    inventory: { feed: 10, premiumFeed: 3, peas: 5, worms: 0, berries: 0, medicine: 1, soap: 0, eggs: 0 },
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
    stats: defaultStats(),
    lifeEvent: null,
    nextLifeEventId: 1,
    rivals: createRivals(rng),
    cup: null,
    drillPurse: { day: -1, earned: 0 },
    weather: { kind: 'clear', day: 0 },
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
