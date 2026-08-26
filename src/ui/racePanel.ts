// Pond Derby: a click-timing race minigame. The player's real duck races
// three wild ducks; base speed comes from its genetics (vigor, size) and
// temperament (energy), and well-timed paddle boosts do the rest.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { createDuck, freshName } from '../sim/duck';
import { personality } from '../sim/behavior';
import { BALANCE, upgradeLevel } from '../sim/economy';
import { chronicle } from '../sim/chronicle';
import { addSocietyPoints } from '../sim/society';
import { currentTier, leagueStanding, recordLeagueResult } from '../sim/league';
import { randomCommonGenome } from '../sim/genetics';
import { createRng } from '../rng';
import { clamp } from '../types';
import { dayOf } from '../sim/time';
import { computeAnim } from '../render/animation';
import { drawDuck } from '../render/duckPainter';
import { el, statBar } from './dom';
import { icon } from './icons';
import { duckPortrait } from './portrait';

const TRACK_LEN = 700;
const LANES = 4;
const CANVAS_W = 860;
const CANVAS_H = 300;
const BOOST_COOLDOWN_MS = 550;
// Player paddle: full power only near the meter's sweet spot; mashing with
// sloppy timing pays a fraction. Squared so precision matters.
const PLAYER_BOOST = 55;
// Wild racers paddle like a competent player: ~1.6 hits/s at decent timing,
// each with their own knack (skill) so the field has a favourite and a dud.
const AI_HITS_PER_SEC = 1.6;
const AI_BOOST_MIN = 30;
const AI_BOOST_VAR = 18;
const METER_PERIOD_MS = 210;

const WILD_NAMES = ['Torrent', 'Squall', 'Cypress', 'Marigold', 'Nimbus', 'Bramble', 'Zephyr', 'Puddlejumper'];

interface Racer {
  duck: Duck;
  x: number;
  baseSpeed: number; // px per second
  boost: number;
  phase: number;
  finishedAt: number | null;
  isPlayer: boolean;
  skill: number; // AI only: paddle-rate multiplier
}

interface UiHooks {
  toast(msg: string): void;
}

export interface RaceOpts {
  league?: boolean; // the daily league race: tier decides fee/purse/field
  title?: string;
  entryFee?: number;
  prizes?: readonly number[];
  aiBoost?: number; // multiplier on wild racers' base speed
  onFinish?(place: number): void;
  racer?: Duck; // preselected racer: skip the picker (tournament rounds)
  // Tournament chaining: given the finishing place, return the next round's
  // options (or null when the run ends here). Replaces "Race again".
  nextRace?(place: number): RaceOpts | null;
  // Festival tournaments run outside the one-race-per-duck-per-day limit.
  ignoreDailyLimit?: boolean;
}

// Paddle power for a meter position in [0, 1]; sweet spot is 0.5.
export function boostPower(meterVal: number): number {
  const closeness = Math.max(0, 1 - Math.abs(meterVal - 0.5) * 2);
  return Math.max(0.1, closeness * closeness);
}

// Each duck races the daily derby once: racing is tiring, and it keeps the
// derby a payoff for a well-bred flock rather than a coin tap.
export function racedToday(duck: Duck, day: number): boolean {
  return duck.lastRaceDay === day;
}

// Base speed from the duck itself: vigorous, energetic, trim ducks are fast.
export function raceSpeed(duck: Duck): number {
  const p = personality(duck);
  const vigorScale = 0.85 + duck.phenotype.vigor * 0.3;
  const energyScale = 1 + (p.energy - 1) * 0.5;
  const sizePenalty = 1.06 - Math.abs(duck.phenotype.sizeScale - 0.95) * 0.25;
  return 52 * vigorScale * energyScale * sizePenalty;
}

export function raceEligible(game: Game): Duck[] {
  return game.state.ducks.filter(
    (d) => (d.stage === 'adult' || d.stage === 'juvenile') && !d.sick && d.needs.health > 40,
  );
}

