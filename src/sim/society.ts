// The Duck Fanciers' Society: a twenty-rank ladder paid for with coins AND
// Society points (earned by breed awards, commissions, and festival
// placings — never buyable). Rewards are cosmetic styles for the pond plus
// a few permanent perks near the top, so coins keep mattering long after the
// upgrades are maxed.
import type { GameState } from '../state';
import { events } from '../events';
import { chronicle } from './chronicle';
import { pedigreeScore } from './pedigree';
import { noteCupPoints } from './cup';
import type { LineHonour } from './line';
import { plural } from '../text';

export type StyleSlot = 'water' | 'lily' | 'grass' | 'hutch';

export interface StyleDef {
  id: string;
  slot: StyleSlot;
  name: string;
  colors: string[]; // slot-specific: water [shallow, deep]; lily [pad, flower]; grass [tint]; hutch [wood, dark]
}

export const STYLES: Record<string, StyleDef> = {
  'water:clear': { id: 'water:clear', slot: 'water', name: 'Clear Spring Water', colors: ['#5aa0d0', '#3477a8'] },
  'water:turquoise': { id: 'water:turquoise', slot: 'water', name: 'Turquoise Water', colors: ['#4ab8b0', '#2a7f80'] },
  'water:deep': { id: 'water:deep', slot: 'water', name: 'Deep Lake Blue', colors: ['#3a6fb5', '#1f3f7a'] },
  'lily:pink': { id: 'lily:pink', slot: 'lily', name: 'Pink Lilies', colors: ['#4f8f3e', '#f2a6c4'] },
  'lily:white': { id: 'lily:white', slot: 'lily', name: 'White Lotus', colors: ['#5a9a48', '#f7f3ea'] },
  'lily:gold': { id: 'lily:gold', slot: 'lily', name: 'Golden Lilies', colors: ['#4f8f3e', '#f0c040'] },
  'grass:lush': { id: 'grass:lush', slot: 'grass', name: 'Lush Lawn', colors: ['#5fa84a'] },
  'grass:golden': { id: 'grass:golden', slot: 'grass', name: 'Golden Meadow', colors: ['#b5a64a'] },
  'grass:meadow': { id: 'grass:meadow', slot: 'grass', name: 'Wildflower Meadow', colors: ['#6aa85e'] },
  'hutch:white': { id: 'hutch:white', slot: 'hutch', name: 'Whitewashed Hutch', colors: ['#e8e2d2', '#9a927e'] },
  'hutch:painted': { id: 'hutch:painted', slot: 'hutch', name: 'Painted Hutch', colors: ['#c8584a', '#7a2f26'] },
  'hutch:gilded': { id: 'hutch:gilded', slot: 'hutch', name: 'Gilded Hutch', colors: ['#d9b24a', '#8a6a1e'] },
};

export type PerkId = 'statue' | 'commissionedStock' | 'pondSlot' | 'visitorGift' | 'goldenBasket';

export interface RankDef {
  rank: number;
  name: string;
  cost: number;
  points: number;
  style?: string; // STYLES id
  title?: string; // bestowed on the pond's top-pedigree duck
  perk?: PerkId;
}

export const RANKS: RankDef[] = [
  { rank: 1, name: 'Fancier', cost: 300, points: 3, style: 'water:clear', title: 'Fancier’s Pick' },
  { rank: 2, name: 'Keeper', cost: 500, points: 6, style: 'lily:pink' },
  { rank: 3, name: 'Steward', cost: 800, points: 10, style: 'grass:lush' },
  { rank: 4, name: 'Warden', cost: 1200, points: 14, style: 'hutch:white' },
  { rank: 5, name: 'Patron', cost: 1600, points: 18, perk: 'statue' },
  { rank: 6, name: 'Breeder', cost: 1900, points: 24, title: 'Prize Breeder' },
  { rank: 7, name: 'Fellow', cost: 2300, points: 30, style: 'water:turquoise' },
  { rank: 8, name: 'Agent', cost: 2700, points: 36, perk: 'commissionedStock' },
  { rank: 9, name: 'Curator', cost: 3200, points: 44, style: 'lily:white' },
  { rank: 10, name: 'Pondmaster', cost: 3800, points: 52, perk: 'pondSlot' },
  { rank: 11, name: 'Laureate', cost: 4400, points: 60, style: 'grass:golden' },
  { rank: 12, name: 'Artisan', cost: 5000, points: 70, style: 'hutch:painted' },
  { rank: 13, name: 'Master Breeder', cost: 5700, points: 80, title: 'Master’s Champion' },
  { rank: 14, name: 'Regent', cost: 6400, points: 92, style: 'water:deep' },
  { rank: 15, name: 'Luminary', cost: 7200, points: 105, style: 'lily:gold' },
  { rank: 16, name: 'Host', cost: 8000, points: 120, perk: 'visitorGift' },
  { rank: 17, name: 'Sage', cost: 8900, points: 135, style: 'grass:meadow' },
  { rank: 18, name: 'Gilder', cost: 9800, points: 150, style: 'hutch:gilded' },
  { rank: 19, name: 'Grand Fancier', cost: 10800, points: 170, title: 'Grand Champion' },
  { rank: 20, name: 'Golden Egg', cost: 12000, points: 200, perk: 'goldenBasket' },
];

export function addSocietyPoints(state: GameState, n: number): void {
  state.society.points += n;
  state.society.lifetimePoints += n;
  noteCupPoints(state, n);
}

