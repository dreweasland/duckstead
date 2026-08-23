import type { GameState } from '../state';
import { GROUND_TOP, WORLD_H, WORLD_W } from '../state';
import type { Rng } from '../rng';
import type { Vec2 } from '../types';
import { clamp, dist } from '../types';
import type { Duck } from './duck';
import { duckRadius } from './duck';
import { BALANCE } from './economy';
import { events } from '../events';
import { FEEDER_POS, FEEDER_RADIUS, isAshore, isInPond, nestPos, pondGeometry } from './pond';
import { eatFood, favouriteTreat, FOODS } from './food';
import { chronicle } from './chronicle';
import { isNight } from './time';

// Below this the card rail overlaps the scene; ducks prefer to stay above it.
const LOW_STRIP_Y = WORLD_H - 120;
const WADDLE_SPEED = 1.1; // world units per tick
const SWIM_SPEED = 0.8;
const SEEK_SPEED = 1.6;
const EAT_DISTANCE = 14;
// Ducks are ~44 units across; keep centres well apart so they're clickable.
const SEPARATION_DIST = 42;
const FOLLOW_MOM_DIST = 70; // ducklings trail their mother past this

// Stable per-duck temperament derived from the duck's identity — no stored
// state, no save-format change. Energy scales how briskly a duck cycles
// through activities; sociability pulls it toward (or away from) the flock.
export interface Personality {
  energy: number; // 0.75 (mellow) .. 1.3 (busy)
  sociability: number; // -1 (loner) .. 1 (flocker)
}

export function personality(duck: Duck): Personality {
  let h = 0;
  for (let i = 0; i < duck.id.length; i += 1) h = (h * 31 + duck.id.charCodeAt(i)) >>> 0;
  return {
    energy: 0.75 + ((h % 97) / 96) * 0.55,
    sociability: (((h >>> 8) % 89) / 88) * 2 - 1,
  };
}

// Human-readable temperament tags for panels and tooltips.
export function personalityLabels(duck: Duck): string[] {
  const p = personality(duck);
  const labels: string[] = [];
  if (p.energy > 1.15) labels.push('energetic');
  else if (p.energy < 0.9) labels.push('mellow');
  if (p.sociability > 0.5) labels.push('social');
  else if (p.sociability < -0.5) labels.push('loner');
  return labels;
}

// Once per game-hour, sample who each duck is hanging around with; a steady
// companion becomes their best friend.
const FRIEND_SAMPLE_TICKS = 600;
const FRIEND_RANGE = 110;
const FRIEND_STREAK_NEEDED = 5;

function tickFriendships(state: GameState): void {
  if (state.clock.totalTicks % FRIEND_SAMPLE_TICKS !== 0) return;
  const active = state.ducks.filter((d) => d.stage !== 'egg');
  for (const duck of active) {
    let nearest: Duck | null = null;
    let nearestDist = FRIEND_RANGE;
    for (const other of active) {
      if (other === duck) continue;
      const d = dist(duck.pos, other.pos);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = other;
      }
    }
    if (!nearest) continue;
    if (duck.friendCandidate === nearest.id) {
      duck.friendStreak = (duck.friendStreak ?? 0) + 1;
      if ((duck.friendStreak ?? 0) >= FRIEND_STREAK_NEEDED && duck.friendId !== nearest.id) {
        duck.friendId = nearest.id;
        if (nearest.friendId === duck.id) {
          events.emit('toast', `${duck.name} and ${nearest.name} are now inseparable!`);
          chronicle(state, 'milestone', `${duck.name} and ${nearest.name} became inseparable.`);
        }
      }
    } else {
      duck.friendCandidate = nearest.id;
      duck.friendStreak = 1;
    }
  }
}

export function tickBehavior(state: GameState, rng: Rng): void {
  const night = isNight(state.clock);

  // Flock centroid, used by sociable ducks as a gentle wander bias.
  const active = state.ducks.filter((d) => d.stage !== 'egg');
  const centroid = { x: 0, y: 0 };
  for (const d of active) {
    centroid.x += d.pos.x / active.length;
    centroid.y += d.pos.y / active.length;
  }

  for (const duck of state.ducks) {
    if (duck.stage === 'egg') {
      // Keep eggs glued to the nest even when the world width changes.
      if (duck.nestOffset) {
        const nest = nestPos();
        duck.pos.x = nest.x + duck.nestOffset.x;
        duck.pos.y = nest.y + duck.nestOffset.y;
      }
      duck.prevPos = { ...duck.pos };
      continue;
    }
    duck.prevPos = { ...duck.pos };

    decideActivity(state, duck, rng, night);
    steer(state, duck, rng, centroid, active.length);
  }

  tickFriendships(state);
}

