import type { GameState } from '../state';
import { broodyWarmthScale, MENTOR_HAPPY_SCALE, mentorNearby } from './elders';
import { GROUND_TOP, WORLD_H, WORLD_W } from '../state';
import type { Rng } from '../rng';
import { clamp } from '../types';
import type { Duck } from './duck';
import { BALANCE, eggWarmthDecayScale, overcrowding, upgradeLevel } from './economy';
import { events } from '../events';
import { festivalToday } from './festivals';
import { isPondDirty } from './pond';
import { eatFood, takeStock, type EatResult, type FoodKind } from './food';
import { drakePressure } from './flockBalance';
import { isNight, seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

// Decay rates per game-hour.
const HUNGER_DECAY = 6;
const CLEAN_DECAY = 3;
const HAPPY_DECAY = 2;
const STARVING_HEALTH_DRAIN = 3;
const STARVING_HAPPY_DRAIN = 2;
const SICK_HAPPY_DRAIN = 5;
const SICK_HEALTH_DRAIN = 4;
const OVERCROWD_HAPPY_DRAIN = 0.6; // per excess duck per hour, capped at 6 excess
const HARRIED_HEN_DRAIN = 0.7; // per surplus drake per hour
const SQUABBLE_DRAIN = 0.3;
export const PRESSURE_VIABILITY_PENALTY = 0.06; // per surplus drake
const HEALTH_REGEN = 1;
const SICKNESS_BASE_CHANCE = 0.02; // per hour when cleanliness < 30
const CONTAGION_CHANCE = 0.01; // per sick pond-mate per hour

export function tickNeeds(state: GameState, rng: Rng): void {
  const night = isNight(state.clock);
  const winter = seasonOf(state.clock) === 'winter';
  const winterLights = festivalToday(state.clock) === 'winterLights';
  const pondDirty = isPondDirty(state);
  const hasToy = upgradeLevel(state, 'duckToy') > 0;
  const perTick = 1 / TICKS_PER_HOUR;
  const nightScale = night ? 0.3 : 1;
  const sickCount = state.ducks.filter((d) => d.stage !== 'egg' && d.sick).length;

  const incubator = upgradeLevel(state, 'incubator') > 0;
  const vet = upgradeLevel(state, 'vetClinic') > 0;
  const warmthScale = eggWarmthDecayScale(state) * broodyWarmthScale(state);
  const crowd = overcrowding(state);
  const pressure = drakePressure(state);
  for (const duck of state.ducks) {
    if (duck.stage === 'egg') {
      tickEggWarmth(duck, incubator, nightScale * warmthScale, perTick);
      continue;
    }
    const n = duck.needs;

    let hungerRate = HUNGER_DECAY * (winter ? 1.5 : 1);
    let cleanRate = CLEAN_DECAY * (pondDirty ? 2 : 1);
    let happyRate = HAPPY_DECAY * (hasToy ? 0.75 : 1);
    // Too many drakes: hens are harried, drakes squabble.
    if (pressure > 0 && (duck.stage === 'adult' || duck.stage === 'elder')) {
      happyRate += (duck.sex === 'F' ? HARRIED_HEN_DRAIN : SQUABBLE_DRAIN) * pressure;
    }
    // Winter Lights festival: nobody's mood dims under the lights.
    if (winterLights) happyRate = 0;
    if (n.hunger < 20) happyRate += STARVING_HAPPY_DRAIN;
    // Overcrowding: every duck over the limit adds to everyone's stress.
    if (crowd > 0) happyRate += OVERCROWD_HAPPY_DRAIN * Math.min(crowd, 6);

    n.hunger = clamp(n.hunger - hungerRate * perTick * nightScale, 0, 100);
    n.cleanliness = clamp(n.cleanliness - cleanRate * perTick * nightScale, 0, 100);
    if (duck.activity === 'swim') {
      n.cleanliness = clamp(n.cleanliness + 2 * perTick, 0, 100);
      // Ducks love swimming near moving water.
      if (upgradeLevel(state, 'waterfall') > 0) {
        n.happiness = clamp(n.happiness + 1 * perTick, 0, 100);
      }
    }
    // A young duck in an elder's company holds its cheer better.
    if (mentorNearby(state, duck)) happyRate *= MENTOR_HAPPY_SCALE;
    n.happiness = clamp(n.happiness - happyRate * perTick * nightScale, 0, 100);
    // Best friends nearby are good company.
    if (duck.friendId) {
      const friend = state.ducks.find((d) => d.id === duck.friendId);
      if (friend && Math.hypot(friend.pos.x - duck.pos.x, friend.pos.y - duck.pos.y) < 70) {
        n.happiness = clamp(n.happiness + 0.5 * perTick, 0, 100);
      }
    }
    // A decorated pond is simply a nicer place to live (capped aura).
    const aura = Math.min(state.decorations.length, 3) * 0.4;
    if (aura > 0) n.happiness = clamp(n.happiness + aura * perTick, 0, 100);

    if (n.hunger < 20) n.health = clamp(n.health - STARVING_HEALTH_DRAIN * perTick, 0, 100);
    if (duck.sick) {
      n.happiness = clamp(n.happiness - SICK_HAPPY_DRAIN * perTick, 0, 100);
      n.health = clamp(n.health - SICK_HEALTH_DRAIN * perTick, 0, 100);
    } else if (n.hunger > 80) {
      n.health = clamp(n.health + HEALTH_REGEN * perTick, 0, 100);
    }

    // Sickness rolls, expressed per-hour, scaled down to per-tick probability.
    if (!duck.sick) {
      const elderScale = duck.stage === 'elder' ? 2 : 1;
      const vigorScale = 1 - duck.phenotype.vigor * 0.5;
      let chancePerHour = 0;
      if (n.cleanliness < 30) chancePerHour += SICKNESS_BASE_CHANCE * vigorScale * elderScale;
      chancePerHour += CONTAGION_CHANCE * (sickCount - (duck.sick ? 1 : 0)) * vigorScale;
      if (vet) chancePerHour *= 0.5;
      if (chancePerHour > 0 && rng.chance(chancePerHour * perTick)) {
        duck.sick = true;
        events.emit('toast', `${duck.name} got sick!`);
      }
    }

    if (duck.petCooldownTicks > 0) duck.petCooldownTicks -= 1;
    if (duck.breedingCooldownTicks > 0) duck.breedingCooldownTicks -= 1;
  }

  // Feed Silo: the trough tops itself up at dawn.
  if (upgradeLevel(state, 'feedSilo') > 0 && state.clock.totalTicks % TICKS_PER_DAY === 6 * TICKS_PER_HOUR) {
    const moved = fillFeeder(state);
    if (moved > 0) events.emit('toast', `The silo poured ${moved} feed into the trough`);
  }

  // Uneaten food spoils after a couple of game-hours.
  for (let i = state.foodPellets.length - 1; i >= 0; i -= 1) {
    const pellet = state.foodPellets[i];
    pellet.age = (pellet.age ?? 0) + 1;
    if (pellet.age > 2 * TICKS_PER_HOUR) state.foodPellets.splice(i, 1);
  }
}

// --- Egg tending ---

// Warmth drifts down unless the egg sits in the incubator. The running sum
// lets the hatch use the average warmth over the whole incubation.
function tickEggWarmth(egg: Duck, incubator: boolean, nightScale: number, perTick: number): void {
  egg.warmth ??= BALANCE.eggStartWarmth;
  if (incubator) egg.warmth = 100;
  else egg.warmth = clamp(egg.warmth - BALANCE.eggWarmthDecay * perTick * nightScale, 0, 100);
  egg.warmthSum = (egg.warmthSum ?? 0) + egg.warmth;
  if (egg.petCooldownTicks > 0) egg.petCooldownTicks -= 1;
}

// Incubation speed multiplier for an egg's current warmth.
export function eggSpeedFor(warmth: number): number {
  const t = clamp(warmth, 0, 100) / 100;
  return BALANCE.eggWarmthSpeedMin + (BALANCE.eggWarmthSpeedMax - BALANCE.eggWarmthSpeedMin) * t;
}

export function eggWarmth(egg: Duck): number {
  return egg.warmth ?? BALANCE.eggStartWarmth;
}

// Tuck an egg into the straw: restores warmth, one tuck per game-hour per egg.
export function tuckEgg(state: GameState, eggId: string): boolean {
  const egg = getDuck(state, eggId);
  if (!egg || egg.stage !== 'egg' || egg.readyToHatch || egg.petCooldownTicks > 0) return false;
  egg.warmth = clamp(eggWarmth(egg) + BALANCE.eggTuckWarmth, 0, 100);
  egg.petCooldownTicks = BALANCE.eggTuckCooldownTicks;
  state.stats.eggsTucked += 1;
  return true;
}

// --- Care actions (called from UI) ---

// Hand-feed a duck from the inventory. Returns the eat result, or null if
// there was nothing to give.
export function feedDuckDirectly(state: GameState, duckId: string, kind: FoodKind | boolean): EatResult | null {
  const food: FoodKind = typeof kind === 'boolean' ? (kind ? 'premiumFeed' : 'feed') : kind;
  const duck = getDuck(state, duckId);
  if (!duck || duck.stage === 'egg') return null;
  if (!takeStock(state, food)) return null;
  state.stats.feeds += 1;
  return eatFood(state, duck, food);
}

export function cleanDuck(state: GameState, duckId: string): boolean {
  const duck = getDuck(state, duckId);
  if (!duck || duck.stage === 'egg') return false;
  duck.needs.cleanliness = clamp(duck.needs.cleanliness + BALANCE.cleanRestore, 0, 100);
  return true;
}

export function petDuck(state: GameState, duckId: string): boolean {
  const duck = getDuck(state, duckId);
  if (!duck || duck.stage === 'egg' || duck.petCooldownTicks > 0) return false;
  duck.needs.happiness = clamp(duck.needs.happiness + BALANCE.petHappiness, 0, 100);
  duck.petCooldownTicks = BALANCE.petCooldownTicks;
  state.stats.pets += 1;
  return true;
}

// --- Gesture care: stroking and brushing in the world ---

// A petting session grants happiness in small steps as the player strokes;
// once the full amount is given, the duck is content and the cooldown starts.
export function petStroke(state: GameState, duckId: string, amount: number): number {
  const duck = state.ducks.find((d) => d.id === duckId);
  if (!duck || duck.stage === 'egg' || duck.petCooldownTicks > 0) return 0;
  const given = duck.petSessionGranted ?? 0;
  const grant = Math.min(amount, BALANCE.petHappiness - given);
  if (grant <= 0) return 0;
  duck.needs.happiness = clamp(duck.needs.happiness + grant, 0, 100);
  duck.petSessionGranted = given + grant;
  // A petted duck settles in rather than waddling off mid-stroke.
  duck.activity = 'idle';
  duck.activityTimer = Math.max(duck.activityTimer, 15);
  if (duck.petSessionGranted >= BALANCE.petHappiness) {
    duck.petSessionGranted = 0;
    duck.petCooldownTicks = BALANCE.petCooldownTicks;
    state.stats.pets += 1;
  }
  return grant;
}

// Brushing scrubs grime off in strokes; no cooldown, the stroke rate is the
// limiter. Returns the cleanliness actually restored.
export function brushStroke(state: GameState, duckId: string, amount: number): number {
  const duck = state.ducks.find((d) => d.id === duckId);
  if (!duck || duck.stage === 'egg') return 0;
  const before = duck.needs.cleanliness;
  duck.needs.cleanliness = clamp(before + amount, 0, 100);
  if (duck.needs.cleanliness !== before) {
    duck.activity = 'idle';
    duck.activityTimer = Math.max(duck.activityTimer, 15);
  }
  return duck.needs.cleanliness - before;
}

export function medicateDuck(state: GameState, duckId: string): boolean {
  const duck = getDuck(state, duckId);
  if (!duck || duck.stage === 'egg' || state.inventory.medicine <= 0 || !duck.sick) return false;
  state.inventory.medicine -= 1;
  duck.sick = false;
  duck.needs.health = clamp(duck.needs.health + BALANCE.medicineHealthRestore * (upgradeLevel(state, 'vetClinic') > 0 ? 2 : 1), 0, 100);
  events.emit('toast', `${duck.name} was cured!`);
  return true;
}

export const FEEDER_CAPACITY = 20;

export function feederCapacity(state: GameState): number {
  return FEEDER_CAPACITY + upgradeLevel(state, 'feedSilo') * 20;
}

// Move feed from the inventory into the trough. Returns units transferred.
// Requires owning the Feeding Trough upgrade.
export function fillFeeder(state: GameState): number {
  if (upgradeLevel(state, 'feedingTrough') === 0) return 0;
  const space = feederCapacity(state) - state.feeder.food;
  const moved = Math.min(space, state.inventory.feed);
  if (moved <= 0) return 0;
  state.inventory.feed -= moved;
  state.feeder.food += moved;
  return moved;
}

export function dropFood(state: GameState, pos: { x: number; y: number }, kind: FoodKind | boolean): boolean {
  const food: FoodKind = typeof kind === 'boolean' ? (kind ? 'premiumFeed' : 'feed') : kind;
  if (!takeStock(state, food)) return false;
  state.stats.feeds += 1;
  const premium = food === 'premiumFeed';
  // Clamp into the area ducks can actually walk/swim to — a pellet dropped in
  // the sky would otherwise lure the flock against the world edge forever.
  const clamped = {
    x: clamp(pos.x, 30, WORLD_W - 30),
    y: clamp(pos.y, GROUND_TOP, WORLD_H - 25),
  };
  state.foodPellets.push({ id: state.nextPelletId, pos: clamped, premium, kind: food, age: 0 });
  state.nextPelletId += 1;
  return true;
}

// --- Breeding gate ---

export interface BreedingCheck {
  ok: boolean;
  reason?: string;
}

// Remaining breeding cooldown as a compact game-time string ("5h" / "40m").
export function restTimeLeft(duck: Duck): string {
  const hours = duck.breedingCooldownTicks / TICKS_PER_HOUR;
  return hours >= 1 ? `${Math.ceil(hours)}h` : `${Math.max(1, Math.ceil(hours * 60))}m`;
}

// Readiness of a single duck, independent of any partner. Used for the
// "ready to breed" indicators; canBreedPair stays the pair-level authority.
export function breedReadiness(duck: Duck): BreedingCheck {
  if (duck.stage !== 'adult') return { ok: false, reason: 'not an adult yet' };
  if (duck.penned) return { ok: false, reason: 'in the bachelor pen' };
  if (duck.sick) return { ok: false, reason: 'sick' };
  if (duck.needs.happiness <= 50) return { ok: false, reason: 'too unhappy' };
  if (duck.needs.health <= 60) return { ok: false, reason: 'not healthy enough' };
  if (duck.breedingCooldownTicks > 0)
    return { ok: false, reason: `resting, ready in ${restTimeLeft(duck)}` };
  return { ok: true };
}

export function canBreedPair(a: Duck, b: Duck): BreedingCheck {
  if (a.id === b.id) return { ok: false, reason: 'A duck cannot breed with itself' };
  if (a.stage !== 'adult' || b.stage !== 'adult')
    return { ok: false, reason: 'Both ducks must be adults' };
  if (a.sex === b.sex) return { ok: false, reason: 'Pair must be male and female' };
  for (const d of [a, b]) {
    if (d.penned) return { ok: false, reason: `${d.name} is in the bachelor pen` };
    if (d.sick) return { ok: false, reason: `${d.name} is sick` };
    if (d.needs.happiness <= 50) return { ok: false, reason: `${d.name} is too unhappy` };
    if (d.needs.health <= 60) return { ok: false, reason: `${d.name} is not healthy enough` };
    if (d.breedingCooldownTicks > 0)
      return { ok: false, reason: `${d.name} is resting (ready in ${restTimeLeft(d)})` };
  }
  return { ok: true };
}

// Chance a clutch takes, rolled when the egg is laid (end of courtship), so
// the pair's condition *during* courtship is what counts. Happiness and
// health multiply rather than average: a cheerful but sickly pair — or a
// healthy, miserable one — breeds poorly, and the starting flock sits around
// 75% so petting and feeding the courting pair is a real lever.
export function eggViability(a: Duck, b: Duck, springBonus: boolean, pressure = 0): number {
  const happy = (a.needs.happiness + b.needs.happiness) / 2 / 100;
  const health = (a.needs.health + b.needs.health) / 2 / 100;
  return clamp(
    happy * health + (springBonus ? BALANCE.springViabilityBonus : 0) - pressure * PRESSURE_VIABILITY_PENALTY,
    0,
    1,
  );
}

function getDuck(state: GameState, id: string): Duck | undefined {
  return state.ducks.find((d) => d.id === id);
}
