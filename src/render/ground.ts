// The ground: seasonal grass colours, the hazy treeline, the rolling
// meadow, its tufts and seasonal scatter, the trees, and the Winter
// Lights strings that hang over the pond during the festival.

import type { GameState } from '../state';
import { WORLD_H, WORLD_W } from '../state';
import type { Season } from '../types';
import { activeStyle } from '../sim/society';
import { mixColors } from '../sim/genetics';
import { pondGeometry } from '../sim/pond';
import { groundShadow, wireSag } from './paint';
import { decorations, HORIZON } from './layout';

// Society styles recolour the pond; the season still shows through.
export function grassColor(season: Season, state: GameState): string {
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

// Hazy bumps of distant woods along the horizon.
export function drawTreeline(ctx: CanvasRenderingContext2D, season: Season): void {
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

export function drawGrass(ctx: CanvasRenderingContext2D, season: Season, state: GameState): void {
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

export function drawGroundDecor(ctx: CanvasRenderingContext2D, season: Season, state: GameState): void {
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

export function drawTrees(ctx: CanvasRenderingContext2D, season: Season): void {
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
    groundShadow(ctx, x + 6 * s, 206, 34 * s, 7 * s, 0.18);

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

// Winter Lights festival: strings of glowing bulbs sagging over the pond.
export function drawFestivalLights(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
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
      const by = poleY + wireSag(s, 22) + 3;
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