function decideActivity(state: GameState, duck: Duck, rng: Rng, night: boolean): void {
  // Sleep overrides everything at night once ashore.
  if (night) {
    if (duck.activity !== 'sleep') {
      // Asleep once clear of the water — or on reaching the roost spot, so a
      // duck can never jog in place against an unreachable margin.
      if (isAshore(state, duck.pos) || dist(duck.pos, roostSpot(state, duck)) < 6) {
        duck.activity = 'sleep';
        duck.activityTimer = 0;
      } else if (duck.activity !== 'waddle') {
        // Head for shore.
        duck.activity = 'waddle';
        duck.activityTimer = 9999;
      }
    }
    return;
  }
  if (duck.activity === 'sleep') {
    duck.activity = 'idle';
    duck.activityTimer = 0;
  }

  // Hungry ducks with food available go eat, whatever they were doing.
  const foodAvailable = state.foodPellets.length > 0 || state.feeder.food > 0;
  if (duck.needs.hunger < 60 && foodAvailable && duck.activity !== 'eat') {
    duck.activity = 'eat';
    duck.activityTimer = 9999;
    return;
  }
  if (duck.activity === 'eat' && !foodAvailable) {
    duck.activity = 'idle';
    duck.activityTimer = 0;
  }

  duck.activityTimer -= 1;
  if (duck.activityTimer > 0) return;

  // Pick a new casual activity. Energetic ducks pick brisker activities and
  // hold each one for less time; mellow ducks laze about longer.
  const inPond = isInPond(state, duck.pos);
  const { energy } = personality(duck);
  const dur = (base: number) => Math.round((rng.int(base) + base * 0.6) / energy);
  const roll = rng.next() * energy;

  if (inPond) {
    // Coming ashore from a swim sometimes ends in a shake-off.
    if (duck.activity === 'swim' && roll > 0.85) {
      duck.activity = 'shake';
      duck.activityTimer = 14;
    } else if (roll < 0.18) {
      duck.activity = 'idle';
      duck.activityTimer = dur(40);
    } else if (roll < 0.34) {
      duck.activity = 'dabble';
      duck.activityTimer = dur(35);
    } else if (roll < 0.48) {
      duck.activity = 'preen';
      duck.activityTimer = dur(30);
    } else {
      duck.activity = 'swim';
      duck.wanderTarget = randomPondPoint(state, rng);
      duck.activityTimer = travelTime(duck, duck.wanderTarget, SWIM_SPEED, dur(80));
      duck.heading = Math.atan2(duck.wanderTarget.y - duck.pos.y, duck.wanderTarget.x - duck.pos.x);
    }
    return;
  }

  if (roll < 0.14) {
    duck.activity = 'idle';
    duck.activityTimer = dur(40);
  } else if (roll < 0.3) {
    // Forage: nose along the grass in a slow zigzag.
    duck.activity = 'forage';
    duck.activityTimer = dur(50);
    duck.heading = rng.range(0, Math.PI * 2);
  } else if (roll < 0.4) {
    duck.activity = 'preen';
    duck.activityTimer = dur(30);
  } else if (roll < 0.48) {
    duck.activity = 'flap';
    duck.activityTimer = 18;
  } else if (roll < 0.53) {
    duck.activity = 'shake';
    duck.activityTimer = 14;
  } else if (roll < 0.85) {
    duck.activity = rng.chance(0.5) ? 'swim' : 'waddle';
    duck.wanderTarget = duck.activity === 'swim' ? randomPondPoint(state, rng) : randomGrassPoint(state, rng);
    duck.activityTimer = travelTime(duck, duck.wanderTarget, duck.activity === 'swim' ? SWIM_SPEED : WADDLE_SPEED, dur(70));
    duck.heading = Math.atan2(duck.wanderTarget.y - duck.pos.y, duck.wanderTarget.x - duck.pos.x);
  } else {
    duck.activity = 'waddle';
    duck.wanderTarget = randomGrassPoint(state, rng);
    duck.activityTimer = travelTime(duck, duck.wanderTarget, WADDLE_SPEED, dur(60));
    duck.heading = Math.atan2(duck.wanderTarget.y - duck.pos.y, duck.wanderTarget.x - duck.pos.x);
  }
}

