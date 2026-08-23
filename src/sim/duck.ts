import type { Activity, LifeStage, Sex, Vec2 } from '../types';
import type { Rng } from '../rng';
import { makeId } from '../rng';
import type { Genome, Phenotype } from './genetics';
import { breed, computePhenotype, starterGenome } from './genetics';
import { TICKS_PER_DAY } from './time';
import { closeKin, lineageFrom } from './lineage';

export interface Needs {
  hunger: number; // satiety, 0 = starving
  cleanliness: number;
  happiness: number;
  health: number;
}

export interface Duck {
  id: string;
  name: string;
  sex: Sex;
  genome: Genome;
  phenotype: Phenotype;
  stage: LifeStage;
  ageTicks: number; // ticks since hatch (or since laying, for eggs)
  needs: Needs;
  sick: boolean;
  parents: [string, string] | null;
  pos: Vec2;
  prevPos: Vec2;
  heading: number; // radians
  activity: Activity;
  activityTimer: number; // ticks remaining in current activity
  breedingCooldownTicks: number;
  incubationTicks: number; // for stage === 'egg'
  petCooldownTicks: number;
  lastRaceDay?: number; // the daily derby allows one entry per duck per day
  lastLayDay?: number; // hens drop one unfertilised egg a day
  favouriteKnown?: boolean; // the player has found this duck's favourite treat
  lineage?: import('./lineage').Lineage; // ancestry, stamped at lay time
  wanderTarget?: Vec2; // where the current swim/waddle is headed
  penned?: boolean; // kept in the bachelor pen: out of the breeding population
  pennedInside?: boolean; // has reached the pen (until then it's walking in)
  // Egg tending (stage === 'egg'): warmth drifts down and the player tucks
  // the egg in to restore it. Warmth scales incubation speed, and its average
  // over the incubation sets the duckling's hatch condition.
  warmth?: number; // 0..100
  warmthSum?: number; // running total, averaged at hatch
  readyToHatch?: boolean; // fully incubated, waiting for the player's tap
  readyTicks?: number; // ticks spent waiting; auto-hatches eventually
  bornDay?: number; // day hatched/joined; birthdays need it (absent in old saves)
  nestOffset?: Vec2; // eggs: position relative to the nest, which moves with window width
  petSessionGranted?: number; // happiness given so far in the current stroke session
  friendId?: string; // best friend, formed by hanging out together
  friendCandidate?: string; // friendship-in-progress tracking
  friendStreak?: number;
}

export const STAGE_DAYS: Record<Exclude<LifeStage, 'egg' | 'adult'>, number> = {
  duckling: 1,
  juvenile: 2,
  elder: 4,
};
export const EGG_DAYS = 0.5;
export const ADULT_BASE_DAYS = 14;

export function adultDurationTicks(vigor: number): number {
  return Math.round(ADULT_BASE_DAYS * (0.8 + 0.4 * vigor) * TICKS_PER_DAY);
}

export const DUCK_NAMES = [
  'Puddle', 'Waddles', 'Bill', 'Quackers', 'Pip', 'Mango', 'Splash', 'Feather',
  'Nibbles', 'Sunny', 'Pebble', 'Dandelion', 'Marsh', 'Clover', 'Ripple', 'Bumble',
  'Tulip', 'Ferdinand', 'Beatrix', 'Ondine', 'Sedge', 'Willow', 'Gustav', 'Pearl',
  'Craig', 'Curtis', 'Chester', 'Melon', 'Emerson', 'Leighton', 'Tony', 'Pappy',
  'Hazel', 'Otto', 'Mabel', 'Bertie', 'Iris', 'Rufus', 'Nettle', 'Barnaby',
  'Wren', 'Alfie', 'Maud', 'Percy', 'Thistle', 'Digby', 'Olive', 'Wilbur',
  'Primrose', 'Humphrey', 'Elsie', 'Reggie', 'Bramble', 'Agnes', 'Cedric', 'Posy',
  'Moss', 'Winifred', 'Ambrose', 'Dotty', 'Kipper', 'Lottie', 'Hector', 'Fenella',
];

