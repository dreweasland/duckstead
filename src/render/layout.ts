// Where things sit: the horizon line, the deterministic scatter of tufts,
// flowers, stars, clouds, reeds, and lily pads shared by the sky, ground,
// and pond painters, and the offscreen-layer helpers the cached passes use.

import { WORLD_H, WORLD_W } from '../state';
import { createRng } from '../rng';

export const HORIZON = 195;

// ---------------------------------------------------------------------------
// Deterministic decoration layout, rebuilt only when the world width changes.

interface Deco {
  x: number;
  y: number;
  r: number;
  v: number; // free-use variant channel, 0..1
}

interface Decorations {
  w: number;
  tufts: Deco[];
  flowers: Deco[];
  stars: Deco[];
  clouds: Deco[];
  reeds: Deco[]; // x = angle on the pond rim, v picks cattail vs grass blade
  extraReeds: Deco[]; // Reed Beds upgrade clumps
  pads: Deco[]; // lily pads: x = angle, r = radial fraction
}

let decoCache: Decorations | null = null;

export function decorations(): Decorations {
  if (decoCache && decoCache.w === WORLD_W) return decoCache;
  const rng = createRng(7331);
  const make = (n: number, fn: () => Deco): Deco[] => Array.from({ length: n }, fn);
  decoCache = {
    w: WORLD_W,
    tufts: make(46, () => ({
      x: rng.range(8, WORLD_W - 8),
      y: rng.range(HORIZON + 22, WORLD_H - 12),
      r: rng.range(3, 5.5),
      v: rng.next(),
    })),
    flowers: make(26, () => ({
      x: rng.range(10, WORLD_W - 10),
      y: rng.range(HORIZON + 30, WORLD_H - 14),
      r: rng.range(2, 3.4),
      v: rng.next(),
    })),
    stars: make(70, () => ({
      x: rng.range(0, WORLD_W),
      y: rng.range(4, HORIZON - 25),
      r: rng.range(0.6, 1.5),
      v: rng.next(),
    })),
    clouds: make(5, () => ({
      x: rng.range(0, WORLD_W),
      y: rng.range(24, 120),
      r: rng.range(0.7, 1.25),
      v: rng.range(3, 7), // drift speed px/s
    })),
    reeds: make(9, () => ({
      x: rng.range(Math.PI * 1.05, Math.PI * 1.95), // upper rim only
      y: 0,
      r: rng.range(14, 26),
      v: rng.next(),
    })),
    // Reed Beds upgrade: extra clumps, six per level, all round the rim.
    extraReeds: make(18, () => ({
      x: rng.range(0, Math.PI * 2),
      y: 0,
      r: rng.range(12, 24),
      v: rng.next(),
    })),
    pads: make(4, () => ({
      x: rng.range(0, Math.PI * 2),
      y: 0,
      r: rng.range(0.45, 0.8),
      v: rng.next(),
    })),
  };
  return decoCache;
}

// ---------------------------------------------------------------------------

// Offscreen layers for the cached backdrop passes (ground, vignette): the
// canvas's effective resolution, and a bitmap rasterized at that scale.
export function effectiveScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.min(3, Math.max(0.5, Math.hypot(m.a, m.b)));
}

export function renderLayer(q: number, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(WORLD_W * q);
  canvas.height = Math.ceil(WORLD_H * q);
  const c = canvas.getContext('2d')!;
  c.scale(q, q);
  paint(c);
  return canvas;
}
