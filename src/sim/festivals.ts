// Seasonal festivals: one event on day 4 of every season, giving the
// calendar a beat to look forward to.
//   Spring  — Egg Show (submit an egg, judged on hidden genes + parent care)
//   Summer  — Derby Grand Prix (harder, richer race)
//   Autumn  — Market Day (sale prices ×1.5, shop consumables −20%)
//   Winter  — Winter Lights (lights over the pond, happiness decay paused)
import type { GameState } from '../state';
import { flock } from '../state';
import type { GameClock } from './time';
import { dayOf, dayOfSeason, seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { chronicle } from './chronicle';
import { addSocietyPoints } from './society';
import { breedStandard, standardMatch } from './standards';
import type { Duck } from './duck';

import { ordinal } from '../text';
import { poiseOf, TRAINING } from './training';
import { rivalEggEntries } from './rivals';
import { BALANCE } from './economy';

function ordinalWord(n: number): string {
  return ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] ?? ordinal(n);
}
import type { Season } from '../types';
import { events } from '../events';

export type FestivalKind = 'eggShow' | 'grandPrix' | 'marketDay' | 'winterLights';

export const FESTIVAL_DAY = 4; // of each 6-day season

const BY_SEASON: Record<Season, FestivalKind> = {
  spring: 'eggShow',
  summer: 'grandPrix',
  autumn: 'marketDay',
  winter: 'winterLights',
};

export const FESTIVAL_NAMES: Record<FestivalKind, string> = {
  eggShow: 'Spring Egg Show',
  grandPrix: 'Derby Grand Prix',
  marketDay: 'Market Day',
  winterLights: 'Winter Lights',
};

export function festivalToday(clock: GameClock): FestivalKind | null {
  return dayOfSeason(clock) === FESTIVAL_DAY ? BY_SEASON[seasonOf(clock)] : null;
}

export function upcomingFestival(clock: GameClock): { kind: FestivalKind; inDays: number } {
  const today = dayOfSeason(clock);
  if (today <= FESTIVAL_DAY) {
    return { kind: BY_SEASON[seasonOf(clock)], inDays: FESTIVAL_DAY - today };
  }
  // Next season's festival.
  const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  const next = seasons[(seasons.indexOf(seasonOf(clock)) + 1) % 4];
  return { kind: BY_SEASON[next], inDays: 6 - today + FESTIVAL_DAY };
}

// Evening: a festival that was never finished packs up at this hour.
export const FESTIVAL_PACKUP_HOUR = 20;

export function tickFestivals(state: GameState): void {
  const tickOfDay = state.clock.totalTicks % TICKS_PER_DAY;
  // Evening: a festival that was never finished packs up. This is what spends
  // a sponsorship (and closes a market left with buyers waiting), so a paid
  // tier can't hang around forever.
  if (tickOfDay === FESTIVAL_PACKUP_HOUR * TICKS_PER_HOUR) {
    const today = festivalToday(state.clock);
    if (today && !festivalEnteredToday(state, today)) {
      if (today === 'marketDay' && state.market?.day === dayOf(state.clock)) {
        closeMarket(state);
      } else {
        markFestivalEntered(state, today);
        events.emit('toast', `The ${FESTIVAL_NAMES[today]} has packed up for the year.`);
      }
    }
    return;
  }
  // Morning announcements only.
  if (tickOfDay !== 8 * TICKS_PER_HOUR) return;
  const today = festivalToday(state.clock);
  if (today) {
    events.emit('toast', `Today is the ${FESTIVAL_NAMES[today]}!`);
    return;
  }
  const { kind, inDays } = upcomingFestival(state.clock);
  if (inDays === 1) events.emit('toast', `Tomorrow: the ${FESTIVAL_NAMES[kind]}!`);
}

// One participation per festival occurrence, keyed by kind → day last done.
export function festivalEnteredToday(state: GameState, kind: FestivalKind): boolean {
  return state.festivalDone[kind] === dayOf(state.clock);
}

export function markFestivalEntered(state: GameState, kind: FestivalKind): void {
  state.festivalDone[kind] = dayOf(state.clock);
  // A sponsorship is spent by the edition it raised.
  delete state.sponsored[kind];
}

