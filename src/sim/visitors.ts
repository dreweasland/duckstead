// Visitors: (1) legacy buyer requests (superseded by the Commissions Board) and
// premium, and (2) rare wild ducks drawn to a well-kept pond, recruitable
// with premium-feed treats — the non-grind faucet for rare alleles.
import type { GameState } from '../state';
import { flock } from '../state';
import type { Rng } from '../rng';
import type { Duck } from './duck';
import { createDuck, DUCK_NAMES, freshName } from './duck';
import { recordBreed } from './breedBook';
import { isOvercrowded, noteSale, pondHasRoom, sellPrice } from './economy';
import { chronicle } from './chronicle';
import { events } from '../events';
import { expressedAlleles, randomCommonGenome, type Genome } from './genetics';
import { pondGeometry } from './pond';
import { dayOf, seasonOf, TICKS_PER_DAY, TICKS_PER_HOUR } from './time';
import { ALL_BREED_KEYS } from './breedBook';
import { breedStandard } from './standards';
import { LOCI } from './genetics';
import { hasPerk } from './society';

export interface BuyerRequest {
  wants: { pattern?: 'solid' | 'spotted' | 'capped'; colorKey?: string; crested?: boolean };
  multiplier: number;
  expiresDay: number;
}

export interface WildVisitor {
  duck: Duck;
  treatsGiven: number;
  expiresDay: number;
  // Fly-in: ticks of flight remaining before it lands at duck.pos. The
  // renderer draws it along the approach path while this is > 0.
  flyTicksLeft?: number;
  // Which side of the pond it came from (-1 left, +1 right).
  side?: -1 | 1;
}

export const VISITOR_FLY_TICKS = 45; // 4.5 real seconds at 1×

// Where the visitor is drawn mid-flight: a long glide in from the side,
// cresting a little before the final flare onto the bank. p is 0..1.
export function visitorFlightPos(visitor: WildVisitor, p: number): { x: number; y: number; height: number } {
  const land = visitor.duck.pos;
  const side = visitor.side ?? 1;
  const ease = 1 - (1 - p) * (1 - p); // ease-out: fast entry, gentle landing
  const x = land.x + side * 520 * (1 - ease);
  const height = 240 * (1 - ease) + Math.sin(p * Math.PI) * 30;
  return { x, y: land.y - height, height };
}

export function visitorInFlight(visitor: WildVisitor): boolean {
  return (visitor.flyTicksLeft ?? 0) > 0;
}

export const TREATS_TO_RECRUIT = 3;
export const VISITOR_CLICK_RADIUS = 30;

function colorKeyOf(genome: Genome): string {
  return [...expressedAlleles(genome, 'baseColor')].sort().join('+');
}

export function tickVisitors(state: GameState, rng: Rng): void {
  const day = dayOf(state.clock);

  // Fly-in progress; touch down into a shake-off, then settle.
  if (state.visitor && visitorInFlight(state.visitor)) {
    state.visitor.flyTicksLeft! -= 1;
    if (state.visitor.flyTicksLeft === 0) state.visitor.duck.activity = 'shake';
  } else if (state.visitor && state.visitor.duck.activity === 'shake') {
    state.visitor.duck.activityTimer += 1;
    if (state.visitor.duck.activityTimer > 14) {
      state.visitor.duck.activity = 'idle';
      state.visitor.duck.activityTimer = 0;
    }
  }

  // Expire stale request / visitor.
  if (state.request && day > state.request.expiresDay) state.request = null;
  if (state.visitor && day > state.visitor.expiresDay) {
    events.emit('toast', `${state.visitor.duck.name} flew off to other ponds…`);
    state.visitor = null;
  }

  // 09:00 — a buyer may post a request: a time-limited price premium on any
  // MATCHING duck already on the pond. Deliberately coexists with the
  // Commissions Board — commissions are bespoke bred-to-order contracts,
  // requests are the "hot market" counterpart that rewards the flock you
  // already have. (The roll was dropped during the board's introduction and
  // the rest of the feature sat dormant; reconnected 2026-08-28.)
  if (state.clock.totalTicks % TICKS_PER_DAY === 9 * TICKS_PER_HOUR) {
    if (!state.request && rng.chance(0.35)) {
      state.request = makeRequest(rng, day, state);
      const want = describeRequest(state.request);
      events.emit(
        'toast',
        `A buyer is asking after ${want.endsWith('duck') ? want : `a ${want} duck`} — ${state.request.multiplier}\u00d7 the usual price for two days!`,
      );
    }
  }

  // 10:00 — a wild duck may drop by if the pond is inviting.
  if (state.clock.totalTicks % TICKS_PER_DAY === 10 * TICKS_PER_HOUR) {
    const active = flock(state);
    const avgHappy =
      active.length > 0 ? active.reduce((sum, d) => sum + d.needs.happiness, 0) / active.length : 0;
    // Decorations make the pond easier to fall for.
    const charm = Math.min(state.decorations.length, 5) * 3;
    const inviting = state.pond.cleanliness > 70 - charm && avgHappy > 60 - charm && !isOvercrowded(state);
    // The very first wild duck is guaranteed on day 2 so a fresh flock gets a
    // rare gene to breed toward before the Breed Book looks like a mirage.
    const firstVisit = state.stats.wildVisits === 0 && day >= 1;
    // Once the flock holds all three rare genes, visitors become rarer events.
    const chance = flockHasAllRare(state) ? 0.2 : 0.35;
    if (!state.visitor && (firstVisit || state.visitorLure || (inviting && rng.chance(chance)))) {
      state.visitor = makeWildVisitor(state, rng, day);
      state.visitorLure = false;
      state.stats.wildVisits += 1;
      events.emit('toast', `A wild duck is visiting your pond — it looks unusual! Offer premium treats to befriend it.`);
    }
  }
}

