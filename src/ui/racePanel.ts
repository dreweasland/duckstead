// Pond Derby: a click-timing race minigame. The player's real duck races
// three wild ducks; base speed comes from its genetics (vigor, size) and
// temperament (energy), and well-timed paddle boosts do the rest.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { createDuck, freshName } from '../sim/duck';
import { BALANCE } from '../sim/economy';
import { currentTier, leagueStanding } from '../sim/league';
import { randomCommonGenome } from '../sim/genetics';
import { createRng, type Rng } from '../rng';
import { boostPower, enterRace, raceEligible, raceRested, raceSpeed, settleRace } from '../sim/race';
import { staminaHold } from '../sim/training';
import { TUNING } from '../sim/tuning';
import { play } from '../audio/audio';
import { keyLabel, keyFor, matchesKey } from './settings';
import { computeAnim } from '../render/animation';
import { drawDuck } from '../render/duckPainter';
import { el, statBar, statTile } from './dom';
import { eventCard, resultRow } from './eventCard';
import { icon } from './icons';
import { duckPortrait } from './portrait';
import { CANVAS_W, drawBanner, drawWater } from './minigameCanvas';

const TRACK_LEN = 700;
const LANES = 4;
const CANVAS_H = 300;
// Player paddle: full power only near the meter's sweet spot; mashing with
// sloppy timing pays a fraction. Wild racers paddle like a competent player,
// each with their own knack (skill). Numbers live in tuning.ts.
const {
  boostCooldownMs: BOOST_COOLDOWN_MS,
  playerBoost: PLAYER_BOOST,
  aiHitsPerSec: AI_HITS_PER_SEC,
  aiBoostMin: AI_BOOST_MIN,
  aiBoostVar: AI_BOOST_VAR,
  meterPeriodMs: METER_PERIOD_MS,
} = TUNING.race;

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

interface RaceOpts {
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
  // A named field (the rival ponds' racers) instead of wild ducks.
  field?: Array<{ duck: Duck; skill: number }>;
}

