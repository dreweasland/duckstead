// Flock balance: ducks keep best at about one drake to three hens. Surplus
// drakes harass the hens — happiness drains, laying drops, clutches take less
// often — and squabble among themselves. The base pond capacities (8/12/16/20)
// divide into 2/3/4/5 drakes; perk and heritage slots can push capacity to odd
// sizes, which is fine — only *surplus* drakes are penalised, so a flock one
// drake under ideal loses nothing.
import type { GameState } from '../state';
import type { Duck } from './duck';
import { plural } from '../text';

export const HENS_PER_DRAKE = 3;
const MAX_EXCESS_EFFECT = 4;

interface FlockBalance {
  drakes: number;
  hens: number;
  idealDrakes: number;
  excess: number; // surplus drakes beyond the ideal (0 = balanced)
  status: 'balanced' | 'crowded' | 'rowdy' | 'no-hens' | 'no-drakes';
  penned: number; // ducks sitting out in the bachelor pen
}

// `releasing` names penned ducks to count as if they were already out — the
// Breed panel quotes a pen stud's clutch at the pressure he will actually add.
export function flockBalance(state: GameState, releasing: readonly string[] = []): FlockBalance {
  // Only breeding-age ducks count: elders can't breed and are past the
  // squabbling, so an elder drake stresses nobody.
  const out = (d: Duck): boolean => !d.penned || releasing.includes(d.id);
  const adults = state.ducks.filter((d) => d.stage === 'adult' && out(d));
  const penned = state.ducks.filter((d) => d.penned && !out(d) && d.stage !== 'egg').length;
  const drakes = adults.filter((d) => d.sex === 'M').length;
  const hens = adults.length - drakes;
  // A pair of drakes is always fine (the starter flock is 2 and 2).
  const idealDrakes = Math.max(2, Math.ceil(hens / HENS_PER_DRAKE));
  const excess = Math.max(0, drakes - idealDrakes);
  let status: FlockBalance['status'] = 'balanced';
  if (hens === 0 && drakes > 0) status = 'no-hens';
  else if (drakes === 0 && hens > 0) status = 'no-drakes';
  else if (excess >= 3) status = 'rowdy';
  else if (excess > 0) status = 'crowded';
  return { drakes, hens, idealDrakes, excess, status, penned };
}

// Effect strength 0..MAX_EXCESS_EFFECT.
export function drakePressure(state: GameState, releasing: readonly string[] = []): number {
  return Math.min(MAX_EXCESS_EFFECT, flockBalance(state, releasing).excess);
}

export function describeBalance(b: FlockBalance): string {
  const pen = b.penned > 0 ? ` · ${b.penned} penned` : '';
  return describeBalanceCore(b) + pen;
}

function describeBalanceCore(b: FlockBalance): string {
  switch (b.status) {
    case 'balanced':
      return `${plural(b.drakes, 'drake')}, ${plural(b.hens, 'hen')} — balanced`;
    case 'crowded':
      return `${b.drakes} drakes for ${plural(b.hens, 'hen')} — ${b.excess} too many; the hens are harried`;
    case 'rowdy':
      return `${b.drakes} drakes for ${plural(b.hens, 'hen')} — a rowdy pond; hens won't lay well`;
    case 'no-hens':
      return `${plural(b.drakes, 'drake')} and no hens`;
    case 'no-drakes':
      return `${plural(b.hens, 'hen')} and no drake`;
  }
}
