// The Line: the game's north star, made into a number you can watch.
//
// "A purebred with a family tree behind it" is what the pond is for, and a
// Champion is that sentence with a bar on it: a grown duck that is purebred
// (both parents its own breed), at its breed's show standard, and at least
// the third generation bred on this line. All three are fixed at hatch, so a
// champion is one for life; recognition happens once, pays once, and goes
// into the Hall of Champions, which survives pond retirement.
//
// Two questions the game already answers stay separate on purpose. The
// advisor's keepVerdict (advisor.ts) is *potential*: which ducks the project
// can't spare. championProgress here is *achievement*: how close this bird is
// to the bar. A duck can be worth keeping and nowhere near champion, or a
// champion the flock could do without.
import type { GameState } from '../state';
import type { Sex } from '../types';
import type { Duck } from './duck';
import type { Genome } from './genetics';
import { events } from '../events';
import { breedKey, breedLabel } from './breedBook';
import { chronicle } from './chronicle';
import { addSocietyPoints } from './society';
import { noteCupPoints } from './cup';
import { isPureBred, pedigreeScore } from './pedigree';
import { standardMatch, STANDARD_THRESHOLD } from './standards';
import { generationOf } from './lineage';
import { dayOf, TICKS_PER_HOUR } from './time';
import { TUNING } from './tuning';
import { ordinal } from '../text';

export interface ChampionRecord {
  id: string;
  name: string;
  sex: Sex;
  breedKey: string;
  gen: number;
  genome: Genome;
  pct: number; // standard match when recognised
  day: number;
  era: number; // heritage count at the time — which pond it stood on
}

export type LineHonour = 'book' | 'awards';

export interface LineState {
  name: string; // "Homestead" — prose says "the Homestead line"
  foundedDay: number;
  champions: ChampionRecord[]; // newest last, capped at hallCap
  championsTotal: number; // lifetime count, unaffected by the cap
  milestones: number[]; // champion-count milestones already honoured
  honours: LineHonour[]; // one-off honours (a full Book, a full award sheet)
  // Baselines for the rolling "next thing" goals, set when the chapters end.
  goalBase: { champions: number; gen: number; breeds: number } | null;
}

export const DEFAULT_LINE_NAME = 'Homestead';

export function defaultLine(): LineState {
  return { name: DEFAULT_LINE_NAME, foundedDay: 0, champions: [], championsTotal: 0, milestones: [], honours: [], goalBase: null };
}

// "the Homestead line" — for prose; headings capitalise it themselves.
export function lineTitle(state: GameState): string {
  return `the ${state.line.name} line`;
}

export interface ChampionCheck {
  ok: boolean;
  pct: number; // standard match, 0–100
  pure: boolean;
  gen: number;
  grown: boolean;
  progress: number; // 0–100; 100 exactly when ok
  gaps: string[]; // what it lacks, in plain words (empty when ok)
}

const W_STANDARD = 60;
const W_PURE = 20;
const W_GEN = 15;
const W_GROWN = 5;

export function championCheck(duck: Duck): ChampionCheck {
  const minGen = TUNING.line.championGen;
  const pct = standardMatch(duck).pct;
  const pure = isPureBred(duck);
  const gen = generationOf(duck);
  const grown = duck.stage === 'adult' || duck.stage === 'elder';
  const atStandard = pct >= STANDARD_THRESHOLD;
  const deep = gen >= minGen;
  const ok = grown && pure && atStandard && deep;
  const progress = ok
    ? 100
    : Math.min(
        99,
        Math.round(W_STANDARD * Math.min(1, pct / STANDARD_THRESHOLD) + (pure ? W_PURE : 0) + W_GEN * (Math.min(gen, minGen) / minGen) + (grown ? W_GROWN : 0)),
      );
  const gaps: string[] = [];
  if (!grown) gaps.push('still growing');
  if (!pure) gaps.push('parents not both its breed');
  if (!atStandard) gaps.push(`${pct}% to standard — needs ${STANDARD_THRESHOLD}%`);
  if (!deep) gaps.push(`gen ${gen} — needs gen ${minGen}+`);
  return { ok, pct, pure, gen, grown, progress, gaps };
}

export function championProgress(duck: Duck): number {
  return championCheck(duck).progress;
}

export function isChampion(duck: Duck): boolean {
  return duck.champion !== undefined;
}

// The line steps into view once the player has bred a little (chapter four
// done) or has a champion — before that the strip is about learning the pond.
export function lineInView(state: GameState): boolean {
  return Boolean(state.goals['chapter:ducks-life']) || state.line.championsTotal > 0;
}

// The living duck nearest the bar that isn't over it yet — what the widget
// and the dawn report point at. Ties go to the deeper pedigree.
export function closestToChampion(state: GameState): { duck: Duck; check: ChampionCheck } | null {
  let best: { duck: Duck; check: ChampionCheck } | null = null;
  for (const duck of state.ducks) {
    if (duck.stage === 'egg' || isChampion(duck)) continue;
    const check = championCheck(duck);
    if (!best || check.progress > best.check.progress || (check.progress === best.check.progress && pedigreeScore(duck) > pedigreeScore(best.duck))) {
      best = { duck, check };
    }
  }
  return best;
}

// Breeds the line has produced a champion of.
export function championedBreeds(state: GameState): Set<string> {
  return new Set(state.line.champions.map((c) => c.breedKey));
}

// Hourly, like the awards: recognise any duck that has come to meet the bar.
export function tickLine(state: GameState): void {
  if (state.clock.totalTicks % TICKS_PER_HOUR !== 0) return;
  for (const duck of state.ducks) {
    if (duck.stage === 'egg' || isChampion(duck)) continue;
    const check = championCheck(duck);
    if (!check.ok) continue;
    recogniseChampion(state, duck, check);
  }
}

function recogniseChampion(state: GameState, duck: Duck, check: ChampionCheck): void {
  const line = state.line;
  const day = dayOf(state.clock);
  const key = breedKey(duck.genome);
  duck.champion = day;
  line.champions.push({ id: duck.id, name: duck.name, sex: duck.sex, breedKey: key, gen: check.gen, genome: duck.genome, pct: check.pct, day, era: state.heritage });
  if (line.champions.length > TUNING.line.hallCap) line.champions.splice(0, line.champions.length - TUNING.line.hallCap);
  line.championsTotal += 1;
  state.money += TUNING.line.championCoins;
  addSocietyPoints(state, TUNING.line.championPoints);
  noteCupPoints(state, TUNING.line.championCupPoints);
  chronicle(state, 'milestone', `${duck.name} is a Champion — a ${breedLabel(key)} at the standard, ${ordinal(check.gen)} generation of ${lineTitle(state)}.`);
  events.emit('toast', `${duck.name} is a Champion! +${TUNING.line.championCoins} coins, +${TUNING.line.championPoints} Society`);
  events.emit('champion', duck);
}
