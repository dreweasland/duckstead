// Training drills: three short solo minigames that build a duck's trained
// stats. Each is its own verb and its own picture, so a drill never feels
// like the one before it:
//   paddle  — a rhythm game on the water: eight beats of a metronome roll
//             toward a hit ring; tap on each, and every tap is graded
//   stamina — a pacing game down a buoyed course: hold to paddle, ease off
//             before the puff gauge tops out; lengths in twelve seconds
//   poise   — a balance game in the show ring: the duck wobbles on its
//             pedestal, left/right nudges keep it upright, and the judge's
//             glances count triple
// The scoring rules live in drillRules.ts; each drill returns a 0..1 form
// that sim/training turns into points.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { canDrill, drillsLeft, trainSquad, TRAIN_STAT_META, type TrainStat } from '../sim/training';
import { computeAnim } from '../render/animation';
import { drawDuck } from '../render/duckPainter';
import { el, statTile } from './dom';
import { backToPondRow, eventCard } from './eventCard';
import type { IconName } from './icons';
import { play } from '../audio/audio';
import { keyFor, keyLabel, matchesKey } from './settings';
import {
  BEAT_MS,
  beatTime,
  COUNT_IN_BEATS,
  DRILL_TAPS,
  FATIGUE_RATE,
  FIRST_GUST_MS,
  GLANCE_MS,
  GLANCE_WEIGHT,
  glanceTimes,
  gradeTap,
  GUST_GAP_MIN,
  GUST_GAP_SPREAD,
  gustStrength,
  HOLD_SPEED,
  IDLE_SPEED,
  LENGTH_PX,
  MARK_HALF,
  MISSED_BEAT_POWER,
  nudge,
  paceFactor,
  paddleQuality,
  POISE_TIME_MS,
  poiseQuality,
  poiseSample,
  PUFF_ZONE,
  RECOVER_RATE,
  STALL_MS,
  STAMINA_TARGET_LENGTHS,
  STAMINA_TIME_MS,
  staminaQuality,
  stepBalance,
  STRAY_MS,
  type Balance,
  type TapGrade,
} from './drillRules';
import { CANVAS_W, drawBanner as drawSharedBanner, drawWater as drawSharedWater } from './minigameCanvas';

const CANVAS_H = 220;

export const DRILL_META: Record<TrainStat, { label: string; icon: IconName; hint: string }> = {
  paddle: { label: 'Paddle drill', icon: 'flag', hint: 'A rhythm game: tap on each beat of the metronome — sprint power.' },
  stamina: { label: 'Long haul', icon: 'bubbles', hint: 'A pacing game: hold to paddle, ease off before the duck puffs out — distance.' },
  poise: { label: 'Show stance', icon: 'star', hint: 'A balance game: keep the duck steady on its pedestal while the judge looks — presence.' },
};

const DRILL_HINTS: Record<TrainStat, string> = {
  paddle: 'Beats roll in from the right. Click the water (or press KEY) as each one reaches the ring. Four count-in ticks, then eight beats.',
  stamina: 'Hold the water (or KEY) to paddle. The puff gauge climbs while you hold; ease off in the green and never let it top out.',
  poise: 'The duck wobbles. Tap ← / → (or A / D, or the left or right half of the ring) to steady it. Stay in the mark, especially when the judge looks.',
};

function drillHint(stat: TrainStat): string {
  return DRILL_HINTS[stat].replace('KEY', keyLabel(keyFor('paddle')));
}

interface UiHooks {
  toast(msg: string): void;
  refresh(): void;
}

interface DrillScaffold {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  counter: HTMLElement;
  finish: (quality: number, detail: string) => void;
  onKeys: (down: (e: KeyboardEvent) => void, up?: (e: KeyboardEvent) => void) => void;
  onPointerUp: (h: () => void) => void;
  setRaf: (id: number) => void;
}

