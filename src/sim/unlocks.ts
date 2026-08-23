// Progressive reveal for the early game: panels appear as the goal chain
// introduces them, so a fresh pond shows Feed/Pet first, not seven buttons.
// Every rule is also satisfied by having *done the thing*, so seasoned saves
// see everything immediately.
import type { GameState } from '../state';

export type Unlockable = 'breeding' | 'shop' | 'book' | 'race';

export const UNLOCK_LABELS: Record<Unlockable, string> = {
  breeding: 'Breeding',
  shop: 'Shop',
  book: 'Breed Book',
  race: 'Pond Derby',
};

export function isUnlocked(state: GameState, what: Unlockable): boolean {
  const s = state.stats;
  switch (what) {
    case 'breeding':
      return s.pets >= 4 || s.clutchesStarted > 0 || s.ducksBred > 0;
    case 'shop':
      return (
        s.ducksBred > 0 ||
        Object.keys(state.upgrades).length > 0 ||
        state.decorations.length > 0 ||
        s.ducksSold > 0 ||
        s.eggsSold > 0
      );
    case 'book':
    case 'race':
      return s.ducksHatched > 0 || s.racesWon > 0 || Object.keys(state.breedBook).length > 4;
  }
}

export const UNLOCKABLES: Unlockable[] = ['breeding', 'shop', 'book', 'race'];
