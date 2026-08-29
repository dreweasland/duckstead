// Training drills: short solo minigames that build a duck's trained stats.
// Three drills, one per stat, on the derby's overlay scaffold:
//   paddle  — eight paddles on the beat; the average timing is the score
//   stamina — hold to paddle, rest before the fatigue bar fills; distance
//   poise   — five rounds of stop-the-needle in a shrinking zone
// Each returns a 0..1 quality that sim/training turns into points.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { boostPower } from '../sim/race';
import { canDrill, drillsLeft, train, TRAIN_STAT_META, type TrainStat } from '../sim/training';
import { computeAnim } from '../render/animation';
import { drawDuck } from '../render/duckPainter';
import { el, statTile } from './dom';
import { backToPondRow, eventCard } from './eventCard';
import type { IconName } from './icons';
import { play } from '../audio/audio';
import { keyFor, keyLabel, matchesKey } from './settings';

const CANVAS_W = 860;
const CANVAS_H = 200;
const METER_PERIOD_MS = 210;
const TAP_COOLDOWN_MS = 350;
export const DRILL_TAPS = 8;
const DRILL_TIME_MS = 12_000;
// Stamina: hold to paddle; fatigue fills in ~2s of holding, empties in ~2.5s.
const STAMINA_TIME_MS = 12_000;
const HOLD_SPEED = 95; // px/s while paddling
const IDLE_SPEED = 12;
const FATIGUE_RATE = 0.5; // per second held
const RECOVER_RATE = 0.4;
const STALL_MS = 1500;
export const STAMINA_TARGET = 620; // px — what a well-paced 12s covers
// Poise: five rounds; the needle sweeps slower and the target shrinks.
export const POISE_ROUNDS = 5;
const POISE_PERIOD_MS = 480;

export const DRILL_META: Record<TrainStat, { label: string; icon: IconName; hint: string }> = {
  paddle: { label: 'Paddle drill', icon: 'flag', hint: 'Eight paddles on the beat — sprint power.' },
  stamina: { label: 'Long haul', icon: 'bubbles', hint: 'Hold to paddle, rest before you tire — distance in twelve seconds.' },
  poise: { label: 'Show stance', icon: 'star', hint: 'Stop the needle in the mark, five times — show-ring presence.' },
};

interface UiHooks {
  toast(msg: string): void;
  refresh(): void;
}

// Oscillating meter position in [0, 1]; the sweet spot is 0.5.
function meterValue(elapsedMs: number, period = METER_PERIOD_MS): number {
  return 0.5 + 0.5 * Math.sin(elapsedMs / period);
}

// Average paddle quality over a drill: untaken paddles count as fumbles.
export function drillQuality(powers: number[]): number {
  let sum = 0;
  for (let i = 0; i < DRILL_TAPS; i += 1) sum += powers[i] ?? 0.1;
  return sum / DRILL_TAPS;
}

// Poise: each round's zone is narrower; closeness is judged against it.
export function poiseRoundScore(meterVal: number, round: number): number {
  const halfWidth = 0.22 - round * 0.03; // 0.22 → 0.10
  const closeness = Math.max(0, 1 - Math.abs(meterVal - 0.5) / halfWidth);
  return closeness * closeness;
}

export function staminaQuality(distance: number): number {
  return Math.min(1, distance / STAMINA_TARGET);
}

interface DrillScaffold {
  card: HTMLElement;
  close: () => void;
  header: (ic: IconName, title: string) => HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  meter: HTMLElement;
  meterFill: HTMLElement;
  counter: HTMLElement;
  finish: (quality: number) => void;
  setKeyHandler: (h: ((e: KeyboardEvent) => void) | null) => void;
  setRaf: (id: number) => void;
}

export function openDrill(game: Game, ui: UiHooks, duck: Duck, stat: TrainStat): void {
  const gate = canDrill(game.state, duck);
  if (!gate.ok) {
    ui.toast(gate.reason ?? 'Can\'t train right now');
    return;
  }
  let raf = 0;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let keyUpHandler: ((e: KeyboardEvent) => void) | null = null;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    if (keyUpHandler) window.removeEventListener('keyup', keyUpHandler);
    keyHandler = null;
    keyUpHandler = null;
  };
  const ev = eventCard(document.getElementById('ui-root')!, 'drill', 'drill-card', cleanup);
  if (!ev) return;
  const { card, close, header } = ev;
  const title = `${DRILL_META[stat].label} — ${duck.name}`;

  const canvas = el('canvas', { class: 'race-canvas drill-canvas' }) as HTMLCanvasElement;
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const meterFill = el('div', { class: 'race-meter-marker' });
  const meter = el('div', { class: 'race-meter' }, meterFill);
  const counter = el('div', { class: 'drill-counter' }, '');
  const hint = el('div', { class: 'muted small race-hint' }, drillHint(stat));
  card.replaceChildren(header(DRILL_META[stat].icon, title), canvas, meter, counter, hint);

  let done = false;
  const finish = (quality: number) => {
    if (done) return;
    done = true;
    cleanup();
    const gain = train(game.state, duck.id, stat, quality);
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
      el('div', { class: 'muted small' }, TRAIN_STAT_META[stat].blurb),
      backToPondRow(close),
    );
    ui.refresh();
    if (gain > 0) ui.toast(`${duck.name} gained +${gain} ${TRAIN_STAT_META[stat].label.toLowerCase()}`);
  };

  const scaffold: DrillScaffold = {
    card,
    close,
    header,
    canvas,
    ctx: canvas.getContext('2d')!,
    meter,
    meterFill,
    counter,
    finish,
    setKeyHandler: (h) => {
      keyHandler = h;
      if (h) window.addEventListener('keydown', h);
    },
    setRaf: (id) => {
      raf = id;
    },
  };
  const racer: Duck = { ...duck, activity: 'swim' };
  if (stat === 'paddle') runPaddle(scaffold, racer);
  else if (stat === 'stamina') {
    runStamina(scaffold, racer, (h) => {
      keyUpHandler = h;
      window.addEventListener('keyup', h);
    });
  } else runPoise(scaffold, racer);
}