export function openDrill(game: Game, ui: UiHooks, duck: Duck, stat: TrainStat): void {
  const gate = canDrill(game.state, duck);
  if (!gate.ok) {
    ui.toast(gate.reason ?? 'Can\'t train right now');
    return;
  }
  let raf = 0;
  let keyDown: ((e: KeyboardEvent) => void) | null = null;
  let keyUp: ((e: KeyboardEvent) => void) | null = null;
  let pointerUp: (() => void) | null = null;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    if (keyDown) window.removeEventListener('keydown', keyDown);
    if (keyUp) window.removeEventListener('keyup', keyUp);
    if (pointerUp) window.removeEventListener('pointerup', pointerUp);
    keyDown = null;
    keyUp = null;
    pointerUp = null;
  };
  const ev = eventCard(document.getElementById('ui-root')!, 'drill', 'drill-card', cleanup);
  if (!ev) return;
  const { card, close, header } = ev;
  const title = `${DRILL_META[stat].label} — ${duck.name}`;

  const canvas = el('canvas', { class: 'race-canvas drill-canvas' }) as HTMLCanvasElement;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const counter = el('div', { class: 'drill-counter' }, '');
  const hint = el('div', { class: 'muted small race-hint' }, drillHint(stat));
  card.replaceChildren(header(DRILL_META[stat].icon, title), canvas, counter, hint);

  let done = false;
  const finish = (quality: number, detail: string) => {
    if (done) return;
    done = true;
    cleanup();
    const { gain, squad } = trainSquad(game.state, duck.id, stat, quality);
    const live = game.state.ducks.find((d) => d.id === duck.id);
    const after = live?.training?.[stat] ?? 0;
    const form = quality >= 0.8 ? 'Perfect form!' : quality >= 0.55 ? 'Good work' : quality >= 0.3 ? 'Sloppy, but it counts' : 'A fumbled drill';
    card.classList.toggle('win', quality >= 0.8);
    card.replaceChildren(
      header(DRILL_META[stat].icon, form),
      el(
        'div',
        { class: 'race-stats' },
        statTile('star', `${Math.round(quality * 100)}%`, 'form'),
        statTile('flag', `+${gain}`, TRAIN_STAT_META[stat].label.toLowerCase()),
        statTile('duck', String(Math.round(after)), `${TRAIN_STAT_META[stat].label.toLowerCase()} now`),
        statTile('sparkle', String(live ? drillsLeft(game.state, live) : 0), 'drills left today'),
      ),
      el('div', { class: 'drill-detail' }, detail),
      ...(squad.length > 0
        ? [el('div', { class: 'drill-squad' }, `Drilled alongside: ${squad.map((m) => `${m.duck.name} +${m.gain}`).join(', ')}`)]
        : []),
      el('div', { class: 'muted small' }, TRAIN_STAT_META[stat].blurb),
      backToPondRow(close),
    );
    ui.refresh();
    if (gain > 0) {
      const others = squad.length > 0 ? ` (and ${squad.length === 1 ? squad[0].duck.name : `${squad.length} squad-mates`})` : '';
      ui.toast(`${duck.name} gained +${gain} ${TRAIN_STAT_META[stat].label.toLowerCase()}${others}`);
    }
  };

  const scaffold: DrillScaffold = {
    canvas,
    ctx: canvas.getContext('2d')!,
    counter,
    finish,
    onKeys: (down, up) => {
      keyDown = down;
      window.addEventListener('keydown', down);
      if (up) {
        keyUp = up;
        window.addEventListener('keyup', up);
      }
    },
    onPointerUp: (h) => {
      pointerUp = h;
      window.addEventListener('pointerup', h);
    },
    setRaf: (id) => {
      raf = id;
    },
  };
  const trainee: Duck = { ...duck, activity: 'swim' };
  if (stat === 'paddle') runPaddle(scaffold, trainee);
  else if (stat === 'stamina') runStamina(scaffold, trainee);
  else runPoise(scaffold, trainee);
}

// A label that pops up over the action and fades.
interface Pop {
  text: string;
  color: string;
  at: number;
  x: number;
  y: number;
}
const POP_MS = 650;

