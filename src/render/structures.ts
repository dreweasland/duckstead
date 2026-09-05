// Built things on the bank: the feeding trough and silo, the nest with its
// hutch, brooder lamp, egg cooler, and incubator, the training perch, the
// vet clinic, and the bachelor pen with its fences and gate.

import type { GameState } from '../state';
import { upgradeLevel } from '../sim/economy';
import { activeStyle, type StyleDef } from '../sim/society';
import { penRect, type PenRect } from '../sim/pen';
import { mixColors } from '../sim/genetics';
import { bathHousePos, FEEDER_POS, nestPos, pondGeometry, treatDispenserPos } from '../sim/pond';
import { feederCapacity } from '../sim/needs';
import { hourOf } from '../sim/time';
import { FOODS, TREATS, type FoodKind } from '../sim/food';
import { groundShadow } from './paint';
import { darknessAt } from './sky';

// Wooden feeding trough; the grain mound shows how full it is. Only drawn
// once the upgrade is owned.
export function drawFeeder(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (!state.upgrades.feedingTrough) return;
  const { x, y } = FEEDER_POS;
  const fill = state.feeder.food / feederCapacity(state);

  groundShadow(ctx, x + 3, y + 20, 52, 12);

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
    groundShadow(ctx, sx, y + 16, 16, 5);
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

// Bath House: a wooden tub on the bank beside the clinic, with suds while
// there is soap and a dry tub when the stock has run out.
export function drawBathHouse(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
  if (upgradeLevel(state, 'bathHouse') === 0) return;
  const { x, y } = bathHousePos(state);
  const soap = state.inventory.soap > 0;
  ctx.save();
  groundShadow(ctx, x, y + 12, 26, 6, 0.18);
  // Tub staves.
  ctx.fillStyle = '#8a6238';
  ctx.beginPath();
  ctx.moveTo(x - 24, y - 12);
  ctx.lineTo(x + 24, y - 12);
  ctx.lineTo(x + 20, y + 10);
  ctx.lineTo(x - 20, y + 10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5f4023';
  ctx.lineWidth = 1;
  for (const sx of [-14, -5, 4, 13]) {
    ctx.beginPath();
    ctx.moveTo(x + sx, y - 12);
    ctx.lineTo(x + sx * 0.85, y + 10);
    ctx.stroke();
  }
  // Iron hoops.
  ctx.strokeStyle = '#4a4a4a';
  ctx.lineWidth = 2;
  for (const hy of [y - 6, y + 5]) {
    ctx.beginPath();
    ctx.moveTo(x - 23 + (hy - y + 12) * 0.18, hy);
    ctx.lineTo(x + 23 - (hy - y + 12) * 0.18, hy);
    ctx.stroke();
  }
  // Water, and suds while there is soap to make them.
  ctx.fillStyle = soap ? '#7fb6d8' : '#6a8aa0';
  ctx.beginPath();
  ctx.ellipse(x, y - 12, 22, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  if (soap) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < 6; i += 1) {
      const bx = x - 14 + i * 5.5 + Math.sin(t / 700 + i) * 1.5;
      const by = y - 14 - Math.abs(Math.sin(t / 900 + i * 1.3)) * 3;
      ctx.beginPath();
      ctx.arc(bx, by, 2 + (i % 3) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Signboard.
  ctx.fillStyle = '#ece6d6';
  ctx.fillRect(x + 24, y - 30, 18, 12);
  ctx.strokeStyle = '#5f4023';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 33, y - 18);
  ctx.lineTo(x + 33, y + 4);
  ctx.stroke();
  ctx.fillStyle = '#4a90c2';
  ctx.beginPath();
  ctx.arc(x + 30, y - 24, 2.2, 0, Math.PI * 2);
  ctx.arc(x + 36, y - 25, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Treat Dispenser: a hopper on a post at the trough's far end, mirroring
// the silo, with a coloured window showing which treat it holds most of.
export function drawTreatDispenser(ctx: CanvasRenderingContext2D, state: GameState): void {
  const level = upgradeLevel(state, 'treatDispenser');
  if (level === 0) return;
  const { x: dx, y } = treatDispenserPos();
  ctx.save();
  groundShadow(ctx, dx, y + 16, 12, 4);
  ctx.strokeStyle = '#5f4023';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(dx, y - 6);
  ctx.lineTo(dx, y + 14);
  ctx.stroke();
  const h = 18 + level * 6;
  const top = y - 10 - h;
  ctx.fillStyle = '#c9b48a';
  ctx.fillRect(dx - 11, top, 22, h);
  ctx.strokeStyle = '#8a6238';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(dx - 11, top, 22, h);
  // Window: the colour of the fullest treat, or empty glass.
  let fullest: FoodKind | null = null;
  for (const kind of TREATS) if (state.inventory[kind] > 0 && (fullest === null || state.inventory[kind] > state.inventory[fullest])) fullest = kind;
  ctx.fillStyle = fullest ? FOODS[fullest].color : 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(dx - 7, top + 5, 14, h - 12);
  // Spout.
  ctx.fillStyle = '#8a6238';
  ctx.beginPath();
  ctx.moveTo(dx - 6, top + h);
  ctx.lineTo(dx + 6, top + h);
  ctx.lineTo(dx + 2, y - 4);
  ctx.lineTo(dx - 2, y - 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawNest(ctx: CanvasRenderingContext2D, state: GameState): void {
  const { x, y } = nestPos();

  groundShadow(ctx, x + 4, y + 20, 66, 18);

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
  groundShadow(ctx, cx, floorY + 26, w / 2 + 6, 6, 0.18);
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
  groundShadow(ctx, x, y + 2, 9, 3.5, 0.18);
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
  groundShadow(ctx, 2, 10, 18, 5);
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
export function drawTrainingPerch(ctx: CanvasRenderingContext2D, state: GameState, t: number): void {
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
export function drawVetClinic(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (upgradeLevel(state, 'vetClinic') === 0) return;
  const x = 300;
  const y = 262;
  ctx.save();
  groundShadow(ctx, x + 2, y + 22, 30, 7, 0.18);
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
export function drawBachelorPen(ctx: CanvasRenderingContext2D, state: GameState): void {
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
  groundShadow(ctx, 0, 15, 20, 4.5);
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
