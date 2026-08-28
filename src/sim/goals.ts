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
  // --- A duck's life: training, upbringing, temperament ---
  {
    id: 'first-drill',
    label: 'Run a training drill',
    reward: 15,
    target: 1,
    value: (s) => s.stats.drills,
  },
  {
    id: 'paddle-50',
    label: "Train a duck's paddle to 50",
    reward: 30,
    target: 1,
    value: (s) => (s.ducks.some((d) => (d.training?.paddle ?? 0) >= 50) ? 1 : 0),
  },
  {
    id: 'first-mark',
    label: 'Raise a duck to earn an upbringing mark',
    reward: 20,
    target: 1,
    value: (s) => s.stats.marksEarned,
  },
  {
    id: 'well-raised',
    label: 'Raise a duck with two marks',
    reward: 40,
    target: 1,
    value: (s) => (s.ducks.some((d) => (d.marks?.length ?? 0) >= 2) ? 1 : 0),
  },
  {
    id: 'bold-line',
    label: 'Hatch a truly bold duck (4/4 temper)',
    reward: 30,
    target: 1,
    value: (s) => (s.ducks.some((d) => d.stage !== 'egg' && d.phenotype.boldness >= 1 && d.lineage && d.lineage.gen > 0) ? 1 : 0),
  },
  {
    id: 'settle-event',
    label: 'Settle a life event',
    reward: 15,
    target: 1,
    value: (s) => s.stats.lifeEventsSettled,
  },
  // --- Later milestones ---
  {
    id: 'standard-award',
    label: 'Earn a Standard award',
    reward: 40,
    target: 1,
    value: (s) => (Object.values(s.awards).some((a) => a.standard !== undefined) ? 1 : 0),
  },
  {
    id: 'gen-3',
    label: 'Breed a third-generation duck',
    reward: 40,
    target: 3,
    value: (s) => s.stats.deepestGen,
  },
  {
    id: 'national-derby',
    label: 'Reach the National Derby',
    reward: 60,
    target: 2,
    value: (s) => s.league.tier,
  },
  {
    id: 'train-100',
    label: 'Train any stat to 100',
    reward: 60,
    target: 1,
    value: (s) => (s.ducks.some((d) => d.training && Math.max(d.training.paddle, d.training.stamina, d.training.poise) >= 100) ? 1 : 0),
  },
  {
    id: 'all-round',
    label: 'Raise an all-rounder (three stats at 50+)',
    reward: 80,
    target: 1,
    value: (s) => (s.ducks.some((d) => d.training && d.training.paddle >= 50 && d.training.stamina >= 50 && d.training.poise >= 50) ? 1 : 0),
  },
  {
    id: 'settle-5',
    label: 'Settle 5 life events',
    reward: 30,
    target: 5,
    value: (s) => s.stats.lifeEventsSettled,
  },
  // --- Reputation ---
  {
    id: 'discover-30',
    label: 'Discover 30 breeds',
    reward: 80,
    target: 30,
    value: (s) => Object.keys(s.breedBook).length,
  },
  {
    id: 'discover-60',
    label: 'Fill the Breed Book',
    reward: 300,
    target: 60,
    value: (s) => Object.keys(s.breedBook).length,
  },
  {
    id: 'pure-award',
    label: 'Earn a Pure award',
    reward: 25,
    target: 1,
    value: (s) => (Object.values(s.awards).some((a) => a.pure !== undefined) ? 1 : 0),
  },
  {
    id: 'master-award',
    label: 'Earn a Master award',
    reward: 80,
    target: 1,
    value: (s) => (Object.values(s.awards).some((a) => a.master !== undefined) ? 1 : 0),
  },
  {
    id: 'awards-20',
    label: 'Earn 20 breed awards',
    reward: 120,
    target: 20,
    value: (s) => Object.values(s.awards).reduce((n, a) => n + Object.keys(a).length, 0),
  },
  {
    id: 'commissions-5',
    label: 'Fill 5 commissions',
    reward: 50,
    target: 5,
    value: (s) => s.commissionsDone,
  },
  {
    id: 'commissions-15',
    label: 'Fill 15 commissions',
    reward: 150,
    target: 15,
    value: (s) => s.commissionsDone,
  },
  {
    id: 'rank-5',
    label: 'Reach Society rank 5 (Patron)',
    reward: 60,
    target: 5,
    value: (s) => s.society.rank,
  },
  {
    id: 'rank-10',
    label: 'Reach Society rank 10 (Pondmaster)',
    reward: 150,
    target: 10,
    value: (s) => s.society.rank,
  },
  {
    id: 'rank-20',
    label: 'Reach the Golden Egg',
    reward: 500,
    target: 20,
    value: (s) => s.society.rank,
  },
  // --- Festivals, rivals, the Cup ---
  {
    id: 'festival-win',
    label: 'Win a festival',
    reward: 40,
    target: 1,
    value: (s) => s.stats.festivalWins,
  },
  {
    id: 'festival-national',
    label: 'Raise a festival to National',
    reward: 200,
    target: 1,
    value: (s) => (Object.values(s.festivalWins).some((w) => w >= 3) ? 1 : 0),
  },
  {
    id: 'hire-stud',
    label: "Hire a rival's stud drake",
    reward: 30,
    target: 1,
    value: (s) => s.stats.studsUsed,
  },
  {
    id: 'enter-cup',
    label: 'Enter the Society Cup',
    reward: 40,
    target: 1,
    value: (s) => s.stats.cupEntries,
  },
  {
    id: 'win-cup',
    label: 'Win the Society Cup',
    reward: 250,
    target: 1,
    value: (s) => s.stats.cupWins,
  },
  // --- The long game ---
  {
    id: 'gen-5',
    label: 'Breed a fifth-generation duck',
    reward: 120,
    target: 5,
    value: (s) => s.stats.deepestGen,
  },
  {
    id: 'flock-16',
    label: 'Keep 16 ducks on the pond',
    reward: 60,
    target: 16,
    value: (s) => s.ducks.filter((d) => d.stage !== 'egg').length,
  },
  {
    id: 'elders-3',
    label: 'Have three elders at once',
    reward: 40,
    target: 3,
    value: (s) => s.ducks.filter((d) => d.stage === 'elder').length,
  },
  {
    id: 'sale-200',
    label: 'Sell a duck for 200+ coins',
    reward: 40,
    target: 200,
    value: (s) => s.stats.biggestSale,
  },
  {
    id: 'heritage-1',
    label: 'Found a heritage pond',
    reward: 100,
    target: 1,
    value: (s) => s.heritage,
  },
  {
    id: 'heritage-3',
    label: 'Found a third heritage pond',
    reward: 300,
    target: 3,
    value: (s) => s.heritage,
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
