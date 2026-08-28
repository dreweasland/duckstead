import type { GameState } from '../state';
import { WORLD_H, WORLD_W } from '../state';
import type { Season, Vec2 } from '../types';
import { upgradeLevel, type DecorKind } from '../sim/economy';
import { activeStyle, type StyleDef } from '../sim/society';
import { penRect, type PenRect } from '../sim/pen';
import { drawDuck } from './duckPainter';
import { createDuck } from '../sim/duck';
import { representativeGenome } from '../sim/breedBook';

// A fixed specimen for the champion statue (grey stone regardless of breed).
const STATUE_DUCK = createDuck(createRng(77), { genome: representativeGenome('M|D|solid|c'), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M', name: 'statue' });
const STATUE_ANIM = { bob: 0, bodyTilt: 0, legPhase: 0, headDip: 0, headBob: 0, billOpen: 0, wingFlap: 0, tailWag: 0, headTuck: 0, headBack: 0, raise: 1, blink: false };
import { lerp } from '../types';
import { createRng } from '../rng';
import { mixColors } from '../sim/genetics';
import { FEEDER_POS, nestPos, pondGeometry } from '../sim/pond';
import { feederCapacity } from '../sim/needs';
import { festivalToday } from '../sim/festivals';
import { hourOf, seasonOf } from '../sim/time';
import { weatherOf } from '../sim/weather';

interface SkyStop {
  hour: number;
  top: string;
  bottom: string;
}

const SKY_STOPS: SkyStop[] = [
  { hour: 0, top: '#0a0f2e', bottom: '#1c2447' },
  { hour: 4.5, top: '#141b3e', bottom: '#3a3560' },
  { hour: 6, top: '#3f5a8a', bottom: '#e8956d' },
  { hour: 8, top: '#6aa5d8', bottom: '#c8e0f0' },
  { hour: 12, top: '#5b9fd8', bottom: '#b9dcf2' },
  { hour: 17, top: '#5f92c8', bottom: '#e8c48a' },
  { hour: 19.5, top: '#41436e', bottom: '#e08a5f' },
  { hour: 21.5, top: '#151b40', bottom: '#3d3358' },
  { hour: 24, top: '#0a0f2e', bottom: '#1c2447' },
];

// Society styles recolour the pond; the season still shows through.
function grassColor(season: Season, state: GameState): string {
  const style = activeStyle(state, 'grass');
  return style ? mixColors(SEASON_GRASS[season], style.colors[0], 0.55) : SEASON_GRASS[season];
}

const SEASON_GRASS: Record<Season, string> = {
  spring: '#77b055',
  summer: '#68a046',
  autumn: '#a58e42',
  winter: '#c3ced2',
};

const SEASON_TREE: Record<Season, string> = {
  spring: '#4f9440',
  summer: '#3f7d2c',
  autumn: '#b06e2c',
  winter: '#7f959c',
};

const SEASON_TREELINE: Record<Season, string> = {
  spring: '#5e9451',
  summer: '#527f3e',
  autumn: '#8f7a3d',
  winter: '#a3b2b8',
};

const HORIZON = 195;

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

function decorations(): Decorations {
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

export function darknessAt(hour: number): number {
  if (hour >= 21 || hour < 5) return 1;
  if (hour >= 19.5) return (hour - 19.5) / 1.5;
  if (hour < 6.5) return 1 - (hour - 5) / 1.5;
  return 0;
}

// ---------------------------------------------------------------------------

// --- Static backdrop cache --------------------------------------------------
// The treeline, grass, tufts, flowers, and trees change only with world size,
// season, and grass style — yet they were re-rasterized every frame (dozens
// of paths and gradients). Render once to an offscreen bitmap at the canvas's
// effective resolution and blit. The sky, sun/moon, stars, and clouds stay
// live: they animate, and the sun must slip behind the cached treeline.
let groundCache: { key: string; canvas: HTMLCanvasElement } | null = null;
let vignetteCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function effectiveScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.min(3, Math.max(0.5, Math.hypot(m.a, m.b)));
}

function renderLayer(q: number, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(WORLD_W * q);
  canvas.height = Math.ceil(WORLD_H * q);
  const c = canvas.getContext('2d')!;
  c.scale(q, q);
  paint(c);
  return canvas;
}

export function drawScene(ctx: CanvasRenderingContext2D, state: GameState, timeMs: number): void {
  const hour = hourOf(state.clock);
  const season = seasonOf(state.clock);
  const dark = darknessAt(hour);

  drawSky(ctx, hour);
  drawStars(ctx, dark, timeMs);
  drawSunMoon(ctx, hour);
  drawClouds(ctx, dark, timeMs);
  const q = effectiveScale(ctx);
  const groundKey = `${WORLD_W}x${WORLD_H}|${season}|${grassColor(season, state)}|${q.toFixed(2)}`;
  if (!groundCache || groundCache.key !== groundKey) {
    groundCache = {
      key: groundKey,
      canvas: renderLayer(q, (c) => {
        drawTreeline(c, season);
        drawGrass(c, season, state);
        drawGroundDecor(c, season, state);
        drawTrees(c, season);
      }),
    };
  }
  ctx.drawImage(groundCache.canvas, 0, 0, WORLD_W, WORLD_H);
  drawVetClinic(ctx, state);
  drawFeeder(ctx, state);
  drawNest(ctx, state);
  drawBachelorPen(ctx, state);
  drawPond(ctx, state, hour, timeMs);
  drawVignette(ctx);
}

function drawSky(ctx: CanvasRenderingContext2D, hour: number): void {
  let i = 0;
  while (i < SKY_STOPS.length - 2 && SKY_STOPS[i + 1].hour <= hour) i += 1;
  const a = SKY_STOPS[i];
  const b = SKY_STOPS[i + 1];
  const t = (hour - a.hour) / (b.hour - a.hour);
  const grad = ctx.createLinearGradient(0, 0, 0, HORIZON + 40);
  grad.addColorStop(0, mixColors(a.top, b.top, t));
  grad.addColorStop(1, mixColors(a.bottom, b.bottom, t));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WORLD_W, HORIZON + 40);
}

function drawStars(ctx: CanvasRenderingContext2D, dark: number, timeMs: number): void {
  if (dark <= 0.2) return;
  const t = timeMs / 1000;
  for (const star of decorations().stars) {
    const twinkle = 0.55 + 0.45 * Math.sin(t * (0.8 + star.v) + star.v * 20);
    ctx.globalAlpha = (dark - 0.2) * twinkle;
    ctx.fillStyle = '#e8ecff';
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSunMoon(ctx: CanvasRenderingContext2D, hour: number): void {
  const daytime = hour >= 6 && hour < 21;
  const t = daytime ? (hour - 6) / 15 : ((hour + 24 - 21) % 24) / 9;
  const x = lerp(60, WORLD_W - 60, t);
  const y = 175 - Math.sin(t * Math.PI) * 135;

  // Soft halo.
  const halo = ctx.createRadialGradient(x, y, 4, x, y, daytime ? 78 : 48);
  halo.addColorStop(0, daytime ? 'rgba(255, 226, 140, 0.5)' : 'rgba(226, 230, 250, 0.28)');
  halo.addColorStop(1, 'rgba(255, 226, 140, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, daytime ? 78 : 48, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, daytime ? 26 : 18, 0, Math.PI * 2);
  ctx.fillStyle = daytime ? '#ffe08a' : '#e8e6da';
  ctx.fill();
  if (!daytime) {
    // Crescent shadow + craters.
    ctx.beginPath();
    ctx.arc(x - 7, y - 4, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 26, 60, 0.5)';
    ctx.fill();
    ctx.fillStyle = 'rgba(160, 160, 150, 0.4)';
    for (const [ox, oy, r] of [
      [5, 2, 2.4],
      [1, 7, 1.6],
      [8, -4, 1.4],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawClouds(ctx: CanvasRenderingContext2D, dark: number, timeMs: number): void {
  const t = timeMs / 1000;
  const tint = mixColors('#ffffff', '#5a628f', dark * 0.75);
  for (const cloud of decorations().clouds) {
    const span = WORLD_W + 260;
    const x = ((cloud.x + t * cloud.v) % span) - 130;
    const s = cloud.r;
    ctx.fillStyle = tint;
    ctx.globalAlpha = 0.82 - dark * 0.3;
    for (const [ox, oy, r] of [
      [0, 0, 26],
      [-24, 7, 18],
      [24, 6, 20],
      [4, -10, 19],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + ox * s, cloud.y + oy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// Hazy bumps of distant woods along the horizon.
function drawTreeline(ctx: CanvasRenderingContext2D, season: Season): void {
  ctx.fillStyle = mixColors(SEASON_TREELINE[season], '#8aa4c0', 0.35);
  ctx.beginPath();
  ctx.moveTo(0, HORIZON + 6);
  let x = 0;
  let i = 0;
  while (x < WORLD_W + 40) {
    const bump = 34 + ((i * 37) % 3) * 12;
    const h = 14 + ((i * 53) % 5) * 4;
    ctx.quadraticCurveTo(x + bump / 2, HORIZON + 6 - h, x + bump, HORIZON + 6);
    x += bump;
    i += 1;
  }
  ctx.lineTo(WORLD_W + 40, HORIZON + 30);
  ctx.lineTo(0, HORIZON + 30);
  ctx.closePath();
  ctx.fill();
}

function drawGrass(ctx: CanvasRenderingContext2D, season: Season, state: GameState): void {
  const grass = grassColor(season, state);
  const grad = ctx.createLinearGradient(0, HORIZON, 0, WORLD_H);
  grad.addColorStop(0, mixColors(grass, '#e8e4b0', 0.18));
  grad.addColorStop(0.45, grass);
  grad.addColorStop(1, mixColors(grass, '#1e3018', 0.22));
  ctx.fillStyle = grad;

  // Gently rolling horizon edge.
  ctx.beginPath();
  ctx.moveTo(0, HORIZON + 8);
  ctx.quadraticCurveTo(WORLD_W * 0.22, HORIZON - 4, WORLD_W * 0.45, HORIZON + 5);
  ctx.quadraticCurveTo(WORLD_W * 0.7, HORIZON + 13, WORLD_W, HORIZON + 2);
  ctx.lineTo(WORLD_W, WORLD_H);
  ctx.lineTo(0, WORLD_H);
  ctx.closePath();
  ctx.fill();
}

function drawGroundDecor(ctx: CanvasRenderingContext2D, season: Season, state: GameState): void {
  const deco = decorations();
  const grass = grassColor(season, state);
  const tuftColor = mixColors(grass, '#243d1c', season === 'winter' ? 0.15 : 0.3);

  // Grass tufts: three little blades.
  ctx.strokeStyle = tuftColor;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (const tuft of deco.tufts) {
    const h = tuft.r * 2;
    ctx.beginPath();
    ctx.moveTo(tuft.x - 3, tuft.y);
    ctx.quadraticCurveTo(tuft.x - 4, tuft.y - h * 0.7, tuft.x - 5, tuft.y - h);
    ctx.moveTo(tuft.x, tuft.y);
    ctx.lineTo(tuft.x, tuft.y - h * 1.15);
    ctx.moveTo(tuft.x + 3, tuft.y);
    ctx.quadraticCurveTo(tuft.x + 4, tuft.y - h * 0.7, tuft.x + 5, tuft.y - h);
    ctx.stroke();
  }

  // Seasonal scatter: flowers, dandelions, leaves, or snow patches.
  for (const f of deco.flowers) {
    if (season === 'spring') {
      ctx.fillStyle = f.v < 0.5 ? '#f3f0e4' : '#eab6cf';
      for (let p = 0; p < 5; p += 1) {
        const a = (p / 5) * Math.PI * 2 + f.v * 6;
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r * 0.8, f.r * 0.62, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#e8c94f';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (season === 'summer') {
      if (f.v > 0.45) continue; // sparser in summer
      ctx.fillStyle = '#e8c94f';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (season === 'autumn') {
      ctx.fillStyle = f.v < 0.4 ? '#c07a35' : f.v < 0.7 ? '#a8542e' : '#8f7a3d';
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.v * 6);
      ctx.beginPath();
      ctx.ellipse(0, 0, f.r * 1.5, f.r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(245, 250, 252, 0.85)';
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, f.r * 3.2, f.r * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawTrees(ctx: CanvasRenderingContext2D, season: Season): void {
  const canopy = SEASON_TREE[season];
  // The right-hand tree stays left of the nesting hutch (which reaches
  // WORLD_W − 207 at level 3) so the hutch never blends into its canopy.
  const positions: Array<[number, number]> = [
    [110, 1],
    [230, 0.7],
    [WORLD_W - 290, 0.9],
  ];
  for (const [x, s] of positions) {
    // Ground shadow.
    ctx.fillStyle = 'rgba(20, 40, 16, 0.18)';
    ctx.beginPath();
    ctx.ellipse(x + 6 * s, 206, 34 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trunk with a slight lean.
    ctx.strokeStyle = '#6d4a2f';
    ctx.lineWidth = 9 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, 204);
    ctx.quadraticCurveTo(x + 2 * s, 180, x - 2 * s, 162 * s === 162 ? 162 : 204 - 44 * s);
    ctx.stroke();

    // Canopy: dark base blobs with a lighter crown.
    const base = mixColors(canopy, '#14290f', 0.25);
    ctx.fillStyle = base;
    for (const [ox, oy, r] of [
      [0, -55, 32],
      [-23, -40, 24],
      [23, -42, 25],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + ox * s, 200 + oy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = mixColors(canopy, '#f2edc0', 0.16);
    for (const [ox, oy, r] of [
      [-8, -62, 20],
      [14, -55, 16],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + ox * s, 200 + oy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    if (season === 'winter') {
      ctx.fillStyle = '#eef3f5';
      ctx.beginPath();
      ctx.ellipse(x, 200 - 58 * s, 30 * s, 9 * s, 0, Math.PI, 0);
      ctx.fill();
    }
  }
}

// A decoration being placed or moved: drawn translucent at the cursor with
// a ring that says whether it can be set down there. While moving, the
// original (hideIndex) is hidden so the ghost reads as the thing itself.
export interface DecorGhost {
  kind: DecorKind;
  pos: Vec2;
  ok: boolean;
  hideIndex: number | null;
}

// Player-placed decorations. Drawn by the renderer as the topmost world
// layer (over ducks and pickups) so nothing ever hides them.
export function drawDecorations(ctx: CanvasRenderingContext2D, state: GameState, t: number, ghost?: DecorGhost | null): void {
  const dark = darknessAt(hourOf(state.clock));
  state.decorations.forEach((decor, i) => {
    if (ghost && ghost.hideIndex === i) return;
    drawDecoration(ctx, decor.kind, decor.pos, dark, t);
  });
}

// Drawn last (over the pond too) so the ghost is always visible wherever
// the cursor is, even where it can't be set down.
export function drawDecorGhost(ctx: CanvasRenderingContext2D, state: GameState, t: number, ghost?: DecorGhost | null): void {
  const dark = darknessAt(hourOf(state.clock));
  if (ghost) {
    ctx.save();
    ctx.translate(ghost.pos.x, ghost.pos.y);
    ctx.strokeStyle = ghost.ok ? 'rgba(143, 206, 126, 0.9)' : 'rgba(240, 120, 110, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.ellipse(0, 4, 26, 10, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = ghost.ok ? 0.6 : 0.35;
    drawDecoration(ctx, ghost.kind, ghost.pos, dark, t);
    ctx.restore();
  }
}

export function drawDecoration(ctx: CanvasRenderingContext2D, kind: DecorKind, pos: Vec2, dark: number, t: number): void {
  {
    const { x, y } = pos;
    ctx.save();
    ctx.translate(x, y);
    switch (kind) {
      case 'lantern': {
        ctx.fillStyle = 'rgba(20, 40, 16, 0.16)';
        ctx.beginPath();
        ctx.ellipse(2, 2, 9, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3a3f45';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -26);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -26);
        ctx.quadraticCurveTo(8, -27, 9, -22);
        ctx.stroke();
        // Glow at night.
        if (dark > 0.2) {
          const glow = ctx.createRadialGradient(9, -18, 1, 9, -18, 22);
          glow.addColorStop(0, `rgba(255, 214, 120, ${0.55 * dark})`);
          glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(9, -18, 22, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = dark > 0.2 ? '#ffd678' : '#c8cdd2';
        ctx.beginPath();
        ctx.arc(9, -18, 3.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'bench': {
        ctx.fillStyle = 'rgba(20, 40, 16, 0.18)';
        ctx.beginPath();
        ctx.ellipse(0, 7, 22, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Back uprights run from the ground through the seat to the backrest.
        ctx.strokeStyle = '#5f4023';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        for (const side of [-13, 13]) {
          ctx.beginPath();
          ctx.moveTo(side, 6);
          ctx.lineTo(side, -21);
          ctx.stroke();
        }
        // Front legs, slightly splayed, reaching the seat.
        ctx.lineWidth = 2.5;
        for (const side of [-15, 15]) {
          ctx.beginPath();
          ctx.moveTo(side * 1.05, 7);
          ctx.lineTo(side, -5);
          ctx.stroke();
        }
        // Seat: two slats with a darker front edge for thickness.
        ctx.fillStyle = '#8a6238';
        ctx.fillRect(-19, -10, 38, 3.2);
        ctx.fillRect(-19, -6.2, 38, 3.2);
        ctx.fillStyle = '#5f4023';
        ctx.fillRect(-19, -3, 38, 1.4);
        // Backrest: two rails joined to the uprights.
        ctx.fillStyle = '#8a6238';
        ctx.fillRect(-18, -21, 36, 3);
        ctx.fillRect(-18, -16.5, 36, 2.4);
        ctx.fillStyle = '#5f4023';
        ctx.fillRect(-18, -14.1, 36, 1);
        break;
      }
      case 'flowerBed': {
        ctx.fillStyle = '#6b4a2e';
        ctx.beginPath();
        ctx.ellipse(0, 0, 17, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        const petals = ['#eab6cf', '#e8c94f', '#f3f0e4', '#c09aec'];
        for (let i = 0; i < 5; i += 1) {
          const fx = -11 + i * 5.5;
          const fy = -1 + ((i * 7) % 3) - 1;
          ctx.fillStyle = petals[i % petals.length];
          for (let p = 0; p < 5; p += 1) {
            const a = (p / 5) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(fx + Math.cos(a) * 2.2, fy + Math.sin(a) * 1.8, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#7a5c28';
          ctx.beginPath();
          ctx.arc(fx, fy, 1, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'gnome': {
        ctx.fillStyle = 'rgba(20, 40, 16, 0.16)';
        ctx.beginPath();
        ctx.ellipse(0, 2, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Body.
        ctx.fillStyle = '#4a6b9c';
        ctx.beginPath();
        ctx.moveTo(-5, 1);
        ctx.quadraticCurveTo(0, -8, 5, 1);
        ctx.closePath();
        ctx.fill();
        // Face + beard.
        ctx.fillStyle = '#e8c9a8';
        ctx.beginPath();
        ctx.arc(0, -8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f0ede4';
        ctx.beginPath();
        ctx.moveTo(-3, -7);
        ctx.quadraticCurveTo(0, -1, 3, -7);
        ctx.closePath();
        ctx.fill();
        // Pointy hat.
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.moveTo(-3.6, -9.5);
        ctx.lineTo(0, -19);
        ctx.lineTo(3.6, -9.5);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'stringLights': {
        const colors = ['#e2574c', '#e8b83a', '#7fc36e', '#7fb2d9'];
        ctx.strokeStyle = '#5f4023';
        ctx.lineWidth = 2.5;
        for (const px of [-24, 24]) {
          ctx.beginPath();
          ctx.moveTo(px, 2);
          ctx.lineTo(px, -22);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(40, 40, 46, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-24, -22);
        ctx.quadraticCurveTo(0, -12, 24, -22);
        ctx.stroke();
        for (let i = 0; i < 5; i += 1) {
          const s = (i + 1) / 6;
          const bx = -24 + 48 * s;
          const by = -22 + 2 * (1 - s) * s * 2 * 10 + 2;
          const glow = 0.6 + 0.4 * Math.sin(t * 3 + i * 1.9 + x);
          ctx.fillStyle = colors[i % colors.length];
          ctx.globalAlpha = dark > 0.2 ? glow : 0.9;
          ctx.beginPath();
          ctx.arc(bx, by, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'statue': {
        // Plinth.
        ctx.fillStyle = 'rgba(20, 40, 16, 0.2)';
        ctx.beginPath();
        ctx.ellipse(2, 14, 22, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8d8f93';
        ctx.fillRect(-18, 4, 36, 9);
        ctx.fillStyle = '#b4b6ba';
        ctx.fillRect(-20, 0, 40, 5);
        ctx.fillStyle = '#6f7175';
        ctx.fillRect(-18, 12, 36, 2);
        // A stone duck, standing proud.
        ctx.save();
        ctx.translate(0, -8);
        ctx.scale(0.7, 0.7);
        drawDuck(ctx, STATUE_DUCK, { inWater: false, selected: false, anim: STATUE_ANIM, facingLeft: false });
        ctx.restore();
        // Stone wash over the duck.
        ctx.globalCompositeOperation = 'saturation';
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(0, -12, 20, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // Plaque.
        ctx.fillStyle = '#c8a85a';
        ctx.fillRect(-7, 5, 14, 5);
        break;
      }
    }
    ctx.restore();
  }
}

// Wooden feeding trough; the grain mound shows how full it is. Only drawn
// once the upgrade is owned.
function drawFeeder(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (!state.upgrades.feedingTrough) return;
  const { x, y } = FEEDER_POS;
  const fill = state.feeder.food / feederCapacity(state);

  ctx.fillStyle = 'rgba(20, 40, 16, 0.16)';
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 20, 52, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs.
  ctx.strokeStyle = '#5f4023';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * 34, y + 4);
    ctx.lineTo(x + side * 40, y + 19);
    ctx.stroke();
  }

  // Trough body.
  ctx.fillStyle = '#8a6238';
  ctx.beginPath();
  ctx.moveTo(x - 46, y - 12);
  ctx.lineTo(x - 36, y + 8);
  ctx.lineTo(x + 36, y + 8);
  ctx.lineTo(x + 46, y - 12);
  ctx.closePath();
  ctx.fill();
  // Inner shadow.
  ctx.fillStyle = '#4f3419';
  ctx.beginPath();
  ctx.moveTo(x - 42, y - 10);
  ctx.lineTo(x - 35, y + 4);
  ctx.lineTo(x + 35, y + 4);
  ctx.lineTo(x + 42, y - 10);
  ctx.closePath();
  ctx.fill();

  // Grain mound scales with the fill level.
  if (fill > 0) {
    ctx.fillStyle = '#dfb658';
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 38 * (0.5 + fill * 0.5), 4 + fill * 8, 0, Math.PI, 0);
    ctx.fill();
  }

  // Front board highlight.
  ctx.strokeStyle = '#a87c48';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 44, y - 11);
  ctx.lineTo(x + 44, y - 11);
  ctx.stroke();

  if (fill === 0) {
    ctx.fillStyle = 'rgba(240, 235, 220, 0.75)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('click to fill', x, y + 34);
    ctx.textAlign = 'left';
  }

  // Feed Silo: a hopper on legs behind the trough, taller per level, with a
  // chute down to the trough's end.
  const silo = upgradeLevel(state, 'feedSilo');
  if (silo > 0) {
    const sx = x - 62;
    const h = 26 + silo * 10;
    const top = y - 16 - h;
    ctx.fillStyle = 'rgba(20, 40, 16, 0.16)';
    ctx.beginPath();
    ctx.ellipse(sx, y + 16, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5f4023';
    ctx.lineWidth = 3;
    for (const side of [-9, 9]) {
      ctx.beginPath();
      ctx.moveTo(sx + side, y - 10);
      ctx.lineTo(sx + side, y + 14);
      ctx.stroke();
    }
    // Body: corrugated drum with a conical bottom.
    ctx.fillStyle = '#b9b4a6';
    ctx.fillRect(sx - 13, top, 26, h);
    ctx.strokeStyle = '#8c877a';
    ctx.lineWidth = 1;
    for (let yy = top + 6; yy < top + h; yy += 6) {
      ctx.beginPath();
      ctx.moveTo(sx - 13, yy);
      ctx.lineTo(sx + 13, yy);
      ctx.stroke();
    }
    ctx.fillStyle = '#a29d90';
    ctx.beginPath();
    ctx.moveTo(sx - 13, top + h);
    ctx.lineTo(sx + 13, top + h);
    ctx.lineTo(sx + 4, y - 8);
    ctx.lineTo(sx - 4, y - 8);
    ctx.closePath();
    ctx.fill();
    // Domed lid.
    ctx.fillStyle = '#8f6b3e';
    ctx.beginPath();
    ctx.ellipse(sx, top, 15, 5, 0, Math.PI, 0);
    ctx.fill();
    // Chute to the trough.
    ctx.strokeStyle = '#8c877a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx + 4, y - 8);
    ctx.lineTo(x - 40, y - 14);
    ctx.stroke();
  }
}

function drawNest(ctx: CanvasRenderingContext2D, state: GameState): void {
  const { x, y } = nestPos();

  ctx.fillStyle = 'rgba(20, 40, 16, 0.16)';
  ctx.beginPath();
  ctx.ellipse(x + 4, y + 20, 66, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Straw mound with arc texture.
  ctx.beginPath();
  ctx.ellipse(x, y + 10, 62, 26, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#c8a55c';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 48, 18, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#a8853f';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 88, 34, 0.55)';
  ctx.lineWidth = 1.3;
  for (const [ox, oy, r, a0, a1] of [
    [-30, 12, 16, 3.4, 5.6],
    [8, 16, 20, 3.6, 5.9],
    [30, 8, 13, 3.2, 5.4],
    [-8, 4, 15, 0.4, 2.4],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x + ox, y + oy, r, a0, a1);
    ctx.stroke();
  }

  const level = state.upgrades.nestingBox ?? 0;
  if (level > 0) drawNestingHutch(ctx, x, y - 34, level, darknessAt(hourOf(state.clock)), activeStyle(state, 'hutch'));
  const lamp = upgradeLevel(state, 'brooderLamp');
  // Lamp on the right of the mound (its arm reaches back over the straw),
  // cooler on the left — both below the hutch so nothing overlaps it.
  if (lamp > 0) drawBrooderLamp(ctx, x + 58, y + 30, lamp, darknessAt(hourOf(state.clock)));
  if (upgradeLevel(state, 'eggCooler') > 0) drawEggCooler(ctx, x - 80, y + 24, upgradeLevel(state, 'eggCooler'));
  // The incubator sits just past the hutch's eave, wherever that ends up.
  const hutchHalf = level > 0 ? (level * 2 * 22 + 8) / 2 + 7 : 0;
  if ((state.upgrades.incubator ?? 0) > 0) drawIncubator(ctx, x + Math.max(80, hutchHalf + 22), y - 26);
}

// The nesting hutch: a raised shelf on posts behind the nest, with one
// straw-lined compartment per egg slot (two per level), a scalloped shingle
// roof, a perch rail, and a warm glow in each doorway after dark.
function drawNestingHutch(ctx: CanvasRenderingContext2D, cx: number, baseY: number, level: number, dark: number, skin: StyleDef | null = null): void {
  const slots = level * 2;
  const cellW = 22;
  const cellH = 22;
  const w = slots * cellW + 8;
  const left = cx - w / 2;
  const floorY = baseY; // top of the floor plank
  const topY = floorY - cellH;
  const wood = skin?.colors[0] ?? '#8a6238';
  const woodDark = skin?.colors[1] ?? '#5f4023';
  const woodDeep = '#3b2614';

  ctx.save();

  // Ground shadow + posts.
  ctx.fillStyle = 'rgba(20, 40, 16, 0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, floorY + 26, w / 2 + 6, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = woodDark;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.5;
  const postXs = slots > 2 ? [left + 8, cx, left + w - 8] : [left + 8, left + w - 8];
  for (const px of postXs) {
    ctx.beginPath();
    ctx.moveTo(px, floorY + 2);
    ctx.lineTo(px, floorY + 24);
    ctx.stroke();
  }
  // Cross brace.
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left + 8, floorY + 20);
  ctx.lineTo(left + w - 8, floorY + 10);
  ctx.stroke();

  // Back wall + floor plank.
  ctx.fillStyle = skin ? mixColors(wood, '#000000', 0.2) : '#6e4b2a';
  ctx.fillRect(left, topY, w, cellH);
  ctx.fillStyle = wood;
  ctx.fillRect(left - 3, floorY, w + 6, 5);
  ctx.fillStyle = woodDark;
  ctx.fillRect(left - 3, floorY + 5, w + 6, 1.5);

  // Compartments.
  for (let i = 0; i < slots; i += 1) {
    const x0 = left + 4 + i * cellW;
    // Interior.
    ctx.fillStyle = woodDeep;
    ctx.fillRect(x0 + 1, topY + 2, cellW - 2, cellH - 2);
    // Straw bedding.
    ctx.fillStyle = '#c8a55c';
    ctx.beginPath();
    ctx.ellipse(x0 + cellW / 2, floorY - 3, cellW / 2 - 3, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 88, 34, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x0 + cellW / 2 - 3, floorY - 3, 4, 3.3, 5.5);
    ctx.stroke();
    // Warm glow after dark: the boxes keep the eggs cosy.
    if (dark > 0.15) {
      const g = ctx.createRadialGradient(x0 + cellW / 2, topY + cellH / 2, 1, x0 + cellW / 2, topY + cellH / 2, cellW * 0.75);
      g.addColorStop(0, `rgba(255, 190, 90, ${0.55 * dark})`);
      g.addColorStop(1, 'rgba(255, 190, 90, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x0 + 1, topY + 2, cellW - 2, cellH - 2);
    }
    // Round doorway frame.
    ctx.strokeStyle = wood;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x0 + cellW / 2, topY + cellH / 2 + 1, 7.5, 0, Math.PI * 2);
    ctx.stroke();
    // Divider.
    ctx.fillStyle = wood;
    ctx.fillRect(x0 - 1.5, topY, 3, cellH);
  }
  // Outer frame.
  ctx.fillStyle = wood;
  ctx.fillRect(left, topY, 4, cellH);
  ctx.fillRect(left + w - 4, topY, 4, cellH);

  // Perch rail along the front.
  ctx.strokeStyle = woodDark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left - 2, floorY + 9);
  ctx.lineTo(left + w + 2, floorY + 9);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  for (const px of [left + 6, left + w - 6]) {
    ctx.beginPath();
    ctx.moveTo(px, floorY + 5);
    ctx.lineTo(px, floorY + 9);
    ctx.stroke();
  }

  // Roof: two rows of scalloped shingles with an overhang and a ridge cap.
  const roofTop = topY - 9;
  const eave = 7;
  ctx.fillStyle = skin ? mixColors(woodDark, '#000000', 0.15) : '#6c4a2c';
  ctx.beginPath();
  ctx.moveTo(left - eave, topY + 1);
  ctx.lineTo(left + w + eave, topY + 1);
  ctx.lineTo(left + w + eave - 4, roofTop);
  ctx.lineTo(left - eave + 4, roofTop);
  ctx.closePath();
  ctx.fill();
  for (const [rowY, tone] of [
    [topY - 1, skin ? mixColors(woodDark, wood, 0.3) : '#7d5532'],
    [topY - 6, skin ? mixColors(woodDark, wood, 0.6) : '#8f6440'],
  ] as const) {
    ctx.fillStyle = tone;
    for (let sx = left - eave; sx < left + w + eave; sx += 8) {
      ctx.beginPath();
      ctx.arc(sx + 4, rowY, 4.2, 0, Math.PI);
      ctx.fill();
    }
  }
  ctx.fillStyle = woodDark;
  ctx.fillRect(left - eave + 3, roofTop - 2, w + eave * 2 - 6, 3);

  // A little hanging sign on a single nail.
  if (level >= 2) {
    const sx = left + w + eave - 6;
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, roofTop + 2);
    ctx.lineTo(sx, roofTop + 8);
    ctx.stroke();
    ctx.fillStyle = '#d9c48f';
    ctx.fillRect(sx - 7, roofTop + 8, 14, 7);
    ctx.fillStyle = '#7a5c28';
    ctx.beginPath();
    ctx.ellipse(sx, roofTop + 11.5, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Level 3: a hanging lantern for the night shift.
  if (level >= 3) {
    const lx = left - eave + 6;
    ctx.strokeStyle = woodDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, roofTop + 2);
    ctx.lineTo(lx, roofTop + 9);
    ctx.stroke();
    if (dark > 0.15) {
      const g = ctx.createRadialGradient(lx, roofTop + 13, 1, lx, roofTop + 13, 14);
      g.addColorStop(0, `rgba(255, 210, 120, ${0.5 * dark})`);
      g.addColorStop(1, 'rgba(255, 210, 120, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lx, roofTop + 13, 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(lx - 3, roofTop + 9, 6, 8);
    ctx.fillStyle = dark > 0.15 ? '#ffd884' : '#b9b090';
    ctx.fillRect(lx - 2, roofTop + 10.5, 4, 5);
  }

  ctx.restore();
}

// Brooder Lamp: a lamp on a bent post over the nest, glowing at night.
function drawBrooderLamp(ctx: CanvasRenderingContext2D, x: number, y: number, level: number, dark: number): void {
  ctx.save();
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  // Base plate + short post, arm curving back left over the straw.
  ctx.fillStyle = 'rgba(20, 40, 16, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + 2, 9, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 34);
  ctx.quadraticCurveTo(x - 2, y - 48, x - 20, y - 48);
  ctx.stroke();
  const lx = x - 28; // lamp hangs here, over the nest's near edge
  const ly = y - 40;
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 20, y - 48);
  ctx.lineTo(lx, ly - 8);
  ctx.stroke();
  // Shade (red at level 2).
  ctx.fillStyle = level > 1 ? '#c8584a' : '#4a4a4a';
  ctx.beginPath();
  ctx.moveTo(lx - 9, ly - 8);
  ctx.lineTo(lx + 9, ly - 8);
  ctx.lineTo(lx + 13, ly + 2);
  ctx.lineTo(lx - 13, ly + 2);
  ctx.closePath();
  ctx.fill();
  // Bulb + glow cone (level 2 is brighter and wider).
  const on = dark > 0.1;
  ctx.fillStyle = on ? '#ffd884' : '#d8d0b0';
  ctx.beginPath();
  ctx.arc(lx, ly + 3, 3, 0, Math.PI * 2);
  ctx.fill();
  if (on) {
    const g = ctx.createRadialGradient(lx, ly + 3, 2, lx, ly + 3, 46 + level * 10);
    g.addColorStop(0, `rgba(255, 200, 110, ${0.7 * dark})`);
    g.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(lx, ly + 3);
    ctx.lineTo(lx - 56 - level * 8, y + 6);
    ctx.lineTo(lx + 30 + level * 6, y + 6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Egg Cooler: a slatted crate with a frosted lid, beside the nest.
function drawEggCooler(ctx: CanvasRenderingContext2D, x: number, y: number, level: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(20, 40, 16, 0.16)';
  ctx.beginPath();
  ctx.ellipse(2, 10, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a6238';
  ctx.fillRect(-16, -10, 32, 18);
  ctx.strokeStyle = '#5f4023';
  ctx.lineWidth = 1.2;
  for (const sx of [-10, -3, 4, 11]) {
    ctx.beginPath();
    ctx.moveTo(sx, -9);
    ctx.lineTo(sx, 7);
    ctx.stroke();
  }
  // Frosted lid, bluer with level.
  ctx.fillStyle = ['#dfe8ec', '#cfe3ee', '#bfe0f2'][Math.min(2, level - 1)];
  ctx.fillRect(-18, -14, 36, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(-16, -13, 12, 1.5);
  // A couple of eggs peeking.
  ctx.fillStyle = '#f3ead2';
  for (const ex of [-7, 2]) {
    ctx.beginPath();
    ctx.ellipse(ex, -4, 3, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Training Perch: a starting gate of hurdles at the pond's edge with a
// pennant — more hurdles per level.
function drawTrainingPerch(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
  const level = upgradeLevel(state, 'trainingPerch');
  if (level === 0) return;
  const g = pondGeometry(state);
  const x0 = g.cx + g.rx * 0.55;
  const y0 = g.cy + g.ry + 22;
  ctx.save();
  // Hurdles.
  for (let i = 0; i < level + 1; i += 1) {
    const hx = x0 + i * 26;
    ctx.strokeStyle = '#5f4023';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx, y0);
    ctx.lineTo(hx, y0 - 14);
    ctx.moveTo(hx + 16, y0);
    ctx.lineTo(hx + 16, y0 - 14);
    ctx.stroke();
    ctx.strokeStyle = i % 2 === 0 ? '#e8e2d2' : '#c8584a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hx - 1, y0 - 12);
    ctx.lineTo(hx + 17, y0 - 12);
    ctx.stroke();
  }
  // Flagpole with a waving pennant.
  const px = x0 - 14;
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, y0 + 2);
  ctx.lineTo(px, y0 - 40);
  ctx.stroke();
  const wave = Math.sin(t * 3) * 3;
  ctx.fillStyle = '#e8b83a';
  ctx.beginPath();
  ctx.moveTo(px, y0 - 40);
  ctx.lineTo(px + 18, y0 - 36 + wave);
  ctx.lineTo(px, y0 - 31);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Vet Clinic: a small whitewashed hut with a red cross on the left bank.
function drawVetClinic(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (upgradeLevel(state, 'vetClinic') === 0) return;
  const x = 300;
  const y = 262;
  ctx.save();
  ctx.fillStyle = 'rgba(20, 40, 16, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x + 2, y + 22, 30, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Walls.
  ctx.fillStyle = '#ece6d6';
  ctx.fillRect(x - 24, y - 14, 48, 34);
  ctx.strokeStyle = '#b5ad99';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(x - 24, y - 14, 48, 34);
  // Roof.
  ctx.fillStyle = '#7a5a3a';
  ctx.beginPath();
  ctx.moveTo(x - 29, y - 14);
  ctx.lineTo(x, y - 32);
  ctx.lineTo(x + 29, y - 14);
  ctx.closePath();
  ctx.fill();
  // Door + window.
  ctx.fillStyle = '#6b4a2e';
  ctx.fillRect(x - 6, y, 12, 20);
  ctx.fillStyle = '#bfe0f2';
  ctx.fillRect(x + 9, y - 8, 10, 9);
  ctx.strokeStyle = '#8f877a';
  ctx.strokeRect(x + 9, y - 8, 10, 9);
  // Red cross sign.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 20, y - 9, 12, 12);
  ctx.fillStyle = '#d4544a';
  ctx.fillRect(x - 16, y - 7, 4, 8);
  ctx.fillRect(x - 18, y - 5, 8, 4);
  ctx.restore();
}

// Bachelor Pen: a post-and-rail paddock on the right bank with a gate on the
// pond side, a water dish, and a straw corner. Level 2 is a longer run.
function drawBachelorPen(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (upgradeLevel(state, 'bachelorPen') === 0) return;
  const r = penRect(state);
  ctx.save();
  // Trodden earth inside.
  ctx.fillStyle = 'rgba(150, 120, 70, 0.22)';
  ctx.beginPath();
  ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 - 6, r.h / 2 - 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Straw corner + water dish.
  ctx.fillStyle = '#c8a55c';
  ctx.beginPath();
  ctx.ellipse(r.x + r.w - 22, r.y + 20, 16, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8d8f93';
  ctx.beginPath();
  ctx.ellipse(r.x + 22, r.y + r.h - 18, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6fb0d8';
  ctx.beginPath();
  ctx.ellipse(r.x + 22, r.y + r.h - 19, 7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Fence: posts every ~30px with two rails; gate (lighter, slatted) on the
  // pond side, centred.
  // The bottom rail is drawn by drawBachelorPenFront, over the ducks, so a
  // duck standing at the front of the paddock shows behind the fence.
  const edges: Array<[number, number, number, number]> = [
    [r.x, r.y, r.x + r.w, r.y], // top
    [r.x + r.w, r.y, r.x + r.w, r.y + r.h], // right
    [r.x, r.y, r.x, r.y + r.h], // left (gate side)
  ];
  const gateY0 = r.y + r.h / 2 - 16;
  const gateY1 = r.y + r.h / 2 + 16;
  drawFenceEdges(ctx, r, edges, gateY0, gateY1);
  ctx.restore();
}

const FENCE_POST = '#6b4a2e';
const FENCE_RAIL = '#8a6238';

function drawFenceEdges(
  ctx: CanvasRenderingContext2D,
  r: PenRect,
  edges: Array<[number, number, number, number]>,
  gateY0: number,
  gateY1: number,
): void {
  const post = FENCE_POST;
  const rail = FENCE_RAIL;
  ctx.lineCap = 'round';
  for (const [x0, y0, x1, y1] of edges) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / 30));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      if (x0 === x1 && x0 === r.x && py > gateY0 && py < gateY1) continue; // gate gap
      ctx.strokeStyle = post;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py + 2);
      ctx.lineTo(px, py - 14);
      ctx.stroke();
    }
    ctx.strokeStyle = rail;
    ctx.lineWidth = 2;
    for (const lift of [-11, -5]) {
      if (x0 === x1 && x0 === r.x) {
        // Left side rails stop at the gate.
        ctx.beginPath();
        ctx.moveTo(x0, y0 + lift);
        ctx.lineTo(x0, gateY0 + lift);
        ctx.moveTo(x0, gateY1 + lift);
        ctx.lineTo(x1, y1 + lift);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x0, y0 + lift);
        ctx.lineTo(x1, y1 + lift);
        ctx.stroke();
      }
    }
  }
  // Gate: three pale slats and a diagonal brace, hinged at the top post.
  if (edges.some(([x0, , x1]) => x0 === x1 && x0 === r.x)) {
    ctx.strokeStyle = '#c9b58a';
    ctx.lineWidth = 2;
    for (const lift of [-12, -7, -2]) {
      ctx.beginPath();
      ctx.moveTo(r.x - 2, gateY0 + lift + 2);
      ctx.lineTo(r.x - 2, gateY1 + lift + 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(r.x - 2, gateY0 - 10);
    ctx.lineTo(r.x - 2, gateY1);
    ctx.stroke();
  }
}

// The paddock's front (bottom) rail, drawn after the ducks.
export function drawBachelorPenFront(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (upgradeLevel(state, 'bachelorPen') === 0) return;
  const r = penRect(state);
  ctx.save();
  drawFenceEdges(ctx, r, [[r.x, r.y + r.h, r.x + r.w, r.y + r.h]], 0, 0);
  ctx.restore();
}

// A little wooden brooder: legged cabinet, warm glowing window with an egg
// silhouette inside, vents, and a power lamp.
function drawIncubator(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);

  // Shadow + legs.
  ctx.fillStyle = 'rgba(20, 40, 16, 0.16)';
  ctx.beginPath();
  ctx.ellipse(0, 15, 20, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4f3419';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const side of [-11, 11]) {
    ctx.beginPath();
    ctx.moveTo(side, 8);
    ctx.lineTo(side + Math.sign(side) * 2, 14);
    ctx.stroke();
  }

  // Cabinet body with a slightly domed lid.
  ctx.fillStyle = '#8a6238';
  ctx.beginPath();
  ctx.moveTo(-16, 9);
  ctx.lineTo(-16, -8);
  ctx.quadraticCurveTo(0, -17, 16, -8);
  ctx.lineTo(16, 9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5f4023';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Warm viewing window with an egg silhouette.
  const glow = ctx.createRadialGradient(0, -1, 1, 0, -1, 11);
  glow.addColorStop(0, '#ffd884');
  glow.addColorStop(1, '#c98a3a');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, -1, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4f3419';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = '#fef7e0';
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.4, 4.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Vent slits + indicator lamp.
  ctx.strokeStyle = '#5f4023';
  ctx.lineWidth = 1.2;
  for (const vy of [3, 6]) {
    ctx.beginPath();
    ctx.moveTo(10, vy);
    ctx.lineTo(14, vy);
    ctx.stroke();
  }
  ctx.fillStyle = '#7fc36e';
  ctx.beginPath();
  ctx.arc(12, -7, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Organic wobble applied to the pond ellipse so the shoreline isn't a perfect
// oval. Collision (isInPond) stays the plain ellipse; the wobble is ±4%.
function pondEdge(a: number): number {
  return 1 + 0.045 * Math.sin(3 * a + 1.7) + 0.03 * Math.sin(5 * a + 0.4);
}

function tracePond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  const STEPS = 36;
  for (let i = 0; i <= STEPS; i += 1) {
    const a = (i / STEPS) * Math.PI * 2;
    const w = pondEdge(a);
    const px = cx + Math.cos(a) * rx * w;
    const py = cy + Math.sin(a) * ry * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawPond(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  hour: number,
  timeMs: number,
): void {
  const g = pondGeometry(state);
  const dirt = 1 - state.pond.cleanliness / 100;
  const t = timeMs / 1000;

  // Sandy shore, then mud ring, then water.
  ctx.fillStyle = '#c9b077';
  tracePond(ctx, g.cx, g.cy, g.rx + 14, g.ry + 12);
  ctx.fill();
  ctx.fillStyle = '#54683c';
  tracePond(ctx, g.cx, g.cy, g.rx + 6, g.ry + 6);
  ctx.fill();

  const waterStyle = activeStyle(state, 'water');
  const water = mixColors(waterStyle?.colors[0] ?? '#4a90c2', '#5f8f4e', dirt * 0.8);
  const deep = mixColors(waterStyle?.colors[1] ?? '#2c6899', '#4a7340', dirt * 0.8);
  const grad = ctx.createRadialGradient(g.cx, g.cy - 12, 10, g.cx, g.cy, g.rx);
  grad.addColorStop(0, mixColors(water, '#cfe8f5', 0.18));
  grad.addColorStop(0.55, water);
  grad.addColorStop(1, deep);
  ctx.fillStyle = grad;
  tracePond(ctx, g.cx, g.cy, g.rx, g.ry);
  ctx.fill();

  // Water shimmer: short horizontal streaks that fade in and out.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2 + 0.6;
    const wobble = Math.sin(t * 0.7 + i * 2.2);
    const sx = g.cx + Math.cos(a) * g.rx * 0.55;
    const sy = g.cy + Math.sin(a) * g.ry * 0.55;
    ctx.globalAlpha = 0.35 + 0.3 * wobble;
    ctx.beginPath();
    ctx.moveTo(sx - 9 - wobble * 3, sy);
    ctx.lineTo(sx + 9 + wobble * 3, sy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Expanding ripple rings.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i += 1) {
    const phase = (t * 0.12 + i / 3) % 1;
    ctx.beginPath();
    ctx.ellipse(
      g.cx,
      g.cy,
      g.rx * 0.25 + g.rx * 0.6 * phase,
      (g.ry * 0.25 + g.ry * 0.6 * phase) * 0.9,
      0,
      0.15 * Math.PI,
      0.85 * Math.PI,
    );
    ctx.stroke();
  }

  // Sun/moon glint path on the water during clear hours.
  const daytime = hour >= 6 && hour < 21;
  const sunT = daytime ? (hour - 6) / 15 : 0.5;
  const glintX = g.cx + (sunT - 0.5) * g.rx * 1.1;
  const glint = ctx.createRadialGradient(glintX, g.cy - g.ry * 0.35, 2, glintX, g.cy - g.ry * 0.35, 46);
  glint.addColorStop(0, daytime ? 'rgba(255, 240, 180, 0.3)' : 'rgba(220, 226, 250, 0.18)');
  glint.addColorStop(1, 'rgba(255, 240, 180, 0)');
  ctx.fillStyle = glint;
  ctx.beginPath();
  ctx.ellipse(glintX, g.cy - g.ry * 0.35, 46, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  drawLilyPads(ctx, state, t);
  drawReeds(ctx, state, t);

  drawTrainingPerch(ctx, state, t);
  if ((state.upgrades.pondFilter ?? 0) > 0) drawBogFilter(ctx, state, t);
  if ((state.upgrades.waterfall ?? 0) > 0) drawWaterfall(ctx, state, t);
  if (festivalToday(state.clock) === 'winterLights') drawFestivalLights(ctx, state, t);
  // Floating toy: a classic yellow rubber duck, bobbing on the water.
  if ((state.upgrades.duckToy ?? 0) > 0) {
    ctx.save();
    ctx.translate(g.cx + g.rx * 0.5, g.cy - g.ry * 0.4 + Math.sin(t * 1.4) * 3);
    ctx.rotate(Math.sin(t * 1.1) * 0.09);

    // Waterline ripple.
    ctx.beginPath();
    ctx.ellipse(0, 5, 15, 4, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Upswept tail.
    ctx.fillStyle = '#f2c53d';
    ctx.beginPath();
    ctx.moveTo(-7, -2);
    ctx.quadraticCurveTo(-14, -9, -10, -1);
    ctx.closePath();
    ctx.fill();
    // Body.
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head.
    ctx.beginPath();
    ctx.arc(6, -8, 5.5, 0, Math.PI * 2);
    ctx.fill();
    // Wing hint.
    ctx.strokeStyle = '#d9a92f';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(-1, -1, 5, 0.4 * Math.PI, 1.1 * Math.PI, true);
    ctx.stroke();
    // Bill.
    ctx.fillStyle = '#e8912d';
    ctx.beginPath();
    ctx.moveTo(10.5, -9.5);
    ctx.quadraticCurveTo(15.5, -8.8, 10.5, -6.6);
    ctx.closePath();
    ctx.fill();
    // Eye + body shine.
    ctx.fillStyle = '#2a2320';
    ctx.beginPath();
    ctx.arc(7.5, -9.5, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.beginPath();
    ctx.arc(3, -10.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// A planted gravel bog filter on the pond's left rim: stone basin, marsh
// plants, an intake pipe, and a trickle of clean water returning to the pond.
function drawBogFilter(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
  const g = pondGeometry(state);
  const bx = g.cx - g.rx * 0.96;
  const by = g.cy - g.ry * 0.3;

  // Intake pipe dipping into the water.
  ctx.strokeStyle = '#565c62';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx + 26, by + 10);
  ctx.quadraticCurveTo(bx + 14, by - 2, bx + 4, by - 6);
  ctx.stroke();

  // Stone basin: a mound of rounded rocks.
  const stones: Array<[number, number, number, string]> = [
    [-14, 2, 9, '#6f757b'],
    [0, 5, 11, '#82888e'],
    [13, 2, 8, '#767c83'],
    [-7, -6, 8, '#8d939a'],
    [6, -7, 8.5, '#7a8087'],
    [0, -12, 7, '#959ba1'],
  ];
  for (const [ox, oy, r, color] of stones) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx + ox, by + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Gravel bed on top.
  ctx.fillStyle = '#a9afb5';
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.arc(bx - 12 + i * 4, by - 14 + ((i * 13) % 3), 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Marsh plants rooted in the gravel.
  ctx.strokeStyle = '#4f8f3e';
  ctx.lineWidth = 1.8;
  for (const [ox, lean, h] of [
    [-8, -3, 22],
    [-2, 2, 27],
    [5, 4, 20],
  ] as const) {
    const sway = Math.sin(t * 1.1 + ox) * 2;
    ctx.beginPath();
    ctx.moveTo(bx + ox, by - 13);
    ctx.quadraticCurveTo(bx + ox + lean, by - 13 - h * 0.6, bx + ox + lean + sway, by - 13 - h);
    ctx.stroke();
  }
  ctx.fillStyle = '#7a4a28';
  ctx.beginPath();
  ctx.ellipse(bx - 2 + 2, by - 13 - 27 + 4, 2.2, 5.5, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Clean water trickling back into the pond, with a landing ripple.
  const spoutX = bx + 18;
  const spoutY = by - 4;
  ctx.strokeStyle = 'rgba(205, 235, 250, 0.8)';
  ctx.lineWidth = 2;
  const drip = (t * 2.2) % 1;
  ctx.beginPath();
  ctx.moveTo(spoutX, spoutY);
  ctx.quadraticCurveTo(spoutX + 6, spoutY + 4, spoutX + 9, spoutY + 12);
  ctx.stroke();
  // Falling droplet along the stream.
  ctx.fillStyle = 'rgba(220, 242, 252, 0.9)';
  ctx.beginPath();
  ctx.arc(spoutX + 3 + drip * 6, spoutY + 2 + drip * 10, 1.4, 0, Math.PI * 2);
  ctx.fill();
  // Expanding ripple where it lands.
  const ripple = (t * 0.9) % 1;
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * (1 - ripple)})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(spoutX + 9, spoutY + 14, 3 + ripple * 9, (3 + ripple * 9) * 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
}

// A rocky waterfall cascading into the pond from its top edge.
function drawWaterfall(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
  const g = pondGeometry(state);
  const wx = g.cx + g.rx * 0.38;
  const wy = g.cy - g.ry * 0.98;

  // Boulder outcrop.
  const rocks: Array<[number, number, number, string]> = [
    [-16, -2, 12, '#6d6e74'],
    [15, -1, 11, '#77787e'],
    [-4, -10, 13, '#82838a'],
    [10, -14, 9, '#8d8e94'],
    [-14, -16, 8, '#75767c'],
  ];
  for (const [ox, oy, r, color] of rocks) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(wx + ox, wy + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Mossy tufts on the rocks.
  ctx.fillStyle = '#5d9451';
  for (const [ox, oy] of [
    [-18, -10],
    [17, -8],
    [3, -20],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(wx + ox, wy + oy, 4.5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The falling sheet of water between the boulders.
  const sheet = ctx.createLinearGradient(0, wy - 8, 0, wy + 14);
  sheet.addColorStop(0, 'rgba(205, 235, 250, 0.9)');
  sheet.addColorStop(1, 'rgba(170, 215, 240, 0.55)');
  ctx.fillStyle = sheet;
  ctx.beginPath();
  ctx.moveTo(wx - 6, wy - 8);
  ctx.lineTo(wx + 7, wy - 8);
  ctx.lineTo(wx + 10, wy + 14);
  ctx.lineTo(wx - 9, wy + 14);
  ctx.closePath();
  ctx.fill();
  // Moving streaks in the fall.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i += 1) {
    const phase = (t * 1.6 + i / 3) % 1;
    const sx = wx - 5 + i * 5.5;
    ctx.globalAlpha = 0.9 - phase * 0.6;
    ctx.beginPath();
    ctx.moveTo(sx, wy - 7 + phase * 16);
    ctx.lineTo(sx + 1, wy - 2 + phase * 16);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Churning foam at the base plus expanding ripples.
  ctx.fillStyle = `rgba(240, 250, 255, ${0.55 + Math.sin(t * 6) * 0.12})`;
  ctx.beginPath();
  ctx.ellipse(wx, wy + 15, 14, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 2; i += 1) {
    const phase = (t * 0.7 + i / 2) % 1;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * (1 - phase)})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(wx, wy + 16, 8 + phase * 22, (8 + phase * 22) * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawLilyPads(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
  const g = pondGeometry(state);
  const season = seasonOf(state.clock);
  if (season === 'winter') return;
  const lily = activeStyle(state, 'lily');
  const padColor = lily?.colors[0] ?? '#4f8f3e';
  const bloomColor = lily?.colors[1] ?? '#f0dce8';
  // Styled lilies bloom in every warm season, not just summer.
  const blooms = lily ? true : season === 'summer';
  for (const pad of decorations().pads) {
    const px = g.cx + Math.cos(pad.x) * g.rx * pad.r;
    const py = g.cy + Math.sin(pad.x) * g.ry * pad.r + Math.sin(t * 1.1 + pad.v * 9) * 1.5;
    const r = 9 + pad.v * 5;
    ctx.fillStyle = padColor;
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * 0.62, 0, 0.25, Math.PI * 2 - 0.25);
    ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fill();
    // Summer bloom on some pads.
    if (blooms && pad.v > 0.55) {
      ctx.fillStyle = bloomColor;
      for (let p = 0; p < 5; p += 1) {
        const a = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(px + Math.cos(a) * 3, py - 3 + Math.sin(a) * 2, 2.6, 1.6, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#e8c94f';
      ctx.beginPath();
      ctx.arc(px, py - 3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Reeds on the far (upper) rim are drawn with the pond, behind the ducks;
// reeds on the near (lower) rim are drawn by drawReedsFront after the ducks
// so a duck swimming past them is partly hidden by the stems.
function drawReeds(ctx: CanvasRenderingContext2D, state: GameState, t: number, front = false): void {
  const g = pondGeometry(state);
  const season = seasonOf(state.clock);
  const stemColor = season === 'winter' ? '#8a9260' : '#5f7d3a';
  const beds = upgradeLevel(state, 'reedBeds');
  const all = [...decorations().reeds, ...decorations().extraReeds.slice(0, beds * 6)];
  const reeds = all.filter((reed) => (Math.sin(reed.x) > 0.15) === front);
  for (const reed of reeds) {
    const rx = g.cx + Math.cos(reed.x) * (g.rx + 10);
    const ry = g.cy + Math.sin(reed.x) * (g.ry + 8);
    const sway = Math.sin(t * 0.9 + reed.v * 8) * 2.5;
    const h = reed.r + 14;

    ctx.strokeStyle = stemColor;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.quadraticCurveTo(rx + sway * 0.4, ry - h * 0.6, rx + sway, ry - h);
    ctx.stroke();
    // Leaf blade.
    ctx.beginPath();
    ctx.moveTo(rx - 1, ry - 4);
    ctx.quadraticCurveTo(rx - 7 + sway * 0.3, ry - h * 0.55, rx - 10 + sway * 0.5, ry - h * 0.8);
    ctx.stroke();

    // Cattail head on the taller reeds.
    if (reed.v > 0.4) {
      ctx.fillStyle = '#7a4a28';
      ctx.beginPath();
      ctx.ellipse(rx + sway, ry - h - 5, 2.6, 7, sway * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawReedsFront(ctx: CanvasRenderingContext2D, state: GameState, timeMs: number): void {
  drawReeds(ctx, state, timeMs / 1000, true);
}

// Winter Lights festival: strings of glowing bulbs sagging over the pond.
function drawFestivalLights(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
  const g = pondGeometry(state);
  const colors = ['#e2574c', '#e8b83a', '#7fc36e', '#7fb2d9', '#c09aec'];
  const poleY = g.cy - g.ry - 46;
  const spans: Array<[number, number]> = [
    [g.cx - g.rx * 0.85, g.cx],
    [g.cx, g.cx + g.rx * 0.85],
  ];

  // Poles at the ends.
  ctx.strokeStyle = '#5f4023';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const x of [spans[0][0], g.cx, spans[1][1]]) {
    ctx.beginPath();
    ctx.moveTo(x, poleY + 4);
    ctx.lineTo(x, g.cy - g.ry + 8);
    ctx.stroke();
  }

  for (const [x0, x1] of spans) {
    // Sagging wire.
    ctx.strokeStyle = 'rgba(40, 40, 46, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, poleY);
    ctx.quadraticCurveTo((x0 + x1) / 2, poleY + 22, x1, poleY);
    ctx.stroke();
    // Bulbs along the wire with a slow twinkle chase.
    const COUNT = 8;
    for (let i = 1; i < COUNT; i += 1) {
      const s = i / COUNT;
      const bx = x0 + (x1 - x0) * s;
      const by = poleY + 2 * (1 - s) * s * 2 * 22 + 3;
      const color = colors[(i + (x0 < g.cx ? 0 : 2)) % colors.length];
      const glow = 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7 + x0);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35 * glow;
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(bx, by, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawVignette(ctx: CanvasRenderingContext2D): void {
  const q = effectiveScale(ctx);
  const key = `${WORLD_W}x${WORLD_H}|${q.toFixed(2)}`;
  if (!vignetteCache || vignetteCache.key !== key) {
    vignetteCache = { key, canvas: renderLayer(q, paintVignette) };
  }
  ctx.drawImage(vignetteCache.canvas, 0, 0, WORLD_W, WORLD_H);
}

function paintVignette(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createRadialGradient(
    WORLD_W / 2,
    WORLD_H / 2,
    Math.min(WORLD_W, WORLD_H) * 0.45,
    WORLD_W / 2,
    WORLD_H / 2,
    Math.max(WORLD_W, WORLD_H) * 0.72,
  );
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(10, 16, 28, 0.22)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
}

// Night darkness overlay, drawn above everything in world space.
export function drawNightOverlay(ctx: CanvasRenderingContext2D, state: GameState): void {
  const darkness = darknessAt(hourOf(state.clock));
  if (darkness <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgba(70, 82, 150, ${0.55 * darkness})`;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.restore();
}

// What's in the sky is what's in state (weather.ts rolls it at dawn): rain
// streaks, drifting snow, a fog bank over the water, or leaves on the wind.
export function drawWeather(ctx: CanvasRenderingContext2D, state: GameState, timeMs: number): void {
  const kind = weatherOf(state);
  if (kind === 'clear') return;
  const t = timeMs / 1000;
  if (kind === 'fog') {
    // Two slow bands of mist over the pond, breathing.
    for (let band = 0; band < 2; band += 1) {
      const y = 300 + band * 120 + Math.sin(t * 0.3 + band) * 12;
      const grad = ctx.createLinearGradient(0, y - 70, 0, y + 70);
      grad.addColorStop(0, 'rgba(220, 228, 236, 0)');
      grad.addColorStop(0.5, `rgba(220, 228, 236, ${0.22 + 0.06 * Math.sin(t * 0.5 + band * 2)})`);
      grad.addColorStop(1, 'rgba(220, 228, 236, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 70, WORLD_W, 140);
    }
    return;
  }
  const count = kind === 'wind' ? 18 : 40;
  for (let i = 0; i < count; i += 1) {
    const seed = i * 127.31;
    if (kind === 'rain') {
      const x = ((seed * 7.13 + t * 60) % (WORLD_W + 40)) - 20;
      const y = ((seed * 13.7 + t * 240) % (WORLD_H + 40)) - 20;
      if (Math.sin(t * 0.05 + i) < 0.4) continue;
      ctx.strokeStyle = 'rgba(180, 210, 240, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2, y + 9);
      ctx.stroke();
    } else if (kind === 'snow') {
      const x = ((seed * 7.13 + t * 18) % (WORLD_W + 40)) - 20;
      const y = ((seed * 13.7 + t * 45) % (WORLD_H + 40)) - 20;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.arc(x + Math.sin(t + i) * 8, y, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Wind: leaves and seed-fluff streaming across, tumbling.
      const x = ((seed * 9.1 + t * 180) % (WORLD_W + 80)) - 40;
      const y = 200 + ((seed * 3.7) % 340) + Math.sin(t * 2 + i) * 14;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 3 + i);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(200, 170, 80, 0.7)' : 'rgba(160, 190, 90, 0.6)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
