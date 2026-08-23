// The derby league: daily races sit in a tier with its own purse, field
// strength and entry rule. Three net wins promote; three net losses relegate.
// Keeps the daily race a payoff that grows with the stable.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { breedKey } from './breedBook';
import { standardMatch } from './standards';
import { chronicle } from './chronicle';
import { addSocietyPoints } from './society';
import { events } from '../events';

export interface LeagueTier {
  tier: number;
  name: string;
  entryFee: number;
  prizes: number[];
  aiBoost: number;
  rule?: string; // human-readable entry rule
  eligible?(duck: Duck): boolean;
}

export const LEAGUE: LeagueTier[] = [
  { tier: 0, name: 'Pond Derby', entryFee: 5, prizes: [15, 6, 0, 0], aiBoost: 1 },
  { tier: 1, name: 'County Derby', entryFee: 10, prizes: [32, 12, 0, 0], aiBoost: 1.1 },
  {
    tier: 2,
    name: 'National Derby',
    entryFee: 20,
    prizes: [65, 25, 0, 0],
    aiBoost: 1.22,
    rule: 'show-standard ducks only (60%+ match)',
    eligible: (d) => standardMatch(d, breedKey(d.genome)).pct >= 60,
  },
];

export const PROMOTE_AT = 3;

export function currentTier(state: GameState): LeagueTier {
  return LEAGUE[Math.min(LEAGUE.length - 1, state.league.tier)];
}

// Record a derby result. Returns a promotion/relegation notice, if any.
export function recordLeagueResult(state: GameState, place: number): string | null {
  const l = state.league;
  // Wins above the Pond tier are worth Society points in their own right.
  if (place === 0 && l.tier > 0) addSocietyPoints(state, l.tier);
  if (place === 0) l.wins += 1;
  else if (place >= 2) l.losses += 1;
  const net = l.wins - l.losses;
  if (net >= PROMOTE_AT && l.tier < LEAGUE.length - 1) {
    l.tier += 1;
    l.wins = 0;
    l.losses = 0;
    const name = LEAGUE[l.tier].name;
    addSocietyPoints(state, 4);
    chronicle(state, 'race', `The stable was promoted to the ${name}.`);
    events.emit('toast', `Promoted to the ${name}! (+4 Society)`);
    return `Promoted to the ${name}!`;
  }
  if (net <= -PROMOTE_AT && l.tier > 0) {
    l.tier -= 1;
    l.wins = 0;
    l.losses = 0;
    const name = LEAGUE[l.tier].name;
    chronicle(state, 'race', `The stable dropped back to the ${name}.`);
    events.emit('toast', `Relegated to the ${name}.`);
    return `Relegated to the ${name}.`;
  }
  return null;
}

export function leagueStanding(state: GameState): string {
  const l = state.league;
  const net = l.wins - l.losses;
  const t = currentTier(state);
  const up = l.tier < LEAGUE.length - 1 ? `${PROMOTE_AT - net} more net win${PROMOTE_AT - net === 1 ? '' : 's'} to promote` : 'top tier';
  return `${t.name} · ${l.wins}W ${l.losses}L · ${up}`;
}
