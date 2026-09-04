// The three drills' scoring rules, kept free of the DOM so they can be
// tested on their own. Each drill is its own verb:
//   paddle  — a rhythm game: tap on a metronome's beats; timing is graded
//   stamina — a pacing game: hold to paddle, ease off before the duck puffs out
//   poise   — a balance game: keep a wobbling duck steady on the show pedestal
// Every drill boils down to a 0..1 form that sim/training turns into points.

// --- Paddle: rhythm ---
export const BEAT_MS = 600; // 100 beats a minute
export const COUNT_IN_BEATS = 4;
export const DRILL_TAPS = 8;
// A tap further from any beat than this is a stray tap: it scores nothing
// and hits nothing.
export const STRAY_MS = 300;

export type TapGrade = 'perfect' | 'good' | 'early' | 'late' | 'miss';

interface TapResult {
  grade: TapGrade;
  power: number; // 0..1, this paddle's share of the form
}

// Grade a tap by how far it landed from the beat, in ms (negative = early).
export function gradeTap(offsetMs: number): TapResult {
  const off = Math.abs(offsetMs);
  if (off <= 70) return { grade: 'perfect', power: 1 };
  if (off <= 150) return { grade: 'good', power: 0.7 };
  if (off < STRAY_MS) return { grade: offsetMs < 0 ? 'early' : 'late', power: 0.35 };
  return { grade: 'miss', power: 0.1 };
}

export const MISSED_BEAT_POWER = 0.1;

// The beat's moment, in ms after the drill starts, for beat index i (0-based
// after the count-in).
export function beatTime(index: number): number {
  return (COUNT_IN_BEATS + index) * BEAT_MS;
}

// Average paddle power over a drill: unresolved beats count as misses.
export function paddleQuality(powers: number[]): number {
  let sum = 0;
  for (let i = 0; i < DRILL_TAPS; i += 1) sum += powers[i] ?? MISSED_BEAT_POWER;
  return sum / DRILL_TAPS;
}

// --- Stamina: pacing ---
export const STAMINA_TIME_MS = 12_000;
export const LENGTH_PX = 150; // one length of the practice course
export const STAMINA_TARGET_LENGTHS = 4.5; // what a well-paced twelve seconds covers
export const HOLD_SPEED = 95; // px/s at full puff
export const IDLE_SPEED = 12; // drifting
export const FATIGUE_RATE = 0.5; // per second held
export const RECOVER_RATE = 0.4; // per second resting
export const PUFF_ZONE = 0.6; // the gauge's green band: full speed up to here
export const STALL_MS = 1500; // puffed out: dead in the water

// Speed factor for a paddling duck at a given fatigue: full up to the green
// band's top, then falling away — the drill rewards easing off, not mashing.
export function paceFactor(fatigue: number): number {
  if (fatigue <= PUFF_ZONE) return 1;
  const over = (fatigue - PUFF_ZONE) / (1 - PUFF_ZONE);
  return 1 - over * 0.65;
}

export function staminaQuality(lengths: number): number {
  return Math.min(1, lengths / STAMINA_TARGET_LENGTHS);
}

// --- Poise: balance ---
export const POISE_TIME_MS = 12_000;
export const MARK_HALF = 0.34; // the mark: a wobble this far either side still reads as steady
const TOPPLE_AT = 1; // past this the duck flaps and rights itself
const TOPPLE_MS = 1200; // ...taking this long, scoring nothing meanwhile
const NUDGE = 0.75; // a tap's kick to the wobble's velocity: one tap answers most of a gust
export const GUST_GAP_MIN = 2000; // ms between gusts, at least
export const GUST_GAP_SPREAD = 1400; // ...plus up to this much
export const FIRST_GUST_MS = 2200;
export const GLANCE_MS = 1300;
export const GLANCE_WEIGHT = 3; // a judged moment counts this many times over
export const GLANCES = 4;

// The judge's glances, spaced through the drill with a little jitter so the
// rhythm can't be memorised; `rand` is 0..1.
export function glanceTimes(rand: () => number): number[] {
  const out: number[] = [];
  const slot = (POISE_TIME_MS - 1500) / GLANCES;
  for (let i = 0; i < GLANCES; i += 1) out.push(1500 + slot * i + rand() * (slot - GLANCE_MS));
  return out;
}

export interface Balance {
  wobble: number; // -1..1, negative leans left
  velocity: number;
  toppledUntil: number; // ms, > now while the duck is righting itself
}

// One step of the wobble: the breeze leans on it, gravity pulls it further
// over, and the player's taps kick it back. `gust` is -1..1 noise; `elapsed`
// grows the instability so the last seconds ask the most. Proper gusts are
// the panel's business: it adds them straight to the velocity.
export function stepBalance(b: Balance, dt: number, gust: number, elapsed: number, now: number): void {
  if (now < b.toppledUntil) return;
  const instability = 0.75 + (elapsed / POISE_TIME_MS) * 0.75;
  b.velocity += (gust * 0.6 + b.wobble * instability) * dt;
  b.velocity *= Math.pow(0.12, dt); // heavy damping: a kick moves it about half its size, then settles
  b.wobble += b.velocity * dt;
  if (Math.abs(b.wobble) >= TOPPLE_AT) {
    // It rights itself, but still leaning the way it fell: a tap is owed.
    b.wobble = Math.sign(b.wobble) * 0.45;
    b.velocity = 0;
    b.toppledUntil = now + TOPPLE_MS;
  }
}

export function nudge(b: Balance, dir: -1 | 1, now: number): void {
  if (now < b.toppledUntil) return;
  b.velocity += dir * NUDGE;
}

// A gust: a shove that grows a little as the drill goes on. Never more
// than a tap and a half can answer.
export function gustStrength(elapsed: number, rand: number): number {
  return 0.55 + rand * 0.35 + (elapsed / POISE_TIME_MS) * 0.25;
}

// How steady a moment reads. Inside the mark is good form, a touch better
// dead centre; past the mark it falls away fast, to nothing at a topple.
export function poiseSample(wobble: number): number {
  const w = Math.abs(wobble);
  if (w <= MARK_HALF) return 1 - 0.3 * (w / MARK_HALF);
  const over = Math.min(1, (w - MARK_HALF) / (TOPPLE_AT - MARK_HALF));
  return 0.45 * (1 - over) * (1 - over);
}

// Time-weighted form over the drill; judged moments weigh more.
export function poiseQuality(samples: Array<{ score: number; weight: number }>): number {
  let sum = 0;
  let weight = 0;
  for (const s of samples) {
    sum += s.score * s.weight;
    weight += s.weight;
  }
  return weight > 0 ? sum / weight : 0;
}
