import type { Game } from '../game';
import { fitWorldToWindow, WORLD_H, WORLD_W } from '../state';
import { lerp } from '../types';
import { duckRadius } from '../sim/duck';
import { eggIncubationTicks } from '../sim/lifecycle';
import { eggWarmth } from '../sim/needs';
import { FOODS } from '../sim/food';
import { VISITOR_FLY_TICKS, visitorFlightPos, visitorInFlight } from '../sim/visitors';
import { isInPond } from '../sim/pond';
import { computeAnim } from './animation';
import { drawDuck } from './duckPainter';
import { drawBachelorPenFront, drawReedsFront, drawDecorations, drawDecorGhost, drawNightOverlay, drawScene, drawWeather, type DecorGhost } from './scene';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number; // seconds
  life: number;
  kind: 'heart' | 'bubble' | 'sparkle';
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  // Decoration being placed/moved, drawn translucent under the cursor.
  decorGhost: DecorGhost | null = null;
  private lastParticleTime = 0;
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private game: Game,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // The world width tracks the window aspect, so this fills the screen;
    // letterboxing only appears at extreme aspect ratios where the world
    // width clamps.
    fitWorldToWindow();
    this.scale = Math.min(w / WORLD_W, h / WORLD_H) * dpr;
    this.offsetX = (w * dpr - WORLD_W * this.scale) / 2;
    this.offsetY = (h * dpr - WORLD_H * this.scale) / 2;
  }

  // Convert a client (CSS pixel) coordinate to world space.
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (clientX * dpr - this.offsetX) / this.scale,
      y: (clientY * dpr - this.offsetY) / this.scale,
    };
  }

  render = (alpha: number): void => {
    const { ctx } = this;
    const state = this.game.state;
    const timeMs = performance.now();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, WORLD_H);
    ctx.clip();

    drawScene(ctx, state, timeMs);
    this.drawBugs(ctx, timeMs);

    // Food pellets.
    for (const pellet of state.foodPellets) {
      ctx.beginPath();
      ctx.arc(pellet.pos.x, pellet.pos.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = FOODS[pellet.kind ?? (pellet.premium ? 'premiumFeed' : 'feed')].color;
      ctx.fill();
    }

    // Ducks, y-sorted for painter's-algorithm depth.
    const sorted = [...state.ducks].sort((a, b) => a.pos.y - b.pos.y);
    for (const duck of sorted) {
      const x = lerp(duck.prevPos.x, duck.pos.x, alpha);
      const y = lerp(duck.prevPos.y, duck.pos.y, alpha);
      const anim = computeAnim(duck, timeMs);
      const inWater = duck.stage !== 'egg' && isInPond(state, duck.pos);
      const facingLeft = Math.cos(duck.heading) < 0;

      ctx.save();
      ctx.translate(x, y);
      drawDuck(ctx, duck, {
        inWater,
        selected: duck.id === this.game.selectedDuckId,
        anim,
        facingLeft,
        eggProgress:
          duck.stage === 'egg' ? duck.incubationTicks / eggIncubationTicks(state) : undefined,
        eggWarmth: duck.stage === 'egg' ? eggWarmth(duck) : undefined,
        eggReady: duck.stage === 'egg' ? duck.readyToHatch === true : undefined,
        timeMs,
      });

      // Sleeping "z" drift.
      if (duck.activity === 'sleep') {
        const t = (timeMs / 1000) % 2;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.8 - t * 0.4})`;
        ctx.font = '10px sans-serif';
        ctx.fillText('z', 14, -26 - t * 8);
      }
      ctx.restore();
    }

    this.drawVisitor(ctx, timeMs, alpha);
    // Near-rim reeds and the pen's front rail go over the ducks behind them.
    drawReedsFront(ctx, state, timeMs);
    drawBachelorPenFront(ctx, state);
    // Decorations sit in front of everything on the ground.
    drawDecorations(ctx, state, timeMs / 1000, this.decorGhost);
    drawDecorGhost(ctx, state, timeMs / 1000, this.decorGhost);
    this.drawParticles(ctx, timeMs);
    drawWeather(ctx, state, timeMs);
    drawNightOverlay(ctx, state);
    ctx.restore();
  };

  // Spawn a little feedback particle at a world position.
  spawnParticle(x: number, y: number, kind: 'heart' | 'bubble' | 'sparkle'): void {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 12,
      vy: -22 - Math.random() * 14,
      age: 0,
      life: 0.9 + Math.random() * 0.4,
      kind,
    });
  }

  private drawParticles(ctx: CanvasRenderingContext2D, timeMs: number): void {
    const dt = this.lastParticleTime ? Math.min(0.05, (timeMs - this.lastParticleTime) / 1000) : 0;
    this.lastParticleTime = timeMs;
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t;
      if (p.kind === 'heart') {
        ctx.fillStyle = '#e37ba3';
        const s = 4 * (1 - t * 0.4);
        ctx.beginPath();
        ctx.arc(p.x - s / 2, p.y - s / 3, s / 2, 0, Math.PI * 2);
        ctx.arc(p.x + s / 2, p.y - s / 3, s / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(p.x - s, p.y - s / 6);
        ctx.lineTo(p.x, p.y + s);
        ctx.lineTo(p.x + s, p.y - s / 6);
        ctx.closePath();
        ctx.fill();
      } else if (p.kind === 'sparkle') {
        ctx.strokeStyle = '#ffe28a';
        ctx.lineWidth = 1.4;
        const s = 3 + t * 3;
        ctx.beginPath();
        ctx.moveTo(p.x - s, p.y);
        ctx.lineTo(p.x + s, p.y);
        ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x, p.y + s);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#d8ecf7';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5 + t * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawVisitor(ctx: CanvasRenderingContext2D, timeMs: number, alpha: number): void {
    const visitor = this.game.state.visitor;
    if (!visitor) return;
    const t = timeMs / 1000;
    const { duck } = visitor;
    const facingLeft = (visitor.side ?? 1) > 0;

    if (visitorInFlight(visitor)) {
      // Glide in from the side: sub-tick interpolation keeps it smooth at 1×.
      const ticksLeft = Math.max(0, (visitor.flyTicksLeft ?? 0) - alpha);
      const p = 1 - ticksLeft / VISITOR_FLY_TICKS;
      const flight = visitorFlightPos(visitor, p);
      // Ground shadow shrinks and fades with altitude.
      const shade = Math.max(0, 1 - flight.height / 260);
      ctx.save();
      ctx.translate(flight.x, duck.pos.y + 14);
      ctx.fillStyle = `rgba(20, 40, 16, ${0.05 + 0.18 * shade})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 14 + 10 * shade, 4 + 3 * shade, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(flight.x, flight.y);
      // Nose down on the approach, flaring level for touchdown.
      ctx.rotate((facingLeft ? -1 : 1) * 0.22 * (1 - p));
      const anim = computeAnim(duck, timeMs);
      anim.wingFlap = Math.abs(Math.sin(t * 14)) * (0.6 + 0.4 * (1 - p));
      anim.bob = 0;
      drawDuck(ctx, duck, { inWater: false, selected: false, anim, facingLeft });
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(duck.pos.x, duck.pos.y);
    drawDuck(ctx, duck, {
      inWater: false,
      selected: false,
      anim: computeAnim(duck, timeMs),
      facingLeft,
    });
    // Pulsing sparkle marker so the visitor stands out.
    const pulse = 0.75 + Math.sin(t * 4) * 0.25;
    ctx.fillStyle = `rgba(232, 184, 58, ${pulse})`;
    ctx.save();
    ctx.translate(0, -42 + Math.sin(t * 2.4) * 2);
    ctx.scale(pulse, pulse);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(2, -2);
    ctx.lineTo(7, 0);
    ctx.lineTo(2, 2);
    ctx.lineTo(0, 7);
    ctx.lineTo(-2, 2);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-2, -2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Treat progress pips.
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.arc(-10 + i * 10, -30, 3, 0, Math.PI * 2);
      ctx.fillStyle = i < visitor.treatsGiven ? '#e8b83a' : 'rgba(255, 255, 255, 0.35)';
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBugs(ctx: CanvasRenderingContext2D, timeMs: number): void {
    const t = timeMs / 1000;
    for (const bug of this.game.state.bugs) {
      ctx.save();
      ctx.translate(bug.pos.x, bug.pos.y);
      if (bug.kind === 'beetle') {
        ctx.rotate(bug.heading);
        // Legs wiggle as it scurries.
        ctx.strokeStyle = '#2c221a';
        ctx.lineWidth = 1;
        const wiggle = Math.sin(t * 14 + bug.id) * 1.2;
        for (const side of [-1, 1]) {
          for (const lx of [-2.5, 0, 2.5]) {
            ctx.beginPath();
            ctx.moveTo(lx, 0);
            ctx.lineTo(lx + wiggle * side * 0.4, side * 4);
            ctx.stroke();
          }
        }
        ctx.fillStyle = '#3d2c1e';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5, 3.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#241a10';
        ctx.beginPath();
        ctx.arc(4.5, 0, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (bug.kind === 'firefly') {
        // Pulsing glow, bobbing as it drifts.
        const pulse = 0.55 + 0.45 * Math.sin(t * 5 + bug.id * 1.7);
        ctx.translate(0, Math.sin(t * 2 + bug.id) * 2);
        ctx.fillStyle = `rgba(220, 255, 120, ${0.18 * pulse})`;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(240, 255, 160, ${0.5 + 0.5 * pulse})`;
        ctx.beginPath();
        ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (bug.kind === 'feather') {
        // A molted feather: curved quill with a soft vane in the duck's color.
        ctx.rotate(-0.25 + bug.heading * 0.5);
        ctx.fillStyle = 'rgba(20, 30, 16, 0.18)';
        ctx.beginPath();
        ctx.ellipse(1, 3, 9, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = bug.color ?? '#c9b58a';
        ctx.beginPath();
        ctx.moveTo(-9, 2);
        ctx.quadraticCurveTo(-2, -8, 10, -3);
        ctx.quadraticCurveTo(2, 5, -9, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-9, 2);
        ctx.quadraticCurveTo(0, -2, 9, -3);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.beginPath();
        ctx.moveTo(-9, 2);
        ctx.lineTo(-13, 4);
        ctx.stroke();
      } else if (bug.kind === 'henEgg') {
        ctx.rotate(bug.heading);
        ctx.fillStyle = 'rgba(20, 40, 16, 0.18)';
        ctx.beginPath();
        ctx.ellipse(1, 4, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, 0, 6.5, 8.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#f3ead2';
        ctx.fill();
        ctx.strokeStyle = '#cfc3a4';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.ellipse(-2, -3, 1.8, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (bug.kind === 'duckweed') {
        // A clump of tiny floating leaves at the rim.
        ctx.fillStyle = 'rgba(20, 40, 16, 0.15)';
        ctx.beginPath();
        ctx.ellipse(0, 3, 10, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        const leaves: Array<[number, number, number]> = [
          [0, 0, 4], [-5, 2, 3], [5, 1, 3.2], [2, -4, 2.8], [-3, -3, 2.6], [-7, -2, 2], [7, -3, 2.2],
        ];
        for (const [lx, ly, r] of leaves) {
          ctx.fillStyle = (lx + ly) % 2 === 0 ? '#6fbf4a' : '#59a83c';
          ctx.beginPath();
          ctx.arc(lx, ly + Math.sin(t * 1.5 + bug.id + lx) * 0.4, r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Snail: body with a spiral shell.
        ctx.rotate(Math.cos(bug.heading) < 0 ? Math.PI : 0);
        ctx.fillStyle = '#9a8a6a';
        ctx.beginPath();
        ctx.ellipse(0, 1.5, 6, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#9a8a6a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(6.5, -3.5);
        ctx.stroke();
        ctx.fillStyle = '#7a5c40';
        ctx.beginPath();
        ctx.arc(-1.5, -2, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#5c4028';
        ctx.beginPath();
        ctx.arc(-1.5, -2, 2, 0, Math.PI * 1.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Hit-test ducks (topmost = greatest y first).
  pickDuck(worldX: number, worldY: number): string | null {
    const state = this.game.state;
    // Among overlapping hits, the one whose centre is nearest (relative to
    // its own hit radius) wins — so a small egg tucked behind a big one is
    // still clickable near its own middle. Front-of-scene (larger y) only
    // breaks near-ties.
    let bestId: string | null = null;
    let bestScore = Infinity;
    for (const duck of state.ducks) {
      const dx = worldX - duck.pos.x;
      const dy = worldY - duck.pos.y;
      // Generous hit radius: ducklings are tiny and everyone is in motion.
      const r = Math.max(24, duckRadius(duck) + 6);
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const score = d / r - duck.pos.y * 0.0001;
      if (score < bestScore) {
        bestScore = score;
        bestId = duck.id;
      }
    }
    return bestId;
  }
}
