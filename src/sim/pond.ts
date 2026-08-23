import type { GameState } from '../state';
import { WORLD_W } from '../state';
import type { Vec2 } from '../types';
import { clamp } from '../types';
import { isOvercrowded, upgradeLevel } from './economy';
import { TICKS_PER_HOUR } from './time';

export interface PondGeometry {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function pondGeometry(state: GameState): PondGeometry {
  const level = upgradeLevel(state, 'pondExpansion');
  return { cx: WORLD_W / 2, cy: 400, rx: 190 + level * 40, ry: 100 + level * 20 };
}

// The nest hugs the top-right of the play area, wherever the edge is.
export function nestPos(): Vec2 {
  return { x: WORLD_W - 130, y: 210 };
}

// Feeding trough on the grass, left of the pond.
export const FEEDER_POS: Vec2 = { x: 150, y: 330 };
export const FEEDER_RADIUS = 55; // click + eat-from distance

export function isInPond(state: GameState, p: Vec2): boolean {
  return pondDistance(state, p) <= 1;
}

// Normalised elliptical distance from the pond centre: 1 = the water's edge.
export function pondDistance(state: GameState, p: Vec2): number {
  const g = pondGeometry(state);
  const dx = (p.x - g.cx) / g.rx;
  const dy = (p.y - g.cy) / g.ry;
  return Math.sqrt(dx * dx + dy * dy);
}

// The drawn shoreline wobbles wider than the geometry ellipse, so "ashore"
// for roosting means well clear of the water, not one pixel past the edge.
export const SHORE_MARGIN = 1.4;

export function isAshore(state: GameState, p: Vec2): boolean {
  return pondDistance(state, p) >= SHORE_MARGIN;
}

// Pond dirtiness accumulates with flock size; the bog filter halves it and
// the waterfall's aeration slows it further.
export function tickPond(state: GameState): void {
  const activeDucks = state.ducks.filter((d) => d.stage !== 'egg').length;
  const filterScale = upgradeLevel(state, 'pondFilter') > 0 ? 0.5 : 1;
  const aerationScale = upgradeLevel(state, 'waterfall') > 0 ? 0.7 : 1;
  // A crowded pond fouls faster than the headcount alone suggests.
  const crowdScale = isOvercrowded(state) ? 1.5 : 1;
  const dirtPerHour = 0.4 * activeDucks * filterScale * aerationScale * crowdScale;
  state.pond.cleanliness = clamp(state.pond.cleanliness - dirtPerHour / TICKS_PER_HOUR, 0, 100);
}

export function cleanPond(state: GameState): void {
  state.pond.cleanliness = 100;
}

export function isPondDirty(state: GameState): boolean {
  return state.pond.cleanliness < 40;
}