function steer(
  state: GameState,
  duck: Duck,
  rng: Rng,
  centroid: Vec2,
  flockSize: number,
): void {
  let speed = 0;
  let target: Vec2 | null = null;

  switch (duck.activity) {
    case 'idle':
    case 'preen':
    case 'sit':
    case 'sleep':
    case 'dabble':
    case 'flap':
    case 'shake':
      break;
    case 'forage': {
      // Creep forward between pecks, veering now and then; water ends it.
      speed = WADDLE_SPEED * 0.25;
      if (rng.chance(0.03)) duck.heading += rng.range(-0.9, 0.9);
      if (isInPond(state, duck.pos)) {
        duck.activity = 'swim';
        duck.activityTimer = 40;
      }
      // Nibbling keeps the peckish going a little longer.
      if (rng.chance(1 / 200)) duck.needs.hunger = clamp(duck.needs.hunger + 1, 0, 100);
      break;
    }
    case 'waddle': {
      speed = WADDLE_SPEED;
      if (isNight(state.clock)) target = roostSpot(state, duck);
      else if (duck.wanderTarget) {
        if (dist(duck.pos, duck.wanderTarget) < 12) delete duck.wanderTarget;
        else target = duck.wanderTarget;
      }
      break;
    }
    case 'swim': {
      speed = SWIM_SPEED;
      // Swimmers outside the pond head toward it; inside, they cross to a
      // chosen point, then drift freely.
      if (!isInPond(state, duck.pos)) {
        if (duck.wanderTarget && !isInPond(state, duck.wanderTarget)) {
          // Climbed out on the far bank with a grass destination: walk on.
          duck.activity = 'waddle';
          target = duck.wanderTarget;
          speed = WADDLE_SPEED;
        } else {
          target = duck.wanderTarget && isInPond(state, duck.wanderTarget) ? duck.wanderTarget : randomPondPoint(state, rng);
          speed = WADDLE_SPEED;
        }
      } else if (duck.wanderTarget) {
        // A grass destination across the water: swim straight for it.
        if (dist(duck.pos, duck.wanderTarget) < 12) delete duck.wanderTarget;
        else target = duck.wanderTarget;
      }
      break;
    }
    case 'eat': {
      const pellet = nearestPellet(state, duck.pos);
      const feederOpen = state.feeder.food > 0;
      const pelletDist = pellet ? dist(duck.pos, pellet.pos) : Infinity;
      const feederDist = feederOpen ? dist(duck.pos, FEEDER_POS) : Infinity;
      if (!pellet && !feederOpen) break;
      speed = SEEK_SPEED;

      if (pelletDist <= feederDist && pellet) {
        target = pellet.pos;
        if (pelletDist < EAT_DISTANCE) {
          state.foodPellets.splice(state.foodPellets.indexOf(pellet), 1);
          const result = eatFood(state, duck, pellet.kind ?? (pellet.premium ? 'premiumFeed' : 'feed'));
          if (result.discovered) {
            events.emit('toast', `${duck.name} loves ${FOODS[favouriteTreat(duck)].name.toLowerCase()}!`);
            events.emit('favourite-found', duck);
          }
          duck.activity = 'idle';
          duck.activityTimer = 15;
          speed = 0;
        }
      } else {
        // Stand at the trough edge and help yourself.
        target = FEEDER_POS;
        if (feederDist < FEEDER_RADIUS * 0.7) {
          state.feeder.food -= 1;
          duck.needs.hunger = clamp(duck.needs.hunger + BALANCE.feedRestore, 0, 100);
          // Fed: drift back toward the water so the trough doesn't become a
          // permanent camp on the left bank.
          duck.activity = 'waddle';
          duck.activityTimer = 60;
          duck.wanderTarget = randomPondPoint(state, rng);
          speed = 0;
        }
      }
      break;
    }
  }

  // Ducklings imprint on their mother and hurry back when she gets too far,
  // so broods trail behind her in a line.
  // At night the roost spot already puts a duckling beside its mother, so the
  // follow rule stands down — otherwise the two pulls fight at the boundary
  // and the duckling jogs in place all night.
  if (
    duck.stage === 'duckling' &&
    duck.activity !== 'eat' &&
    duck.activity !== 'sleep' &&
    duck.parents &&
    !isNight(state.clock)
  ) {
    const mom = state.ducks.find((d) => d.id === duck.parents![0]);
    if (mom && dist(duck.pos, mom.pos) > FOLLOW_MOM_DIST) {
      target = mom.pos;
      speed = Math.max(speed, WADDLE_SPEED * 1.25);
      if (duck.activity !== 'waddle' && duck.activity !== 'swim') {
        duck.activity =
          isInPond(state, mom.pos) && isInPond(state, duck.pos) ? 'swim' : 'waddle';
        duck.activityTimer = 30;
      }
    }
  }

  const { sociability } = personality(duck);

  // Standing ducks still shuffle apart: a pile-up is unclickable, and ducks
  // don't sit on each other anyway. Sleepers shuffle too, just slower.
  if (speed === 0) {
    const shuffle = duck.activity === 'sleep' ? 0.05 : 0.35;
    const { dx, dy } = separation(state, duck, sociability, shuffle);
    if (dx !== 0 || dy !== 0) {
      duck.pos.x = clamp(duck.pos.x + dx, duckRadius(duck), WORLD_W - duckRadius(duck));
      duck.pos.y = clamp(duck.pos.y + dy, GROUND_TOP, WORLD_H - 50);
    }
    return;
  }

  // Wander jitter + goal seek + separation.
  if (target) {
    duck.heading = Math.atan2(target.y - duck.pos.y, target.x - duck.pos.x);
  } else {
    duck.heading += rng.range(-0.15, 0.15);
    // The bottom strip of the world sits under the card rail on screen, so
    // wanderers drifting down there are nudged back up toward the action.
    if (duck.pos.y > LOW_STRIP_Y) {
      duck.heading += angleDiff(-Math.PI / 2, duck.heading) * 0.08;
    }
    // Sociable ducks drift toward the flock while wandering; loners don't.
    if (sociability > 0.15 && flockSize > 1) {
      const toFlock = Math.atan2(centroid.y - duck.pos.y, centroid.x - duck.pos.x);
      duck.heading += angleDiff(toFlock, duck.heading) * 0.025 * sociability;
    }
    // Best friends drift back toward each other when they stray apart.
    if (duck.friendId) {
      const friend = state.ducks.find((d) => d.id === duck.friendId);
      if (friend && dist(duck.pos, friend.pos) > 140) {
        const toFriend = Math.atan2(friend.pos.y - duck.pos.y, friend.pos.x - duck.pos.x);
        duck.heading += angleDiff(toFriend, duck.heading) * 0.04;
      }
    }
  }

  let dx = Math.cos(duck.heading) * speed;
  let dy = Math.sin(duck.heading) * speed;

  const sep = separation(state, duck, sociability, 1);
  dx += sep.dx;
  dy += sep.dy;

  duck.pos.x = clamp(duck.pos.x + dx, duckRadius(duck), WORLD_W - duckRadius(duck));
  duck.pos.y = clamp(duck.pos.y + dy, GROUND_TOP, WORLD_H - 50);

  // Waddlers bounce off the pond edge; swimmers stay in open water.
  if (duck.activity === 'waddle' && isInPond(state, duck.pos) && !isNight(state.clock)) {
    duck.activity = 'swim';
  }
}