export function openRacePanel(game: Game, ui: UiHooks, opts: RaceOpts = {}): void {
  const tierDef = opts.league ? currentTier(game.state) : null;
  const title = opts.title ?? tierDef?.name ?? 'Pond Derby';
  const entryFee = opts.entryFee ?? tierDef?.entryFee ?? BALANCE.raceEntryFee;
  const prizes = opts.prizes ?? tierDef?.prizes ?? BALANCE.racePrizes;
  const aiBoost = opts.aiBoost ?? tierDef?.aiBoost ?? 1;

  let raf = 0;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  const ev = eventCard(document.getElementById('ui-root')!, 'derby', '', () => {
    cancelAnimationFrame(raf);
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
  });
  if (!ev) return;
  const { card, close, header } = ev;

  const showPicker = () => {
    card.classList.remove('win');
    const eligible = raceEligible(game.state);
    const fee = entryFee;
    card.replaceChildren(
      header('flag', title),
    );
    // The stakes at a glance, dawn-card style.
    card.append(
      el(
        'div',
        { class: 'race-stats' },
        statTile('coin', String(fee), 'entry'),
        statTile('star', String(prizes[0]), '1st prize'),
        statTile('starOutline', String(prizes[1] ?? 0), '2nd prize'),
        statTile('duck', String(eligible.length), eligible.length === 1 ? 'racer ready' : 'racers ready'),
      ),
      el(
        'div',
        { class: 'muted small race-blurb' },
        'Speed comes from vigor, boldness, a trim build — and paddle drills.',
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
      const rested = opts.ignoreDailyLimit || raceRested(game.state, duck);
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
              if (enterRace(game.state, duck.id, fee, opts.ignoreDailyLimit)) startRace(duck);
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
    // Seeded from the game's rng: the whole race — field, skills, lanes, AI
    // paddling — is reproducible, so tests can pin difficulty. (Drawing the
    // seed also makes each race a real event in the sim's random stream.)
    const rng = createRng(game.rng.int(0xffffffff) >>> 0);
    const taken = [playerDuck.name];
    const player = makeRacer(playerDuck, true, rng);
    const racers: Racer[] = [player];
    // Stamina: a trained duck's boosts fade more slowly.
    const playerHold = staminaHold(playerDuck);
    for (let i = 0; i < LANES - 1; i += 1) {
      const named = opts.field?.[i];
      const wild = named
        ? { ...named.duck }
        : createDuck(rng, {
            genome: randomCommonGenome(rng),
            stage: 'adult',
            pos: { x: 0, y: 0 },
          });
      if (!named) wild.name = freshName(rng, taken, WILD_NAMES);
      taken.push(wild.name);
      wild.activity = 'swim';
      const racer = makeRacer(wild, false, rng);
      racer.baseSpeed *= aiBoost;
      racer.skill = named ? named.skill : rng.range(0.8, 1.2);
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
    const hint = el('div', { class: 'muted small race-hint' }, `Click the water (or press ${keyLabel(keyFor('paddle'))}) when the marker is centered to paddle!`);
    card.replaceChildren(
      header('flag', title),
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
      if (player.finishedAt !== null) return;
      lastBoost = now;
      const meterVal = meterValue(now - start);
      const power = boostPower(meterVal);
      player.boost += PLAYER_BOOST * power;
      meter.classList.remove('hit-good', 'hit-weak');
      void meter.offsetWidth; // restart the flash animation
      meter.classList.add(power > 0.7 ? 'hit-good' : 'hit-weak');
      play(power > 0.7 ? 'hit' : 'miss');
    };
    canvas.addEventListener('pointerdown', tryBoost);
    keyHandler = (e) => {
      if (matchesKey(e, 'paddle')) {
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
        const v = racer.baseSpeed * wobble + racer.boost;
        if (!racer.isPlayer && rng.chance(dt * AI_HITS_PER_SEC * racer.skill)) {
          racer.boost += AI_BOOST_MIN + rng.next() * AI_BOOST_VAR;
        }
        racer.boost *= Math.pow(racer.isPlayer ? 0.15 + playerHold * 0.15 : 0.15, dt);
        racer.x += v * dt;
        if (racer.x >= TRACK_LEN) {
          racer.x = TRACK_LEN;
          finishCount += 1;
          racer.finishedAt = finishCount;
        }
      }

      meterFill.style.left = `${meterValue(now - start) * 100}%`;
      drawRace(ctx, racers, elapsed, now);

      if (doneAt === null && (finishCount === racers.length || (player.finishedAt !== null && elapsed > 3))) {
        // Give trailing AI a beat to finish for a complete scoreboard.
        doneAt = now + 1200;
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
    const player = ranked[playerPlace] ?? ranked[0]; // the field always starts with the player's racer
    const playerId = player.duck.id;
    const { prize, notice } = settleRace(game.state, {
      duckId: playerId,
      place: playerPlace,
      prizes,
      league: Boolean(opts.league),
      title,
    });
    if (notice) ui.toast(notice);
    if (playerPlace === 0) play('cheer');
    opts.onFinish?.(playerPlace);
    const playerDuck = game.state.ducks.find((d) => d.id === playerId);

    const list = el('div', { class: 'race-results' });
    ranked.forEach((racer, i) => {
      list.append(
        resultRow(i + 1, {
          mine: racer.isPlayer,
          portrait: duckPortrait(racer.duck, 36),
          name: racer.duck.name + (racer.isPlayer ? ' (you)' : ''),
          reward: racer.isPlayer ? prizes[i] ?? 0 : 0,
        }),
      );
    });
    const next = opts.nextRace ? opts.nextRace(playerPlace) : undefined;
    const actionRow = el('div', { class: 'actions race-actions' });
    if (next) {
      const advanceDuck = playerDuck ?? player.duck;
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
      header('flag', headline),
      list,
      actionRow,
    );
    if (prize > 0) ui.toast(`${playerPlace === 0 ? 'Won' : 'Placed'} — +${prize} coins!`);
  };

  if (opts.racer && enterRace(game.state, opts.racer.id, entryFee, opts.ignoreDailyLimit)) {
    startRace(opts.racer);
  } else {
    showPicker();
  }
}

function makeRacer(duck: Duck, isPlayer: boolean, rng: Rng): Racer {
  return {
    duck: { ...duck, activity: 'swim' },
    x: 0,
    baseSpeed: raceSpeed(duck),
    boost: 0,
    phase: rng.range(0, Math.PI * 2),
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

  // Water background with a drifting shimmer.
  drawWater(ctx, CANVAS_W, CANVAS_H, now, { count: 10, xStride: 97, yTop: 0, yStride: 53 });

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
  if (elapsed < 1.4) drawBanner(ctx, CANVAS_W, CANVAS_H, elapsed < 1 ? 'Ready…' : 'GO!');
}
