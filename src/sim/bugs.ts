// Foraging micro-loop: small pickups dot the grass and pond so there's always
// something to tap between eggs.
//   beetle / snail — daytime critters, pocket change; a duck may snap one up
//                    first (a happiness treat for the duck).
//   firefly        — night-only glow, pocket change, so the dark hours aren't dead.
//   feather        — molted by your own ducks; coins plus a Feather Album entry.
//   duckweed       — grows on the pond rim; gather it for free feed.
//   henEgg         — laid daily by content hens (see laying.ts); basket → shop.
// Feathers and duckweed never expire, so a player returning from 16× still
// finds a handful to collect.
import type { Bug, BugKind, GameState } from '../state';
import { WORLD_H, WORLD_W } from '../state';
import type { Rng } from '../rng';
import { clamp, dist } from '../types';
import { isInPond, pondGeometry } from './pond';
import { isNight, TICKS_PER_HOUR, TICKS_PER_MINUTE } from './time';
import { upgradeLevel } from './economy';

const MAX_CRITTERS = 3; // beetles + snails
const MAX_FIREFLIES = 3;
const MAX_FEATHERS = 4;
const MAX_DUCKWEED = 3;
const CRITTER_LIFETIME = 2 * TICKS_PER_HOUR;
// Aim for roughly one spawn every ~20 game-minutes while below the cap.
const CRITTER_SPAWN_CHANCE = 1 / (20 * TICKS_PER_MINUTE);
const FIREFLY_SPAWN_CHANCE = 1 / (15 * TICKS_PER_MINUTE);
// A flock molts a feather every ~2 game-hours, and weed sprouts every ~3.
const FEATHER_SPAWN_CHANCE = 1 / (2 * TICKS_PER_HOUR);
const DUCKWEED_SPAWN_CHANCE = 1 / (3 * TICKS_PER_HOUR);
const DUCK_EAT_DISTANCE = 16;
export const BUG_CATCH_RADIUS = 18;

const SPEED: Partial<Record<BugKind, number>> = { beetle: 0.22, snail: 0.05, firefly: 0.35 };
export const BUG_REWARD: Record<BugKind, number> = {
  beetle: 3,
  snail: 2,
  firefly: 1,
  feather: 2,
  duckweed: 0, // pays in feed instead
  henEgg: 0, // goes into the egg basket
};
export const DUCKWEED_FEED = 1;

const CRITTER = new Set<BugKind>(['beetle', 'snail']);

export function tickBugs(state: GameState, rng: Rng): void {
  const night = isNight(state.clock);
  const count = (kind: BugKind) => state.bugs.filter((b) => b.kind === kind).length;
  // Reed Beds: richer ground, more of everything, and it sprouts a bit faster.
  const reeds = upgradeLevel(state, 'reedBeds');
  const boost = 1 + reeds * 0.25;

  if (!night && count('beetle') + count('snail') < MAX_CRITTERS + reeds && rng.chance(CRITTER_SPAWN_CHANCE * boost)) {
    spawnOnGrass(state, rng, rng.chance(0.55) ? 'beetle' : 'snail');
  }
  if (night && count('firefly') < MAX_FIREFLIES + reeds && rng.chance(FIREFLY_SPAWN_CHANCE * boost)) {
    spawnOnGrass(state, rng, 'firefly');
  }
  if (count('feather') < MAX_FEATHERS + reeds && rng.chance(FEATHER_SPAWN_CHANCE * boost)) {
    spawnFeather(state, rng);
  }
  if (count('duckweed') < MAX_DUCKWEED + reeds && rng.chance(DUCKWEED_SPAWN_CHANCE * boost)) {
    spawnDuckweed(state, rng);
  }

  for (let i = state.bugs.length - 1; i >= 0; i -= 1) {
    const bug = state.bugs[i];
    bug.ageTicks += 1;
    const mobile = SPEED[bug.kind];
    if (mobile !== undefined && bug.ageTicks > CRITTER_LIFETIME) {
      state.bugs.splice(i, 1);
      continue;
    }
    // Fireflies fade out at sunrise.
    if (bug.kind === 'firefly' && !night) {
      state.bugs.splice(i, 1);
      continue;
    }
    if (mobile === undefined) continue;

    // Crawl with a wander jitter; bounce off the pond and the world edges.
    // The lower bound keeps pickups above the card rail's screen strip so
    // they always stay clickable.
    bug.heading += rng.range(-0.2, 0.2) * (bug.kind === 'firefly' ? 2 : 1);
    const nx = bug.pos.x + Math.cos(bug.heading) * mobile;
    const ny = bug.pos.y + Math.sin(bug.heading) * mobile;
    const overWater = bug.kind !== 'firefly' && isInPond(state, { x: nx, y: ny });
    if (overWater || nx < 20 || nx > WORLD_W - 20 || ny < 215 || ny > WORLD_H - 95) {
      bug.heading += Math.PI;
    } else {
      bug.pos.x = nx;
      bug.pos.y = ny;
    }

    // A duck close by eats a critter — a free happiness treat.
    if (!CRITTER.has(bug.kind)) continue;
    for (const duck of state.ducks) {
      if (duck.stage === 'egg' || duck.activity === 'sleep') continue;
      if (dist(duck.pos, bug.pos) < DUCK_EAT_DISTANCE) {
        duck.needs.happiness = clamp(duck.needs.happiness + 3, 0, 100);
        state.bugs.splice(i, 1);
        break;
      }
    }
  }
}