// Long enough to actually arrive, plus a little lingering at the far end.
function travelTime(duck: Duck, to: Vec2, speed: number, base: number): number {
  return Math.max(base, Math.ceil(dist(duck.pos, to) / speed) + 20);
}

// A random point well inside the pond.
export function randomPondPoint(state: GameState, rng: Rng): Vec2 {
  const g = pondGeometry(state);
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(rng.next()) * 0.85;
  return { x: g.cx + Math.cos(a) * g.rx * r, y: g.cy + Math.sin(a) * g.ry * r };
}

// A random point on the grass (anywhere on the map that isn't water, above
// the card rail), so waddlers actually explore the whole bank.
export function randomGrassPoint(state: GameState, rng: Rng): Vec2 {
  for (let i = 0; i < 10; i += 1) {
    const p = { x: rng.range(40, WORLD_W - 40), y: rng.range(GROUND_TOP + 10, WORLD_H - 110) };
    if (!isInPond(state, p)) return p;
  }
  const g = pondGeometry(state);
  return { x: g.cx + g.rx * 1.4, y: g.cy };
}

// Each duck's night roost: a fixed spot on the upper bank, fanned by id so
// the flock spreads out, placed well outside the shore margin and kept on
// the grass (not in the sky, not under the card rail, not off-screen).
export function roostSpot(state: GameState, duck: Duck): Vec2 {
  // Ducklings tuck in beside their mother, fanned out by id so a brood
  // doesn't stack.
  if (duck.stage === 'duckling' && duck.parents) {
    const mom = state.ducks.find((d) => d.id === duck.parents![0]);
    if (mom && mom.stage !== 'egg') {
      const spot = roostSpot(state, mom);
      let h = 0;
      for (let i = 0; i < duck.id.length; i += 1) h = (h * 31 + duck.id.charCodeAt(i)) >>> 0;
      const side = (h % 2 === 0 ? 1 : -1) * (1 + (h >>> 3) % 2);
      return { x: spot.x + side * 22, y: spot.y + 10 + ((h >>> 5) % 3) * 6 };
    }
  }
  // Best friends roost side by side: the younger follows the elder's spot.
  if (duck.friendId) {
    const friend = state.ducks.find((d) => d.id === duck.friendId);
    if (friend && friend.friendId === duck.id && friend.id < duck.id) {
      const spot = roostSpot(state, friend);
      return { x: spot.x + 30, y: spot.y + 6 };
    }
  }
  const g = pondGeometry(state);
  // Fan the flock evenly along the upper bank (9 o'clock round to 3 o'clock),
  // ordered by id so each duck keeps the same spot night after night.
  const roosters = state.ducks.filter((d) => d.stage !== 'egg' && d.stage !== 'duckling').map((d) => d.id).sort();
  const idx = Math.max(0, roosters.indexOf(duck.id));
  const n = Math.max(1, roosters.length);
  let theta = Math.PI * 1.08 + ((idx + 0.5) / n) * Math.PI * 0.84;
  const r = duckRadius(duck) + 4;
  // Just past the shore margin; a fully expanded pond on a narrow window
  // can't fit 1.55× to the sides, so shrink toward the margin as needed.
  const radius = clamp((g.cx - r) / g.rx, 1.44, 1.55);
  // Keep the spot below the horizon: flatten the angle toward the sides if
  // the top of a big pond would put it in the sky.
  const minSin = -(g.cy - GROUND_TOP - 8) / (radius * g.ry);
  if (Math.sin(theta) < minSin) {
    const lim = Math.asin(Math.max(-1, minSin)); // negative angle
    theta = Math.cos(theta) < 0 ? Math.PI - lim : lim + Math.PI * 2;
  }
  return {
    x: clamp(g.cx + Math.cos(theta) * g.rx * radius, r, WORLD_W - r),
    y: clamp(g.cy + Math.sin(theta) * g.ry * radius, GROUND_TOP, WORLD_H - 60),
  };
}