// --- Spring Egg Show ---

import type { Rng } from '../rng';
import type { Genome } from './genetics';
import { computePhenotype, LOCI, randomCommonGenome } from './genetics';
import { breedKey, breedLabel } from './breedBook';
// Circular with economy.ts (it imports festivalToday); safe because both
// sides are hoisted function declarations used only at call time.
import { sellPrice } from './economy';

export interface EggShowEntry {
  breeder: string; // 'You' for the player
  eggName: string;
  genome: Genome;
  breed: string; // revealed post-judging
  score: number;
  comment: string;
  isPlayer: boolean;
}

export interface EggShowResult {
  entries: EggShowEntry[]; // ranked, best first
  playerPlace: number; // 0-based
  prize: number;
}

export const EGG_SHOW_PRIZES = [40, 20, 10, 5, 5];

// Reputation tiers: win a festival and next year's edition is a bigger
// event — tougher field, bigger purse, more Society points.
export const FESTIVAL_TIER_NAMES = ['', 'County', 'Regional', 'National'];
export function festivalTier(state: GameState, kind: FestivalKind): number {
  return Math.min(3, (state.festivalWins[kind] ?? 0) + (state.sponsored[kind] ? 1 : 0));
}
export function festivalTitle(state: GameState, kind: FestivalKind): string {
  const tier = festivalTier(state, kind);
  return tier > 0 ? `${FESTIVAL_TIER_NAMES[tier]} ${FESTIVAL_NAMES[kind]}` : FESTIVAL_NAMES[kind];
}
export function festivalPurseScale(state: GameState, kind: FestivalKind): number {
  return 1 + festivalTier(state, kind) * 0.75;
}
function noteFestivalWin(state: GameState, kind: FestivalKind): void {
  state.festivalWins[kind] = (state.festivalWins[kind] ?? 0) + 1;
  state.stats.festivalWins += 1;
}
// For wins decided outside this module (the Grand Prix final runs in the UI).
export function noteFestivalWinPublic(state: GameState, kind: FestivalKind): void {
  noteFestivalWin(state, kind);
}

// Local entrants beyond the three rival ponds (see rivals.ts).
const RIVAL_BREEDERS = [
  'Ferryman Bram',
  'Duchess Plumage',
  'Tilly Two-Ponds',
];

const RIVAL_EGG_NAMES = ['Sunrise', 'Speckle', 'Hope', 'Biggie', 'Peanut', 'Treasure'];

// Judge commentary derived from what's actually in the genome.
function judgeComment(genome: Genome, rng: Rng): string {
  const p = computePhenotype(genome);
  const remarks: string[] = [];
  if (genome.baseColor.includes('B')) remarks.push('Is that a shimmer of blue under the shell?');
  if (genome.crest[0] === 'R' && genome.crest[1] === 'R')
    remarks.push('The candling lamp shows a promising little crest!');
  if (p.pattern === 'spotted') remarks.push('Lovely freckling on this line.');
  if (p.pattern === 'capped') remarks.push('A capped bloodline — classic.');
  if (genome.dilution[0] === 'd' && genome.dilution[1] === 'd')
    remarks.push('Such a delicate pastel pedigree.');
  if (genome.billColor.includes('P')) remarks.push('Rumors of a pink bill in this family…');
  if (p.vigor >= 0.75) remarks.push('A strong, steady heartbeat.');
  if (remarks.length === 0) {
    remarks.push(
      rng.pick([
        'A solid, honest egg.',
        'Well-shaped, nicely kept.',
        'A dependable barnyard line.',
        'Nothing flashy, but sound.',
      ]),
    );
  }
  return rng.pick(remarks);
}

// Judges weigh rarity, how close the egg's genes sit to its breed's show
// standard, and how well the parents were kept.
function scoreEgg(genome: Genome, care: number): number {
  const std = standardMatch({ genome } as Duck, breedKey(genome)).pct;
  return Math.round(computePhenotype(genome).rarityScore * 4 + std * 0.5 + care / 4);
}