export function makeRequest(rng: Rng, day: number, state?: GameState): BuyerRequest {
  const wants: BuyerRequest['wants'] = {};
  wants.pattern = rng.pick(['solid', 'spotted', 'capped'] as const);
  // Blue joins the buyers' vocabulary once it exists on the pond.
  const hasBlue = state?.ducks.some((d) => d.genome.baseColor.includes('B')) ?? false;
  if (rng.chance(0.5)) wants.colorKey = rng.pick(hasBlue ? ['M', 'W', 'k', 'B', 'B+M'] : ['M', 'W', 'k']);
  if (rng.chance(0.15)) wants.crested = true;
  return {
    wants,
    multiplier: Math.round((2.5 + rng.next() * 0.5) * 10) / 10,
    expiresDay: day + 2,
  };
}

function flockHasAllRare(state: GameState): boolean {
  const g = flock(state).map((d) => d.genome);
  return g.some((x) => x.baseColor.includes('B')) && g.some((x) => x.billColor.includes('P')) && g.some((x) => x.crest[0] === 'R' && x.crest[1] === 'R');
}

// What a wild duck brings depends on the pond's standing:
//   tier 1 — one rare gene (always)
//   tier 2 (Society rank ≥ 5) — the rare gene comes as a true-breeding pair
//   tier 3 (rank ≥ 10) — a chance of a near-standard duck for a breed the
//            Book lacks; in winter, the only source of pink bill + crest together
// The Host perk adds a second gift; a Winter Lights lure brings the best.
export function visitorTier(state: GameState): number {
  return state.society.rank >= 10 ? 3 : state.society.rank >= 5 ? 2 : 1;
}

function giftGenome(state: GameState, rng: Rng, lured: boolean): Genome {
  const tier = lured ? 3 : visitorTier(state);
  const winter = seasonOf(state.clock) === 'winter';
  if (tier >= 3 && (lured || rng.chance(0.3))) {
    const missing = ALL_BREED_KEYS.filter((k) => !state.breedBook[k]);
    if (missing.length > 0) {
      const g = breedStandard(rng.pick(missing));
      const def = rng.pick(LOCI);
      g[def.id] = [rng.pick(def.alleles), rng.pick(def.alleles)];
      return g;
    }
  }
  const genome = randomCommonGenome(rng);
  const gifts = 1 + (hasPerk(state, 'visitorGift') ? 1 : 0) + (winter && tier >= 3 ? 1 : 0);
  const pool: Array<(g: Genome) => void> = [
    (g) => { g.baseColor = tier >= 2 ? ['B', 'B'] : ['B', rng.pick(['B', 'M', 'W'])]; },
    (g) => { g.billColor = tier >= 2 ? ['P', 'P'] : ['P', rng.pick(['O', 'y'])]; },
    (g) => { g.crest = ['R', 'R']; },
  ];
  const order = [0, 1, 2].sort(() => rng.next() - 0.5);
  for (let i = 0; i < Math.min(gifts, 3); i += 1) pool[order[i]](genome);
  return genome;
}

