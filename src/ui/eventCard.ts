// Shared scaffolding for the event pop-ups (derby, festivals, recaps): the
// dimmed overlay, the themed card, its banner header, and the closing row.
// Seven call sites previously rebuilt all of this inline.
import { el } from './dom';
import { icon, type IconName } from './icons';

export type EventTheme = 'derby' | 'market' | 'winter' | 'egg';

export interface EventCard {
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
