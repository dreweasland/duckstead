// Sound, synthesised. No audio files: every quack, plop, chime, and the
// pond's ambience come out of a small WebAudio graph, so the build stays
// asset-free and the CSP untouched. The context opens on the first user
// gesture (browsers require it); until then every call is a no-op.
import { events } from '../events';

interface AudioSettings {
  volume: number; // 0..1
  muted: boolean;
}

type Cue =
  | 'quack'
  | 'plop'
  | 'coin'
  | 'chime'
  | 'sparkle'
  | 'bell'
  | 'farewell'
  | 'tick'
  | 'splash'
  | 'cheer'
  | 'hit'
  | 'miss';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambienceGain: GainNode | null = null;
let ambienceSource: AudioBufferSourceNode | null = null;
let ambienceNight = false;
let settings: AudioSettings = { volume: 0.6, muted: false };
let unlocked = false;
const lastCue = new Map<Cue, number>();

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  if (!unlocked) return null;
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.connect(ctx.destination);
  applyVolume();
  return ctx;
}

function applyVolume(): void {
  if (!master || !ctx) return;
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume * settings.volume, ctx.currentTime, 0.05);
}

export function setAudioSettings(next: AudioSettings): void {
  settings = { ...next };
  applyVolume();
  if (!settings.muted && unlocked) ensureAmbience();
}

// Call from the first pointerdown/keydown: opens the context and starts the
// ambience. Safe to call repeatedly.
export function unlockAudio(): void {
  if (unlocked) {
    if (ctx?.state === 'suspended') void ctx.resume();
    return;
  }
  unlocked = true;
  if (ensureContext()) ensureAmbience();
}

// --- Cues ---------------------------------------------------------------

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slideTo?: number; attack?: number; delay?: number } = {}): void {
  const c = ensureContext();
  if (!c || !master || settings.muted) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t0 + (opts.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, opts: { gain?: number; filter?: number; q?: number; delay?: number } = {}): void {
  const c = ensureContext();
  if (!c || !master || settings.muted) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = opts.filter ?? 1200;
  f.Q.value = opts.q ?? 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.15, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

// A quack: a buzzy sawtooth with a formant filter, pitched by the duck's
// size (big ducks are deep) and sex (hens are higher and sharper).
export function quack(sizeScale = 1, sex: 'M' | 'F' = 'F', count = 1): void {
  const c = ensureContext();
  if (!c || !master || settings.muted) return;
  if (!throttle('quack', 120)) return;
  const base = (sex === 'F' ? 520 : 380) / (0.7 + sizeScale * 0.5);
  for (let i = 0; i < count; i += 1) {
    const t0 = c.currentTime + i * 0.17;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base * 1.15, t0);
    osc.frequency.exponentialRampToValueAtTime(base * 0.8, t0 + 0.13);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = base * 2.2;
    f.Q.value = 2.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
    osc.connect(f).connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.17);
  }
}

function throttle(cue: Cue, ms: number): boolean {
  const now = performance.now();
  if ((lastCue.get(cue) ?? -Infinity) + ms > now) return false;
  lastCue.set(cue, now);
  return true;
}