// A rival egg that keeps pace with the player: built from a breed standard
// the player has already shown they can reach, with a few loci scrambled.
// Higher tiers scramble less.
function rivalGenome(state: GameState, rng: Rng, tier: number, favourite: boolean): Genome {
  const known = Object.keys(state.breedBook);
  if (known.length === 0 || (!favourite && rng.chance(0.4))) return randomCommonGenome(rng);
  const key = rng.pick(known);
  const g = breedStandard(key);
  const scramble = Math.max(0, (favourite ? 2 : 4) - tier);
  for (let i = 0; i < scramble; i += 1) {
    const def = rng.pick(LOCI);
    g[def.id] = [rng.pick(def.alleles), rng.pick(def.alleles)];
  }
  return g;
}

// --- Autumn Market Day: visiting buyers you can haggle with ---

export interface MarketBuyer {
  name: string;
  quote: string;
  duckId: string;
  duckName: string;
  offer: number;
  haggled: boolean; // one haggle attempt per buyer
}

const MARKET_BUYERS = [
  'A miller with deep pockets',
  'A fancier from the city',
  'A farmer restocking her pond',
  'A traveling showman',
  'An eccentric egg collector',
];

const MARKET_QUOTES = [
  '“Now THAT is a duck. Name your… no wait, here is MY price:”',
  '“I have been watching this one all morning.”',
  '“My pond needs exactly this bird.”',
  '“A fine specimen. I shall be reasonable. Ish.”',
];

export const HAGGLE_BONUS = 0.25;
export const HAGGLE_SUCCESS = 0.55;

// Up to three buyers, each smitten with a specific duck from the flock.
export function generateMarketBuyers(state: GameState, rng: Rng): MarketBuyer[] {
  if (festivalToday(state.clock) !== 'marketDay') return [];
  const candidates = flock(state);
  const buyers: MarketBuyer[] = [];
  const names = [...MARKET_BUYERS];
  const pool = [...candidates];
  while (buyers.length < 3 && pool.length > 0) {
    const duck = pool.splice(rng.int(pool.length), 1)[0];
    buyers.push({
      name: names.splice(rng.int(names.length), 1)[0],
      quote: rng.pick(MARKET_QUOTES),
      duckId: duck.id,
      duckName: duck.name,
      // sellPrice already includes the Market Day 1.5x — buyers open above it.
      offer: Math.round(sellPrice(state, duck) * (1.1 + rng.next() * 0.35) * festivalPurseScale(state, 'marketDay')),
      haggled: false,
    });
  }
  return buyers;
}

// Push for more: succeeds slightly more often than not, but a scoffed buyer
// walks away entirely.
export function marketHaggle(buyer: MarketBuyer, rng: Rng): boolean {
  buyer.haggled = true;
  if (rng.chance(HAGGLE_SUCCESS)) {
    buyer.offer = Math.round(buyer.offer * (1 + HAGGLE_BONUS));
    return true;
  }
  return false;
}

// Market Day is won by selling: the target rises with the festival's tier.
export function marketTarget(state: GameState): number {
  return BALANCE.marketTargetBase + festivalTier(state, 'marketDay') * BALANCE.marketTargetPerTier;
}

export interface MarketClose {
  sold: number;
  earned: number;
  target: number;
  won: boolean;
}

// The stalls pack up: the day is entered (spending any sponsorship), and a
// sale total past the target wins the festival. Null if there's no market
// today or it's already closed.
export function closeMarket(state: GameState, rng?: Rng): MarketClose | null {
  void rng;
  if (!state.market || state.market.day !== dayOf(state.clock)) return null;
  if (festivalEnteredToday(state, 'marketDay')) return null;
  const { sold, earned } = state.market;
  const target = marketTarget(state);
  const won = earned >= target;
  const title = festivalTitle(state, 'marketDay');
  const scale = festivalPurseScale(state, 'marketDay');
  markFestivalEntered(state, 'marketDay');
  state.market.buyers = [];
  if (won) {
    noteFestivalWin(state, 'marketDay');
    addSocietyPoints(state, Math.round(4 * scale));
    chronicle(state, 'festival', `${title}: ${earned} coins taken at the stall — the best trade of the fair.`);
    events.emit('toast', `Market Day won — ${earned} coins against a target of ${target}! (+${Math.round(4 * scale)} Society)`);
  } else if (sold > 0) {
    chronicle(state, 'festival', `${title}: ${sold} duck${sold === 1 ? '' : 's'} sold for ${earned} coins.`);
  }
  return { sold, earned, target, won };
}

