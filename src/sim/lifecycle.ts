import type { GameState } from '../state';
import type { Rng } from '../rng';
import type { Duck } from './duck';
import { adultDurationTicks, DUCK_NAMES, EGG_DAYS, freshName, HATCH_NAMES, STAGE_DAYS } from './duck';
import { recordBreed } from './breedBook';
import { BALANCE, upgradeLevel } from './economy';
import { eggSpeedFor, eggWarmth } from './needs';
import { chronicle } from './chronicle';
import { checkHatchAwards } from './awards';
import { generationOf, livingDescendants } from './lineage';
import { pedigreeScore } from './pedigree';
import { passingPoints } from './elders';
import { events } from '../events';
import { dayOf, DAYS_PER_SEASON, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';

const YEAR_DAYS = DAYS_PER_SEASON * 4;

// Brooder Lamp: the young grow up faster.
export function growthScale(state: GameState): number {
  return 1 + upgradeLevel(state, 'brooderLamp') * 0.2;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function eggIncubationTicks(state: GameState): number {
  const days = upgradeLevel(state, 'incubator') > 0 ? EGG_DAYS / 2 : EGG_DAYS;
  return Math.round(days * TICKS_PER_DAY);
}

export function tickLifecycle(state: GameState, rng: Rng): void {
  // Birthdays at 09:00, once a season (a duck lives ~3 seasons, so a yearly
  // birthday could never arrive). A year birthday is a chronicle event.
  if (state.clock.totalTicks % TICKS_PER_DAY === 9 * TICKS_PER_HOUR) {
    const today = dayOf(state.clock);
    for (const duck of state.ducks) {
      if (duck.stage === 'egg' || duck.bornDay === undefined) continue;
      const age = today - duck.bornDay;
      if (age > 0 && age % DAYS_PER_SEASON === 0) {
        const seasons = age / DAYS_PER_SEASON;
        duck.needs.happiness = Math.min(100, duck.needs.happiness + 10);
        if (age % YEAR_DAYS === 0) {
          events.emit('toast', `${duck.name} is ${age / YEAR_DAYS} year${age === YEAR_DAYS ? '' : 's'} old today — a rare old bird!`);
          chronicle(state, 'birthday', `${duck.name} reached a full year — few ducks do.`);
        } else {
          events.emit('toast', `It's ${duck.name}'s birthday — ${seasons} season${seasons === 1 ? '' : 's'} old today!`);
        }
      }
    }
    // Lineage records for the Records screen.
    for (const duck of state.ducks) {
      if (duck.stage === 'egg') continue;
      const ped = pedigreeScore(duck);
      if (ped > state.stats.bestPedigree) state.stats.bestPedigree = ped;
      const gen = generationOf(duck);
      if (gen > state.stats.deepestGen) {
        state.stats.deepestGen = gen;
        if (gen >= 3) chronicle(state, 'milestone', `${duck.name} is the pond's first ${ordinal(gen)}-generation duck.`);
      }
    }
  }

  const dead: Duck[] = [];

  for (const duck of state.ducks) {
    duck.ageTicks += 1;

    if (duck.stage === 'egg') {
      if (duck.readyToHatch) {
        // Cracked and waiting for the player's tap; hatches itself after a
        // grace period so fast-forwarding players aren't held hostage.
        duck.readyTicks = (duck.readyTicks ?? 0) + 1;
        if (duck.readyTicks >= BALANCE.eggClaimGraceTicks) hatch(state, rng, duck);
        continue;
      }
      duck.incubationTicks += eggSpeedFor(eggWarmth(duck));
      if (duck.incubationTicks >= eggIncubationTicks(state)) {
        duck.incubationTicks = eggIncubationTicks(state);
        duck.readyToHatch = true;
        duck.readyTicks = 0;
        events.emit('toast', `${eggLabel(state, duck)} is cracking — tap it to help it hatch!`);
      }
      continue;
    }

    switch (duck.stage) {
      case 'duckling':
        if (duck.ageTicks >= (STAGE_DAYS.duckling * TICKS_PER_DAY) / growthScale(state)) {
          duck.stage = 'juvenile';
          duck.ageTicks = 0;
          state.stats.juvenilesRaised += 1;
        }
        break;
      case 'juvenile':
        if (duck.ageTicks >= (STAGE_DAYS.juvenile * TICKS_PER_DAY) / growthScale(state)) {
          duck.stage = 'adult';
          duck.ageTicks = 0;
        }
        break;
      case 'adult':
        if (duck.ageTicks >= adultDurationTicks(duck.phenotype.vigor)) {
          duck.stage = 'elder';
          duck.ageTicks = 0;
          events.emit('toast', `${duck.name} has become a wise old elder`);
        }
        break;
      case 'elder':
        if (duck.ageTicks >= STAGE_DAYS.elder * TICKS_PER_DAY) dead.push(duck);
        break;
    }

    if (duck.needs.health <= 0) dead.push(duck);
  }

  for (const duck of dead) {
    const idx = state.ducks.indexOf(duck);
    if (idx < 0) continue;
    state.ducks.splice(idx, 1);
    const descendants = livingDescendants(state, duck.id).length;
    state.memorial.push({
      name: duck.name,
      sex: duck.sex,
      bodyColor: duck.phenotype.bodyColor,
      genome: duck.genome,
      diedOnDay: dayOf(state.clock),
      rarityScore: duck.phenotype.rarityScore,
      diedStage: duck.stage,
      ageDays: duck.bornDay !== undefined ? dayOf(state.clock) - duck.bornDay : undefined,
      gen: generationOf(duck),
      pedigree: pedigreeScore(duck),
      descendants,
    });
    const age = duck.bornDay !== undefined ? dayOf(state.clock) - duck.bornDay : undefined;
    const line = descendants > 0 ? ` ${duck.sex === 'F' ? 'Her' : 'His'} line lives on in ${descendants} duck${descendants === 1 ? '' : 's'}.` : '';
    chronicle(
      state,
      'death',
      duck.stage === 'elder'
        ? `${duck.name} passed peacefully${age !== undefined ? ` at ${age} days` : ''}.${line}`
        : `${duck.name} died young${age !== undefined ? ` at ${age} days` : ''}.${line}`,
    );
    // An honoured passing: an elder that lived out its days on the pond
    // leaves a feather for the album, and the Society notes a life well
    // lived. Selling an elder forfeits all of this.
    if (duck.stage === 'elder') {
      const points = passingPoints(duck);
      state.society.points += points;
      state.society.lifetimePoints += points;
      state.featherAlbum[duck.phenotype.bodyColor] =
        (state.featherAlbum[duck.phenotype.bodyColor] ?? 0) + 1;
      events.emit(
        'toast',
        `${duck.name}'s feather rests in the album — the Society honours a life well lived (+${points})`,
      );
    }
    // A best friend grieves.
    const friend = state.ducks.find((d) => d.friendId === duck.id);
    if (friend) {
      friend.needs.happiness = Math.max(0, friend.needs.happiness - 12);
      delete friend.friendId;
    }
    events.emit('duck-died', duck);
    events.emit('toast', `${duck.name} has passed away`);
  }
}

// Player taps a cracked egg. Returns false if it isn't ready.
export function claimHatch(state: GameState, rng: Rng, eggId: string): boolean {
  const egg = state.ducks.find((d) => d.id === eggId);
  if (!egg || egg.stage !== 'egg' || !egg.readyToHatch) return false;
  hatch(state, rng, egg);
  return true;
}

// Average warmth over the incubation, 0..100.
export function eggTendingScore(egg: Duck): number {
  const ticks = Math.max(1, egg.ageTicks);
  return (egg.warmthSum ?? BALANCE.eggStartWarmth * ticks) / ticks;
}

function eggLabel(state: GameState, egg: Duck): string {
  const mother = egg.parents ? state.ducks.find((d) => d.id === egg.parents![0]) : undefined;
  return mother ? `${mother.name}'s egg` : 'An egg';
}

function hatch(state: GameState, rng: Rng, egg: Duck): void {
  // A well-tended egg hatches a content, sturdy duckling; a cold one hatches
  // hungry and grumpy and needs immediate care.
  const tended = eggTendingScore(egg) / 100;
  egg.stage = 'duckling';
  egg.ageTicks = 0;
  egg.activity = 'idle';
  egg.bornDay = dayOf(state.clock);
  egg.name = freshName(rng, state.ducks.filter((d) => d !== egg).map((d) => d.name), HATCH_NAMES, DUCK_NAMES);
  const lamp = upgradeLevel(state, 'brooderLamp') * 8;
  egg.needs = {
    hunger: Math.round(40 + 50 * tended),
    cleanliness: 90,
    happiness: Math.min(100, Math.round(45 + 55 * tended) + lamp),
    health: Math.min(100, Math.round(70 + 30 * tended) + lamp),
  };
  delete egg.warmth;
  delete egg.warmthSum;
  delete egg.readyToHatch;
  delete egg.readyTicks;
  egg.petCooldownTicks = 0;
  // Scatter slightly off the nest so siblings don't stack.
  egg.pos.x += rng.range(-25, 25);
  egg.pos.y += rng.range(10, 40);
  egg.prevPos = { ...egg.pos };
  state.stats.ducksHatched += 1;
  events.emit('egg-hatched', egg);
  const mood = tended >= 0.7 ? ' — snug and chirpy!' : tended < 0.35 ? ' — shivering and hungry, feed it!' : '!';
  events.emit('toast', `${egg.name} hatched${mood}`);
  recordBreed(state, egg);
  checkHatchAwards(state, egg);
}