export function nextRank(state: GameState): RankDef | null {
  return RANKS[state.society.rank] ?? null;
}

export function canAdvance(state: GameState): { ok: boolean; reason?: string } {
  const next = nextRank(state);
  if (!next) return { ok: false, reason: 'Top rank reached' };
  if (state.money < next.cost) return { ok: false, reason: `Need ${next.cost} coins` };
  if (state.society.points < next.points) return { ok: false, reason: `Need ${next.points} Society points` };
  return { ok: true };
}

export function advanceRank(state: GameState): boolean {
  const next = nextRank(state);
  if (!next || !canAdvance(state).ok) return false;
  state.money -= next.cost;
  state.society.points -= next.points;
  state.society.rank = next.rank;
  if (next.style) {
    state.society.unlockedStyles.push(next.style);
    state.society.style[STYLES[next.style].slot] = next.style; // newest applies by default
  }
  if (next.perk) state.society.perks.push(next.perk);
  chronicle(state, 'society', `The pond was admitted to the Society as ${next.name} (rank ${next.rank}).`);
  events.emit('toast', `Society rank ${next.rank}: ${next.name}!`);
  events.emit('purchase');
  return true;
}

export function hasPerk(state: GameState, perk: PerkId): boolean {
  return state.society.perks.includes(perk);
}

export function activeStyle(state: GameState, slot: StyleSlot): StyleDef | null {
  const id = state.society.style[slot];
  return id ? STYLES[id] ?? null : null;
}

// The line's own ladder: every so many champions the Society names the line,
// with points and a title a champion wears. It never runs out of rungs the
// way the rank ladder does — the last one is a long way off.
export interface LineMilestone {
  n: number; // champions
  points: number;
  title: string;
}

export const LINE_MILESTONES: LineMilestone[] = [
  { n: 1, points: 5, title: 'Champion Breeder' },
  { n: 3, points: 8, title: 'Line Founder' },
  { n: 5, points: 12, title: 'Keeper of the Line' },
  { n: 10, points: 20, title: 'Bloodline Master' },
  { n: 25, points: 30, title: 'Dynast' },
  { n: 50, points: 50, title: 'Legend of the Society' },
];

// One-off honours for finishing the finite ladders.
export const HONOUR_TITLES: Record<LineHonour, { title: string; points: number }> = {
  book: { title: 'Keeper of the Book', points: 30 },
  awards: { title: 'Master of All Breeds', points: 50 },
};

// Grant any line milestone the champion count has reached, once each.
export function grantLineMilestones(state: GameState): void {
  for (const m of LINE_MILESTONES) {
    if (state.line.championsTotal < m.n || state.line.milestones.includes(m.n)) continue;
    state.line.milestones.push(m.n);
    addSocietyPoints(state, m.points);
    chronicle(state, 'society', `The Society names the ${state.line.name} line "${m.title}" — ${plural(m.n, 'champion')} bred.`);
    events.emit('toast', `${m.title}! The Society honours the line: +${m.points} Society`);
  }
}

export function grantHonour(state: GameState, honour: LineHonour): void {
  if (state.line.honours.includes(honour)) return;
  state.line.honours.push(honour);
  const h = HONOUR_TITLES[honour];
  addSocietyPoints(state, h.points);
  chronicle(state, 'milestone', honour === 'book' ? `Every breed in the Book has hatched — the Society names the ${state.line.name} line "${h.title}".` : `Every award in the Book is won — the Society names the ${state.line.name} line "${h.title}".`);
  events.emit('toast', `${h.title}! +${h.points} Society`);
}

// Rank titles bestowed so far, highest last.
function societyTitles(state: GameState): string[] {
  return RANKS.filter((r) => r.rank <= state.society.rank && r.title).map((r) => r.title!);
}

// The line's titles, highest last: milestones reached, then honours.
export function lineTitles(state: GameState): string[] {
  const milestones = LINE_MILESTONES.filter((m) => state.line.milestones.includes(m.n)).map((m) => m.title);
  const honours = state.line.honours.map((h) => HONOUR_TITLES[h].title);
  return [...milestones, ...honours];
}

// Everything the pond may call itself, for the Society tab.
export function allTitles(state: GameState): string[] {
  return [...societyTitles(state), ...lineTitles(state)];
}

export function rewardLabel(r: RankDef): string {
  if (r.style) return STYLES[r.style].name;
  if (r.title) return `Title: ${r.title}`;
  switch (r.perk) {
    case 'statue': return 'Statue of your champion (decor)';
    case 'commissionedStock': return 'Commissioned stock: order a duck with a chosen rare gene';
    case 'pondSlot': return '+1 pond slot';
    case 'visitorGift': return 'Wild visitors bring an extra rare gene';
    case 'goldenBasket': return 'Golden basket: hen eggs sell for double';
  }
  return '';
}

// A champion wears the line's highest title; the pond's top-pedigree adult
// holds the highest rank title. Two ladders, two holders.
export function championTitle(state: GameState, duck: { id: string; champion?: number }): string | null {
  if (duck.champion !== undefined) {
    const line = lineTitles(state);
    if (line.length > 0) return line[line.length - 1];
  }
  const titles = societyTitles(state);
  if (titles.length === 0) return null;
  let best: { id: string; score: number } | null = null;
  for (const d of state.ducks) {
    if (d.stage !== 'adult' && d.stage !== 'elder') continue;
    const score = pedigreeScore(d);
    if (!best || score > best.score) best = { id: d.id, score };
  }
  return best?.id === duck.id ? titles[titles.length - 1] : null;
}
