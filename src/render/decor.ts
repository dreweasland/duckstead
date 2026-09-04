// Player-placed decorations: lanterns, benches, flower beds, gnomes,
// string lights, and the champion statue, plus the translucent ghost
// shown while one is being placed or moved.

import type { GameState } from '../state';
import type { Vec2 } from '../types';
import type { DecorKind } from '../sim/economy';
import { drawDuck } from './duckPainter';
import { createDuck } from '../sim/duck';
import { representativeGenome } from '../sim/breedBook';
import { createRng } from '../rng';
import { hourOf } from '../sim/time';
import { groundShadow, wireSag } from './paint';
import { darknessAt } from './sky';

// A fixed specimen for the champion statue (grey stone regardless of breed).
const STATUE_DUCK = createDuck(createRng(77), { genome: representativeGenome('M|D|solid|c'), stage: 'adult', pos: { x: 0, y: 0 }, sex: 'M', name: 'statue' });
const STATUE_ANIM = { bob: 0, bodyTilt: 0, legPhase: 0, headDip: 0, headBob: 0, billOpen: 0, wingFlap: 0, tailWag: 0, headTuck: 0, headBack: 0, raise: 1, blink: false };

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
  const { x, y } = pos;
  ctx.save();
  ctx.translate(x, y);
  switch (kind) {
    case 'lantern': {
      groundShadow(ctx, 2, 2, 9, 3);
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
      groundShadow(ctx, 0, 7, 22, 4.5, 0.18);
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
      groundShadow(ctx, 0, 2, 7, 2.5);
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
        const by = -22 + wireSag(s, 10) + 2;
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
      groundShadow(ctx, 2, 14, 22, 6, 0.2);
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
