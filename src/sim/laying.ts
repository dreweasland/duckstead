// Hens lay: every adult or elder female drops one unfertilised egg a day
// when she's fed and content — whether or not she's been bred. Eggs land on
// the grass as pickups (the forage loop) and go into the basket for sale.
import type { GameState } from '../state';
import { GROUND_TOP, WORLD_H, WORLD_W } from '../state';
import type { Rng } from '../rng';
import type { Duck } from './duck';
import { clamp } from '../types';
import { pondDistance, pondGeometry } from './pond';
import { dayOf, hourOf, TICKS_PER_HOUR } from './time';
import { drakePressure } from './flockBalance';
import { upgradeLevel } from './economy';
import { TUNING } from './tuning';

const LAY_START = TUNING.laying.start;
const LAY_END = TUNING.laying.end;
const MAX_LOOSE_EGGS = TUNING.laying.maxLooseEggs;
// Spread each hen's daily egg over the laying window (~10 game-hours).
const LAY_CHANCE_PER_TICK = 1 / ((LAY_END - LAY_START) * TICKS_PER_HOUR * 0.7);

// The cheer a hen needs before she'll lay: bold hens lay through most
// things, timid ones need settling. 45 (bold) .. 65 (timid).
export function layHappinessNeeded(duck: Duck): number {
  return TUNING.laying.happinessNeeded + (0.5 - (duck.phenotype.boldness ?? 0.5)) * TUNING.laying.temperSwing;
}

export function canLayToday(duck: Duck, day: number): boolean {
  return (
    duck.sex === 'F' &&
    (duck.stage === 'adult' || duck.stage === 'elder') &&
    duck.lastLayDay !== day &&
    duck.broodyDay !== day &&
    !duck.penned &&
    !duck.sick &&
    duck.needs.hunger > 40 &&
    duck.needs.happiness > layHappinessNeeded(duck)
  );
}

export function tickLaying(state: GameState, rng: Rng): void {
  const hour = hourOf(state.clock);
  if (hour < LAY_START || hour >= LAY_END) return;
  if (state.bugs.filter((b) => b.kind === 'henEgg').length >= MAX_LOOSE_EGGS + upgradeLevel(state, 'reedBeds') * 2) return;
  const day = dayOf(state.clock);
  const courting = new Set(state.pendingClutches.map((c) => c.motherId));
  // In the last hour of the window an eligible hen lays for certain, so a
  // content hen reliably yields her egg a day.
  const lastCall = hour >= LAY_END - 1;
  // Harried hens lay less: each surplus drake is a coin-flip against the egg.
  const pressure = drakePressure(state);
  for (const duck of state.ducks) {
    if (courting.has(duck.id) || !canLayToday(duck, day)) continue;
    if (!lastCall && !rng.chance(LAY_CHANCE_PER_TICK)) continue;
    if (pressure > 0 && !rng.chance(Math.pow(0.5, pressure))) {
      duck.lastLayDay = day; // skipped today
      continue;
    }
    duck.lastLayDay = day;
    state.bugs.push({
      id: state.nextBugId,
      kind: 'henEgg',
      pos: shorePoint(state, duck, rng),
      heading: rng.range(-0.3, 0.3),
      ageTicks: 0,
      source: duck.name,
    });
    state.nextBugId += 1;
    return; // at most one egg per tick keeps the scatter natural
  }
}

// Where the egg lands: beside the hen if she's ashore, else on the nearest
// bank so it never sits in the water. Always above the card rail.
// The painted shoreline (water + sand ring) reaches ~1.15× the geometry
// ellipse, so "dry" means comfortably past that.
const DRY_DISTANCE = 1.3;

function shorePoint(state: GameState, duck: Duck, rng: Rng): { x: number; y: number } {
  let { x, y } = duck.pos;
  if (pondDistance(state, duck.pos) < DRY_DISTANCE) {
    const g = pondGeometry(state);
    const ang = Math.atan2((y - g.cy) / g.ry, (x - g.cx) / g.rx);
    const r = DRY_DISTANCE + 0.04;
    x = g.cx + Math.cos(ang) * g.rx * r;
    y = g.cy + Math.sin(ang) * g.ry * r;
    // Jitter along the bank, never back toward the water.
    const tx = -Math.sin(ang) * g.rx;
    const ty = Math.cos(ang) * g.ry;
    const len = Math.hypot(tx, ty) || 1;
    const j = rng.range(-12, 12);
    x += (tx / len) * j;
    y += (ty / len) * j;
  } else {
    x += rng.range(-14, 14);
    y += rng.range(-6, 10);
  }
  x = clamp(x, 30, WORLD_W - 30);
  y = clamp(y, GROUND_TOP, WORLD_H - 100);
  // The clamp (horizon / card rail) can drag a bank point back over water;
  // if so, slide it round the rim to the nearest dry spot.
  if (pondDistance(state, { x, y }) < DRY_DISTANCE) {
    const g = pondGeometry(state);
    const ang = Math.atan2((y - g.cy) / g.ry, (x - g.cx) / g.rx);
    const side = Math.cos(ang) < 0 ? -1 : 1;
    x = clamp(g.cx + side * g.rx * (DRY_DISTANCE + 0.06), 30, WORLD_W - 30);
    y = clamp(g.cy, GROUND_TOP, WORLD_H - 100);
  }
  return { x, y };
}
