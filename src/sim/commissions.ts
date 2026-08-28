// The Commissions Board: contracts from named breeders asking for a duck of
// a given breed with escalating extra demands (sex, generation, standard
// match, pink bill). Generated from what the pond could plausibly produce
// within a generation or two, so there is always a next target. Pays many
// times market price plus Society points.
import type { GameState } from '../state';
import { flock } from '../state';
import type { Rng } from '../rng';
import type { Duck } from './duck';
import { createDuck } from './duck';
import { breedKey, breedLabel, representativeGenome } from './breedBook';
import { childBreedKeys } from './advisor';
import { BALANCE } from './economy';
import { computePhenotype, type Allele, type Genome } from './genetics';
import { generationOf } from './lineage';
import { standardMatch } from './standards';
import { chronicle } from './chronicle';
import { addSocietyPoints } from './society';
import { events } from '../events';
import { dayOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { createRng } from '../rng';

export interface Commission {
  id: number;
  client: string;
  key: string; // breed key
  sex?: 'M' | 'F';
  minGen?: number;
  minStandard?: number; // percent
  pinkBill?: boolean;
  reward: number;
  points: number;
  postedDay: number;
  expiresDay: number;
}

export const COMMISSION_SLOTS = 3;
export const COMMISSION_DAYS = 6;
const CLIENTS = [
  'Mrs. Abernathy', 'the Thistlewood estate', 'Harbour Farm', 'Dr. Quill', 'the Millpond Society',
  'Old Tom Fennick', 'the Abbey kitchens', 'Lady Marrow', 'the Fairweather twins', 'Pemberton & Sons',
];

// The Board is open from day one: its first tier is the plain "a buyer wants
// a Spotted Mallard" request; demands grow with commissions filled.
export function commissionsUnlocked(state: GameState): boolean {
  void state;
  return true;
}

// A breeding hint for a commission nobody on the pond fits yet: the pair
// most likely to hatch the wanted breed, and the chance per egg. (The Breed
// panel shows the same odds for any pairing — this just saves the hunt.)
export function bestPairFor(state: GameState, key: string): { sire: Duck; dam: Duck; chance: number } | null {
  // Only adults can nest (elders are past breeding).
  const adults = state.ducks.filter((d) => d.stage === 'adult' && !d.penned);
  let best: { sire: Duck; dam: Duck; chance: number } | null = null;
  for (const sire of adults.filter((d) => d.sex === 'M')) {
    for (const dam of adults.filter((d) => d.sex === 'F')) {
      const chance = breedChance(sire.genome, dam.genome, key);
      if (chance > 0 && (!best || chance > best.chance)) best = { sire, dam, chance };
    }
  }
  return best;
}

// Exact probability (mutation aside) that a clutch of this pair expresses
// the breed key: product over the four Book loci of the share of allele
// combinations giving the key's expression at that locus.
function breedChance(a: Genome, b: Genome, key: string): number {
  const rep = representativeGenome(key);
  let p = 1;
  for (const id of ['baseColor', 'dilution', 'pattern', 'crest'] as const) {
    let hits = 0;
    for (const x of a[id]) {
      for (const y of b[id]) {
        const child = { ...rep, [id]: [x, y] as [Allele, Allele] };
        if (breedKey(child) === key) hits += 1;
      }
    }
    p *= hits / 4;
    if (p === 0) return 0;
  }
  return p;
}

// Demands escalate with commissions fulfilled.
function tierFor(state: GameState): number {
  return Math.min(3, Math.floor(state.commissionsDone / 3));
}

function candidateKeys(state: GameState): string[] {
  const hatched = flock(state);
  const keys = new Set<string>();
  for (const d of hatched) keys.add(breedKey(d.genome));
  const males = hatched.filter((d) => d.sex === 'M');
  const females = hatched.filter((d) => d.sex === 'F');
  for (const m of males) for (const f of females) for (const k of childBreedKeys(m.genome, f.genome)) keys.add(k);
  return [...keys];
}

export function makeCommission(state: GameState, rng: Rng): Commission | null {
  const keys = candidateKeys(state).filter((k) => !state.commissions.some((c) => c.key === k));
  if (keys.length === 0) return null;
  // Prefer breeds not yet at Standard: that is the thing to breed toward.
  const unmet = keys.filter((k) => !state.awards[k]?.standard);
  const key = rng.pick(unmet.length > 0 ? unmet : keys);
  const tier = tierFor(state);
  const c: Commission = {
    id: state.nextCommissionId,
    client: rng.pick(CLIENTS),
    key,
    reward: 0,
    points: 3 + tier * 3,
    postedDay: dayOf(state.clock),
    expiresDay: dayOf(state.clock) + COMMISSION_DAYS,
  };
  if (tier >= 1 && rng.chance(0.6)) c.sex = rng.chance(0.5) ? 'M' : 'F';
  if (tier >= 1) c.minGen = tier; // gen 1..3
  if (tier >= 2) c.minStandard = tier === 2 ? 60 : 80;
  if (tier >= 3 && rng.chance(0.35)) c.pinkBill = true;
  const rarity = computePhenotype(representativeGenome(key)).rarityScore;
  const base = BALANCE.adultBasePrice * (1 + rarity * BALANCE.rarityMultiplier);
  const demandBonus = 1 + (c.sex ? 0.2 : 0) + (c.minGen ?? 0) * 0.3 + (c.minStandard ? c.minStandard / 100 : 0) + (c.pinkBill ? 0.8 : 0);
  c.reward = Math.round(base * (3 + tier) * demandBonus);
  state.nextCommissionId += 1;
  return c;
}

export function tickCommissions(state: GameState, rng: Rng): void {
  // Expire at dawn; refill one slot per day at 08:00.
  if (state.clock.totalTicks % TICKS_PER_DAY === 6 * TICKS_PER_HOUR) {
    const day = dayOf(state.clock);
    const before = state.commissions.length;
    state.commissions = state.commissions.filter((c) => c.expiresDay > day);
    if (state.commissions.length < before) events.emit('toast', 'A commission expired unfilled.');
  }
  if (state.clock.totalTicks % TICKS_PER_DAY === 8 * TICKS_PER_HOUR && commissionsUnlocked(state)) {
    if (state.commissions.length < COMMISSION_SLOTS) {
      const c = makeCommission(state, rng);
      if (c) {
        state.commissions.push(c);
        events.emit('toast', `New commission from ${c.client}: ${describeCommission(c)}`);
      }
    }
  }
}

export function duckFits(duck: Duck, c: Commission): boolean {
  if (duck.stage === 'egg' || duck.stage === 'duckling') return false;
  if (breedKey(duck.genome) !== c.key) return false;
  if (c.sex && duck.sex !== c.sex) return false;
  if (c.minGen !== undefined && generationOf(duck) < c.minGen) return false;
  if (c.minStandard !== undefined && standardMatch(duck, c.key).pct < c.minStandard) return false;
  // P is dominant, so one copy shows a pink bill.
  if (c.pinkBill && !duck.genome.billColor.includes('P')) return false;
  return true;
}

// Why a duck of the right breed doesn't fit — the demands it misses, in
// plain words. Null when it fits (or isn't the breed at all).
export function commissionGap(duck: Duck, c: Commission): string[] | null {
  if (breedKey(duck.genome) !== c.key) return null;
  const gaps: string[] = [];
  if (duck.stage === 'egg' || duck.stage === 'duckling') gaps.push('still a duckling');
  if (c.sex && duck.sex !== c.sex) gaps.push(`must be a ${c.sex === 'F' ? 'hen' : 'drake'}`);
  if (c.minGen !== undefined && generationOf(duck) < c.minGen) gaps.push(`gen ${generationOf(duck)} — needs gen ${c.minGen}+`);
  if (c.minStandard !== undefined) {
    const pct = standardMatch(duck, c.key).pct;
    if (pct < c.minStandard) gaps.push(`${pct}% to standard — needs ${c.minStandard}%`);
  }
  if (c.pinkBill && !duck.genome.billColor.includes('P')) gaps.push('needs a pink bill');
  return gaps;
}

export function fulfilCommission(state: GameState, commissionId: number, duckId: string): boolean {
  const c = state.commissions.find((x) => x.id === commissionId);
  const idx = state.ducks.findIndex((d) => d.id === duckId);
  if (!c || idx < 0) return false;
  const duck = state.ducks[idx];
  if (!duckFits(duck, c)) return false;
  state.ducks.splice(idx, 1);
  state.money += c.reward;
  state.stats.ducksSold += 1;
  state.commissionsDone += 1;
  if (c.reward > state.stats.biggestSale) state.stats.biggestSale = c.reward;
  addSocietyPoints(state, c.points);
  state.commissions = state.commissions.filter((x) => x.id !== commissionId);
  chronicle(state, 'sale', `${duck.name} went to ${c.client} — a ${breedLabel(c.key)} commission worth ${c.reward} coins.`);
  events.emit('toast', `${c.client} paid ${c.reward} coins for ${duck.name} (+${c.points} Society)`);
  return true;
}

export function describeCommission(c: Commission): string {
  const parts = [`a ${breedLabel(c.key)}${c.sex ? (c.sex === 'F' ? ' hen' : ' drake') : ''}`];
  if (c.minGen) parts.push(`gen ${c.minGen}+`);
  if (c.minStandard) parts.push(`${c.minStandard}% to standard`);
  if (c.pinkBill) parts.push('pink bill');
  return parts.join(' · ');
}

// A specimen for the board's portrait.
export function commissionSpecimen(c: Commission): Duck {
  return createDuck(createRng(c.id + 99), { genome: representativeGenome(c.key), stage: 'adult', pos: { x: 0, y: 0 }, sex: c.sex ?? 'F', name: 'wanted' });
}
