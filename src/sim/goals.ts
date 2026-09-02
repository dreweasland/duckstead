// The goal chain: fifty-odd things to do, in eight chapters, each paying out
// once when its predicate first holds. Completion lives in the save
// (state.goals, keyed by goal id; a finished chapter is keyed 'chapter:<id>').
// Every goal carries a hint — where to go and what to do — and can say
// why it's for later, so the list reads as a path rather than a backlog.
import type { GameState } from '../state';
import { events } from '../events';
import { isUnlocked, UNLOCK_LABELS, type Unlockable } from './unlocks';

export type ChapterId = 'first-days' | 'daily-round' | 'growing' | 'ducks-life' | 'milestones' | 'reputation' | 'festivals' | 'long-game';

export interface ChapterDef {
  id: ChapterId;
  title: string;
  blurb: string;
  reward: number; // paid once when every goal in the chapter is done
}

export const CHAPTERS: ChapterDef[] = [
  { id: 'first-days', title: 'First days', blurb: 'Care for the flock, nest a pair, and hatch your first duckling.', reward: 30 },
  { id: 'daily-round', title: 'The daily round', blurb: 'The rhythm of a pond: eggs, feed, forage, and a first race.', reward: 40 },
  { id: 'growing', title: 'Growing the pond', blurb: 'Coins into upgrades, new blood from the wild, the first pages of the Book.', reward: 60 },
  { id: 'ducks-life', title: "A duck's life", blurb: 'Training, upbringing, temperament, and the choices a life event brings.', reward: 80 },
  { id: 'milestones', title: 'Milestones', blurb: 'Standards met, generations deepened, the derby climbed.', reward: 120 },
  { id: 'reputation', title: 'Reputation', blurb: 'The Book, the awards, the Board, and the Society ladder.', reward: 200 },
  { id: 'festivals', title: 'Festivals and rivals', blurb: 'Seasonal festivals, the rival ponds, and the Society Cup.', reward: 200 },
  { id: 'long-game', title: 'The long game', blurb: 'Deep lines, a full pond, elders, and heritage.', reward: 400 },
];

// Where "Show me" takes the player.
export interface GoalGo {
  panel: 'care' | 'breeding' | 'shop' | 'roster' | 'book' | 'race' | 'save';
  tab?: string;
}

export interface GoalDef {
  id: string;
  label: string;
  hint: string; // where to go and what to do, in a sentence or two
  reward: number;
  target: number;
  value(state: GameState): number;
  chapter: ChapterId;
  unlocks?: Unlockable; // panel that appears when this goal completes
  needs?: Unlockable; // panel this goal can't be attempted without
  after?: string; // goal id that sensibly comes first
  go?: GoalGo;
  later?(state: GameState): string | undefined; // why this is for later, if it is
}

type GoalIn = Omit<GoalDef, 'chapter'>;
const chapter = (id: ChapterId, goals: GoalIn[]): GoalDef[] => goals.map((g) => ({ ...g, chapter: id }));