export function marketSell(state: GameState, buyer: MarketBuyer): boolean {
  const idx = state.ducks.findIndex((d) => d.id === buyer.duckId);
  if (idx < 0) return false;
  if (state.market) {
    state.market.sold += 1;
    state.market.earned += buyer.offer;
  }
  state.money += buyer.offer;
  state.ducks.splice(idx, 1);
  state.stats.ducksSold += 1;
  events.emit('toast', `Sold ${buyer.duckName} for ${buyer.offer} coins!`);
  return true;
}

// --- Winter Lights: the lantern ceremony ---

export const LANTERN_WISHES = [
  'For warm nests…',
  'For strong hatchlings…',
  'For clear water…',
  'For rare feathers…',
  'For old friends…',
];

export interface CeremonyReward {
  coins: number;
  premiumFeed: number;
  wish: WinterWish;
  wishText: string;
  // The lantern parade: how the pond looked under the lights, against the
  // tier's bar. Absent on rewards saved before the parade existed.
  parade?: { score: number; target: number; won: boolean };
}

// The parade is judged on the pond itself: decorations, the flock's poise,
// and its cheer. Out of ~100.
export function winterParadeScore(state: GameState): number {
  const adults = flock(state).filter((d) => d.stage !== 'duckling');
  const avg = (f: (d: Duck) => number) => (adults.length > 0 ? adults.reduce((s, d) => s + f(d), 0) / adults.length : 0);
  const decor = Math.min(6, state.decorations.length) * 8;
  const poise = avg((d) => poiseOf(d)) * 0.3;
  const cheer = avg((d) => d.needs.happiness) * 0.3;
  return Math.round(decor + poise + cheer);
}

export function winterParadeTarget(state: GameState): number {
  return 45 + festivalTier(state, 'winterLights') * 15;
}

export type WinterWish = 'lure' | 'society' | 'fortune';
export const WINTER_WISHES: Array<{ id: WinterWish; label: string; blurb: string }> = [
  { id: 'lure', label: 'A stranger on the wind', blurb: 'A remarkable wild duck arrives tomorrow, bearing the best it can.' },
  { id: 'society', label: 'Good standing', blurb: '+8 Society points.' },
  { id: 'fortune', label: 'A full purse', blurb: `Coins equal to your pond's best-ever sale (at least 60, capped).` },
];

// The finale after all lanterns are lit: the flock gathers, spirits soar,
// and the last wish is the player's to choose.
export function winterCeremonyFinale(state: GameState, wish: WinterWish = 'fortune'): CeremonyReward | null {
  if (festivalToday(state.clock) !== 'winterLights') return null;
  if (festivalEnteredToday(state, 'winterLights')) return null;
  for (const duck of state.ducks) {
    if (duck.stage === 'egg') continue;
    duck.needs.happiness = Math.min(100, duck.needs.happiness + 12);
  }
  const reward: CeremonyReward = { coins: 15, premiumFeed: 2, wish, wishText: '' };
  const score = winterParadeScore(state);
  const target = winterParadeTarget(state);
  reward.parade = { score, target, won: score >= target };
  if (wish === 'lure') {
    state.visitorLure = true;
    reward.wishText = 'Something stirs in the reeds to the north. Tomorrow, then.';
  } else if (wish === 'society') {
    addSocietyPoints(state, 8);
    reward.wishText = 'Word of your pond reaches the Society. +8 points.';
  } else {
    const purse = Math.min(BALANCE.winterFortuneCap, Math.max(60, state.stats.biggestSale));
    reward.coins += purse;
    reward.wishText = `A purse is found under the lantern post: ${purse} coins.`;
  }
  state.money += reward.coins;
  state.inventory.premiumFeed += reward.premiumFeed;
  const title = festivalTitle(state, 'winterLights');
  if (reward.parade.won) {
    const scale = festivalPurseScale(state, 'winterLights');
    noteFestivalWin(state, 'winterLights');
    addSocietyPoints(state, Math.round(4 * scale));
    chronicle(state, 'festival', `${title}: the lantern parade scored ${score} — the finest pond on the water.`);
  }
  chronicle(state, 'festival', `At Winter Lights the pond wished for ${WINTER_WISHES.find((w) => w.id === wish)?.label.toLowerCase()}.`);
  markFestivalEntered(state, 'winterLights');
  events.emit('toast', 'The whole flock gathers beneath the lights…');
  return reward;
}

