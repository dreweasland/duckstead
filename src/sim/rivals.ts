// Rival breeders: three named ponds that grow alongside yours. Each keeps a
// small flock of real genomes that breeds a generation every season toward
// its own taste, drills its birds, and shows up wherever the player does —
// the Egg Show field, the Grand Prix grid, the Commissions Board, a stud
// drake for hire — so the world gets harder with the years, not just with
// the player's own flock.
import type { GameState } from '../state';
import type { Rng } from '../rng';
import { createRng } from '../rng';
import type { Duck } from './duck';
import { createDuck } from './duck';
import { breed, computePhenotype, randomCommonGenome, type Genome } from './genetics';
import { breedKey } from './breedBook';
import { ALL_BREED_KEYS } from './breedBook';
import { breedStandard, standardMatch } from './standards';
import { rareAlleleCount } from './pedigree';
import { chronicle } from './chronicle';
import { events } from '../events';
import { dayOf, dayOfSeason, seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR, yearOf } from './time';
import { TUNING } from './tuning';
import { BALANCE, noteSale } from './economy';
import { canBreedPair } from './needs';
import { nestCapacity } from './economy';
import { eggsIncubating, BREEDING_COOLDOWN_TICKS, COURTSHIP_TICKS } from './breeding';

export type RivalSpecialty = 'show' | 'racing' | 'rare';

export interface Rival {
  id: string;
  name: string;
  specialty: RivalSpecialty;
  flock: Genome[];
  training: number; // 0..100, their drilled paddle/poise
  wins: number; // festival + cup wins, all time
  yearPoints: number; // Society-equivalent points this year (the Cup)
  lastSeason: number; // absolute season index last advanced
  lastEggDay?: number; // the day this rival last bought a hatching egg
}

export interface RivalDef {
  id: string;
  name: string;
  specialty: RivalSpecialty;
  blurb: string;
  duckNames: string[];
}

export const RIVAL_DEFS: RivalDef[] = [
  { id: 'marta', name: 'Marta of Millpond', specialty: 'show', blurb: 'Breeds to the standard and drills poise. Her eggs win shows.', duckNames: ['Sable', 'Quince', 'Damson', 'Harriet', 'Lyle', 'Perpetua'] },
  { id: 'wiggins', name: 'Old Wiggins', specialty: 'racing', blurb: 'A racing stable: bold, hardy lines and a lot of paddling.', duckNames: ['Torrent', 'Squall', 'Nimbus', 'Zephyr', 'Gale', 'Rip'] },
  { id: 'reedy', name: 'The Reedy Sisters', specialty: 'rare', blurb: 'Collectors of blue, pink bills, and crests — and dear stud fees.', duckNames: ['Opal', 'Indigo', 'Blush', 'Plume', 'Cobalt', 'Rosalind'] },
];

export function rivalDef(id: string): RivalDef {
  return RIVAL_DEFS.find((r) => r.id === id) ?? RIVAL_DEFS[0];
}

function seasonIndex(state: GameState): number {
  return Math.floor(state.clock.totalTicks / (TICKS_PER_DAY * 6));
}

// A genome shaped to a specialty.
function specialtyGenome(rng: Rng, specialty: RivalSpecialty, strength: number): Genome {
  if (specialty === 'show') {
    const g = breedStandard(rng.pick(ALL_BREED_KEYS.filter((k) => !k.startsWith('B'))));
    const scramble = Math.max(1, Math.round(4 - strength * 3));
    for (let i = 0; i < scramble; i += 1) {
      const id = rng.pick(['size1', 'size2', 'bill1', 'temper1', 'vigor1', 'patternColor'] as const);
      g[id] = [rng.pick(['+', '-']), rng.pick(['+', '-'])] as Genome[typeof id];
      if (id === 'patternColor') g.patternColor = [rng.pick(['A', 'a']), rng.pick(['A', 'a'])];
    }
    return g;
  }
  const g = randomCommonGenome(rng);
  if (specialty === 'racing') {
    g.vigor1 = ['+', rng.chance(strength) ? '+' : '-'];
    g.vigor2 = ['+', '+'];
    g.temper1 = ['+', '+'];
    g.temper2 = ['+', rng.chance(strength) ? '+' : '-'];
    g.size1 = ['+', '-'];
    g.size2 = ['-', '-'];
    g.size3 = ['+', '-'];
  } else {
    const gift = rng.int(3);
    if (gift === 0) g.baseColor = ['B', rng.chance(strength) ? 'B' : 'M'];
    else if (gift === 1) g.billColor = ['P', rng.chance(strength) ? 'P' : 'O'];
    else g.crest = ['R', 'R'];
  }
  return g;
}

