// The sky and everything laid over the world: the hour-blended gradient,
// stars, sun and moon, drifting clouds, the cached vignette, the night
// darkness overlay, and the weather (rain, snow, fog, wind).

import type { GameState } from '../state';
import { WORLD_H, WORLD_W } from '../state';
import { lerp } from '../types';
import { mixColors } from '../sim/genetics';
import { hourOf, NIGHT_END, NIGHT_START } from '../sim/time';
import { weatherOf } from '../sim/weather';
import { decorations, effectiveScale, HORIZON, renderLayer } from './layout';

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

export function darknessAt(hour: number): number {
  if (hour >= NIGHT_START || hour < 5) return 1;
  if (hour >= 19.5) return (hour - 19.5) / 1.5;
  if (hour < 6.5) return 1 - (hour - 5) / 1.5;
  return 0;
}

let vignetteCache: { key: string; canvas: HTMLCanvasElement } | null = null;

export function drawSky(ctx: CanvasRenderingContext2D, hour: number): void {
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

export function drawStars(ctx: CanvasRenderingContext2D, dark: number, timeMs: number): void {
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

export function drawSunMoon(ctx: CanvasRenderingContext2D, hour: number): void {
  const daytime = hour >= NIGHT_END && hour < NIGHT_START;
  const t = daytime ? (hour - NIGHT_END) / (NIGHT_START - NIGHT_END) : ((hour + 24 - NIGHT_START) % 24) / (24 - NIGHT_START + NIGHT_END);
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

export function drawClouds(ctx: CanvasRenderingContext2D, dark: number, timeMs: number): void {
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

export function drawVignette(ctx: CanvasRenderingContext2D): void {
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