function push(state: GameState, bug: Omit<Bug, 'id' | 'ageTicks'>): void {
  state.bugs.push({ ...bug, id: state.nextBugId, ageTicks: 0 });
  state.nextBugId += 1;
}

function spawnOnGrass(state: GameState, rng: Rng, kind: BugKind): void {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pos = { x: rng.range(40, WORLD_W - 40), y: rng.range(225, WORLD_H - 100) };
    if (kind !== 'firefly' && isInPond(state, pos)) continue;
    push(state, { kind, pos, heading: rng.range(0, Math.PI * 2) });
    return;
  }
}

// A random active duck drops a feather in its plumage color where it stands.
function spawnFeather(state: GameState, rng: Rng): void {
  const molters = state.ducks.filter(
    (d) => d.stage !== 'egg' && d.stage !== 'duckling' && d.activity !== 'sleep',
  );
  if (molters.length === 0) return;
  const duck = rng.pick(molters);
  const pos = {
    x: clamp(duck.pos.x + rng.range(-30, 30), 30, WORLD_W - 30),
    y: clamp(duck.pos.y + rng.range(10, 35), 225, WORLD_H - 100),
  };
  push(state, {
    kind: 'feather',
    pos,
    heading: rng.range(-0.6, 0.6),
    color: duck.phenotype.bodyColor,
    source: duck.name,
  });
}

// Duckweed clumps sprout just outside the pond's rim.
function spawnDuckweed(state: GameState, rng: Rng): void {
  const g = pondGeometry(state);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const a = rng.range(0, Math.PI * 2);
    const pos = { x: g.cx + Math.cos(a) * (g.rx + 22), y: g.cy + Math.sin(a) * (g.ry + 16) };
    if (pos.y < 225 || pos.y > WORLD_H - 100) continue;
    if (state.bugs.some((b) => b.kind === 'duckweed' && dist(b.pos, pos) < 40)) continue;
    push(state, { kind: 'duckweed', pos, heading: 0 });
    return;
  }
}

export interface Pickup {
  kind: BugKind;
  coins: number;
  feed: number;
  color?: string;
  source?: string;
}

// Try to collect a pickup at a world position. Returns what was gathered, or
// null for a miss.
export function catchBugAt(state: GameState, x: number, y: number): Pickup | null {
  for (let i = 0; i < state.bugs.length; i += 1) {
    const bug = state.bugs[i];
    if (dist(bug.pos, { x, y }) > BUG_CATCH_RADIUS) continue;
    state.bugs.splice(i, 1);
    const coins = BUG_REWARD[bug.kind];
    state.money += coins;
    let feed = 0;
    switch (bug.kind) {
      case 'feather':
        state.stats.feathersCollected += 1;
        if (bug.color) state.featherAlbum[bug.color] = (state.featherAlbum[bug.color] ?? 0) + 1;
        break;
      case 'duckweed':
        feed = DUCKWEED_FEED;
        state.inventory.feed += feed;
        state.stats.duckweedGathered += 1;
        break;
      case 'henEgg':
        state.inventory.eggs += 1;
        state.stats.henEggsGathered += 1;
        break;
      default:
        state.stats.bugsCaught += 1;
    }
    return { kind: bug.kind, coins, feed, color: bug.color, source: bug.source };
  }
  return null;
}
