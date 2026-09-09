// The ledger: the top-right corner card — five stat tiles in a row, value
// above and label beneath, like a scoreboard: coins, Society points, the
// line (champions · deepest generation; it opens the Hall), the flock
// against capacity, and the pond's cleanliness. Consumables live in the
// bottom dock, where they are used.
import { TUNING } from '../sim/tuning';
import { el } from './dom';
import { icon } from './icons';

export type LedgerKey = 'coin' | 'society' | 'line' | 'flock' | 'pond';

interface LedgerHost {
  openHall(): void;
}

interface LedgerRefs {
  element: HTMLElement;
  counts: Record<LedgerKey, HTMLElement>;
}

export function buildLedger(host: LedgerHost): LedgerRefs {
  const counts = {} as LedgerRefs['counts'];
  const tile = (key: LedgerKey, iconName: Parameters<typeof icon>[0], label: string, title: string, onclick?: () => void): HTMLElement => {
    const count = el('span', { class: 'hud-chip-count' }, '0');
    counts[key] = count;
    const value = el('span', { class: 'stat-value' }, icon(iconName, 13), count);
    const text = el('span', { class: 'stat-label' }, label);
    return onclick
      ? el('button', { class: `stat chip-${key}`, title, onclick }, value, text)
      : el('span', { class: `stat chip-${key}`, title }, value, text);
  };
  const element = el(
    'section',
    { class: 'corner-card ledger', 'aria-label': 'Coins, points, the line, flock, and pond' },
    tile('coin', 'coin', 'coins', 'Coins'),
    tile('society', 'star', 'points', 'Society points — earned from champions, breed awards, commissions, festival placings, and new feather colours'),
    tile('line', 'crown', 'the line', 'The line: champions · deepest generation. Opens the Hall of Champions.', () => host.openHall()),
    tile('flock', 'duck', 'flock', "Grown ducks on the pond / capacity — over it, the flock is stressed. Elders, the young, and penned ducks don't count."),
    tile('pond', 'bubbles', 'pond', `Pond cleanliness — wild ducks only visit above ${TUNING.visitors.inviteCleanliness}%`),
  );
  return { element, counts };
}