function drawPops(ctx: CanvasRenderingContext2D, pops: Pop[], now: number): void {
  ctx.textAlign = 'center';
  ctx.font = 'bold 18px sans-serif';
  for (const p of pops) {
    const age = (now - p.at) / POP_MS;
    if (age >= 1) continue;
    ctx.globalAlpha = 1 - age * age;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y - age * 26);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

const GRADE_LOOK: Record<TapGrade | 'stray', { text: string; color: string }> = {
  perfect: { text: 'Perfect!', color: '#9fe58a' },
  good: { text: 'Good', color: '#ffe08a' },
  early: { text: 'Early', color: '#ffb46a' },
  late: { text: 'Late', color: '#ffb46a' },
  miss: { text: 'Miss', color: '#ff7a6a' },
  stray: { text: 'Off the beat', color: '#c8d0d8' },
};

// --- Paddle: a rhythm game ---
const HIT_X = 180;
const LANE_Y = 52;
const NOTE_SPEED = 0.3; // px per ms: a beat apart is 180px

function runPaddle(s: DrillScaffold, duck: Duck): void {
  const start = performance.now();
  const powers: Array<number | undefined> = new Array<number | undefined>(DRILL_TAPS).fill(undefined);
  const grades: TapGrade[] = [];
  const pops: Pop[] = [];
  let resolved = 0;
  let lastBeat = -1;
  let lastTap = -Infinity;
  let x = 90;
  let boost = 0;
  let lastFrame = start;
  let endAt = Infinity;
  const updateCounter = () => {
    const perfect = grades.filter((g) => g === 'perfect').length;
    s.counter.textContent = `${resolved} / ${DRILL_TAPS} beats${perfect ? ` · ${perfect} perfect` : ''}`;
  };
  updateCounter();
  const settle = (i: number, grade: TapGrade, power: number, now: number) => {
    powers[i] = power;
    grades.push(grade);
    resolved += 1;
    const look = GRADE_LOOK[grade];
    pops.push({ text: look.text, color: look.color, at: now, x: HIT_X, y: LANE_Y - 22 });
    boost += 110 * power;
    updateCounter();
    if (resolved >= DRILL_TAPS) endAt = now + 600;
  };
  const tap = () => {
    const now = performance.now();
    if (now - lastTap < 120) return;
    lastTap = now;
    const elapsed = now - start;
    let best = -1;
    let bestOff = Infinity;
    for (let i = 0; i < DRILL_TAPS; i += 1) {
      if (powers[i] !== undefined) continue;
      const off = elapsed - beatTime(i);
      if (Math.abs(off) < Math.abs(bestOff)) {
        best = i;
        bestOff = off;
      }
    }
    if (best < 0 || Math.abs(bestOff) >= STRAY_MS) {
      play('miss');
      pops.push({ ...GRADE_LOOK.stray, at: now, x: HIT_X, y: LANE_Y - 22 });
      return;
    }
    const { grade, power } = gradeTap(bestOff);
    play(power >= 0.7 ? 'hit' : 'miss');
    settle(best, grade, power, now);
  };
  s.canvas.addEventListener('pointerdown', tap);
  s.onKeys((e) => {
    if (matchesKey(e, 'paddle')) {
      e.preventDefault();
      tap();
    }
  });
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const elapsed = now - start;
    // The metronome.
    const beat = Math.floor(elapsed / BEAT_MS);
    if (beat !== lastBeat && beat < COUNT_IN_BEATS + DRILL_TAPS) {
      lastBeat = beat;
      play('tick');
    }
    // Beats that rolled past unanswered.
    for (let i = 0; i < DRILL_TAPS; i += 1) {
      if (powers[i] === undefined && elapsed > beatTime(i) + STRAY_MS) {
        play('miss');
        settle(i, 'miss', MISSED_BEAT_POWER, now);
      }
    }
    boost *= Math.pow(0.2, dt);
    x += (30 + boost) * dt;
    if (x > CANVAS_W - 80) x = 90;
    drawWater(s.ctx, now);
    drawBeatLane(s.ctx, elapsed, powers, beat);
    drawSwimmer(s.ctx, duck, x, now);
    drawPops(s.ctx, pops, now);
    if (elapsed < COUNT_IN_BEATS * BEAT_MS) {
      const count = COUNT_IN_BEATS - Math.floor(elapsed / BEAT_MS);
      drawBanner(s.ctx, `${count}…`);
    }
    if (now >= endAt) {
      const tally = (['perfect', 'good', 'early', 'late', 'miss'] as TapGrade[])
        .map((g) => [g, grades.filter((gg) => gg === g).length] as const)
        .filter(([, n]) => n > 0)
        .map(([g, n]) => `${n} ${g}`)
        .join(', ');
      s.finish(paddleQuality(powers.map((p) => p ?? MISSED_BEAT_POWER)), `Eight beats: ${tally}.`);
      return;
    }
    s.setRaf(requestAnimationFrame(frame));
  };
  s.setRaf(requestAnimationFrame(frame));
}

