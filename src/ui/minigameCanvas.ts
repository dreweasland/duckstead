// Canvas primitives the minigames share: the race (racePanel) and the
// training drills (trainingPanel) each paint their own picture on a canvas
// of the same width, over the same water, under the same banner. Anything
// specific to one game — lanes, buoys, the show ring — stays with that game.

export const CANVAS_W = 860;

export interface ShimmerOpts {
  count: number; // how many drifting highlights
  xStride: number; // px between highlights along the drift
  yTop: number; // highlights sit below this line
  yStride: number; // px between highlights down the canvas
}

// Deep-water gradient with a drift of highlights. The shimmer layout is the
// caller's: each game keeps the exact pattern it always had.
export function drawWater(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, shimmer: ShimmerOpts): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#4a90c2');
  grad.addColorStop(1, '#2c6899');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < shimmer.count; i += 1) {
    const sx = ((i * shimmer.xStride + now / 25) % (w + 40)) - 20;
    const sy = shimmer.yTop + ((i * shimmer.yStride) % (h - shimmer.yTop));
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy);
    ctx.lineTo(sx + 8, sy);
    ctx.stroke();
  }
}

// A dark band across the middle with gold text: countdowns and cues.
export function drawBanner(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  ctx.fillStyle = 'rgba(16, 22, 30, 0.65)';
  ctx.fillRect(0, h / 2 - 26, w, 52);
  ctx.fillStyle = '#ffe08a';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2 + 9);
  ctx.textAlign = 'left';
}