export const GOALS: GoalDef[] = [
  ...chapter('first-days', [
    {
      id: 'first-feed',
      label: 'Feed a duck',
      hint: 'Care → Feed, then click a duck. A hungry duck shows an orange bar on its card.',
      reward: 5,
      target: 1,
      value: (s) => s.stats.feeds,
      go: { panel: 'care' },
    },
    {
      id: 'pet-flock',
      label: 'Pet your ducks 4 times',
      hint: 'Care → Pet, then click ducks. Petting cheers them, and four pets open the Breeding panel.',
      reward: 10,
      target: 4,
      value: (s) => s.stats.pets,
      unlocks: 'breeding',
      go: { panel: 'care' },
    },
    {
      id: 'nest-pair',
      label: 'Nest a breeding pair',
      hint: 'Breed, then click a drake and a hen on the pond — adults that are fed, happy, and healthy. They court for an hour.',
      reward: 10,
      target: 1,
      value: (s) => s.stats.clutchesStarted,
      needs: 'breeding',
      go: { panel: 'breeding', tab: 'pairing' },
    },
    {
      id: 'first-egg',
      label: 'Have an egg laid',
      hint: 'At the end of the courting hour the hen lays if the pair is happy and healthy — feed and pet them while they court. Your first clutch always takes.',
      reward: 10,
      target: 1,
      value: (s) => s.stats.ducksBred,
      unlocks: 'shop',
      needs: 'breeding',
      after: 'nest-pair',
      go: { panel: 'breeding', tab: 'nest' },
    },
    {
      id: 'tuck-egg',
      label: 'Tuck an egg into the warm straw',
      hint: 'Breed → Nest, and press Tuck in on an egg to restore its warmth. Warm eggs hatch; cold ones fail.',
      reward: 10,
      target: 1,
      value: (s) => s.stats.eggsTucked,
      needs: 'breeding',
      after: 'first-egg',
      go: { panel: 'breeding', tab: 'nest' },
    },
    {
      id: 'catch-bugs',
      label: 'Catch 3 bugs',
      hint: 'Beetles and snails cross the grass by day, fireflies at night. Click one before a duck eats it; fog keeps them in.',
      reward: 10,
      target: 3,
      value: (s) => s.stats.bugsCaught,
    },
    {
      id: 'first-hatch',
      label: 'Hatch your first duckling',
      hint: 'A warm egg hatches in a few days; the nest shows its progress. When it cracks, click it to help it out.',
      reward: 20,
      target: 1,
      value: (s) => s.stats.ducksHatched,
      unlocks: 'book',
      needs: 'breeding',
      after: 'first-egg',
      go: { panel: 'breeding', tab: 'nest' },
    },
  ]),
  ...chapter('daily-round', [
    {
      id: 'fill-trough',
      label: 'Buy and fill the feeding trough',
      hint: 'Shop → Upgrades → Feeding Trough, then click the trough by the house to pour feed in. Ducks help themselves.',
      reward: 15,
      target: 1,
      value: (s) => (s.feeder.food > 0 ? 1 : 0),
      needs: 'shop',
      go: { panel: 'shop', tab: 'upgrades' },
    },
    {
      id: 'egg-basket',
      label: 'Gather 5 hen eggs from the grass',
      hint: 'A fed, content hen drops an egg on the grass between 07:00 and 17:00. Click the egg to basket it.',
      reward: 10,
      target: 5,
      value: (s) => s.stats.henEggsGathered,
    },
    {
      id: 'sell-basket',
      label: 'Sell an egg basket at the shop',
      hint: 'Shop → Sell, and sell the basket. Autumn and Market Day pay more; the Egg Cooler adds a quarter.',
      reward: 10,
      target: 1,
      value: (s) => (s.stats.henEggsSold > 0 ? 1 : 0),
      needs: 'shop',
      after: 'egg-basket',
      go: { panel: 'shop', tab: 'sell' },
    },
    {
      id: 'favourite-treat',
      label: "Find a duck's favourite treat",
      hint: 'Every duck loves one of peas, worms, or berries. Feed treats from Care until a heart bursts over one of them.',
      reward: 15,
      target: 1,
      value: (s) => s.stats.favouritesFound,
      go: { panel: 'care' },
    },
    {
      id: 'reveal-colors',
      label: 'Raise a duckling to juvenile',
      hint: 'Keep a duckling fed and near its mother for a day. It molts into a juvenile and shows its true colours.',
      reward: 20,
      target: 1,
      value: (s) => s.stats.juvenilesRaised,
      after: 'first-hatch',
    },
    {
      id: 'win-race',
      label: 'Win a pond race',
      hint: 'Race enters the daily Pond Derby. Paddle when the meter sits in its sweet spot; a trained paddle stat helps.',
      reward: 20,
      target: 1,
      value: (s) => s.stats.racesWon,
      needs: 'race',
      go: { panel: 'race' },
    },
    {
      id: 'feather-album',
      label: 'Collect 3 molted feathers',
      hint: 'Ducks molt now and then and a feather lies where they stood. Click it; feathers never expire.',
      reward: 10,
      target: 3,
      value: (s) => s.stats.feathersCollected,
    },
    {
      id: 'gather-duckweed',
      label: 'Gather duckweed from the pond rim',
      hint: 'Duckweed collects on the pond rim. Click it for free feed.',
      reward: 10,
      target: 2,
      value: (s) => s.stats.duckweedGathered,
    },
  ]),
  ...chapter('growing', [
    {
      id: 'sell-duck',
      label: 'Sell a duck',
      hint: "Open a duck's card and press Sell. Rare, near-standard ducks fetch more; a buyer at the gate pays a multiple.",
      reward: 15,
      target: 1,
      value: (s) => s.stats.ducksSold,
      needs: 'shop',
      go: { panel: 'roster' },
    },
    {
      id: 'first-upgrade',
      label: 'Buy any upgrade',
      hint: 'Shop → Upgrades. The Feeding Trough or a Nesting Box are good first buys.',
      reward: 25,
      target: 1,
      value: (s) => Object.keys(s.upgrades).length,
      needs: 'shop',
      go: { panel: 'shop', tab: 'upgrades' },
    },
    {
      id: 'befriend-wild',
      label: 'Befriend a wild duck',
      hint: 'At 10:00 a wild duck may land if the pond is clean and the flock content. Feed it three premium treats and it stays.',
      reward: 30,
      target: 1,
      value: (s) => s.stats.wildRecruited,
      go: { panel: 'care' },
    },
    {
      id: 'discover-5',
      label: 'Discover 5 breeds',
      hint: 'Every new colour, dilution, pattern, or crest combination you hatch is a breed in the Book. Pair ducks that look different.',
      reward: 15,
      target: 5,
      value: (s) => Object.keys(s.breedBook).length,
      go: { panel: 'book', tab: 'breeds' },
    },
    {
      id: 'sell-eggs',
      label: 'Sell 3 nest eggs',
      hint: "Open a nest egg's card and sell it — a rival pond keeps a standing offer, and the Board's egg commissions pay more.",
      reward: 10,
      target: 3,
      value: (s) => s.stats.eggsSold,
      needs: 'shop',
      after: 'first-egg',
      go: { panel: 'breeding', tab: 'nest' },
    },
    {
      id: 'discover-15',
      label: 'Discover 15 breeds',
      hint: 'Recessive surprises appear when two carriers meet. The Pedigree Scope upgrade reads what a duck carries.',
      reward: 40,
      target: 15,
      value: (s) => Object.keys(s.breedBook).length,
      after: 'discover-5',
      go: { panel: 'book', tab: 'breeds' },
    },
  ]),
  ...chapter('ducks-life', [
    {
      id: 'first-drill',
      label: 'Run a training drill',
      hint: "Open an adult's card → Training and run a drill. One drill a day per duck; the Training Perch adds more.",
      reward: 15,
      target: 1,
      value: (s) => s.stats.drills,
      go: { panel: 'roster' },
    },
    {
      id: 'paddle-50',
      label: "Train a duck's paddle to 50",
      hint: 'Paddle drills, every day. Stats fade a point a day, so keep at it; a friend watching adds a point.',
      reward: 30,
      target: 1,
      value: (s) => (s.ducks.some((d) => (d.training?.paddle ?? 0) >= 50) ? 1 : 0),
      after: 'first-drill',
      go: { panel: 'roster' },
    },
    {
      id: 'first-mark',
      label: 'Raise a duck to earn an upbringing mark',
      hint: 'Marks come from upbringing: an egg kept warm hatches hardy; a juvenile that races or drills is keen.',
      reward: 20,
      target: 1,
      value: (s) => s.stats.marksEarned,
    },
    {
      id: 'well-raised',
      label: 'Raise a duck with two marks',
      hint: 'Stack them: keep the egg warm (hardy), then drill it as a juvenile (keen), or raise it near an elder (steady).',
      reward: 40,
      target: 1,
      value: (s) => (s.ducks.some((d) => (d.marks?.length ?? 0) >= 2) ? 1 : 0),
      after: 'first-mark',
    },
    {
      id: 'bold-line',
      label: 'Hatch a truly bold duck (4/4 temper)',
      hint: "Temper adds up across two gene pairs. Pair your boldest ducks and check the temper gauge on the duckling's card.",
      reward: 30,
      target: 1,
      value: (s) => (s.ducks.some((d) => d.stage !== 'egg' && d.phenotype.boldness >= 1 && d.lineage && d.lineage.gen > 0) ? 1 : 0),
      go: { panel: 'roster' },
    },
    {
      id: 'settle-event',
      label: 'Settle a life event',
      hint: 'At 11:00 a life event may need a decision — a chip appears in the top bar. Unanswered ones settle themselves at 20:00.',
      reward: 15,
      target: 1,
      value: (s) => s.stats.lifeEventsSettled,
    },
  ]),
  ...chapter('milestones', [
    {
      id: 'standard-award',
      label: 'Earn a Standard award',
      hint: "Raise a duck that matches its breed's standard at 90% or better. The Book shows each standard and how close a duck is.",
      reward: 40,
      target: 1,
      value: (s) => (Object.values(s.awards).some((a) => a.standard !== undefined) ? 1 : 0),
      go: { panel: 'book', tab: 'breeds' },
    },
    {
      id: 'gen-3',
      label: 'Breed a third-generation duck',
      hint: "Breed the children of your own pairs, then theirs. A duck's card shows its generation.",
      reward: 40,
      target: 3,
      value: (s) => s.stats.deepestGen,
      go: { panel: 'breeding', tab: 'pairing' },
    },
    {
      id: 'national-derby',
      label: 'Reach the National Derby',
      hint: 'Three net wins promote a tier: Pond, County, National. The National Derby takes show-standard ducks only.',
      reward: 60,
      target: 2,
      value: (s) => s.league.tier,
      needs: 'race',
      after: 'win-race',
      go: { panel: 'race' },
    },
    {
      id: 'train-100',
      label: 'Train any stat to 100',
      hint: 'The last points come slowly. Perfect form gains most, and a best friend watching the drill adds one.',
      reward: 60,
      target: 1,
      value: (s) => (s.ducks.some((d) => d.training && Math.max(d.training.paddle, d.training.stamina, d.training.poise) >= 100) ? 1 : 0),
      after: 'paddle-50',
      go: { panel: 'roster' },
    },
    {
      id: 'all-round',
      label: 'Raise an all-rounder (three stats at 50+)',
      hint: "Split one duck's drills across paddle, stamina, and poise. The Training Perch buys the extra drills a day you'll need.",
      reward: 80,
      target: 1,
      value: (s) => (s.ducks.some((d) => d.training && d.training.paddle >= 50 && d.training.stamina >= 50 && d.training.poise >= 50) ? 1 : 0),
      after: 'paddle-50',
      go: { panel: 'shop', tab: 'upgrades' },
    },
    {
      id: 'settle-5',
      label: 'Settle 5 life events',
      hint: 'Life events come around every few days once the flock has adults. Each is a choice with a cost and a gain.',
      reward: 30,
      target: 5,
      value: (s) => s.stats.lifeEventsSettled,
      after: 'settle-event',
    },
  ]),
  ...chapter('reputation', [
    {
      id: 'discover-30',
      label: 'Discover 30 breeds',
      hint: "Halfway through the Book. Bring in fresh genes: wild visitors, the rivals' eggs, or a stud drake.",
      reward: 80,
      target: 30,
      value: (s) => Object.keys(s.breedBook).length,
      after: 'discover-15',
      go: { panel: 'book', tab: 'breeds' },
    },
    {
      id: 'discover-60',
      label: 'Fill the Breed Book',
      hint: 'All sixty: every colour, dilute or not, three patterns, crest or not. The Book marks what is missing.',
      reward: 300,
      target: 60,
      value: (s) => Object.keys(s.breedBook).length,
      after: 'discover-30',
      go: { panel: 'book', tab: 'breeds' },
    },
    {
      id: 'pure-award',
      label: 'Earn a Pure award',
      hint: 'Pair two ducks of the same breed; their duckling hatches Pure-bred.',
      reward: 25,
      target: 1,
      value: (s) => (Object.values(s.awards).some((a) => a.pure !== undefined) ? 1 : 0),
      go: { panel: 'breeding', tab: 'pairing' },
    },
    {
      id: 'master-award',
      label: 'Earn a Master award',
      hint: 'Keep five living ducks of one breed at once. A Pond Expansion helps make room.',
      reward: 80,
      target: 1,
      value: (s) => (Object.values(s.awards).some((a) => a.master !== undefined) ? 1 : 0),
      go: { panel: 'book', tab: 'breeds' },
    },
    {
      id: 'awards-20',
      label: 'Earn 20 breed awards',
      hint: 'Pure, Standard, and Master for each breed — 180 in all. Book → Breeds tracks every one.',
      reward: 120,
      target: 20,
      value: (s) => Object.values(s.awards).reduce((n, a) => n + Object.keys(a).length, 0),
      after: 'standard-award',
      go: { panel: 'book', tab: 'breeds' },
    },
    {
      id: 'commissions-5',
      label: 'Fill 5 commissions',
      hint: "Shop → Board. Breeders ask for specific ducks; deliver from the duck's card. A card names the pair likeliest to hatch one.",
      reward: 50,
      target: 5,
      value: (s) => s.commissionsDone,
      needs: 'shop',
      go: { panel: 'shop', tab: 'board' },
    },
    {
      id: 'commissions-15',
      label: 'Fill 15 commissions',
      hint: 'Demands grow every three you fill: sex, generation, standard match, pink bills. Keep a spread of breeds ready.',
      reward: 150,
      target: 15,
      value: (s) => s.commissionsDone,
      needs: 'shop',
      after: 'commissions-5',
      go: { panel: 'shop', tab: 'board' },
    },
    {
      id: 'rank-5',
      label: 'Reach Society rank 5 (Patron)',
      hint: 'Shop → Society. Ranks cost coins and Society points; points come from discoveries, awards, commissions, and festival placings.',
      reward: 60,
      target: 5,
      value: (s) => s.society.rank,
      needs: 'shop',
      go: { panel: 'shop', tab: 'society' },
    },
    {
      id: 'rank-10',
      label: 'Reach Society rank 10 (Pondmaster)',
      hint: 'Pondmaster adds a pond slot. Commissions and festival wins are the steadiest points.',
      reward: 150,
      target: 10,
      value: (s) => s.society.rank,
      needs: 'shop',
      after: 'rank-5',
      go: { panel: 'shop', tab: 'society' },
    },
    {
      id: 'rank-20',
      label: 'Reach the Golden Egg',
      hint: 'The top of the Society ladder. Every point you earn counts toward it.',
      reward: 500,
      target: 20,
      value: (s) => s.society.rank,
      needs: 'shop',
      after: 'rank-10',
      go: { panel: 'shop', tab: 'society' },
    },
  ]),
  ...chapter('festivals', [
    {
      id: 'festival-win',
      label: 'Win a festival',
      hint: 'One festival a season; the chip in the top bar counts down. Enter from the chip on the day, before it packs up at 20:00.',
      reward: 40,
      target: 1,
      value: (s) => s.stats.festivalWins,
    },
    {
      id: 'festival-national',
      label: 'Raise a festival to National',
      hint: "Each win raises next year's edition a tier: County, Regional, National. Three wins of one festival.",
      reward: 200,
      target: 1,
      value: (s) => (Object.values(s.festivalWins).some((w) => w >= 3) ? 1 : 0),
      after: 'festival-win',
    },
    {
      id: 'hire-stud',
      label: "Hire a rival's stud drake",
      hint: 'Shop → Board → Stud service. Pick a hen and hire a rival drake for one clutch; the egg is yours.',
      reward: 30,
      target: 1,
      value: (s) => s.stats.studsUsed,
      needs: 'shop',
      go: { panel: 'shop', tab: 'board' },
    },
    {
      id: 'enter-cup',
      label: 'Enter the Society Cup',
      hint: "Shop → Society. From rank 5, stake Society points to enter the year's Cup against the rival ponds.",
      reward: 40,
      target: 1,
      value: (s) => s.stats.cupEntries,
      needs: 'shop',
      after: 'rank-5',
      go: { panel: 'shop', tab: 'society' },
    },
    {
      id: 'win-cup',
      label: 'Win the Society Cup',
      hint: 'Every point earned until the last night of winter counts. Discoveries, awards, commissions, and festivals all pay points.',
      reward: 250,
      target: 1,
      value: (s) => s.stats.cupWins,
      needs: 'shop',
      after: 'enter-cup',
      go: { panel: 'shop', tab: 'society' },
    },
  ]),
  ...chapter('long-game', [
    {
      id: 'gen-5',
      label: 'Breed a fifth-generation duck',
      hint: 'Five generations of your own breeding. Pair children with unrelated ducks to keep the line strong.',
      reward: 120,
      target: 5,
      value: (s) => s.stats.deepestGen,
      after: 'gen-3',
      go: { panel: 'breeding', tab: 'pairing' },
    },
    {
      id: 'flock-16',
      label: 'Keep 16 ducks on the pond',
      hint: 'Pond Expansions add four places each; the Pondmaster perk and each heritage pond add one. Elders never count.',
      reward: 60,
      target: 16,
      value: (s) => s.ducks.filter((d) => d.stage !== 'egg').length,
      needs: 'shop',
      go: { panel: 'shop', tab: 'upgrades' },
    },
    {
      id: 'elders-3',
      label: 'Have three elders at once',
      hint: 'Adults grow old after a couple of weeks. Elders are free to keep and sit broody by the nest, so let them stay.',
      reward: 40,
      target: 3,
      value: (s) => s.ducks.filter((d) => d.stage === 'elder').length,
    },
    {
      id: 'sale-200',
      label: 'Sell a duck for 200+ coins',
      hint: 'Rare, near-standard, well-raised ducks fetch the most. Sell on Market Day, or to a buyer at the gate.',
      reward: 40,
      target: 200,
      value: (s) => s.stats.biggestSale,
      needs: 'shop',
      after: 'sell-duck',
      go: { panel: 'roster' },
    },
    {
      id: 'heritage-1',
      label: 'Found a heritage pond',
      hint: 'With 10 breeds in the Book, retire the pond from the Save panel and refound it with one drake and one hen. The Book and Society carry over.',
      reward: 100,
      target: 1,
      value: (s) => s.heritage,
      later: (s) => (Object.keys(s.breedBook).length < 10 ? 'Needs 10 breeds in the Book' : undefined),
      go: { panel: 'save' },
    },
    {
      id: 'heritage-3',
      label: 'Found a third heritage pond',
      hint: 'Each retirement adds a pond slot and a little mutation. Awards, chronicle, rivals, and an open Cup all carry over.',
      reward: 300,
      target: 3,
      value: (s) => s.heritage,
      after: 'heritage-1',
      go: { panel: 'save' },
    },
  ]),
];