function drawBeatLane(ctx: CanvasRenderingContext2D, elapsed: number, powers: Array<number | undefined>, beat: number): void {
  // The lane the beats travel along.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(HIT_X, LANE_Y);
  ctx.lineTo(CANVAS_W, LANE_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  // The hit ring pulses on every beat.
  const sinceBeat = elapsed - beat * BEAT_MS;
  const pulse = Math.max(0, 1 - sinceBeat / 160);
  ctx.strokeStyle = `rgba(255, 224, 138, ${0.55 + pulse * 0.45})`;
  ctx.lineWidth = 3 + pulse * 3;
  ctx.beginPath();
  ctx.arc(HIT_X, LANE_Y, 18 + pulse * 6, 0, Math.PI * 2);
  ctx.stroke();
  // The beats themselves: gold rolling in, greyed once answered.
  for (let i = 0; i < DRILL_TAPS; i += 1) {
    const nx = HIT_X + (beatTime(i) - elapsed) * NOTE_SPEED;
    if (nx < -20 || nx > CANVAS_W + 20) continue;
    const answered = powers[i] !== undefined;
    ctx.fillStyle = answered ? 'rgba(255, 255, 255, 0.2)' : '#ffe08a';
    ctx.beginPath();
    ctx.arc(nx, LANE_Y, answered ? 7 : 11, 0, Math.PI * 2);
    ctx.fill();
    if (!answered) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), nx, LANE_Y + 4);
      ctx.textAlign = 'left';
    }
  }
}

// --- Stamina: a pacing game down the course ---
const SWIM_X = 200;
const GAUGE_X = CANVAS_W - 42;

function runStamina(s: DrillScaffold, duck: Duck): void {
  const start = performance.now();
  let holding = false;
  let fatigue = 0;
  let stalledUntil = 0;
  let stalls = 0;
  let distance = 0;
  let lastFrame = start;
  const pops: Pop[] = [];
  let lastLength = 0;
  s.counter.textContent = '0.0 lengths';
  s.canvas.addEventListener('pointerdown', () => {
    holding = true;
  });
  s.onPointerUp(() => {
    holding = false;
  });
  s.onKeys(
    (e) => {
      if (matchesKey(e, 'paddle')) {
        e.preventDefault();
        holding = true;
      }
    },
    (e) => {
      if (matchesKey(e, 'paddle')) holding = false;
    },
  );
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const elapsed = now - start;
    const live = elapsed > 900;
    const stalled = now < stalledUntil;
    const paddling = holding && !stalled && live;
    if (paddling) {
      fatigue = Math.min(1, fatigue + FATIGUE_RATE * dt);
      if (fatigue >= 1) {
        stalledUntil = now + STALL_MS;
        stalls += 1;
        play('miss');
        pops.push({ text: 'Puffed out!', color: '#ff7a6a', at: now, x: SWIM_X, y: CANVAS_H / 2 - 30 });
      }
    } else {
      fatigue = Math.max(0, fatigue - RECOVER_RATE * dt);
    }
    const speed = stalled ? 0 : paddling ? HOLD_SPEED * paceFactor(fatigue) : IDLE_SPEED;
    if (live) distance += speed * dt;
    const lengths = distance / LENGTH_PX;
    if (Math.floor(lengths) > lastLength) {
      lastLength = Math.floor(lengths);
      play('hit');
      pops.push({ text: `${lastLength} length${lastLength === 1 ? '' : 's'}`, color: '#9fe58a', at: now, x: SWIM_X, y: CANVAS_H / 2 - 30 });
    }
    s.counter.textContent = `${lengths.toFixed(1)} lengths${stalled ? ' · puffed out!' : ''}`;
    drawWater(s.ctx, now);
    drawCourse(s.ctx, distance);
    drawSwimmer(s.ctx, { ...duck, activity: paddling ? 'swim' : 'idle' }, SWIM_X, now, stalled);
    drawPuffGauge(s.ctx, fatigue, stalled, paddling);
    drawPops(s.ctx, pops, now);
    drawClock(s.ctx, Math.max(0, Math.ceil((STAMINA_TIME_MS - elapsed) / 1000)));
    if (!live) drawBanner(s.ctx, 'Pace yourself…');
    if (elapsed >= STAMINA_TIME_MS) {
      const stallNote = stalls === 0 ? 'never puffed out' : `puffed out ${stalls === 1 ? 'once' : `${stalls} times`}`;
      s.finish(staminaQuality(lengths), `${lengths.toFixed(1)} of ${STAMINA_TARGET_LENGTHS} lengths in twelve seconds, ${stallNote}.`);
      return;
    }
    s.setRaf(requestAnimationFrame(frame));
  };
  s.setRaf(requestAnimationFrame(frame));
}