export function raceRested(game: Game, duck: Duck): boolean {
  return !racedToday(duck, dayOf(game.state.clock));
}

export function openRacePanel(game: Game, ui: UiHooks, opts: RaceOpts = {}): void {
  if (document.querySelector('.race-overlay')) return;
  const tierDef = opts.league ? currentTier(game.state) : null;
  const title = opts.title ?? tierDef?.name ?? 'Pond Derby';
  const entryFee = opts.entryFee ?? tierDef?.entryFee ?? BALANCE.raceEntryFee;
  const prizes = opts.prizes ?? tierDef?.prizes ?? BALANCE.racePrizes;
  const aiBoost = opts.aiBoost ?? tierDef?.aiBoost ?? 1;
  const overlay = el('div', { class: 'race-overlay' });
  const card = el('div', { class: 'race-card theme-derby' });
  overlay.append(card);
  document.getElementById('ui-root')!.append(overlay);

  let raf = 0;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  const close = () => {
    cancelAnimationFrame(raf);
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    overlay.remove();
  };

  const showPicker = () => {
    card.classList.remove('win');
    const eligible = raceEligible(game);
    const fee = entryFee;
    card.replaceChildren(
      el(
        'div',
        { class: 'race-header' },
        el('strong', { class: 'with-icon' }, icon('flag', 16), title),
        el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
      ),
    );
    // The stakes at a glance, dawn-card style.
    const tile = (ic: Parameters<typeof icon>[0], value: string, label: string) =>
      el('div', { class: 'race-tile' }, icon(ic, 13), el('strong', {}, value), el('span', { class: 'race-tile-label' }, label));
    card.append(
      el(
        'div',
        { class: 'race-stats' },
        tile('coin', String(fee), 'entry'),
        tile('star', String(prizes[0]), '1st prize'),
        tile('starOutline', String(prizes[1] ?? 0), '2nd prize'),
        tile('duck', String(eligible.length), eligible.length === 1 ? 'racer ready' : 'racers ready'),
      ),
      el(
        'div',
        { class: 'muted small race-blurb' },
        'Speed comes from vigor, energy, and a trim build.',
        opts.ignoreDailyLimit ? '' : ' Each duck races once a day.',
      ),
    );
    if (tierDef) {
      card.append(el('div', { class: 'small league-standing with-icon' }, icon('flag', 11), ` ${leagueStanding(game.state)}${tierDef.rule ? ` · ${tierDef.rule}` : ''}`));
    }
    if (eligible.length === 0) {
      card.append(el('div', { class: 'section muted' }, 'No eligible racers — ducks must be juvenile or older, healthy, and not sick.'));
      return;
    }
    if (game.state.money < fee) {
      card.append(el('div', { class: 'section warn-text' }, 'Not enough coins for the entry fee.'));
    }
    // Fastest first, each with a speed bar relative to the best on the pond —
    // the field reads like a form guide instead of lines of text.
    const field = [...eligible].sort((a, b) => raceSpeed(b) - raceSpeed(a));
    const maxSpeed = raceSpeed(field[0]);
    const grid = el('div', { class: 'race-picker' });
    field.forEach((duck, i) => {
      const rested = opts.ignoreDailyLimit || raceRested(game, duck);
      const allowed = !tierDef?.eligible || tierDef.eligible(duck);
      const spd = raceSpeed(duck);
      const favourite = i === 0 && field.length > 1 && allowed && rested;
      const bar = statBar((spd / maxSpeed) * 100, favourite ? '#e8b83a' : '#69b356', true);
      bar.classList.add('race-speed-bar');
      const status = !allowed ? 'not eligible' : !rested ? 'raced today' : favourite ? 'the favourite' : '\u00a0';
      grid.append(
        el(
          'button',
          {
            class: `race-pick${favourite ? ' favourite' : ''}`,
            disabled: game.state.money < fee || !rested || !allowed,
            title: !allowed ? `${duck.name} doesn't meet the ${tierDef!.name} rule` : rested ? '' : `${duck.name} already raced today`,
            onclick: () => {
              game.state.money -= fee;
              startRace(duck);
            },
          },
          duckPortrait(duck, 52),
          el('span', { class: 'race-pick-name' }, duck.name),
          el('span', { class: 'race-speed-row' }, bar, el('span', { class: 'race-speed-num' }, String(Math.round(spd)))),
          el('span', { class: `muted small race-pick-status${status === 'the favourite' ? ' fav' : ''}` }, status),
        ),
      );
    });
    card.append(grid);
  };

  const startRace = (playerDuck: Duck) => {
    const rng = createRng((Date.now() ^ 0x5eed) >>> 0);
    if (!opts.ignoreDailyLimit) {
      const live = game.state.ducks.find((d) => d.id === playerDuck.id);
      if (live) live.lastRaceDay = dayOf(game.state.clock);
    }
    const taken = [playerDuck.name];
    const racers: Racer[] = [
      makeRacer(playerDuck, true),
    ];
    racers[0].baseSpeed *= 1 + upgradeLevel(game.state, 'trainingPerch') * 0.04;
    for (let i = 0; i < LANES - 1; i += 1) {
      const wild = createDuck(rng, {
        genome: randomCommonGenome(rng),
        stage: 'adult',
        pos: { x: 0, y: 0 },
      });
      wild.name = freshName(rng, taken, WILD_NAMES);
      taken.push(wild.name);
      wild.activity = 'swim';
      const racer = makeRacer(wild, false);
      racer.baseSpeed *= aiBoost;
      racer.skill = rng.range(0.8, 1.2);
      racers.push(racer);
    }
    // Shuffle lanes so the player isn't always lane 1.
    for (let i = racers.length - 1; i > 0; i -= 1) {
      const j = rng.int(i + 1);
      [racers[i], racers[j]] = [racers[j], racers[i]];
    }

    const canvas = el('canvas', { class: 'race-canvas' }) as HTMLCanvasElement;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const meterFill = el('div', { class: 'race-meter-marker' });
    const meter = el('div', { class: 'race-meter' }, meterFill);
    const hint = el('div', { class: 'muted small race-hint' }, 'Click the water (or press Space) when the marker is centered to paddle!');
    card.replaceChildren(
      el(
        'div',
        { class: 'race-header' },
        el('strong', { class: 'with-icon' }, icon('flag', 16), title),
        el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
      ),
      canvas,
      meter,
      hint,
    );

    const ctx = canvas.getContext('2d')!;
    const start = performance.now();
    let lastBoost = -Infinity;
    let lastFrame = start;
    let finishCount = 0;
    let doneAt: number | null = null;

    const tryBoost = () => {
      const now = performance.now();
      if (now - lastBoost < BOOST_COOLDOWN_MS) return;
      const player = racers.find((r) => r.isPlayer)!;
      if (player.finishedAt !== null) return;
      lastBoost = now;
      const meterVal = meterValue(now - start);
      const power = boostPower(meterVal);
      player.boost += PLAYER_BOOST * power;
      meter.classList.remove('hit-good', 'hit-weak');
      void meter.offsetWidth; // restart the flash animation
      meter.classList.add(power > 0.7 ? 'hit-good' : 'hit-weak');
    };
    canvas.addEventListener('pointerdown', tryBoost);
    keyHandler = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        tryBoost();
      }
    };
    window.addEventListener('keydown', keyHandler);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const elapsed = (now - start) / 1000;

      for (const racer of racers) {
        if (racer.finishedAt !== null) continue;
        if (elapsed < 1) continue; // "Ready…" moment before the start
        const wobble = 1 + Math.sin(now / 400 + racer.phase) * 0.12;
        let v = racer.baseSpeed * wobble + racer.boost;
        if (!racer.isPlayer && Math.random() < dt * AI_HITS_PER_SEC * racer.skill) {
          racer.boost += AI_BOOST_MIN + Math.random() * AI_BOOST_VAR;
        }
        racer.boost *= Math.pow(0.15, dt);
        racer.x += v * dt;
        if (racer.x >= TRACK_LEN) {
          racer.x = TRACK_LEN;
          finishCount += 1;
          racer.finishedAt = finishCount;
        }
      }

      meterFill.style.left = `${meterValue(now - start) * 100}%`;
      drawRace(ctx, racers, elapsed, now);

      const player = racers.find((r) => r.isPlayer)!;
      if (doneAt === null && (finishCount === racers.length || (player.finishedAt !== null && elapsed > 3))) {
        if (finishCount === racers.length || player.finishedAt !== null) {
          // Give trailing AI a beat to finish for a complete scoreboard.
          doneAt = now + 1200;
        }
      }
      if (doneAt !== null && now >= doneAt) {
        finishRace(racers);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  };

  const finishRace = (racers: Racer[]) => {
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    keyHandler = null;
    // Rank: finished order first, then by distance.
    const ranked = [...racers].sort((a, b) => {
      if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return b.x - a.x;
    });
    const playerPlace = ranked.findIndex((r) => r.isPlayer);
    const prize = prizes[playerPlace] ?? 0;
    game.state.money += prize;
    if (opts.league) {
      const notice = recordLeagueResult(game.state, playerPlace);
      if (notice) ui.toast(notice);
    }
    if (playerPlace === 0) {
      game.state.stats.racesWon += 1;
      if (opts.title && !opts.title.includes('Derby —') && opts.title !== 'Pond Derby' && !opts.title.includes('Heat')) {
        addSocietyPoints(game.state, 6);
        chronicle(game.state, 'race', `${racers.find((r) => r.isPlayer)!.duck.name} won the ${opts.title}.`);
      } else if (game.state.stats.racesWon === 1 || game.state.stats.racesWon % 10 === 0) {
        chronicle(game.state, 'race', `${racers.find((r) => r.isPlayer)!.duck.name} took the pond's ${game.state.stats.racesWon === 1 ? 'first' : `${game.state.stats.racesWon}th`} derby win.`);
      }
    }
    opts.onFinish?.(playerPlace);
    const playerDuck = game.state.ducks.find((d) => d.id === racers.find((r) => r.isPlayer)!.duck.id);
    if (playerDuck) {
      playerDuck.needs.happiness = clamp(playerDuck.needs.happiness + BALANCE.raceHappiness, 0, 100);
      playerDuck.needs.hunger = clamp(playerDuck.needs.hunger - BALANCE.raceHunger, 0, 100);
    }

    const list = el('div', { class: 'race-results' });
    ranked.forEach((racer, i) => {
      list.append(
        el(
          'div',
          { class: `race-result-row${racer.isPlayer ? ' mine' : ''}` },
          el('span', { class: `race-place p${i + 1}` }, `${i + 1}`),
          duckPortrait(racer.duck, 36),
          el('span', { class: 'race-result-name' }, racer.duck.name + (racer.isPlayer ? ' (you)' : '')),
          racer.isPlayer && (prizes[i] ?? 0) > 0
            ? el('span', { class: 'goal-reward with-icon' }, icon('coin', 11), `${prizes[i]}`)
            : null,
        ),
      );
    });
    const next = opts.nextRace ? opts.nextRace(playerPlace) : undefined;
    const actionRow = el('div', { class: 'actions race-actions' });
    if (next) {
      const advanceDuck = playerDuck ?? racers.find((r) => r.isPlayer)!.duck;
      actionRow.append(
        el(
          'button',
          {
            class: 'action-btn primary',
            onclick: () => {
              close();
              openRacePanel(game, ui, { ...next, racer: advanceDuck });
            },
          },
          `On to the ${next.title ?? 'next race'}!`,
        ),
      );
    } else if (opts.league) {
      // Only the daily league race reopens the picker; a tournament final
      // ends here (its purse would otherwise be farmable for free).
      actionRow.append(el('button', { class: 'action-btn primary', onclick: showPicker }, 'Race again'));
    }
    actionRow.append(el('button', { class: 'action-btn', onclick: close }, 'Back to the pond'));

    const headline = next
      ? 'You advance!'
      : opts.nextRace && playerPlace > 1
        ? 'Eliminated…'
        : playerPlace === 0
          ? 'Victory!'
          : 'Race finished';
    // A win turns the header band gold.
    card.classList.toggle('win', playerPlace === 0 && !next);
    card.replaceChildren(
      el(
        'div',
        { class: 'race-header' },
        el('strong', { class: 'with-icon' }, icon('flag', 16), headline),
        el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
      ),
      list,
      actionRow,
    );
    if (prize > 0) ui.toast(`${playerPlace === 0 ? 'Won' : 'Placed'} — +${prize} coins!`);
  };

  if (opts.racer && game.state.money >= entryFee) {
    game.state.money -= entryFee;
    startRace(opts.racer);
  } else {
    showPicker();
  }
}

