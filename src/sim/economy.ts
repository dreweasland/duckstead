import type { GameState } from '../state';
import type { Vec2 } from '../types';
import type { Duck } from './duck';
import { events } from '../events';
import { festivalToday } from './calendar';
import { isPureBred, pedigreeScore } from './pedigree';
import { generationOf } from './lineage';
import { chronicle } from './chronicle';
import { hasPerk } from './society';
import { heritagePondBonus } from './heritage';
import { TUNING } from './tuning';
import { plural } from '../text';
import { duckById } from '../state';

// Rates, chances and thresholds live in tuning.ts; re-exported here so the
// two tables are found together.
export { TUNING };

export const BALANCE = {
  startingMoney: 50,
  eggBasePrice: 8,
  henEggPrice: 4, // unfertilised basket eggs, per egg
  ducklingBasePrice: 25,
  adultBasePrice: 40,
  rarityMultiplier: 0.5, // price *= 1 + rarity * this
  pedigreeMultiplier: 0.08, // price *= 1 + pedigree * this
  autumnEggBonus: 1.25,
  feedRestore: TUNING.food.feedRestore,
  premiumFeedRestore: TUNING.food.premiumFeedRestore,
  premiumFeedHappiness: TUNING.food.premiumFeedHappiness,
  cleanRestore: 50,
  petHappiness: 15,
  petCooldownTicks: 600, // 1 game-hour
  medicineHealthRestore: 30,
  eggStartWarmth: 70,
  eggWarmthDecay: 10, // per game-hour (night ×0.3 like other needs)
  eggTuckWarmth: 40,
  eggTuckCooldownTicks: 600, // 1 game-hour
  eggWarmthSpeedMin: 0.5, // incubation speed at 0 warmth
  eggWarmthSpeedMax: 1.3, // ...and at 100 warmth
  eggClaimGraceTicks: 600, // a cracked egg hatches itself after 1 game-hour
  springViabilityBonus: 0.05,
  raceEntryFee: 5,
  racePrizes: [15, 6, 0, 0],
  raceHappiness: 6, // racing is fun
  raceHunger: 12, // ...and tiring
  // Drills pay pocket money, capped per day so they stay training, not a job.
  drillCoins: 3, // × drill quality
  drillCoinsDailyCap: 15,
  // The Winter Lights "full purse" wish pays the pond's best sale — to a point.
  winterFortuneCap: 400,
  // Basket eggs: the first dozen a day sell at full price, the rest cheaper.
  basketFullPriceEggs: 12,
  basketTaper: 0.6,
  // Stud service: a rival's drake for one clutch.
  studBase: 120,
  studPerRarity: 35,
  // Market Day's target: sell this much (by tier) to win the festival.
  marketTargetBase: 100,
  marketTargetPerTier: 80,
} as const;

export type UpgradeId =
  | 'feedingTrough'
  | 'nestingBox'
  | 'incubator'
  | 'pondExpansion'
  | 'pondFilter'
  | 'waterfall'
  | 'duckToy'
  | 'pedigreeScope'
  | 'trainingPerch'
  | 'reedBeds'
  | 'eggCooler'
  | 'brooderLamp'
  | 'feedSilo'
  | 'vetClinic'
  | 'bachelorPen'
  | 'bathHouse'
  | 'treatDispenser';

interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  maxLevel: number;
  costs: number[]; // cost per level
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'feedingTrough',
    name: 'Feeding Trough',
    description: 'Ducks feed themselves from it — pour regular feed in by clicking it.',
    maxLevel: 1,
    costs: [40],
  },
  {
    id: 'nestingBox',
    name: 'Nesting Box',
    description: '+2 eggs can incubate at once per level, and eggs lose warmth 25% slower.',
    maxLevel: 3,
    costs: [60, 150, 300],
  },
  {
    id: 'incubator',
    name: 'Incubator',
    description: 'Eggs hatch twice as fast, +15% viability.',
    maxLevel: 1,
    costs: [200],
  },
  {
    id: 'pondExpansion',
    name: 'Pond Expansion',
    description: '+4 duck capacity per level, bigger pond.',
    maxLevel: 3,
    costs: [100, 250, 500],
  },
  {
    id: 'pondFilter',
    name: 'Bog Filter',
    description: 'A planted gravel bed that keeps the pond clean — dirt builds half as fast.',
    maxLevel: 1,
    costs: [120],
  },
  {
    id: 'waterfall',
    name: 'Waterfall',
    description: 'Aerates the pond: dirt builds 30% slower, and swimming ducks gain happiness.',
    maxLevel: 1,
    costs: [250],
  },
  {
    id: 'duckToy',
    name: 'Floating Duck Toy',
    description: 'Flock happiness decays 25% slower.',
    maxLevel: 1,
    costs: [80],
  },
  {
    id: 'pedigreeScope',
    name: 'Pedigree Scope',
    description: 'Reveals exact genotypes on duck panels.',
    maxLevel: 1,
    costs: [150],
  },
  {
    id: 'bachelorPen',
    name: 'Bachelor Pen',
    description: 'A fenced paddock for surplus drakes: 3 ducks per level sit out of breeding without being sold.',
    maxLevel: 2,
    costs: [220, 550],
  },
  // --- Late-game sinks: scaling, functional, and priced for a full pond ---
  {
    id: 'reedBeds',
    name: 'Reed Beds',
    description: 'More to forage: +1 of every pickup on the grass per level, +2 loose hen eggs.',
    maxLevel: 3,
    costs: [300, 700, 1500],
  },
  {
    id: 'feedSilo',
    name: 'Feed Silo',
    description: 'Trough holds +20 per level and tops itself up from your feed at dawn.',
    maxLevel: 3,
    costs: [400, 900, 1800],
  },
  {
    id: 'eggCooler',
    name: 'Egg Cooler',
    description: 'Basket eggs fetch +25% per level.',
    maxLevel: 3,
    costs: [500, 1200, 3000],
  },
  {
    id: 'brooderLamp',
    name: 'Brooder Lamp',
    description: 'Ducklings and juveniles grow 20% faster per level and hatch happier.',
    maxLevel: 2,
    costs: [600, 1400],
  },
  {
    id: 'trainingPerch',
    name: 'Training Perch',
    description: '+1 training drill per duck per day, per level.',
    maxLevel: 3,
    costs: [800, 2000, 5000],
  },
  {
    id: 'vetClinic',
    name: 'Vet Clinic',
    description: 'Sickness and contagion halved; medicine restores +60 health.',
    maxLevel: 1,
    costs: [1500],
  },
  // The two chores that scale worst with a big flock get the silo treatment:
  // a structure that does the rounds for you as long as you keep it stocked.
  {
    id: 'bathHouse',
    name: 'Bath House',
    description: 'At dawn, scrubs every duck below 60% clean — one bar of soap each. Keep soap in stock.',
    maxLevel: 1,
    costs: [700],
  },
  {
    id: 'treatDispenser',
    name: 'Treat Dispenser',
    description: 'Each daytime hour, hands a treat from your stock to the gloomiest duck below 70% — its favourite first, once you have found it. +1 duck an hour per level.',
    maxLevel: 2,
    costs: [900, 2000],
  },
];

// Festival sponsorship: coins buy a tier on the next edition of a festival
// for one year — bigger purse, tougher field, more Society points.
export function sponsorCost(state: GameState, kind: string): number {
  const current = state.festivalWins[kind] ?? 0;
  return 1000 + current * 750;
}

export function sponsorFestival(state: GameState, kind: string): boolean {
  if (state.sponsored[kind]) return false;
  const cost = sponsorCost(state, kind);
  if (state.money < cost) return false;
  state.money -= cost;
  state.sponsored[kind] = true;
  events.emit('toast', `You are sponsoring this year's ${kind === 'eggShow' ? 'Egg Show' : kind === 'grandPrix' ? 'Grand Prix' : kind === 'marketDay' ? 'Market Day' : 'Winter Lights'}!`);
  events.emit('purchase');
  return true;
}

export interface ShopItemDef {
  id: 'feed' | 'premiumFeed' | 'peas' | 'worms' | 'berries' | 'medicine' | 'soap' | 'starterDuck';
  name: string;
  description: string;
  cost: number;
}

export const SHOP_ITEMS: ShopItemDef[] = [
  { id: 'feed', name: 'Feed ×10', description: '+40 hunger per pellet.', cost: 5 },
  {
    id: 'premiumFeed',
    name: 'Premium Feed ×10',
    description: '+60 hunger, +5 happiness per pellet.',
    cost: 15,
  },
  { id: 'peas', name: 'Peas ×10', description: 'A treat: +40 hunger, +2 happiness. Some ducks love them.', cost: 8 },
  { id: 'worms', name: 'Worms ×10', description: 'A treat: +45 hunger, +2 happiness. Some ducks love them.', cost: 10 },
  { id: 'berries', name: 'Berries ×10', description: 'A treat: +40 hunger, +3 happiness. Some ducks love them.', cost: 10 },
  { id: 'medicine', name: 'Medicine', description: 'Cures a sick duck, +30 health.', cost: 20 },
  { id: 'soap', name: 'Soap ×10', description: 'One bar scrubs one duck in the Bath House.', cost: 6 },
  {
    id: 'starterDuck',
    name: 'Adopt a Duck',
    description: 'A random adult duck with common genes.',
    cost: 50,
  },
];