// Buoy gates every length, a checkered flag at the target; the course
// scrolls past a duck that stays put on screen.
function drawCourse(ctx: CanvasRenderingContext2D, distance: number): void {
  const total = Math.ceil(STAMINA_TARGET_LENGTHS) + 3;
  for (let k = 1; k <= total; k += 1) {
    const sx = SWIM_X + k * LENGTH_PX - distance;
    if (sx < -30 || sx > CANVAS_W + 30) continue;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(sx, 30);
    ctx.lineTo(sx, CANVAS_H - 20);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const by of [40, CANVAS_H - 30]) {
      ctx.fillStyle = '#e8b83a';
      ctx.beginPath();
      ctx.arc(sx, by, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(k), sx, 22);
    ctx.textAlign = 'left';
  }
  const tx = SWIM_X + STAMINA_TARGET_LENGTHS * LENGTH_PX - distance;
  if (tx > -30 && tx < CANVAS_W + 30) {
    // The target: a checkered flag on a pole.
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(tx - 1, 28, 2, 60);
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#f0f0f0' : '#202830';
        ctx.fillRect(tx + 1 + c * 7, 28 + r * 7, 7, 7);
      }
    }
  }
}

function drawPuffGauge(ctx: CanvasRenderingContext2D, fatigue: number, stalled: boolean, paddling: boolean): void {
  const top = 30;
  const bottom = CANVAS_H - 24;
  const h = bottom - top;
  const w = 18;
  const x = GAUGE_X - w / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x - 3, top - 3, w + 6, h + 6);
  // Green up to the puff zone, amber above.
  const zoneY = bottom - h * PUFF_ZONE;
  ctx.fillStyle = 'rgba(127, 195, 110, 0.35)';
  ctx.fillRect(x, zoneY, w, bottom - zoneY);
  ctx.fillStyle = 'rgba(255, 180, 106, 0.35)';
  ctx.fillRect(x, top, w, zoneY - top);
  // The fill.
  const fillY = bottom - h * fatigue;
  ctx.fillStyle = stalled ? '#ff6a5a' : fatigue > PUFF_ZONE ? '#ffb46a' : '#9fe58a';
  ctx.fillRect(x, fillY, w, bottom - fillY);
  if (paddling && !stalled) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, top - 1, w + 2, h + 2);
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('puff', GAUGE_X, bottom + 16);
  ctx.textAlign = 'left';
}

// --- Poise: a balance game in the show ring ---
const PEDESTAL_X = CANVAS_W / 2;
const PEDESTAL_Y = CANVAS_H - 58;