function makeRacer(duck: Duck, isPlayer: boolean): Racer {
  return {
    duck: { ...duck, activity: 'swim' },
    x: 0,
    baseSpeed: raceSpeed(duck),
    boost: 0,
    phase: Math.random() * Math.PI * 2,
    finishedAt: null,
    isPlayer,
    skill: 1,
  };
}

// Oscillating meter position in [0, 1]; the sweet spot is 0.5.
function meterValue(elapsedMs: number): number {
  return 0.5 + 0.5 * Math.sin(elapsedMs / METER_PERIOD_MS);
}

function drawRace(
  ctx: CanvasRenderingContext2D,
  racers: Racer[],
  elapsed: number,
  now: number,
): void {
  const laneH = CANVAS_H / LANES;

  // Water background.
  const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  grad.addColorStop(0, '#4a90c2');
  grad.addColorStop(1, '#2c6899');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Drifting shimmer.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 10; i += 1) {
    const x = ((i * 97 + now / 25) % (CANVAS_W + 40)) - 20;
    const y = (i * 53) % CANVAS_H;
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.stroke();
  }

  // Lane ropes.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.setLineDash([10, 8]);
  for (let i = 1; i < LANES; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, i * laneH);
    ctx.lineTo(CANVAS_W, i * laneH);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Finish line: checkered posts.
  const fx = 60 + TRACK_LEN + 30;
  for (let y = 0; y < CANVAS_H; y += 12) {
    ctx.fillStyle = (y / 12) % 2 === 0 ? '#f2ede2' : '#2a2320';
    ctx.fillRect(fx, y, 6, 12);
    ctx.fillStyle = (y / 12) % 2 === 0 ? '#2a2320' : '#f2ede2';
    ctx.fillRect(fx + 6, y, 6, 12);
  }

  // Racers.
  racers.forEach((racer, lane) => {
    const y = lane * laneH + laneH / 2 + 8;
    const x = 60 + racer.x;
    ctx.save();
    ctx.translate(x, y);
    drawDuck(ctx, racer.duck, {
      inWater: true,
      selected: false,
      anim: computeAnim(racer.duck, now),
      facingLeft: false,
    });
    ctx.restore();
    // Name tag.
    ctx.fillStyle = racer.isPlayer ? '#ffe08a' : 'rgba(255, 255, 255, 0.75)';
    ctx.font = '11px sans-serif';
    ctx.fillText(racer.duck.name, x - 20, y - 32);
  });

  // Countdown / go banner.
  if (elapsed < 1.4) {
    ctx.fillStyle = 'rgba(16, 22, 30, 0.65)';
    ctx.fillRect(0, CANVAS_H / 2 - 26, CANVAS_W, 52);
    ctx.fillStyle = '#ffe08a';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(elapsed < 1 ? 'Ready…' : 'GO!', CANVAS_W / 2, CANVAS_H / 2 + 9);
    ctx.textAlign = 'left';
  }
}
