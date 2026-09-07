// The ledger: the top-right corner card with the five numbers that are the
// game's score and standing — coins, Society points, the line (champions
// and deepest generation; it opens the Hall), the flock against capacity,
// and the pond's cleanliness. Consumables live in the bottom dock, where
// they are used, not here.
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
  const chip = (key: LedgerKey, iconName: Parameters<typeof icon>[0], label: string): HTMLElement => {
    const count = el('span', { class: 'hud-chip-count' }, '0');
    counts[key] = count;
    return el('span', { class: `hud-chip chip-${key}`, title: label }, icon(iconName, 13), count);
  };
  const lineCount = el('span', { class: 'hud-chip-count' }, '0');
  counts.line = lineCount;
  const lineChip = el(
    'button',
    { class: 'hud-chip chip-line', title: 'The line: champions · deepest generation. Opens the Hall of Champions.', onclick: () => host.openHall() },
    icon('crown', 13),
    lineCount,
  );
  // Two rows on purpose — the purse and the score, then the pond — so the
  // hairline dividers only ever sit between chips, never at a row's edge.
  const element = el(
    'section',
    { class: 'corner-card ledger', 'aria-label': 'Coins, points, the line, flock, and pond' },
    el(
      'span',
      { class: 'hud-chips' },
      chip('coin', 'coin', 'Coins'),
      chip('society', 'star', 'Society points — earned from champions, breed awards, commissions, festival placings, and new feather colours'),
      lineChip,
    ),
    el(
      'span',
      { class: 'hud-chips ledger-pond' },
      chip('flock', 'duck', "Grown ducks on the pond / capacity — over it, the flock is stressed. Elders, the young, and penned ducks don't count."),
      chip('pond', 'bubbles', `Pond cleanliness — wild ducks only visit above ${TUNING.visitors.inviteCleanliness}%`),
    ),
  );
  return { element, counts };
}