// Run the whole show: build a rival field, judge everyone, pay by placement.
export function runEggShow(state: GameState, eggId: string, rng: Rng): EggShowResult | null {
  if (festivalToday(state.clock) !== 'eggShow') return null;
  if (festivalEnteredToday(state, 'eggShow')) return null;
  const egg = state.ducks.find((d) => d.id === eggId && d.stage === 'egg');
  if (!egg) return null;

  // Player entry: hidden genes + parental condition.
  let parentCare = 60;
  if (egg.parents) {
    const parents = egg.parents
      .map((id) => state.ducks.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
    // Poise: a well-drilled parent carries itself before the judges.
    if (parents.length > 0) {
      parentCare =
        parents.reduce((sum, p) => sum + ((p.needs.happiness + p.needs.health) / 2) * (1 + (poiseOf(p) / TRAINING.max) * TRAINING.poiseCare), 0) /
        parents.length;
    }
  }
  const entries: EggShowEntry[] = [
    {
      breeder: 'You',
      eggName: egg.name === 'Egg' ? 'Your egg' : egg.name,
      genome: egg.genome,
      breed: breedLabel(breedKey(egg.genome)),
      score: scoreEgg(egg.genome, parentCare),
      comment: judgeComment(egg.genome, rng),
      isPlayer: true,
    },
  ];

  // The three rival ponds each enter a clutch from their own flocks (they
  // get stronger every year), plus one local entrant scaled to the player's
  // Book — the favourite when the Book is still empty.
  const tier = festivalTier(state, 'eggShow');
  for (const r of rivalEggEntries(state, rng)) {
    entries.push({
      breeder: r.breeder,
      eggName: rng.pick(RIVAL_EGG_NAMES),
      genome: r.genome,
      breed: breedLabel(breedKey(r.genome)),
      score: scoreEgg(r.genome, r.care * (1 + tier * 0.05)),
      comment: judgeComment(r.genome, rng),
      isPlayer: false,
    });
  }
  {
    const genome = rivalGenome(state, rng, tier, true);
    if (Object.keys(state.breedBook).length === 0) {
      const flourish = rng.int(3);
      if (flourish === 0) genome.pattern = ['p', 'p'];
      else if (flourish === 1) genome.dilution = ['d', 'd'];
      else genome.crest = ['R', 'R'];
    }
    entries.push({
      breeder: rng.pick(RIVAL_BREEDERS),
      eggName: rng.pick(RIVAL_EGG_NAMES),
      genome,
      breed: breedLabel(breedKey(genome)),
      score: scoreEgg(genome, 40 + rng.next() * 55),
      comment: judgeComment(genome, rng),
      isPlayer: false,
    });
  }

  entries.sort((a, b) => b.score - a.score);
  const playerPlace = entries.findIndex((e) => e.isPlayer);
  const scale = festivalPurseScale(state, 'eggShow');
  const title = festivalTitle(state, 'eggShow');
  const prize = Math.round((EGG_SHOW_PRIZES[playerPlace] ?? 0) * scale);
  state.money += prize;
  markFestivalEntered(state, 'eggShow');
  if (playerPlace <= 1) addSocietyPoints(state, Math.round((playerPlace === 0 ? 6 : 3) * scale));
  if (playerPlace === 0) {
    chronicle(state, 'festival', `An egg from this pond took first at the ${title}.`);
    noteFestivalWin(state, 'eggShow');
  } else {
    chronicle(state, 'festival', `The pond placed ${ordinalWord(playerPlace + 1)} at the ${title}.`);
  }
  return { entries, playerPlace, prize };
}