function runPoise(s: DrillScaffold, duck: Duck): void {
  const start = performance.now();
  const b: Balance = { wobble: 0, velocity: 0, toppledUntil: 0 };
  const samples: Array<{ score: number; weight: number }> = [];
  const glances = glanceTimes(Math.random);
  const pops: Pop[] = [];
  const phase = [Math.random() * 6, Math.random() * 6];
  let nextShove = FIRST_GUST_MS + Math.random() * 600;
  let glancesSeen = 0;
  let steadyTime = 0;
  let liveTime = 0;
  let topples = 0;
  let lastFrame = start;
  let lastGlance = -1;
  const kick = (dir: -1 | 1) => {
    const now = performance.now();
    if (now - start < 900) return;
    nudge(b, dir, now);
    play('tick');
  };
  s.canvas.addEventListener('pointerdown', (e) => {
    const rect = s.canvas.getBoundingClientRect();
    kick(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
  });
  s.onKeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') {
      e.preventDefault();
      kick(-1);
    } else if (k === 'arrowright' || k === 'd') {
      e.preventDefault();
      kick(1);
    }
  });
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const elapsed = now - start;
    const live = elapsed > 900;
    const t = elapsed / 1000;
    const glancing = glances.some((g) => elapsed >= g && elapsed < g + GLANCE_MS);
    const glanceIdx = glances.findIndex((g) => elapsed >= g && elapsed < g + GLANCE_MS);
    if (glanceIdx !== lastGlance) {
      lastGlance = glanceIdx;
      if (glanceIdx >= 0) {
        glancesSeen += 1;
        play('sparkle');
      }
    }
    if (live) {
      const wasToppled = now < b.toppledUntil;
      // A breeze, and now and then a proper gust.
      const gust = Math.sin(t * 1.7 + phase[0]) * 0.6 + Math.sin(t * 3.1 + phase[1]) * 0.4;
      if (elapsed >= nextShove && !wasToppled) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        b.velocity += dir * gustStrength(elapsed, Math.random());
        pops.push({ text: dir < 0 ? '← gust' : 'gust →', color: '#c8d0d8', at: now, x: PEDESTAL_X + dir * 120, y: 70 });
        nextShove = elapsed + GUST_GAP_MIN + Math.random() * GUST_GAP_SPREAD;
      }
      stepBalance(b, dt, gust, elapsed, now);
      if (!wasToppled && now < b.toppledUntil) {
        topples += 1;
        play('miss');
        pops.push({ text: 'Flap!', color: '#ff7a6a', at: now, x: PEDESTAL_X, y: 60 });
      }
      const toppled = now < b.toppledUntil;
      const score = toppled ? 0 : poiseSample(b.wobble);
      samples.push({ score, weight: dt * (glancing ? GLANCE_WEIGHT : 1) });
      liveTime += dt;
      if (!toppled && Math.abs(b.wobble) <= MARK_HALF) steadyTime += dt;
    }
    const steadyPct = liveTime > 0 ? Math.round((steadyTime / liveTime) * 100) : 0;
    s.counter.textContent = `Steady ${steadyPct}% · judge's glances ${glancesSeen} / ${glances.length}`;
    drawRing(s.ctx, now, glancing);
    drawBalanceArc(s.ctx, b.wobble, now < b.toppledUntil);
    drawPedestalDuck(s.ctx, duck, b, now);
    drawPops(s.ctx, pops, now);
    drawClock(s.ctx, Math.max(0, Math.ceil((POISE_TIME_MS - elapsed) / 1000)));
    if (!live) drawBanner(s.ctx, 'Stand tall…');
    else if (glancing) drawTag(s.ctx, 'The judge looks…', 150, CANVAS_H / 2);
    if (elapsed >= POISE_TIME_MS) {
      const toppleNote = topples === 0 ? 'never flapped' : `flapped ${topples === 1 ? 'once' : `${topples} times`}`;
      s.finish(poiseQuality(samples), `Steady ${steadyPct}% of the time through ${glances.length} glances, ${toppleNote}.`);
      return;
    }
    s.setRaf(requestAnimationFrame(frame));
  };
  s.setRaf(requestAnimationFrame(frame));
}

