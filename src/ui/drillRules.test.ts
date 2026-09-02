import { describe, expect, it } from 'vitest';
import {
  BEAT_MS,
  beatTime,
  COUNT_IN_BEATS,
  DRILL_TAPS,
  FATIGUE_RATE,
  GLANCE_MS,
  GLANCES,
  glanceTimes,
  gradeTap,
  gustStrength,
  HOLD_SPEED,
  IDLE_SPEED,
  LENGTH_PX,
  MARK_HALF,
  nudge,
  paceFactor,
  paddleQuality,
  POISE_TIME_MS,
  poiseQuality,
  poiseSample,
  RECOVER_RATE,
  STALL_MS,
  STAMINA_TIME_MS,
  staminaQuality,
  stepBalance,
  STRAY_MS,
  type Balance,
} from './drillRules';

// A tiny deterministic generator for the simulations below.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('paddle drill: rhythm', () => {
  it('grades a tap by its distance from the beat', () => {
    expect(gradeTap(0)).toEqual({ grade: 'perfect', power: 1 });
    expect(gradeTap(-60).grade).toBe('perfect');
    expect(gradeTap(120).grade).toBe('good');
    expect(gradeTap(-200).grade).toBe('early');
    expect(gradeTap(200).grade).toBe('late');
    expect(gradeTap(STRAY_MS).grade).toBe('miss');
  });

  it('beats follow the count-in, a beat apart', () => {
    expect(beatTime(0)).toBe(COUNT_IN_BEATS * BEAT_MS);
    expect(beatTime(1) - beatTime(0)).toBe(BEAT_MS);
  });

  it('form is the average, and unanswered beats count as misses', () => {
    expect(paddleQuality(new Array<number>(DRILL_TAPS).fill(1))).toBe(1);
    expect(paddleQuality([])).toBeCloseTo(0.1);
    const half = paddleQuality([1, 1, 1, 1]);
    expect(half).toBeCloseTo((4 + 4 * 0.1) / DRILL_TAPS);
  });
});

// Runs the pacing game with a given holding strategy; returns lengths.
function swim(strategy: (fatigue: number, holding: boolean) => boolean): number {
  const dt = 1 / 60;
  let fatigue = 0;
  let holding = false;
  let stalledUntil = -1;
  let distance = 0;
  for (let t = 0; t < STAMINA_TIME_MS / 1000; t += dt) {
    const stalled = t < stalledUntil;
    holding = strategy(fatigue, holding);
    const paddling = holding && !stalled;
    if (paddling) {
      fatigue = Math.min(1, fatigue + FATIGUE_RATE * dt);
      if (fatigue >= 1) stalledUntil = t + STALL_MS / 1000;
    } else fatigue = Math.max(0, fatigue - RECOVER_RATE * dt);
    distance += (stalled ? 0 : paddling ? HOLD_SPEED * paceFactor(fatigue) : IDLE_SPEED) * dt;
  }
  return distance / LENGTH_PX;
}

describe('stamina drill: pacing', () => {
  it('speed is full in the green band and falls off above it', () => {
    expect(paceFactor(0)).toBe(1);
    expect(paceFactor(0.6)).toBe(1);
    expect(paceFactor(0.8)).toBeLessThan(1);
    expect(paceFactor(1)).toBeGreaterThan(0.3);
  });

  it('pacing beats mashing: easing off in the green covers more water than holding through', () => {
    const paced = swim((f, h) => (h ? f < 0.6 : f < 0.3));
    const mashed = swim(() => true);
    const idle = swim(() => false);
    expect(paced).toBeGreaterThan(mashed);
    expect(staminaQuality(paced)).toBeGreaterThanOrEqual(0.9);
    expect(staminaQuality(mashed)).toBeLessThan(0.75);
    expect(staminaQuality(mashed)).toBeGreaterThan(0.4);
    expect(staminaQuality(idle)).toBeLessThan(0.3);
  });
});

