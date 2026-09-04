// The pond: wobbled shoreline, water with shimmer, ripples, and glint, the
// bog filter, the waterfall, lily pads, the rubber duck toy, and the reeds
// on its rim (the near-rim reeds drawn again over the ducks).

import type { GameState } from '../state';
import { upgradeLevel } from '../sim/economy';
import { activeStyle } from '../sim/society';
import { mixColors } from '../sim/genetics';
import { pondGeometry } from '../sim/pond';
import { festivalToday } from '../sim/festivals';
import { NIGHT_END, NIGHT_START, seasonOf } from '../sim/time';
import { fillCircles } from './paint';
import { decorations } from './layout';
import { drawFestivalLights } from './ground';
import { drawTrainingPerch } from './structures';

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

export function drawPond(
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
  const daytime = hour >= NIGHT_END && hour < NIGHT_START;
  const sunT = daytime ? (hour - NIGHT_END) / (NIGHT_START - NIGHT_END) : 0.5;
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
  fillCircles(ctx, bx, by, stones);
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
  fillCircles(ctx, wx, wy, rocks);
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
