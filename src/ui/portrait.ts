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

// A square canvas at devicePixelRatio resolution, transform pre-applied.
function hidpiCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx };
}

// The procedural render, uncached.
function renderPortrait(duck: Duck, size: number): HTMLCanvasElement {
  const { canvas, ctx } = hidpiCanvas(size);
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

// The card rail and roster rebuild portraits twice a second; without a cache
// that is dozens of full procedural redraws per second for stills that
// almost never change. Key on everything the still actually shows: genome is
// immutable per id, so id + the mutable visual inputs (cleanliness bucketed
// so dirt smudges update coarsely). FIFO-capped: synthetic ducks (pedigree
// ancestors, egg-show samples) carry fresh ids and must not grow it forever.
const portraitCache = new Map<string, HTMLCanvasElement>();
const PORTRAIT_CACHE_CAP = 300;

function portraitKey(duck: Duck, size: number): string {
  const dpr = window.devicePixelRatio || 1;
  const clean = duck.stage === 'egg' ? 9 : Math.round(duck.needs.cleanliness / 15);
  const sad = duck.stage !== 'egg' && duck.needs.happiness < 25 ? 1 : 0;
  return `${duck.id}|${size}|${dpr}|${duck.stage}|${duck.sick ? 1 : 0}|${clean}|${sad}`;
}

export function duckPortrait(duck: Duck, size = 72): HTMLCanvasElement {
  const key = portraitKey(duck, size);
  let src = portraitCache.get(key);
  if (!src) {
    if (portraitCache.size >= PORTRAIT_CACHE_CAP) {
      const oldest = portraitCache.keys().next().value;
      if (oldest !== undefined) portraitCache.delete(oldest);
    }
    src = renderPortrait(duck, size);
    portraitCache.set(key, src);
  }
  // A canvas node can only live in one DOM spot, so each call still returns
  // a fresh element — but blitting the cached bitmap skips the redraw.
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.getContext('2d')!.drawImage(src, 0, 0);
  return canvas;
}

// A small still of a decoration for the shop.
export function decorPortrait(kind: DecorKind, size = 56): HTMLCanvasElement {
  const { canvas, ctx } = hidpiCanvas(size);
  const zoom = size / 40;
  ctx.scale(zoom, zoom);
  drawDecoration(ctx, kind, { x: 20, y: 27 }, 0, 0.4);
  return canvas;
}
