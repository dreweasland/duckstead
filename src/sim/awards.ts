// The Breed Book award ladder: every breed has three tiers past "hatched".
//   Pure     — hatched from two parents of the same breed
//   Standard — a living duck matching the breed standard at 90%+
//   Master   — five of the breed alive at once
// Each pays coins (scaled by the breed's rarity) and Society points.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { events } from '../events';
import { breedKey, breedLabel, representativeGenome } from './breedBook';
import { computePhenotype } from './genetics';
import { isPureBred } from './pedigree';
import { standardMatch, STANDARD_THRESHOLD } from './standards';
import { chronicle } from './chronicle';
import { dayOf, TICKS_PER_HOUR } from './time';
import { addSocietyPoints } from './society';

export type AwardTier = 'pure' | 'standard' | 'master';
export const AWARD_TIERS: AwardTier[] = ['pure', 'standard', 'master'];
export const AWARD_LABELS: Record<AwardTier, string> = { pure: 'Pure', standard: 'Standard', master: 'Master' };
export const AWARD_COINS: Record<AwardTier, number> = { pure: 20, standard: 40, master: 80 };
export const AWARD_POINTS: Record<AwardTier, number> = { pure: 2, standard: 4, master: 8 };
export const MASTER_COUNT = 5;

export type BreedAwards = Partial<Record<AwardTier, number>>; // tier → day earned

function grant(state: GameState, key: string, tier: AwardTier, who?: string): void {
  const awards = (state.awards[key] ??= {});
  if (awards[tier] !== undefined) return;
  awards[tier] = dayOf(state.clock);
  const rarity = computePhenotype(representativeGenome(key)).rarityScore;
  const coins = Math.round(AWARD_COINS[tier] * (1 + rarity / 4));
  state.money += coins;
  addSocietyPoints(state, AWARD_POINTS[tier]);
  const label = breedLabel(key);
  const text =
    tier === 'pure'
      ? `${who ?? 'A duckling'} hatched purebred — the first Pure ${label}.`
      : tier === 'standard'
        ? `${who ?? 'A duck'} met the ${label} show standard.`
        : `Five ${label}s on the pond at once — Master of the breed.`;
  chronicle(state, 'award', text);
  events.emit('toast', `${AWARD_LABELS[tier]} ${label}! +${coins} coins, +${AWARD_POINTS[tier]} Society`);
}

// On hatch: Pure is decided by parentage.
export function checkHatchAwards(state: GameState, duck: Duck): void {
  if (isPureBred(duck)) grant(state, breedKey(duck.genome), 'pure', duck.name);
}

// Hourly: Standard and Master depend on the living flock.
export function tickAwards(state: GameState): void {
  if (state.clock.totalTicks % TICKS_PER_HOUR !== 0) return;
  const living = state.ducks.filter((d) => d.stage !== 'egg' && d.stage !== 'duckling');
  const counts = new Map<string, number>();
  for (const duck of living) {
    const key = breedKey(duck.genome);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!state.awards[key]?.standard && standardMatch(duck, key).pct >= STANDARD_THRESHOLD) {
      grant(state, key, 'standard', duck.name);
    }
  }
  for (const [key, n] of counts) if (n >= MASTER_COUNT) grant(state, key, 'master');
}

export function awardCount(state: GameState): number {
  let n = 0;
  for (const a of Object.values(state.awards)) n += Object.keys(a).length;
  return n;
}
