import type { Duck } from '../sim/duck';
import { drawDecoration } from '../render/scene';
import type { DecorKind } from '../sim/economy';
import { drawDuck } from '../render/duckPainter';

const IDLE_ANIM = {
  bob: 0,
  bodyTilt: 0,
  legPhase: 0,
  headDip: 0,
  headBob: 0,
  billOpen: 0,
  wingFlap: 0,
  tailWag: 0,
  headTuck: 0,
  headBack: 0,
  raise: 0,
  blink: false,
};

// Portraits are free because drawing is procedural — render the duck to a
// small offscreen canvas.
export function duckPortrait(duck: Duck, size = 72): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(size / 2 - 4, size / 2 + 6);
  const zoom = (size / 90) * (duck.stage === 'duckling' ? 1.6 : duck.stage === 'egg' ? 2 : 1);
  ctx.scale(zoom, zoom);
  drawDuck(ctx, duck, {
    inWater: false,
    selected: false,
    anim: IDLE_ANIM,
    facingLeft: false,
    eggProgress: 0,
  });
  return canvas;
}

// A small still of a decoration for the shop.
export function decorPortrait(kind: DecorKind, size = 56): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const zoom = size / 40;
  ctx.scale(zoom, zoom);
  drawDecoration(ctx, kind, { x: 20, y: 27 }, 0, 0.4);
  return canvas;
}