const DRILL_HINTS: Record<TrainStat, string> = {
  paddle: 'Click the water (or press KEY) on the beat — eight clean paddles make a perfect drill.',
  stamina: 'Hold the water (or KEY) to paddle. Let go before the fatigue bar fills, or the duck stalls.',
  poise: 'Click (or press KEY) when the needle sits in the mark. Five rounds; the mark shrinks each time.',
};

function drillHint(stat: TrainStat): string {
  return DRILL_HINTS[stat].replace('KEY', keyLabel(keyFor('paddle')));
}

// --- Paddle: tap on the beat ---
function runPaddle(s: DrillScaffold, racer: Duck): void {
  const start = performance.now();
  const powers: number[] = [];
  let lastTap = -Infinity;
  let x = 60;
  let boost = 0;
  let lastFrame = start;
  s.counter.textContent = `0 / ${DRILL_TAPS} paddles`;
  const tap = () => {
    const now = performance.now();
    if (now - lastTap < TAP_COOLDOWN_MS) return;
    lastTap = now;
    const power = boostPower(meterValue(now - start));
    powers.push(power);
    boost += 60 * power;
    flash(s.meter, power > 0.7);
    s.counter.textContent = `${powers.length} / ${DRILL_TAPS} paddles`;
    if (powers.length >= DRILL_TAPS) s.finish(drillQuality(powers));
  };
  s.canvas.addEventListener('pointerdown', tap);
  s.setKeyHandler((e) => {
    if (matchesKey(e, 'paddle')) {
      e.preventDefault();
      tap();
    }
  });
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const elapsed = now - start;
    boost *= Math.pow(0.2, dt);
    x += (30 + boost) * dt;
    if (x > CANVAS_W - 80) x = 60;
    s.meterFill.style.left = `${meterValue(elapsed) * 100}%`;
    drawWater(s.ctx, now);
    drawRacer(s.ctx, racer, x, now);
    drawClock(s.ctx, Math.max(0, Math.ceil((DRILL_TIME_MS - elapsed) / 1000)));
    if (elapsed < 900) drawBanner(s.ctx, 'On the beat…');
    if (elapsed >= DRILL_TIME_MS) {
      s.finish(drillQuality(powers));
      return;
    }
    s.setRaf(requestAnimationFrame(frame));
  };
  s.setRaf(requestAnimationFrame(frame));
}

// --- Stamina: hold to paddle, rest to recover ---
function runStamina(s: DrillScaffold, racer: Duck, onKeyUp: (h: (e: KeyboardEvent) => void) => void): void {
  const start = performance.now();
  let holding = false;
  let fatigue = 0;
  let stalledUntil = 0;
  let distance = 0;
  let x = 60;
  let lastFrame = start;
  s.meter.classList.add('fatigue');
  s.counter.textContent = '0 px';
  const down = () => {
    holding = true;
  };
  const up = () => {
    holding = false;
  };
  s.canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointerup', up);
  s.setKeyHandler((e) => {
    if (matchesKey(e, 'paddle')) {
      e.preventDefault();
      holding = true;
    }
  });
  onKeyUp((e) => {
    if (matchesKey(e, 'paddle')) holding = false;
  });
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const elapsed = now - start;
    const stalled = now < stalledUntil;
    const paddling = holding && !stalled && elapsed > 900;
    if (paddling) {
      fatigue = Math.min(1, fatigue + FATIGUE_RATE * dt);
      if (fatigue >= 1) {
        stalledUntil = now + STALL_MS;
        flash(s.meter, false);
      }
    } else {
      fatigue = Math.max(0, fatigue - RECOVER_RATE * dt);
    }
    const speed = stalled ? 0 : paddling ? HOLD_SPEED : IDLE_SPEED;
    if (elapsed > 900) distance += speed * dt;
    x += speed * dt;
    if (x > CANVAS_W - 80) x = 60;
    s.meterFill.style.left = `${fatigue * 100}%`;
    s.counter.textContent = `${Math.round(distance)} px${stalled ? ' — stalled!' : ''}`;
    drawWater(s.ctx, now);
    drawRacer(s.ctx, racer, x, now, stalled);
    drawClock(s.ctx, Math.max(0, Math.ceil((STAMINA_TIME_MS - elapsed) / 1000)));
    if (elapsed < 900) drawBanner(s.ctx, 'Pace yourself…');
    if (elapsed >= STAMINA_TIME_MS) {
      window.removeEventListener('pointerup', up);
      s.finish(staminaQuality(distance));
      return;
    }
    s.setRaf(requestAnimationFrame(frame));
  };
  s.setRaf(requestAnimationFrame(frame));
}