// Fresh names for hatchlings; once these run out the main pool is used too.
export const HATCH_NAMES = [
  'Pip', 'Dot', 'Scoot', 'Wobble', 'Fluff', 'Bean', 'Sprout', 'Chirp',
  'Puff', 'Bubbles', 'Sprocket', 'Maple', 'Fern', 'Basil', 'Poppy', 'Juniper',
  'Twig', 'Pudding', 'Nutmeg', 'Crumb', 'Biscuit', 'Pickle', 'Dumpling', 'Tadpole',
  'Acorn', 'Cricket', 'Waffle', 'Noodle', 'Peanut', 'Minnow', 'Tansy', 'Clementine',
];

export function randomName(rng: Rng): string {
  return rng.pick(DUCK_NAMES);
}

// Pick a name nobody on the pond is using, drawing uniformly from whatever
// is still unused in the pool(s). Only once every name is taken do we fall
// back to numbered suffixes.
export function freshName(rng: Rng, existing: Iterable<string>, ...pools: string[][]): string {
  const taken = new Set(existing);
  for (const pool of pools) {
    const free = pool.filter((n) => !taken.has(n));
    if (free.length > 0) return rng.pick(free);
  }
  return dedupeName(rng.pick(pools[0]), taken);
}

// Avoid two living ducks sharing a name — confusing now that names are shown
// on cards. Falls back to numbered suffixes when the pool runs dry.
export function dedupeName(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

interface CreateDuckOpts {
  genome: Genome;
  stage: LifeStage;
  pos: Vec2;
  parents?: [string, string] | null;
  name?: string;
  sex?: Sex;
}

export function createDuck(rng: Rng, opts: CreateDuckOpts): Duck {
  return {
    id: makeId(rng),
    name: opts.name ?? randomName(rng),
    sex: opts.sex ?? (rng.chance(0.5) ? 'M' : 'F'),
    genome: opts.genome,
    phenotype: computePhenotype(opts.genome),
    stage: opts.stage,
    ageTicks: 0,
    needs: { hunger: 80, cleanliness: 80, happiness: 70, health: 100 },
    sick: false,
    parents: opts.parents ?? null,
    pos: { ...opts.pos },
    prevPos: { ...opts.pos },
    heading: rng.range(0, Math.PI * 2),
    activity: opts.stage === 'egg' ? 'sit' : 'idle',
    activityTimer: 0,
    breedingCooldownTicks: 0,
    incubationTicks: 0,
    petCooldownTicks: 0,
  };
}

export function createStarterDuck(rng: Rng, pos: Vec2, sex?: Sex): Duck {
  return createDuck(rng, { genome: starterGenome(rng), stage: 'adult', pos, sex });
}

export function layEgg(rng: Rng, mother: Duck, father: Duck, pos: Vec2, mutationRate?: number): Duck {
  const genome = breed(mother.genome, father.genome, rng, mutationRate);
  // Inbreeding depression: close kin throw less vigorous clutches.
  if (closeKin(mother, father)) {
    for (const id of ['vigor1', 'vigor2'] as const) {
      const pair = genome[id];
      for (let i = 0; i < 2; i += 1) if (pair[i] === '+' && rng.chance(0.35)) pair[i] = '-';
    }
  }
  const egg = createDuck(rng, {
    genome,
    stage: 'egg',
    pos,
    parents: [mother.id, father.id],
    name: 'Egg',
  });
  egg.lineage = lineageFrom(mother, father);
  return egg;
}

export function isWaterfowlActive(duck: Duck): boolean {
  return duck.stage !== 'egg';
}

// Visual radius in world units, used for click-picking and separation.
export function duckRadius(duck: Duck): number {
  const stageScale = duck.stage === 'duckling' ? 0.45 : duck.stage === 'juvenile' ? 0.75 : 1;
  return 22 * duck.phenotype.sizeScale * stageScale;
}
