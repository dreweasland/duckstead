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
  { rank: 6, name: 'Breeder', cost: 2200, points: 24, title: 'Prize Breeder' },
  { rank: 7, name: 'Fellow', cost: 2800, points: 30, style: 'water:turquoise' },
  { rank: 8, name: 'Agent', cost: 3500, points: 36, perk: 'commissionedStock' },
  { rank: 9, name: 'Curator', cost: 4300, points: 44, style: 'lily:white' },
  { rank: 10, name: 'Pondmaster', cost: 5200, points: 52, perk: 'pondSlot' },
  { rank: 11, name: 'Laureate', cost: 6200, points: 60, style: 'grass:golden' },
  { rank: 12, name: 'Artisan', cost: 7400, points: 70, style: 'hutch:painted' },
  { rank: 13, name: 'Master Breeder', cost: 8800, points: 80, title: 'Master’s Champion' },
  { rank: 14, name: 'Regent', cost: 10400, points: 92, style: 'water:deep' },
  { rank: 15, name: 'Luminary', cost: 12000, points: 105, style: 'lily:gold' },
  { rank: 16, name: 'Host', cost: 14000, points: 120, perk: 'visitorGift' },
  { rank: 17, name: 'Sage', cost: 16000, points: 135, style: 'grass:meadow' },
  { rank: 18, name: 'Gilder', cost: 18000, points: 150, style: 'hutch:gilded' },
  { rank: 19, name: 'Grand Fancier', cost: 20000, points: 170, title: 'Grand Champion' },
  { rank: 20, name: 'Golden Egg', cost: 24000, points: 200, perk: 'goldenBasket' },
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

// Titles bestowed so far, highest last.
function societyTitles(state: GameState): string[] {
  return RANKS.filter((r) => r.rank <= state.society.rank && r.title).map((r) => r.title!);
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

// The pond's top-pedigree adult holds the highest Society title earned.
export function championTitle(state: GameState, duck: { id: string }): string | null {
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