// The goal that opens a panel — the early-game gates the Goals list makes
// a point of, and what a locked button names when clicked.
export function goalUnlocking(what: Unlockable): GoalDef | undefined {
  return GOALS.find((g) => g.unlocks === what);
}

// Progress toward a goal, clamped to its target.
export function goalProgress(state: GameState, goal: GoalDef): number {
  return Math.min(goal.target, goal.value(state));
}

export function goalDone(state: GameState, goal: GoalDef): boolean {
  return Boolean(state.goals[goal.id]);
}

// Why a goal is for later — a locked panel, an earlier goal, or its own
// reason — or undefined when it can be attempted now.
export function goalLater(state: GameState, goal: GoalDef): string | undefined {
  if (goal.needs && !isUnlocked(state, goal.needs)) return `Opens with ${UNLOCK_LABELS[goal.needs]}`;
  if (goal.after && !state.goals[goal.after]) {
    const prior = GOALS.find((g) => g.id === goal.after);
    if (prior) return `After "${prior.label}"`;
  }
  return goal.later?.(state);
}

export function chapterGoals(id: ChapterId): GoalDef[] {
  return GOALS.filter((g) => g.chapter === id);
}

export function chapterProgress(state: GameState, id: ChapterId): { done: number; total: number } {
  const goals = chapterGoals(id);
  return { done: goals.filter((g) => goalDone(state, g)).length, total: goals.length };
}