export function play(cue: Cue): void {
  switch (cue) {
    case 'quack':
      quack();
      break;
    case 'plop':
      if (!throttle('plop', 60)) return;
      tone(320, 0.12, { type: 'sine', gain: 0.18, slideTo: 140 });
      noise(0.08, { gain: 0.06, filter: 900 });
      break;
    case 'splash':
      noise(0.35, { gain: 0.12, filter: 1800, q: 0.5 });
      tone(240, 0.2, { gain: 0.08, slideTo: 90 });
      break;
    case 'coin':
      if (!throttle('coin', 80)) return;
      tone(1320, 0.09, { type: 'triangle', gain: 0.14 });
      tone(1760, 0.16, { type: 'triangle', gain: 0.12, delay: 0.06 });
      break;
    case 'chime':
      tone(880, 0.4, { gain: 0.14 });
      tone(1108, 0.5, { gain: 0.12, delay: 0.12 });
      tone(1318, 0.7, { gain: 0.1, delay: 0.24 });
      break;
    case 'sparkle':
      if (!throttle('sparkle', 150)) return;
      tone(1567, 0.12, { type: 'triangle', gain: 0.08 });
      tone(2093, 0.18, { type: 'triangle', gain: 0.07, delay: 0.05 });
      break;
    case 'bell':
      tone(660, 0.9, { type: 'triangle', gain: 0.16 });
      tone(990, 0.9, { type: 'sine', gain: 0.06, delay: 0.02 });
      break;
    case 'farewell':
      tone(392, 1.2, { gain: 0.12 });
      tone(311, 1.6, { gain: 0.1, delay: 0.5 });
      tone(261, 2.2, { gain: 0.09, delay: 1.0 });
      break;
    case 'tick':
      if (!throttle('tick', 40)) return;
      tone(1800, 0.03, { type: 'square', gain: 0.04 });
      break;
    case 'cheer':
      noise(0.9, { gain: 0.1, filter: 2400, q: 0.3 });
      tone(523, 0.3, { type: 'triangle', gain: 0.1 });
      tone(659, 0.3, { type: 'triangle', gain: 0.1, delay: 0.15 });
      tone(784, 0.5, { type: 'triangle', gain: 0.12, delay: 0.3 });
      break;
    case 'hit':
      if (!throttle('hit', 60)) return;
      tone(740, 0.08, { type: 'triangle', gain: 0.12, slideTo: 980 });
      break;
    case 'miss':
      if (!throttle('miss', 60)) return;
      tone(220, 0.1, { type: 'square', gain: 0.05, slideTo: 160 });
      break;
  }
}

// --- Ambience -----------------------------------------------------------

// A looping bed of filtered noise (water) with the occasional bird by day
// and cricket by night, regenerated when day turns to night.
function ensureAmbience(): void {
  const c = ensureContext();
  if (!c || !master || settings.muted) return;
  if (ambienceSource) return;
  const seconds = 6;
  const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    // Brown-ish noise: water lapping.
    last = (last + (Math.random() * 2 - 1) * 0.02) * 0.995;
    data[i] = last * (0.7 + 0.3 * Math.sin((i / c.sampleRate) * 0.9));
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 600;
  ambienceGain = c.createGain();
  ambienceGain.gain.value = 0.35;
  src.connect(f).connect(ambienceGain).connect(master);
  src.start();
  ambienceSource = src;
  scheduleCreature();
}

let creatureTimer = 0;
function scheduleCreature(): void {
  window.clearTimeout(creatureTimer);
  creatureTimer = window.setTimeout(() => {
    if (!settings.muted && ctx) {
      if (ambienceNight) {
        // Cricket: a rapid trill.
        for (let i = 0; i < 5; i += 1) tone(4200, 0.03, { type: 'square', gain: 0.012, delay: i * 0.06 });
      } else {
        // Songbird: two rising notes.
        const f = 1800 + Math.random() * 1200;
        tone(f, 0.12, { gain: 0.03, slideTo: f * 1.3 });
        tone(f * 1.2, 0.15, { gain: 0.025, slideTo: f * 1.05, delay: 0.16 });
      }
    }
    scheduleCreature();
  }, 4000 + Math.random() * 9000);
}

export function setAmbienceNight(night: boolean): void {
  ambienceNight = night;
  if (ambienceGain && ctx) ambienceGain.gain.setTargetAtTime(night ? 0.2 : 0.35, ctx.currentTime, 0.5);
}

// Wire the game's events to cues. Idempotent.
let wired = false;
export function wireGameAudio(): void {
  if (wired) return;
  wired = true;
  events.on('egg-hatched', () => play('chime'));
  events.on('purchase', () => play('coin'));
  events.on('duck-grew', () => play('sparkle'));
  events.on('duck-died', () => play('farewell'));
  events.on('life-event', () => play('bell'));
  events.on('favourite-found', () => play('sparkle'));
  events.on('dawn', () => play('chime'));
}