// The show ring: warm boards, rope on posts, a spotlight when the judge looks.
function drawRing(ctx: CanvasRenderingContext2D, now: number, glancing: boolean): void {
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#3a2c22');
  grad.addColorStop(1, '#6b4a34');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Floorboards.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1;
  for (let y = 110; y < CANVAS_H; y += 14) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_W, y);
    ctx.stroke();
  }
  // Bunting along the top, stopping short of the clock.
  for (let i = 0; i < 16; i += 1) {
    const bx = 20 + i * 48;
    ctx.fillStyle = i % 2 === 0 ? '#e8b83a' : '#d95f4b';
    ctx.beginPath();
    ctx.moveTo(bx - 10, 8);
    ctx.lineTo(bx + 10, 8);
    ctx.lineTo(bx, 24 + Math.sin(now / 600 + i) * 1.5);
    ctx.closePath();
    ctx.fill();
  }
  // Rope on posts, either side of the pedestal.
  for (const px of [120, CANVAS_W - 120]) {
    ctx.fillStyle = '#b08b5a';
    ctx.fillRect(px - 4, 96, 8, 60);
    ctx.fillStyle = '#e8d49a';
    ctx.beginPath();
    ctx.arc(px, 94, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#d95f4b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(124, 100);
  ctx.quadraticCurveTo(PEDESTAL_X - 200, 120, PEDESTAL_X - 110, 112);
  ctx.moveTo(CANVAS_W - 124, 100);
  ctx.quadraticCurveTo(PEDESTAL_X + 200, 120, PEDESTAL_X + 110, 112);
  ctx.stroke();
  // The spotlight.
  if (glancing) {
    const cone = ctx.createRadialGradient(PEDESTAL_X, PEDESTAL_Y - 20, 10, PEDESTAL_X, PEDESTAL_Y - 20, 150);
    cone.addColorStop(0, 'rgba(255, 236, 170, 0.35)');
    cone.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = cone;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  // The pedestal.
  ctx.fillStyle = '#2a1e16';
  ctx.fillRect(PEDESTAL_X - 46, PEDESTAL_Y + 8, 92, 12);
  ctx.fillStyle = '#c9a15c';
  ctx.beginPath();
  ctx.moveTo(PEDESTAL_X - 40, PEDESTAL_Y + 8);
  ctx.lineTo(PEDESTAL_X + 40, PEDESTAL_Y + 8);
  ctx.lineTo(PEDESTAL_X + 30, PEDESTAL_Y + 44);
  ctx.lineTo(PEDESTAL_X - 30, PEDESTAL_Y + 44);
  ctx.closePath();
  ctx.fill();
}

// The balance arc above the duck: the mark in the middle, the needle where
// the wobble sits.
function drawBalanceArc(ctx: CanvasRenderingContext2D, wobble: number, toppled: boolean): void {
  const cx = PEDESTAL_X;
  const cy = 96;
  const r = 54;
  const span = Math.PI * 0.8;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2 - span / 2, -Math.PI / 2 + span / 2);
  ctx.stroke();
  ctx.strokeStyle = toppled ? 'rgba(255, 122, 106, 0.9)' : 'rgba(159, 229, 138, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2 - (span / 2) * MARK_HALF, -Math.PI / 2 + (span / 2) * MARK_HALF);
  ctx.stroke();
  ctx.lineCap = 'butt';
  const a = -Math.PI / 2 + (span / 2) * Math.max(-1, Math.min(1, wobble));
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
  ctx.lineTo(cx + Math.cos(a) * (r + 10), cy + Math.sin(a) * (r + 10));
  ctx.stroke();
}

function drawPedestalDuck(ctx: CanvasRenderingContext2D, duck: Duck, b: Balance, now: number): void {
  const toppled = now < b.toppledUntil;
  ctx.save();
  ctx.translate(PEDESTAL_X, PEDESTAL_Y);
  const tilt = toppled ? Math.sin(now / 40) * 0.35 : b.wobble * 0.55;
  ctx.rotate(tilt);
  const posed: Duck = { ...duck, activity: toppled ? 'flap' : 'idle' };
  drawDuck(ctx, posed, { inWater: false, selected: false, anim: computeAnim(posed, now), facingLeft: false });
  ctx.restore();
}

// --- Shared drawing ---
// The drills' water: shimmer kept below the beat lane and the clock.
function drawWater(ctx: CanvasRenderingContext2D, now: number): void {
  drawSharedWater(ctx, CANVAS_W, CANVAS_H, now, { count: 12, xStride: 83, yTop: 70, yStride: 41 });
}

function drawSwimmer(ctx: CanvasRenderingContext2D, duck: Duck, x: number, now: number, stalled = false): void {
  ctx.save();
  ctx.translate(x, CANVAS_H / 2 + 30);
  drawDuck(ctx, duck, { inWater: true, selected: false, anim: computeAnim(duck, now), facingLeft: false });
  ctx.restore();
  if (stalled) {
    // Bubbles: the duck getting its breath back.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 3; i += 1) {
      const by = CANVAS_H / 2 + 10 - ((now / 6 + i * 40) % 60);
      ctx.beginPath();
      ctx.arc(x + 18 + i * 6, by, 2 + i, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawClock(ctx: CanvasRenderingContext2D, secondsLeft: number): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${secondsLeft}s`, CANVAS_W - 14, 22);
  ctx.textAlign = 'left';
}

// A small gold tag off to one side, for a cue that mustn't hide the duck.
function drawTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = 'bold 16px sans-serif';
  const w = ctx.measureText(text).width + 24;
  ctx.fillStyle = 'rgba(80, 60, 10, 0.8)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 16, w, 32, 16);
  ctx.fill();
  ctx.fillStyle = '#ffe08a';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y + 6);
  ctx.textAlign = 'left';
}

function drawBanner(ctx: CanvasRenderingContext2D, text: string): void {
  drawSharedBanner(ctx, CANVAS_W, CANVAS_H, text);
}
