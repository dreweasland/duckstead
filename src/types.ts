export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export type LifeStage = 'egg' | 'duckling' | 'juvenile' | 'adult' | 'elder';

export type Activity =
  | 'idle'
  | 'waddle'
  | 'swim'
  | 'eat'
  | 'sleep'
  | 'preen'
  | 'sit'
  | 'dabble' // tail-up feeding in the water
  | 'flap' // stand tall and stretch the wings
  | 'shake'; // shake off water

export type Sex = 'M' | 'F';