// Push away from any duck inside the personal bubble. Loners keep a wider
// bubble. `scale` tempers the shove for ducks that are standing still.
function separation(state: GameState, duck: Duck, sociability: number, scale: number): { dx: number; dy: number } {
  const sepDist = SEPARATION_DIST + (sociability < 0 ? -sociability * 14 : 0);
  let dx = 0;
  let dy = 0;
  for (const other of state.ducks) {
    if (other === duck || other.stage === 'egg') continue;
    const d = dist(duck.pos, other.pos);
    if (d > 0 && d < sepDist) {
      const push = ((sepDist - d) / sepDist) * 0.6 * scale;
      dx += ((duck.pos.x - other.pos.x) / d) * push;
      dy += ((duck.pos.y - other.pos.y) / d) * push;
    } else if (d === 0) {
      // Exactly stacked (e.g. two hatchlings): nudge apart deterministically.
      dx += 0.3 * scale;
    }
  }
  return { dx, dy };
}

// Shortest signed angle from `from` to `to`, in (-PI, PI].
function angleDiff(to: number, from: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function nearestPellet(state: GameState, pos: Vec2) {
  let best = null;
  let bestDist = Infinity;
  for (const pellet of state.foodPellets) {
    const d = dist(pos, pellet.pos);
    if (d < bestDist) {
      bestDist = d;
      best = pellet;
    }
  }
  return best;
}