// Runs the balance game with a player who reacts after `reactionMs` and
// taps toward centre while the duck leans past `threshold`.
function balance(seed: number, player: { reactionMs: number; threshold: number } | null): { quality: number; steady: number; topples: number } {
  const rand = lcg(seed);
  const dt = 1 / 60;
  const b: Balance = { wobble: 0, velocity: 0, toppledUntil: 0 };
  const glances = glanceTimes(rand);
  const samples: Array<{ score: number; weight: number }> = [];
  const phase = [rand() * 6, rand() * 6];
  let nextGust = 1800 + rand() * 800;
  let lastTap = -Infinity;
  let steady = 0;
  let topples = 0;
  let leanSince = -1;
  for (let now = 0; now < POISE_TIME_MS; now += dt * 1000) {
    const t = now / 1000;
    const wasToppled = now < b.toppledUntil;
    const breeze = Math.sin(t * 1.7 + phase[0]) * 0.6 + Math.sin(t * 3.1 + phase[1]) * 0.4;
    if (now >= nextGust && !wasToppled) {
      b.velocity += (rand() < 0.5 ? -1 : 1) * gustStrength(now, rand());
      nextGust = now + 1400 + rand() * 1200;
    }
    if (player) {
      const leaning = Math.abs(b.wobble) > player.threshold;
      if (!leaning) leanSince = -1;
      else if (leanSince < 0) leanSince = now;
      if (leaning && now - leanSince >= player.reactionMs && now - lastTap >= 180) {
        nudge(b, b.wobble > 0 ? -1 : 1, now);
        lastTap = now;
      }
    }
    stepBalance(b, dt, breeze, now, now);
    if (!wasToppled && now < b.toppledUntil) topples += 1;
    const toppled = now < b.toppledUntil;
    const glancing = glances.some((g) => now >= g && now < g + GLANCE_MS);
    samples.push({ score: toppled ? 0 : poiseSample(b.wobble), weight: dt * (glancing ? 3 : 1) });
    if (!toppled && Math.abs(b.wobble) <= MARK_HALF) steady += dt;
  }
  return { quality: poiseQuality(samples), steady: steady / (POISE_TIME_MS / 1000), topples };
}

describe('poise drill: balance', () => {
  it('a moment reads best dead centre, good anywhere in the mark, and worthless at a topple', () => {
    expect(poiseSample(0)).toBe(1);
    expect(poiseSample(MARK_HALF / 2)).toBeCloseTo(0.85);
    expect(poiseSample(MARK_HALF)).toBeCloseTo(0.7);
    expect(poiseSample(MARK_HALF + 0.01)).toBeLessThan(0.6);
    expect(poiseSample(-0.6)).toBeLessThan(0.2);
    expect(poiseSample(1)).toBe(0);
  });

  it('judged moments weigh more', () => {
    const q = poiseQuality([
      { score: 1, weight: 1 },
      { score: 0, weight: 3 },
    ]);
    expect(q).toBeCloseTo(0.25);
    expect(poiseQuality([])).toBe(0);
  });

  it('the judge glances four times, spread through the drill, never past its end', () => {
    const times = glanceTimes(lcg(3));
    expect(times).toHaveLength(GLANCES);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(GLANCE_MS);
    expect(times[times.length - 1] + GLANCE_MS).toBeLessThanOrEqual(POISE_TIME_MS);
  });

  it('a duck nobody steadies leans over and flaps; a reasonable player keeps it up', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const alone = balance(seed, null);
      expect(alone.topples).toBeGreaterThanOrEqual(1);
      expect(alone.quality).toBeLessThan(0.45);
      const attentive = balance(seed, { reactionMs: 250, threshold: 0.15 });
      expect(attentive.topples).toBe(0);
      expect(attentive.quality).toBeGreaterThan(0.6);
      expect(attentive.quality).toBeGreaterThan(alone.quality);
      const slow = balance(seed, { reactionMs: 600, threshold: 0.35 });
      expect(slow.quality).toBeLessThan(attentive.quality);
    }
  });
});
