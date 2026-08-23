// The Bachelor Pen: a fenced paddock on the right bank where surplus ducks
// (drakes, usually) can be kept out of the breeding population without
// being sold. Penned ducks don't count toward drake pressure, can't nest or
// lay, and stay inside the fence — but they still eat and get grubby.
import type { GameState } from '../state';
import { WORLD_W } from '../state';
import type { Vec2 } from '../types';
import type { Duck } from './duck';
import { upgradeLevel } from './economy';
import { pondGeometry } from './pond';

export const PEN_PER_LEVEL = 3;

export interface PenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function penLevel(state: GameState): number {
  return upgradeLevel(state, 'bachelorPen');
}

export function penCapacity(state: GameState): number {
  return penLevel(state) * PEN_PER_LEVEL;
}

// The paddock sits on the right bank below the nest, clear of the pond at
// every expansion level; level 2 is a longer fence.
export function penRect(state: GameState): PenRect {
  const g = pondGeometry(state);
  const level = Math.max(1, penLevel(state));
  const wanted = 120 + (level - 1) * 60;
  const h = 84;
  // Shrink to whatever bank is left between the pond and the screen edge
  // (a fully expanded pond on a narrow window leaves little), never
  // narrower than a usable 90px.
  const available = WORLD_W - 30 - (g.cx + g.rx + 16);
  const w = Math.max(90, Math.min(wanted, available));
  const x = WORLD_W - 30 - w;
  const y = 330;
  return { x, y, w, h };
}

export function inPen(state: GameState, p: Vec2): boolean {
  const r = penRect(state);
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function clampToPen(state: GameState, p: Vec2, margin = 14): Vec2 {
  const r = penRect(state);
  return {
    x: Math.min(r.x + r.w - margin, Math.max(r.x + margin, p.x)),
    y: Math.min(r.y + r.h - margin, Math.max(r.y + margin, p.y)),
  };
}

export function penDucks(state: GameState): Duck[] {
  return state.ducks.filter((d) => d.penned && d.stage !== 'egg');
}

// A settled spot for each penned duck, evenly spaced so they don't pile up.
export function penSpot(state: GameState, duck: Duck): Vec2 {
  const r = penRect(state);
  const mates = penDucks(state).map((d) => d.id).sort();
  const idx = Math.max(0, mates.indexOf(duck.id));
  const n = Math.max(1, mates.length);
  const cols = Math.min(3, n);
  const row = Math.floor(idx / cols);
  const col = idx % cols;
  const rows = Math.max(1, Math.ceil(n / cols));
  return {
    x: r.x + ((col + 0.5) / cols) * r.w,
    y: r.y + ((row + 0.5) / rows) * r.h,
  };
}

export function canPen(state: GameState, duck: Duck): { ok: boolean; reason?: string } {
  if (penLevel(state) === 0) return { ok: false, reason: 'Buy the Bachelor Pen at the shop' };
  if (duck.stage === 'egg' || duck.stage === 'duckling') return { ok: false, reason: 'Too young for the pen' };
  if (duck.penned) return { ok: false, reason: 'Already in the pen' };
  const used = penDucks(state).length;
  if (used >= penCapacity(state)) return { ok: false, reason: `The pen is full (${used}/${penCapacity(state)})` };
  return { ok: true };
}

export function penDuck(state: GameState, duckId: string): { ok: boolean; reason?: string } {
  const duck = state.ducks.find((d) => d.id === duckId);
  if (!duck) return { ok: false, reason: 'Duck not found' };
  const gate = canPen(state, duck);
  if (!gate.ok) return gate;
  duck.penned = true;
  // Walk in through the gate rather than teleporting across the map.
  duck.activity = 'waddle';
  duck.activityTimer = 9999;
  duck.wanderTarget = penSpot(state, duck);
  return { ok: true };
}

export function releaseDuck(state: GameState, duckId: string): boolean {
  const duck = state.ducks.find((d) => d.id === duckId);
  if (!duck || !duck.penned) return false;
  delete duck.penned;
  delete duck.pennedInside;
  duck.activity = 'waddle';
  duck.activityTimer = 60;
  delete duck.wanderTarget;
  return true;
}
