import type { Duck } from '../sim/duck';
import type { Phenotype } from '../sim/genetics';
import { darken, lighten, mixColors } from '../sim/genetics';
import type { AnimState } from './animation';

// The duck is drawn in a local space where the body center is the origin and
// the duck faces +x. Body is ~44 wide before sizeScale.

export interface DrawOpts {
  inWater: boolean;
  selected: boolean;
  anim: AnimState;
  facingLeft: boolean;
  eggProgress?: number; // 0..1 incubation progress, for stage === 'egg'
  eggWarmth?: number; // 0..100, tints the shell and adds shiver lines when cold
  eggReady?: boolean; // cracked open, waiting for a tap
  timeMs?: number;
}

const MALLARD_HEAD_GREEN = '#2e6b45';

export function drawDuck(ctx: CanvasRenderingContext2D, duck: Duck, opts: DrawOpts): void {
  const p = duck.phenotype;
  const stageScale =
    duck.stage === 'duckling' ? 0.45 : duck.stage === 'juvenile' ? 0.75 : 1;
  const scale = p.sizeScale * stageScale;

  ctx.save();
  ctx.translate(0, -opts.anim.bob);
  ctx.scale(opts.facingLeft ? -scale : scale, scale);
  ctx.rotate(opts.anim.bodyTilt);

  if (duck.stage === 'egg') {
    drawEgg(ctx, opts.eggProgress ?? 0, opts.eggWarmth ?? 70, opts.eggReady ?? false, opts.timeMs ?? 0, opts.selected);
    ctx.restore();
    return;
  }

  const colors = stageColors(duck, p);

  if (opts.selected) {
    ctx.beginPath();
    ctx.ellipse(0, 6, 30, 20, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 235, 130, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  if (!opts.inWater) drawLegs(ctx, opts.anim);

  drawTail(ctx, colors.body, opts.anim);
  drawBody(ctx, colors.body, duck, opts.inWater);
  drawWing(ctx, colors.body, opts.anim);
  if (p.pattern === 'spotted') drawSpots(ctx, duck, p.patternColor);
  drawDirt(ctx, duck);
  drawHeadGroup(ctx, duck, colors, opts.anim);

  if (duck.activity === 'shake') drawShakeDroplets(ctx);
  if (duck.activity === 'forage' && !opts.inWater) drawForageBits(ctx, opts.anim);
  if (opts.inWater) drawWaterline(ctx);
  if (duck.activity === 'dabble') drawDabbleRipple(ctx);
  ctx.restore();
}

function stageColors(duck: Duck, p: Phenotype): { body: string; head: string } {
  let body = p.bodyColor;
  let head = p.headColor;
  // Adult mallard-expressing males get the classic green head.
  if (
    duck.sex === 'M' &&
    (duck.stage === 'adult' || duck.stage === 'elder') &&
    isMallardish(duck)
  ) {
    head = mixColors(head, MALLARD_HEAD_GREEN, 0.75);
  }
  // Ducklings wear yellow fluff over their genetic color — true colors are a
  // reveal moment at the juvenile molt.
  if (duck.stage === 'duckling') {
    body = mixColors(body, '#f0d95d', 0.6);
    head = mixColors(head, '#f0d95d', 0.6);
  }
  if (duck.stage === 'elder') {
    body = mixColors(body, '#c9c4bb', 0.15);
    head = mixColors(head, '#c9c4bb', 0.15);
  }
  return { body, head };
}

function isMallardish(duck: Duck): boolean {
  const [a, b] = duck.genome.baseColor;
  return a === 'M' || b === 'M';
}

function drawEgg(
  ctx: CanvasRenderingContext2D,
  progress: number,
  warmth: number,
  ready: boolean,
  timeMs: number,
  selected: boolean,
): void {
  // A ready egg rocks impatiently; a cold one shivers.
  const t = timeMs / 1000;
  if (ready) ctx.rotate(Math.sin(t * 9) * 0.18);
  else if (warmth < 25) ctx.translate(Math.sin(t * 40) * 0.8, 0);

  if (selected || ready) {
    ctx.beginPath();
    ctx.ellipse(0, 2, 17, 20, 0, 0, Math.PI * 2);
    ctx.strokeStyle = ready ? `rgba(255, 220, 90, ${0.6 + 0.4 * Math.sin(t * 6)})` : 'rgba(255, 235, 130, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Warm glow when toasty, blue chill when cold.
  if (warmth > 70) {
    ctx.beginPath();
    ctx.ellipse(0, 2, 16, 19, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 170, 60, ${0.10 + 0.15 * ((warmth - 70) / 30)})`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 14, 0, 0, Math.PI * 2);
  ctx.fillStyle = warmth < 40 ? mixColors('#f5eeda', '#b9cde6', (40 - warmth) / 40) : '#f5eeda';
  ctx.fill();
  ctx.strokeStyle = '#d8cdb2';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Crack lines appear at 50% and 80% incubation.
  ctx.strokeStyle = '#a89a76';
  if (progress > 0.5) {
    ctx.beginPath();
    ctx.moveTo(-5, -3);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 3);
    ctx.stroke();
  }
  if (progress > 0.8) {
    ctx.beginPath();
    ctx.moveTo(3, -6);
    ctx.lineTo(5, -2);
    ctx.lineTo(2, 1);
    ctx.lineTo(5, 4);
    ctx.stroke();
  }
}

function drawLegs(ctx: CanvasRenderingContext2D, anim: AnimState): void {
  const swing = Math.sin(anim.legPhase * Math.PI * 2) * 4;
  ctx.strokeStyle = '#d98324';
  ctx.fillStyle = '#d98324';
  ctx.lineWidth = 2.5;
  for (const side of [-1, 1]) {
    const x = 2 + side * 5 + (side > 0 ? swing : -swing);
    ctx.beginPath();
    ctx.moveTo(side * 4, 12);
    ctx.lineTo(x, 21);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 4, 21.5);
    ctx.lineTo(x + 5, 21.5);
    ctx.lineTo(x + 1, 18.5);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTail(ctx: CanvasRenderingContext2D, bodyColor: string, anim: AnimState): void {
  ctx.save();
  // Wag pivots around the tail base.
  ctx.translate(-18, 2);
  ctx.rotate(-anim.tailWag);
  ctx.translate(18, -2);
  ctx.beginPath();
  ctx.moveTo(-18, -2);
  ctx.lineTo(-30, -10);
  ctx.lineTo(-27, -2);
  ctx.lineTo(-31, 3);
  ctx.lineTo(-19, 6);
  ctx.closePath();
  ctx.fillStyle = darken(bodyColor, 0.15);
  ctx.fill();
  ctx.restore();
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  bodyColor: string,
  duck: Duck,
  inWater: boolean,
): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 15, 0, 0, Math.PI * 2);
  ctx.fillStyle = duck.sick ? mixColors(bodyColor, '#7ba36a', 0.25) : bodyColor;
  ctx.fill();

  // Belly highlight (hidden under the waterline when swimming).
  if (!inWater) {
    ctx.beginPath();
    ctx.ellipse(2, 7, 15, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = lighten(bodyColor, 0.18);
    ctx.fill();
  }
}

function drawWing(ctx: CanvasRenderingContext2D, bodyColor: string, anim: AnimState): void {
  ctx.save();
  ctx.translate(-2, -3);
  ctx.rotate(-anim.wingFlap);
  ctx.beginPath();
  ctx.moveTo(8, -2);
  ctx.bezierCurveTo(2, -9, -14, -8, -16, 0);
  ctx.bezierCurveTo(-14, 7, 0, 8, 8, -2);
  ctx.closePath();
  ctx.fillStyle = darken(bodyColor, 0.1);
  ctx.fill();
  ctx.restore();
}

// Deterministic spots seeded by duck id, clipped to the body ellipse.
function drawSpots(ctx: CanvasRenderingContext2D, duck: Duck, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 15, 0, 0, Math.PI * 2);
  ctx.clip();
  let h = 0;
  for (let i = 0; i < duck.id.length; i += 1) h = (h * 31 + duck.id.charCodeAt(i)) >>> 0;
  const count = 5 + (h % 4);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    h = (h * 1103515245 + 12345) >>> 0;
    const x = ((h % 100) / 100) * 40 - 20;
    h = (h * 1103515245 + 12345) >>> 0;
    const y = ((h % 100) / 100) * 26 - 13;
    h = (h * 1103515245 + 12345) >>> 0;
    const r = 2 + (h % 100) / 40;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Grubby ducks wear their neglect: mud smudges that fade as they're brushed.
function drawDirt(ctx: CanvasRenderingContext2D, duck: Duck): void {
  if (duck.stage === 'egg') return;
  const clean = duck.needs.cleanliness;
  if (clean >= 55) return;
  const alpha = ((55 - clean) / 55) * 0.55;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 15, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = `rgba(94, 70, 40, ${alpha})`;
  let h = 0;
  for (let i = 0; i < duck.id.length; i += 1) h = (h * 33 + duck.id.charCodeAt(i)) >>> 0;
  const count = 3 + (h % 3);
  for (let i = 0; i < count; i += 1) {
    h = (h * 1103515245 + 12345) >>> 0;
    const x = ((h % 100) / 100) * 36 - 18;
    h = (h * 1103515245 + 12345) >>> 0;
    const y = ((h % 100) / 100) * 22 - 11;
    h = (h * 1103515245 + 12345) >>> 0;
    const r = 3 + (h % 100) / 30;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHeadGroup(
  ctx: CanvasRenderingContext2D,
  duck: Duck,
  colors: { body: string; head: string },
  anim: AnimState,
): void {
  const p = duck.phenotype;
  ctx.save();

  if (anim.headTuck > 0) {
    // Sleeping: head rests back on the body.
    ctx.translate(2, -8);
  } else if (anim.headBack > 0) {
    // Preening: the head swivels right around (mirrored) so the bill points
    // backward and dips down to nuzzle into the wing.
    const turn = Math.min(1, anim.headBack);
    ctx.translate(12 - turn * 18, -14 + turn * 6);
    ctx.scale(-1, 1);
    ctx.rotate(0.25 + turn * 0.45);
  } else {
    ctx.translate(16 + anim.headBob, -16 - anim.raise * 5 + anim.headDip * 14);
    ctx.rotate(anim.headDip * 0.5);
  }

  // Neck.
  ctx.beginPath();
  ctx.moveTo(-8, 4);
  ctx.quadraticCurveTo(-10, 12, -12, 14);
  ctx.lineTo(-2, 14);
  ctx.quadraticCurveTo(-2, 8, 0, 4);
  ctx.closePath();
  ctx.fillStyle = colors.head;
  ctx.fill();

  // Head.
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fillStyle = duck.sick ? mixColors(colors.head, '#7ba36a', 0.25) : colors.head;
  ctx.fill();

  // Capped pattern: colored crown.
  if (p.pattern === 'capped') {
    ctx.beginPath();
    ctx.arc(0, 0, 10, Math.PI, 0);
    ctx.fillStyle = p.patternColor;
    ctx.fill();
  }

  // Crest pom-pom.
  if (p.crested) {
    ctx.fillStyle = lighten(colors.head, 0.25);
    for (const [cx, cy, r] of [
      [-4, -9, 4.5],
      [1, -11, 5],
      [5, -8, 4],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawBill(ctx, p, anim);
  drawEye(ctx, duck, anim);
  ctx.restore();
}

function drawBill(ctx: CanvasRenderingContext2D, p: Phenotype, anim: AnimState): void {
  const len = 8 + p.billLength * 8;
  const halfW = (4 + p.billWidth * 4) / 2;
  const open = anim.billOpen * 3;

  ctx.fillStyle = p.billColor;
  // Upper mandible.
  ctx.beginPath();
  ctx.moveTo(8, -halfW * 0.6 - open * 0.4);
  ctx.quadraticCurveTo(8 + len, -halfW - open, 8 + len, -open * 0.5);
  ctx.lineTo(8 + len, 0);
  ctx.lineTo(8, 1);
  ctx.closePath();
  ctx.fill();
  // Lower mandible.
  ctx.beginPath();
  ctx.moveTo(8, 1);
  ctx.lineTo(8 + len - 1, open * 0.4 + 0.5);
  ctx.quadraticCurveTo(8 + len - 2, halfW + open * 0.6, 8, halfW * 0.7 + 1);
  ctx.closePath();
  ctx.fillStyle = darken(p.billColor, 0.12);
  ctx.fill();
}

function drawEye(ctx: CanvasRenderingContext2D, duck: Duck, anim: AnimState): void {
  const sad = duck.stage !== 'egg' && duck.needs.happiness < 25;
  if (anim.headTuck > 0 || anim.blink) {
    // Closed eye arc.
    ctx.beginPath();
    ctx.arc(2, -2, 2.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = '#1d1a16';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(3, -2, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = '#1d1a16';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(3.8, -2.8, 0.7, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (duck.sick || sad) {
    // Droopy eyelid.
    ctx.beginPath();
    ctx.moveTo(0.5, -4);
    ctx.lineTo(5.5, -3);
    ctx.strokeStyle = duck.sick ? '#5f7d54' : '#1d1a16';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
}

function drawWaterline(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(0, 9, 27, 6, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Splash rings where the head plunges in while dabbling.
function drawDabbleRipple(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 1.3;
  for (const r of [6, 11]) {
    ctx.beginPath();
    ctx.ellipse(22, 8, r, r * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Seeds and grass bits flicked up in front of the bill while foraging,
// timed to the pecks.
function drawForageBits(ctx: CanvasRenderingContext2D, anim: AnimState): void {
  const peck = Math.max(0, anim.headDip - 0.7) / 0.35; // 0 → 1 at the bottom of a peck
  if (peck <= 0) return;
  ctx.fillStyle = `rgba(120, 150, 70, ${0.7 * peck})`;
  const bits: Array<[number, number, number]> = [
    [24, 10 - peck * 6, 1.4],
    [29, 8 - peck * 9, 1.1],
    [20, 7 - peck * 4, 1],
  ];
  for (const [x, y, r] of bits) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A halo of flung droplets during a shake-off.
function drawShakeDroplets(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(190, 225, 250, 0.8)';
  const drops: Array<[number, number, number]> = [
    [-26, -14, 1.6],
    [-10, -22, 1.3],
    [10, -24, 1.5],
    [26, -16, 1.2],
    [30, -2, 1.4],
    [-30, 0, 1.2],
  ];
  for (const [x, y, r] of drops) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
