// Small shared canvas strokes used by both the scene and the renderer.

/** Soft ground-contact shadow: a dark green ellipse under an object. */
export function groundShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha = 0.16,
): void {
  ctx.fillStyle = `rgba(20, 40, 16, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Fill a list of `[dx, dy, radius, color]` discs offset from (x, y). */
export function fillCircles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  circles: ReadonlyArray<readonly [number, number, number, string]>,
): void {
  for (const [ox, oy, r, color] of circles) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Vertical drop of a wire hung between two posts at fraction `s` of its span. */
export function wireSag(s: number, depth: number): number {
  return 2 * (1 - s) * s * 2 * depth;
}
