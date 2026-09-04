import type { GameState } from '../state';
import { WORLD_H, WORLD_W } from '../state';
import { hourOf, seasonOf } from '../sim/time';
import { effectiveScale, renderLayer } from './layout';
import { darknessAt, drawClouds, drawSky, drawStars, drawSunMoon, drawVignette } from './sky';
import { drawGrass, drawGroundDecor, drawTreeline, drawTrees, grassColor } from './ground';
import { drawBachelorPen, drawFeeder, drawNest, drawVetClinic } from './structures';
import { drawPond } from './pond';

// The scene is painted by the modules below; the renderer imports the
// pieces it layers between the ducks from here.
export { drawDecorations, drawDecorGhost, drawDecoration, type DecorGhost } from './decor';
export { drawBachelorPenFront } from './structures';
export { drawReedsFront } from './pond';
export { drawNightOverlay, drawWeather } from './sky';

// --- Static backdrop cache --------------------------------------------------
// The treeline, grass, tufts, flowers, and trees change only with world size,
// season, and grass style — yet they were re-rasterized every frame (dozens
// of paths and gradients). Render once to an offscreen bitmap at the canvas's
// effective resolution and blit. The sky, sun/moon, stars, and clouds stay
// live: they animate, and the sun must slip behind the cached treeline.
let groundCache: { key: string; canvas: HTMLCanvasElement } | null = null;

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
