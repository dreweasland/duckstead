// The Feather Album pays for diversity. A molted feather (or an elder's last
// one) adds its plumage colour to the album; the first of each colour is a
// Society point. The album was a colour census nobody read — now it is a
// small standing reward for a line that has explored its genes.
import type { GameState } from '../state';
import { events } from '../events';
import { addSocietyPoints } from './society';

export function collectFeather(state: GameState, color: string): boolean {
  const first = (state.featherAlbum[color] ?? 0) === 0;
  state.featherAlbum[color] = (state.featherAlbum[color] ?? 0) + 1;
  if (first) {
    addSocietyPoints(state, 1);
    events.emit('toast', 'A new colour for the Feather Album — +1 Society');
  }
  return first;
}
