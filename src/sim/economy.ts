import type { GameState } from '../state';
import type { Duck } from './duck';
import { events } from '../events';
import { festivalToday } from './festivals';
import { pedigreeScore } from './pedigree';
import { chronicle } from './chronicle';
import { hasPerk } from './society';

export const BALANCE = {
  startingMoney: 50,
  eggBasePrice: 8,
  henEggPrice: 4, // unfertilised basket eggs, per egg
  ducklingBasePrice: 25,
  adultBasePrice: 40,
  rarityMultiplier: 0.5, // price *= 1 + rarity * this
  pedigreeMultiplier: 0.08, // price *= 1 + pedigree * this
  autumnEggBonus: 1.25,
  feedRestore: 40,
  premiumFeedRestore: 60,
  premiumFeedHappiness: 5,
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
  | 'bachelorPen';

export interface UpgradeDef {
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
    description: 'Your racers run 4% faster per level.',
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
  id: 'feed' | 'premiumFeed' | 'peas' | 'worms' | 'berries' | 'medicine' | 'starterDuck';
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

// Decorations make the pond nicer to live at (and lure wild visitors).
export function decorCount(state: GameState): number {
  return state.decorations.length;
}

export function upgradeLevel(state: GameState, id: UpgradeId): number {
  return state.upgrades[id] ?? 0;
}

export function nestCapacity(state: GameState): number {
  return 2 + upgradeLevel(state, 'nestingBox') * 2 + (hasPerk(state, 'nestSlot') ? 1 : 0) + Math.min(5, state.heritage);
}

export function duckCapacity(state: GameState): number {
  return 8 + upgradeLevel(state, 'pondExpansion') * 4;
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
  // Pedigree (generations, fixed genes, rare alleles, pure breeding) is
  // worth money: a gen-4 purebred sells for far more than a founder.
  const rarity = (1 + duck.phenotype.rarityScore * BALANCE.rarityMultiplier) * (1 + BALANCE.pedigreeMultiplier * pedigreeScore(duck));
  // Market Day festival: everything sells at a premium.
  const festival = festivalToday(state.clock) === 'marketDay' ? 1.5 : 1;
  if (duck.stage === 'egg') {
    // Egg rarity is unknown to the player; price on the average of the
    // parents' phenotype isn't stored, so use the egg's own hidden genes.
    return Math.round(BALANCE.eggBasePrice * rarity * festival);
  }
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
export function sellEggBasket(state: GameState): number {
  const n = state.inventory.eggs;
  if (n <= 0) return 0;
  const earned = n * henEggPrice(state);
  state.money += earned;
  state.inventory.eggs = 0;
  state.stats.henEggsSold += n;
  events.emit('toast', `Sold ${n} egg${n === 1 ? '' : 's'} for ${earned} coins`);
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
    const friend = state.ducks.find((d) => d.id === duck.friendId);
    if (friend) {
      chronicle(state, 'sale', `${friend.name} watched the cart take ${duck.name} away.`);
      friend.needs.happiness = Math.max(0, friend.needs.happiness - 8);
      delete friend.friendId;
    }
  }
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