export function chapterDone(state: GameState, id: ChapterId): boolean {
  const p = chapterProgress(state, id);
  return p.done >= p.total;
}

// The chapter the player is on: the first with anything left to do.
export function currentChapter(state: GameState): ChapterDef {
  return CHAPTERS.find((c) => !chapterDone(state, c.id)) ?? CHAPTERS[CHAPTERS.length - 1];
}

export function goalsOverview(state: GameState): { done: number; total: number } {
  return { done: GOALS.filter((g) => goalDone(state, g)).length, total: GOALS.length };
}

export interface WidgetGoal {
  goal: GoalDef;
  later?: string;
  upNext: boolean; // borrowed from the chapter after the current one
}

// What the pond-side widget shows: the current chapter's open goals with the
// doable ones first, and — when fewer than `fill` of those can be attempted
// now — a few doable goals from the next chapter, marked as up next.
export function widgetGoals(state: GameState, limit: number, fill = 3): WidgetGoal[] {
  const current = currentChapter(state);
  const rank = (w: WidgetGoal) => (w.later ? 1 : 0);
  const rows: WidgetGoal[] = chapterGoals(current.id)
    .filter((g) => !goalDone(state, g))
    .map((goal) => ({ goal, later: goalLater(state, goal), upNext: false }))
    .sort((a, b) => rank(a) - rank(b));
  const doable = rows.filter((r) => !r.later).length;
  if (doable < fill) {
    const idx = CHAPTERS.findIndex((c) => c.id === current.id);
    const next = CHAPTERS[idx + 1];
    if (next) {
      for (const goal of chapterGoals(next.id)) {
        if (goalDone(state, goal) || goalLater(state, goal)) continue;
        rows.push({ goal, upNext: true });
        if (rows.filter((r) => !r.later).length >= fill) break;
      }
    }
  }
  return rows.slice(0, limit);
}

export function tickGoals(state: GameState): void {
  for (const goal of GOALS) {
    if (state.goals[goal.id] || goal.value(state) < goal.target) continue;
    state.goals[goal.id] = true;
    state.money += goal.reward;
    events.emit('toast', `Goal complete: ${goal.label} (+${goal.reward} coins)`);
  }
  // A chapter closes once when its last goal does.
  for (const ch of CHAPTERS) {
    const key = `chapter:${ch.id}`;
    if (state.goals[key] || !chapterDone(state, ch.id)) continue;
    state.goals[key] = true;
    state.money += ch.reward;
    events.emit('chapter-done', ch);
    events.emit('toast', `Chapter complete: ${ch.title} (+${ch.reward} coins)`);
  }
}

export function pendingGoals(state: GameState): GoalDef[] {
  return GOALS.filter((g) => !state.goals[g.id]);
}
