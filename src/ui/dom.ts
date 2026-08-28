import { clamp } from '../types';
import { icon } from './icons';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
type Child = Node | string | null | undefined;

export function statBar(pct: number, color: string, thin = false): HTMLElement {
  const fill = el('div', { class: 'bar-fill' });
  fill.style.width = `${clamp(pct, 0, 100)}%`;
  fill.style.background = color;
  return el('div', { class: thin ? 'bar thin' : 'bar' }, fill);
}

export function needColor(value: number): string {
  return value > 60 ? '#69b356' : value > 30 ? '#e0a93a' : '#d4544a';
}

export function el(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'disabled') {
      if (value) node.setAttribute('disabled', '');
    } else if (key.startsWith('on')) {
      // Defensive: a computed key reaching here would write onclick="..."
      // markup. No call site does this today; keep it impossible.
      continue;
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  // An icon-only button is unreadable to a screen reader: its tooltip
  // becomes its accessible name.
  if (tag === 'button' && typeof attrs.title === 'string' && attrs.title && !attrs['aria-label'] && !node.textContent?.trim()) {
    node.setAttribute('aria-label', attrs.title);
  }
  return node;
}

// A labelled stat tile — the race picker, festival recaps, and market tally
// all share this shape.
export function statTile(ic: Parameters<typeof icon>[0], value: string, label: string): HTMLElement {
  return el('div', { class: 'race-tile' }, icon(ic, 13), el('strong', {}, value), el('span', { class: 'race-tile-label' }, label));
}

// The standard panel header: icon + title, optional middle content (pills,
// coin counts), and the closing X. Five panels rebuilt this shape inline.
export function panelHeader(ic: Parameters<typeof icon>[0], title: string, close: () => void, ...middle: Child[]): HTMLElement {
  return el(
    'div',
    { class: 'panel-header' },
    el('strong', { class: 'with-icon' }, icon(ic), title),
    ...middle,
    el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
  );
}