export function createRivals(rng: Rng): Rival[] {
  return RIVAL_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    specialty: def.specialty,
    flock: Array.from({ length: TUNING.rivals.flockSize }, () => specialtyGenome(rng, def.specialty, 0.2)),
    training: 10,
    wins: 0,
    yearPoints: 0,
    lastSeason: 0,
    lastEggDay: -1,
  }));
}

// How formidable a rival is, 0..1: the years grind their lines toward their
// goal, and every win emboldens them.
export function rivalStrength(state: GameState, rival: Rival): number {
  return Math.min(1, 0.2 + (yearOf(state.clock) - 1) * 0.15 + rival.wins * 0.05);
}

// What a rival is breeding for, as a number to maximise (roughly 0–100).
export function rivalFitness(specialty: RivalSpecialty, g: Genome): number {
  return fitness(specialty, g);
}

function fitness(specialty: RivalSpecialty, g: Genome): number {
  const p = computePhenotype(g);
  if (specialty === 'show') return standardMatch({ genome: g } as Duck, breedKey(g)).pct;
  if (specialty === 'racing') return p.vigor * 60 + p.boldness * 30 + (1 - Math.abs(p.sizeScale - 0.95)) * 10;
  return rareAlleleCount({ genome: g } as Duck) * 25 + p.rarityScore * 5;
}

// The rival's best bird by its own lights.
export function rivalBestGenome(rival: Rival): Genome {
  let best = rival.flock[0];
  for (const g of rival.flock) if (fitness(rival.specialty, g) > fitness(rival.specialty, best)) best = g;
  return best;
}

// One generation for one rival: breed a child from two of the flock, keep it
// if it's fitter than the weakest (or by luck), and drill the stable.
function advanceRival(state: GameState, rival: Rival, rng: Rng): void {
  const year = yearOf(state.clock);
  const a = rng.pick(rival.flock);
  const b = rng.pick(rival.flock.filter((g) => g !== a).length > 0 ? rival.flock.filter((g) => g !== a) : rival.flock);
  const child = breed(a, b, rng, 0.03);
  let weakest = 0;
  for (let i = 1; i < rival.flock.length; i += 1) {
    if (fitness(rival.specialty, rival.flock[i]) < fitness(rival.specialty, rival.flock[weakest])) weakest = i;
  }
  if (fitness(rival.specialty, child) > fitness(rival.specialty, rival.flock[weakest]) || rng.chance(0.3)) {
    rival.flock[weakest] = child;
  }
  rival.training = Math.min(100, rival.training + TUNING.rivals.trainingPerSeason + (year - 1) * TUNING.rivals.trainingPerYear);
  const points = TUNING.rivals.pointsBase + (year - 1) * TUNING.rivals.pointsPerYear + rival.wins * TUNING.rivals.pointsPerWin;
  rival.yearPoints += Math.round(points * rng.range(0.8, 1.2));
}

// Season's first morning: every rival advances a generation. Year's first
// morning: their Cup tallies reset.
export function tickRivals(state: GameState, rng: Rng): void {
  if (state.clock.totalTicks % TICKS_PER_DAY !== 6 * TICKS_PER_HOUR || dayOfSeason(state.clock) !== 1) return;
  const idx = seasonIndex(state);
  if (seasonOf(state.clock) === 'spring') for (const r of state.rivals) r.yearPoints = 0;
  for (const rival of state.rivals) {
    if (rival.lastSeason >= idx) continue;
    rival.lastSeason = idx;
    advanceRival(state, rival, rng);
  }
  if (idx > 0) events.emit('toast', 'The rival ponds have hatched a new generation.');
}