// --- Poise: stop the needle ---
function runPoise(s: DrillScaffold, racer: Duck): void {
  const start = performance.now();
  const scores: number[] = [];
  let roundStart = start;
  let frozenUntil = 0;
  let frozenVal = 0.5;
  s.meter.classList.add('poise');
  s.counter.textContent = `Round 1 / ${POISE_ROUNDS}`;
  const tap = () => {
    const now = performance.now();
    if (now < frozenUntil || now - start < 900) return;
    const val = meterValue(now - roundStart, POISE_PERIOD_MS);
    const score = poiseRoundScore(val, scores.length);
    scores.push(score);
    frozenVal = val;
    frozenUntil = now + 700;
    flash(s.meter, score > 0.6);
    if (scores.length >= POISE_ROUNDS) {
      setTimeout(() => s.finish(scores.reduce((a, b) => a + b, 0) / POISE_ROUNDS), 700);
    } else {
      s.counter.textContent = `Round ${scores.length + 1} / ${POISE_ROUNDS}`;
      setTimeout(() => {
        roundStart = performance.now();
      }, 700);
    }
  };
  s.canvas.addEventListener('pointerdown', tap);
  s.setKeyHandler((e) => {
    if (matchesKey(e, 'paddle')) {
      e.preventDefault();
      tap();
    }
  });
  const frame = (now: number) => {
    const elapsed = now - start;
    const val = now < frozenUntil ? frozenVal : meterValue(now - roundStart, POISE_PERIOD_MS);
    s.meterFill.style.left = `${val * 100}%`;
    const halfWidth = 0.22 - Math.min(scores.length, POISE_ROUNDS - 1) * 0.03;
    s.meter.style.setProperty('--zone', `${halfWidth * 100}%`);
    drawWater(s.ctx, now);
    drawRacer(s.ctx, { ...racer, activity: 'idle' }, CANVAS_W / 2, now);
    if (elapsed < 900) drawBanner(s.ctx, 'Stand tall…');
    if (scores.length >= POISE_ROUNDS && now >= frozenUntil) return;
    s.setRaf(requestAnimationFrame(frame));
  };
  s.setRaf(requestAnimationFrame(frame));
}

// --- Shared drawing ---
function flash(meter: HTMLElement, good: boolean): void {
  play(good ? 'hit' : 'miss');
  meter.classList.remove('hit-good', 'hit-weak');
  void meter.offsetWidth; // restart the flash animation
  meter.classList.add(good ? 'hit-good' : 'hit-weak');
}

function drawWater(ctx: CanvasRenderingContext2D, now: number): void {
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#4a90c2');
  grad.addColorStop(1, '#2c6899');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i += 1) {
    const sx = ((i * 83 + now / 25) % (CANVAS_W + 40)) - 20;
    const sy = (i * 41) % CANVAS_H;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy);
    ctx.lineTo(sx + 8, sy);
    ctx.stroke();
  }
  // Practice buoys drift past to sell the motion.
  ctx.fillStyle = '#e8b83a';
  for (let i = 0; i < 4; i += 1) {
    const bx = ((i * 230 - now / 12) % (CANVAS_W + 40) + CANVAS_W + 40) % (CANVAS_W + 40) - 20;
    ctx.beginPath();
    ctx.arc(bx, CANVAS_H * 0.3 + Math.sin(now / 500 + i) * 3, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRacer(ctx: CanvasRenderingContext2D, duck: Duck, x: number, now: number, stalled = false): void {
  ctx.save();
  ctx.translate(x, CANVAS_H / 2 + 20);
  drawDuck(ctx, duck, { inWater: true, selected: false, anim: computeAnim(duck, now), facingLeft: false });
  ctx.restore();
  if (stalled) {
    ctx.fillStyle = '#ffe08a';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('puffed out!', x - 24, CANVAS_H / 2 - 24);
  }
}

function drawClock(ctx: CanvasRenderingContext2D, secondsLeft: number): void {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${secondsLeft}s`, CANVAS_W - 14, 22);
  ctx.textAlign = 'left';
}

function drawBanner(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.fillStyle = 'rgba(16, 22, 30, 0.65)';
  ctx.fillRect(0, CANVAS_H / 2 - 26, CANVAS_W, 52);
  ctx.fillStyle = '#ffe08a';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2 + 9);
  ctx.textAlign = 'left';
}