function makeWildVisitor(state: GameState, rng: Rng, day: number): WildVisitor {
  const genome = giftGenome(state, rng, state.visitorLure);

  // Land on the left or right bank at pond height — never the bottom strip,
  // which the card rail covers on screen.
  const g = pondGeometry(state);
  const side = rng.chance(0.5) ? -1 : 1;
  const duck = createDuck(rng, {
    genome,
    stage: 'adult',
    pos: { x: g.cx + side * (g.rx + 60), y: g.cy - 30 + rng.range(-25, 25) },
  });
  duck.name = freshName(rng, state.ducks.map((d) => d.name), DUCK_NAMES);
  duck.activity = 'flap';
  duck.heading = side < 0 ? 0 : Math.PI; // face the pond
  duck.bornDay = day;
  return { duck, treatsGiven: 0, expiresDay: day + 1, flyTicksLeft: VISITOR_FLY_TICKS, side };
}

export function matchesRequest(duck: Duck, request: BuyerRequest): boolean {
  if (duck.stage === 'egg') return false;
  const { wants } = request;
  if (wants.pattern && duck.phenotype.pattern !== wants.pattern) return false;
  if (wants.colorKey && colorKeyOf(duck.genome) !== wants.colorKey) return false;
  if (wants.crested && !duck.phenotype.crested) return false;
  return true;
}

export function requestPrice(state: GameState, duck: Duck): number {
  if (!state.request) return 0;
  return Math.round(sellPrice(state, duck) * state.request.multiplier);
}

export function sellToBuyer(state: GameState, duckId: string): boolean {
  const idx = state.ducks.findIndex((d) => d.id === duckId);
  if (idx < 0 || !state.request) return false;
  const duck = state.ducks[idx];
  if (!matchesRequest(duck, state.request)) return false;
  const price = requestPrice(state, duck);
  state.money += price;
  state.ducks.splice(idx, 1);
  state.stats.ducksSold += 1;
  noteSale(state, duck, price);
  state.request = null;
  events.emit('toast', `The buyer happily paid ${price} coins for ${duck.name}!`);
  return true;
}

export function describeRequest(request: BuyerRequest): string {
  const parts: string[] = [];
  if (request.wants.crested) parts.push('crested');
  if (request.wants.pattern && request.wants.pattern !== 'solid') parts.push(request.wants.pattern);
  if (request.wants.pattern === 'solid') parts.push('solid');
  if (request.wants.colorKey) {
    parts.push(
      { M: 'mallard', W: 'white', k: 'black', B: 'blue', 'B+M': 'blue-mallard' }[request.wants.colorKey] ?? request.wants.colorKey,
    );
  }
  return parts.join(' ') || 'any duck';
}

// Give the visiting wild duck a premium treat; recruits it on the third.
export function treatVisitor(state: GameState): 'no-visitor' | 'landing' | 'no-feed' | 'fed' | 'joined' | 'full' {
  const visitor = state.visitor;
  if (!visitor) return 'no-visitor';
  if (visitorInFlight(visitor)) return 'landing';
  if (state.inventory.premiumFeed <= 0) return 'no-feed';
  state.inventory.premiumFeed -= 1;
  visitor.treatsGiven += 1;
  if (visitor.treatsGiven < TREATS_TO_RECRUIT) {
    events.emit('toast', `${visitor.duck.name} gobbles the treat (${visitor.treatsGiven}/${TREATS_TO_RECRUIT})`);
    return 'fed';
  }
  if (!pondHasRoom(state)) {
    visitor.treatsGiven = TREATS_TO_RECRUIT - 1; // stays hopeful; make room
    events.emit('toast', 'It wants to stay, but the pond is at capacity!');
    return 'full';
  }
  state.ducks.push(visitor.duck);
  state.stats.wildRecruited += 1;
  chronicle(state, 'visitor', `${visitor.duck.name}, a wild duck, chose to stay.`);
  recordBreed(state, visitor.duck);
  events.emit('toast', `${visitor.duck.name} joined your flock!`);
  state.visitor = null;
  return 'joined';
}
