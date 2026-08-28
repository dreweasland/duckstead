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
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

// A labelled stat tile — the race picker, festival recaps, and market tally
// all share this shape.
export function statTile(ic: Parameters<typeof icon>[0], value: string, label: string): HTMLElement {
  return el('div', { class: 'race-tile' }, icon(ic, 13), el('strong', {}, value), el('span', { class: 'race-tile-label' }, label));
}