export type DecorKind = 'lantern' | 'bench' | 'flowerBed' | 'gnome' | 'stringLights' | 'statue';

export interface DecorDef {
  kind: DecorKind;
  name: string;
  description: string;
  cost: number;
}

export const DECOR_ITEMS: DecorDef[] = [
  { kind: 'flowerBed', name: 'Flower Bed', description: 'A cheerful ring of blooms.', cost: 25 },
  { kind: 'lantern', name: 'Garden Lantern', description: 'Glows warmly after dark.', cost: 30 },
  { kind: 'bench', name: 'Wooden Bench', description: 'A quiet spot to watch the pond.', cost: 45 },
  { kind: 'gnome', name: 'Garden Gnome', description: 'He has seen things.', cost: 60 },
  {
    kind: 'stringLights',
    name: 'String Lights',
    description: 'A festive strand between two posts.',
    cost: 80,
  },
  {
    kind: 'statue',
    name: 'Champion Statue',
    description: 'A stone likeness of a prize duck. Society Patrons only.',
    cost: 400,
  },
];

export function upgradeLevel(state: GameState, id: UpgradeId): number {
  return state.upgrades[id] ?? 0;
}

export function nestCapacity(state: GameState): number {
  return 2 + upgradeLevel(state, 'nestingBox') * 2;
}

export function duckCapacity(state: GameState): number {
  // Beyond the pond-expansion sizes, the Society's Pondmaster perk and each
  // pond retirement (heritage) add a duck slot apiece — pond room stays
  // scarce at the 20 cap, so these are the late-game way to grow the flock.
  return 8 + upgradeLevel(state, 'pondExpansion') * 4 + (hasPerk(state, 'pondSlot') ? 1 : 0) + heritagePondBonus(state);
}

// Hatched ducks on the pond. Eggs and courting pairs belong to the nest (its
// own capacity), so an egg pipeline keeps running at a full pond — but a
// clutch that hatches over the limit overcrowds it (see `overcrowding`).
export function pondOccupancy(state: GameState): number {
  // Elders have earned their spot on the bank: they no longer count against
  // capacity, so there is never a reason to sell one just to free a slot.
  return state.ducks.filter((d) => d.stage !== 'egg' && d.stage !== 'elder').length;
}

export function pondHasRoom(state: GameState): boolean {
  return pondOccupancy(state) < duckCapacity(state);
}

// Ducks beyond capacity. Each one makes the flock a little more miserable and
// the water a little dirtier, and wild ducks won't visit — sell to fix.
export function overcrowding(state: GameState): number {
  return Math.max(0, pondOccupancy(state) - duckCapacity(state));
}

export function isOvercrowded(state: GameState): boolean {
  return overcrowding(state) > 0;
}

// Nesting boxes keep eggs warm: warmth drifts down 25% slower per level.
export function eggWarmthDecayScale(state: GameState): number {
  return 1 - upgradeLevel(state, 'nestingBox') * 0.25;
}

export function sellPrice(state: GameState, duck: Duck): number {
  // Market Day festival: everything sells at a premium.
  const festival = festivalToday(state.clock) === 'marketDay' ? 1.5 : 1;
  if (duck.stage === 'egg') {
    // An egg's own genes are secret until it hatches, so its price reads
    // only what the player can see: the parents' rarity (stamped at lay)
    // and the visible pedigree (generation, purebred parents). Eggs laid
    // before the stamp existed fall back to their own genes.
    const parentRarity = duck.parentRarity ?? duck.phenotype.rarityScore;
    const visiblePedigree = Math.min(6, generationOf(duck)) + (isPureBred(duck) ? 1 : 0);
    const eggRarity = (1 + parentRarity * BALANCE.rarityMultiplier) * (1 + BALANCE.pedigreeMultiplier * visiblePedigree);
    return Math.round(BALANCE.eggBasePrice * eggRarity * festival);
  }
  // Pedigree (generations, fixed genes, rare alleles, pure breeding) is
  // worth money: a gen-4 purebred sells for far more than a founder.
  const rarity = (1 + duck.phenotype.rarityScore * BALANCE.rarityMultiplier) * (1 + BALANCE.pedigreeMultiplier * pedigreeScore(duck));
  if (duck.stage === 'duckling' || duck.stage === 'juvenile') {
    return Math.round(BALANCE.ducklingBasePrice * rarity * festival);
  }
  return Math.round(BALANCE.adultBasePrice * rarity * festival);
}

