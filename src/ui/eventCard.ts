// Shared scaffolding for the event pop-ups (derby, festivals, recaps): the
// dimmed overlay, the themed card, its banner header, and the closing row.
// Seven call sites previously rebuilt all of this inline.
import { el } from './dom';
import { icon, type IconName } from './icons';

type EventTheme = 'derby' | 'market' | 'winter' | 'egg' | 'life' | 'drill';

interface EventCard {
  overlay: HTMLElement;
  card: HTMLElement;
  close: () => void;
  // A banner header for the card; rebuild freely as the card's state changes.
  header: (ic: IconName, title: string) => HTMLElement;
}

// Builds and mounts the overlay + card. Returns null when an event overlay
// is already open (the popups never stack). `onClose` runs before removal —
// the place for per-event cleanup (timers, rAF, lifted duck cards).
export function eventCard(root: HTMLElement, theme: EventTheme, extraCardClass = '', onClose?: () => void): EventCard | null {
  if (document.querySelector('.race-overlay')) return null;
  const overlay = el('div', { class: 'race-overlay' });
  const card = el('div', { class: `race-card theme-${theme}${extraCardClass ? ` ${extraCardClass}` : ''}` });
  const close = (): void => {
    onClose?.();
    overlay.remove();
  };
  const header = (ic: IconName, title: string): HTMLElement =>
    el(
      'div',
      { class: 'race-header' },
      el('strong', { class: 'with-icon' }, icon(ic, 16), title),
      el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
    );
  overlay.append(card);
  root.append(overlay);
  return { overlay, card, close, header };
}

export function backToPondRow(close: () => void, label = 'Back to the pond'): HTMLElement {
  return el('div', { class: 'actions race-actions' }, el('button', { class: 'action-btn primary', onclick: close }, label));
}

// One line of a standings table: the place, an optional portrait, the name
// (a string, or a prebuilt name node for richer layouts), an optional note,
// and the prize when there is one. Four tables built this inline.
export interface ResultRowOpts {
  mine: boolean;
  portrait?: HTMLElement;
  name: string | HTMLElement;
  note?: string;
  reward?: number;
}

export function resultRow(place: number, o: ResultRowOpts): HTMLElement {
  return el(
    'div',
    { class: `race-result-row${o.mine ? ' mine' : ''}` },
    el('span', { class: `race-place p${place}` }, String(place)),
    o.portrait,
    typeof o.name === 'string' ? el('span', { class: 'race-result-name' }, o.name) : o.name,
    o.note !== undefined ? el('span', { class: 'muted small' }, o.note) : null,
    o.reward && o.reward > 0 ? el('span', { class: 'goal-reward with-icon' }, icon('coin', 11), String(o.reward)) : null,
  );
}
