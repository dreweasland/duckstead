// Early-game goal checklist. Each goal pays out once when its predicate first
// holds; completion state lives in the save (state.goals).
import type { GameState } from '../state';
import { events } from '../events';
import type { Unlockable } from './unlocks';

export interface GoalDef {
  id: string;
  label: string;
  reward: number;
  target: number;
  value(state: GameState): number;
  unlocks?: Unlockable; // panel that appears when this goal completes
}

export const GOALS: GoalDef[] = [
  // --- First minutes: care, then breeding ---
  {
    id: 'first-feed',
    label: 'Feed a duck',
    reward: 5,
    target: 1,
    value: (s) => s.stats.feeds,
  },
  {
    id: 'pet-flock',
    label: 'Pet your ducks 4 times',
    reward: 10,
    target: 4,
    value: (s) => s.stats.pets,
    unlocks: 'breeding',
  },
  {
    id: 'nest-pair',
    label: 'Nest a breeding pair',
    reward: 10,
    target: 1,
    value: (s) => s.stats.clutchesStarted,
  },
  {
    id: 'first-egg',
    label: 'Have an egg laid',
    reward: 10,
    target: 1,
    value: (s) => s.stats.ducksBred,
    unlocks: 'shop',
  },
  {
    id: 'tuck-egg',
    label: 'Tuck an egg into the warm straw',
    reward: 10,
    target: 1,
    value: (s) => s.stats.eggsTucked,
  },
  {
    id: 'catch-bugs',
    label: 'Catch 3 bugs',
    reward: 10,
    target: 3,
    value: (s) => s.stats.bugsCaught,
  },
  {
    id: 'first-hatch',
    label: 'Hatch your first duckling',
    reward: 20,
    target: 1,
    value: (s) => s.stats.ducksHatched,
    unlocks: 'book',
  },
  // --- The daily loop ---
  {
    id: 'fill-trough',
    label: 'Buy and fill the feeding trough',
    reward: 15,
    target: 1,
    value: (s) => (s.feeder.food > 0 ? 1 : 0),
  },
  {
    id: 'egg-basket',
    label: 'Gather 5 hen eggs from the grass',
    reward: 10,
    target: 5,
    value: (s) => s.stats.henEggsGathered,
  },
  {
    id: 'sell-basket',
    label: 'Sell an egg basket at the shop',
    reward: 10,
    target: 1,
    value: (s) => (s.stats.henEggsSold > 0 ? 1 : 0),
  },
  {
    id: 'favourite-treat',
    label: "Find a duck's favourite treat",
    reward: 15,
    target: 1,
    value: (s) => s.stats.favouritesFound,
  },
  {
    id: 'reveal-colors',
    label: 'Raise a duckling to juvenile',
    reward: 20,
    target: 1,
    value: (s) => s.stats.juvenilesRaised,
  },
  {
    id: 'win-race',
    label: 'Win a pond race',
    reward: 20,
    target: 1,
    value: (s) => s.stats.racesWon,
  },
  {
    id: 'feather-album',
    label: 'Collect 3 molted feathers',
    reward: 10,
    target: 3,
    value: (s) => s.stats.feathersCollected,
  },
  {
    id: 'gather-duckweed',
    label: 'Gather duckweed from the pond rim',
    reward: 10,
    target: 2,
    value: (s) => s.stats.duckweedGathered,
  },
  // --- Growing the pond ---
  {
    id: 'sell-duck',
    label: 'Sell a duck',
    reward: 15,
    target: 1,
    value: (s) => s.stats.ducksSold,
  },
  {
    id: 'first-upgrade',
    label: 'Buy any upgrade',
    reward: 25,
    target: 1,
    value: (s) => Object.keys(s.upgrades).length,
  },
  {
    id: 'befriend-wild',
    label: 'Befriend a wild duck',
    reward: 30,
    target: 1,
    value: (s) => s.stats.wildRecruited,
  },
  {
    id: 'discover-5',
    label: 'Discover 5 breeds',
    reward: 15,
    target: 5,
    value: (s) => Object.keys(s.breedBook).length,
  },
  {
    id: 'sell-eggs',
    label: 'Sell 3 nest eggs',
    reward: 10,
    target: 3,
    value: (s) => s.stats.eggsSold,
  },
  {
    id: 'discover-15',
    label: 'Discover 15 breeds',
    reward: 40,
    target: 15,
    value: (s) => Object.keys(s.breedBook).length,
  },
];

// Progress toward a goal, clamped to its target.
export function goalProgress(state: GameState, goal: GoalDef): number {
  return Math.min(goal.target, goal.value(state));
}

export function tickGoals(state: GameState): void {
  for (const goal of GOALS) {
    if (state.goals[goal.id] || goal.value(state) < goal.target) continue;
    state.goals[goal.id] = true;
    state.money += goal.reward;
    events.emit('toast', `Goal complete: ${goal.label} (+${goal.reward} coins)`);
  }
}

export function pendingGoals(state: GameState): GoalDef[] {
  return GOALS.filter((g) => !state.goals[g.id]);
}