// Consumables are discounted on Market Day.
export function consumableCost(state: GameState, item: ShopItemDef): number {
  const festival = festivalToday(state.clock) === 'marketDay' ? 0.8 : 1;
  return Math.round(item.cost * festival);
}

// Price per basket egg today: Market Day and autumn both lift it.
export function henEggPrice(state: GameState): number {
  const festival = festivalToday(state.clock) === 'marketDay' ? 1.5 : 1;
  const autumn = state.seasonCache === 'autumn' ? BALANCE.autumnEggBonus : 1;
  const golden = hasPerk(state, 'goldenBasket') ? 2 : 1;
  const cooler = 1 + upgradeLevel(state, 'eggCooler') * 0.25;
  return Math.round(BALANCE.henEggPrice * festival * autumn * golden * cooler);
}

// Sell the whole basket. Returns coins earned (0 if empty).
// What a basket of n eggs fetches: full price up to a dozen, tapered beyond.
export function basketValue(state: GameState, n: number): number {
  const price = henEggPrice(state);
  const full = Math.min(n, BALANCE.basketFullPriceEggs);
  const rest = Math.max(0, n - full);
  return Math.round(full * price + rest * price * BALANCE.basketTaper);
}

export function sellEggBasket(state: GameState): number {
  const n = state.inventory.eggs;
  if (n <= 0) return 0;
  const earned = basketValue(state, n);
  state.money += earned;
  state.inventory.eggs = 0;
  state.stats.henEggsSold += n;
  events.emit('toast', `Sold ${plural(n, 'egg')} for ${earned} coins`);
  return earned;
}

export function sellDuck(state: GameState, duckId: string): boolean {
  const idx = state.ducks.findIndex((d) => d.id === duckId);
  if (idx < 0) return false;
  const duck = state.ducks[idx];
  let price = sellPrice(state, duck);
  if (duck.stage === 'egg' && state.seasonCache === 'autumn') {
    price = Math.round(price * BALANCE.autumnEggBonus);
  }
  state.money += price;
  state.ducks.splice(idx, 1);
  if (duck.stage === 'egg') state.stats.eggsSold += 1;
  else state.stats.ducksSold += 1;
  noteSale(state, duck, price);
  events.emit('toast', `Sold ${duck.name} for ${price} coins`);
  return true;
}

// Record-keeping for any sale: biggest sale, and a chronicle line for a
// notable one (a purebred or a record).
export function noteSale(state: GameState, duck: Duck, price: number): void {
  if (price > state.stats.biggestSale) {
    state.stats.biggestSale = price;
    if (duck.stage !== 'egg' && price >= 120) {
      chronicle(state, 'sale', `${duck.name} sold for ${price} coins — the pond's biggest sale yet.`);
    }
  }
  if (duck.stage !== 'egg' && duck.friendId) {
    const friend = duckById(state, duck.friendId);
    if (friend) {
      chronicle(state, 'sale', `${friend.name} watched the cart take ${duck.name} away.`);
      friend.needs.happiness = Math.max(0, friend.needs.happiness - 8);
      delete friend.friendId;
    }
  }
}

// Buy and set down a decoration. The UI has already checked the spot; this
// is the spend, so it persists the placement like any other purchase.
export function placeDecoration(
  state: GameState,
  kind: DecorKind,
  pos: Vec2,
): { ok: true } | { ok: false; reason: string } {
  const def = DECOR_ITEMS.find((d) => d.kind === kind)!;
  if (state.money < def.cost) return { ok: false, reason: 'Not enough coins any more!' };
  state.money -= def.cost;
  state.decorations.push({ kind, pos: { x: pos.x, y: pos.y } });
  events.emit('purchase');
  return { ok: true };
}

export function buyUpgrade(state: GameState, id: UpgradeId): boolean {
  const def = UPGRADES.find((u) => u.id === id)!;
  const level = upgradeLevel(state, id);
  if (level >= def.maxLevel) return false;
  const cost = def.costs[level];
  if (state.money < cost) return false;
  state.money -= cost;
  state.upgrades[id] = level + 1;
  events.emit('toast', `Bought ${def.name}${def.maxLevel > 1 ? ` (level ${level + 1})` : ''}`);
  events.emit('purchase');
  return true;
}