// A synthetic adult for a rival's genome, deterministic per rival + slot so
// portraits and names are stable across renders.
export function rivalDuck(rival: Rival, slot: number, genome: Genome = rival.flock[slot % rival.flock.length]): Duck {
  const def = rivalDef(rival.id);
  let h = 7;
  for (const ch of `${rival.id}:${slot}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = createRng(h);
  const duck = createDuck(rng, { genome, stage: 'adult', pos: { x: 0, y: 0 }, name: def.duckNames[slot % def.duckNames.length] });
  duck.id = `rival:${rival.id}:${slot}`;
  duck.needs = { hunger: 85, cleanliness: 85, happiness: 80, health: 95 };
  duck.training = { paddle: rival.specialty === 'racing' ? rival.training : rival.training * 0.4, stamina: rival.training * 0.5, poise: rival.specialty === 'show' ? rival.training : rival.training * 0.4 };
  return duck;
}

// --- Where rivals show up ---

export interface RivalEggEntry {
  breeder: string;
  genome: Genome;
  care: number; // 0..100+, what a parent's condition and poise add up to
}

// Egg Show entries: each rival enters a clutch from its two best birds.
export function rivalEggEntries(state: GameState, rng: Rng): RivalEggEntry[] {
  return state.rivals.map((rival) => {
    const best = rivalBestGenome(rival);
    const other = rng.pick(rival.flock.filter((g) => g !== best).length > 0 ? rival.flock.filter((g) => g !== best) : rival.flock);
    const strength = rivalStrength(state, rival);
    const poise = rival.specialty === 'show' ? rival.training : rival.training * 0.4;
    return {
      breeder: rival.name,
      genome: breed(best, other, rng, 0),
      care: (45 + strength * 45) * (1 + (poise / 100) * 0.5),
    };
  });
}

// Grand Prix grid: one racer per rival (their best, drilled), and how sharp
// each one paddles.
export function rivalRacers(state: GameState): Array<{ duck: Duck; skill: number }> {
  return state.rivals.map((rival, i) => {
    const strength = rivalStrength(state, rival);
    const genome = rival.specialty === 'racing' ? rivalBestGenome(rival) : rival.flock[i % rival.flock.length];
    const duck = rivalDuck(rival, i, genome);
    return { duck, skill: 0.85 + strength * 0.4 + (rival.specialty === 'racing' ? 0.1 : 0) };
  });
}

// --- The hatching-egg market ---
// Rivals buy eggs from pairings that suit their programme. The offer is
// priced on the PARENTS (the family tree stamped on the egg) — never the
// egg's own hidden genes, so the bid can't leak what's inside the shell.

export const EGG_OFFER_THRESHOLD = 55; // parents' average fitness a rival needs
export const EGG_OFFER_SHARE = 0.35; // of projected adult value, plus quality
export const EGG_ABSORB_CHANCE = 0.5; // the rival folds the genome into its flock

export interface EggOffer {
  rivalId: string;
  rivalName: string;
  price: number;
  score: number; // the pairing's fit for that rival, 0–100
}

// Projected adult value from what the player can see: the parents' rarity
// (stamped at lay) and the visible pedigree (generation, purebred parents).
function projectedValue(egg: Duck): number {
  const rarity = egg.parentRarity ?? 0;
  const visiblePed = Math.min(6, egg.lineage?.gen ?? 0) + (isPureBredPair(egg) ? 1 : 0);
  return BALANCE.adultBasePrice * (1 + rarity * BALANCE.rarityMultiplier) * (1 + BALANCE.pedigreeMultiplier * visiblePed);
}

function isPureBredPair(egg: Duck): boolean {
  const l = egg.lineage;
  return Boolean(l?.sire && l.dam && breedKey(l.sire.genome) === breedKey(l.dam.genome));
}

// The best standing offer on a nest egg, if any rival wants it today.
export function rivalEggOffer(state: GameState, egg: Duck): EggOffer | null {
  if (egg.stage !== 'egg') return null;
  const l = egg.lineage;
  if (!l?.sire || !l.dam) return null; // a wild clutch has no pedigree to sell
  const day = dayOf(state.clock);
  let best: EggOffer | null = null;
  for (const rival of state.rivals) {
    if (rival.lastEggDay === day) continue; // one egg per rival per day
    const score = (fitness(rival.specialty, l.sire.genome) + fitness(rival.specialty, l.dam.genome)) / 2;
    if (score < EGG_OFFER_THRESHOLD) continue;
    const strength = rivalStrength(state, rival);
    const price = Math.round(projectedValue(egg) * (EGG_OFFER_SHARE + (score / 100) * 0.35) * (0.8 + strength * 0.4));
    if (!best || price > best.price) best = { rivalId: rival.id, rivalName: rival.name, price, score: Math.round(score) };
  }
  return best;
}

// The rival takes the egg — and, as often as not, your bloodline: the
// genome may replace the weakest bird in their flock. Coins now, a sharper
// Egg Show field later.
export function sellEggToRival(state: GameState, eggId: string, rng: Rng): boolean {
  const idx = state.ducks.findIndex((d) => d.id === eggId);
  if (idx < 0) return false;
  const egg = state.ducks[idx];
  const offer = rivalEggOffer(state, egg);
  if (!offer) return false;
  const rival = state.rivals.find((r) => r.id === offer.rivalId)!;
  rival.lastEggDay = dayOf(state.clock);
  state.money += offer.price;
  state.ducks.splice(idx, 1);
  state.stats.eggsSold += 1;
  noteSale(state, egg, offer.price);
  let kept = false;
  if (rng.chance(EGG_ABSORB_CHANCE)) {
    absorbGenome(rival, egg.genome);
    kept = true;
  }
  chronicle(state, 'sale', `${rival.name} bought a hatching egg from the ${egg.lineage?.dam?.name ?? '?'} × ${egg.lineage?.sire?.name ?? '?'} pairing for ${offer.price} coins.`);
  events.emit('toast', `${rival.name} paid ${offer.price} coins for the egg${kept ? ' — it will hatch on their pond' : ''}.`);
  events.emit('purchase');
  return true;
}

// Fold a genome into the rival's flock in place of its weakest bird.
export function absorbGenome(rival: Rival, genome: Genome): void {
  let weakest = 0;
  for (let i = 1; i < rival.flock.length; i += 1) {
    if (fitness(rival.specialty, rival.flock[i]) < fitness(rival.specialty, rival.flock[weakest])) weakest = i;
  }
  if (fitness(rival.specialty, genome) > fitness(rival.specialty, rival.flock[weakest])) {
    rival.flock[weakest] = JSON.parse(JSON.stringify(genome)) as Genome;
  }
}

// --- Stud service ---

export interface StudOffer {
  rivalId: string;
  drake: Duck; // synthetic, for the portrait and the Scope
  cost: number;
}

export function studOffers(state: GameState): StudOffer[] {
  return state.rivals.map((rival) => {
    const genome = rivalBestGenome(rival);
    const drake = rivalDuck(rival, 0, genome);
    drake.sex = 'M';
    const rarity = computePhenotype(genome).rarityScore;
    const cost = Math.round((BALANCE.studBase + rarity * BALANCE.studPerRarity) * (1 + rivalStrength(state, rival) * 0.5));
    return { rivalId: rival.id, drake, cost };
  });
}

// Hire a rival's drake for one clutch with a hen of yours. The courtship runs
// like any other; the sire is remembered on the egg's lineage by name.
export function hireStud(state: GameState, rivalId: string, henId: string): { ok: boolean; reason?: string } {
  const offer = studOffers(state).find((o) => o.rivalId === rivalId);
  const hen = state.ducks.find((d) => d.id === henId);
  if (!offer || !hen) return { ok: false, reason: 'No such hen or stud' };
  if (hen.sex !== 'F') return { ok: false, reason: 'A stud needs a hen' };
  const check = canBreedPair(hen, offer.drake);
  if (!check.ok) return check;
  if (eggsIncubating(state) + state.pendingClutches.length >= nestCapacity(state)) {
    return { ok: false, reason: 'The nest is full — sell or hatch some eggs first' };
  }
  if (state.money < offer.cost) return { ok: false, reason: `Need ${offer.cost} coins` };
  state.money -= offer.cost;
  state.pendingClutches.push({
    motherId: hen.id,
    fatherId: offer.drake.id,
    ticksRemaining: COURTSHIP_TICKS,
    stud: { rivalId, name: offer.drake.name, genome: offer.drake.genome },
  });
  hen.breedingCooldownTicks = BREEDING_COOLDOWN_TICKS;
  state.stats.clutchesStarted += 1;
  state.stats.studsUsed += 1;
  const rival = state.rivals.find((r) => r.id === rivalId);
  chronicle(state, 'sale', `${hen.name} was put to ${offer.drake.name}, ${rival?.name ?? 'a rival'}'s drake, for ${offer.cost} coins.`);
  events.emit('toast', `${offer.drake.name} arrives from ${rival?.name ?? 'the rival pond'} — ${hen.name} is courting.`);
  events.emit('purchase');
  return { ok: true };
}

// Rebuild a stud father for the nest from what the clutch remembers.
export function studFather(state: GameState, clutch: { fatherId: string; stud?: { rivalId: string; name: string; genome: Genome } }): Duck | undefined {
  if (!clutch.stud) return undefined;
  const rival = state.rivals.find((r) => r.id === clutch.stud!.rivalId);
  const duck = rival ? rivalDuck(rival, 0, clutch.stud.genome) : createDuck(createRng(1), { genome: clutch.stud.genome, stage: 'adult', pos: { x: 0, y: 0 }, name: clutch.stud.name, sex: 'M' });
  duck.id = clutch.fatherId;
  duck.name = clutch.stud.name;
  duck.sex = 'M';
  return duck;
}
