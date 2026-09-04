import { clamp } from '../types';
import type { Needs } from '../sim/duck';
import { icon, type IconName } from './icons';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
type Child = Node | string | null | undefined;

// The coloured fill of a progress bar, for callers that bring their own
// track (the nest's `bar bar-thin` rows).
export function barFill(pct: number, color: string): HTMLElement {
  const fill = el('div', { class: 'bar-fill' });
  fill.style.width = `${pct}%`;
  fill.style.background = color;
  return fill;
}

export function statBar(pct: number, color: string, thin = false): HTMLElement {
  return el('div', { class: thin ? 'bar thin' : 'bar' }, barFill(clamp(pct, 0, 100), color));
}

// A toned gauge (clutch viability, Society rank progress): the track is
// styled, the fill takes an ok/mid/warn tone.
export function gaugeBar(pct: number, tone: 'ok' | 'mid' | 'warn'): HTMLElement {
  const fill = el('div', { class: `br-gauge-fill ${tone}` });
  fill.style.width = `${pct}%`;
  return el('div', { class: 'br-gauge' }, fill);
}

// The four needs as bar rows: key, icon, label.
export const NEED_ROWS: Array<[keyof Needs, IconName, string]> = [
  ['hunger', 'wheat', 'Hunger'],
  ['cleanliness', 'bubbles', 'Clean'],
  ['happiness', 'smile', 'Happy'],
  ['health', 'heart', 'Health'],
];

export function needColor(value: number): string {
  return value > 60 ? '#69b356' : value > 30 ? '#e0a93a' : '#d4544a';
}

// An egg's warmth bar: amber while warm, blue once it needs tucking.
export function eggWarmthColor(warmth: number): string {
  return warmth > 40 ? '#e0893a' : '#6aa0d8';
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

// A two-step confirm: the idle button arms (the caller flips a flag and
// rebuilds), the armed "Really …?" button acts. Native confirm() would block
// the game loop, so eight sites hand-rolled this. Returns one button idle;
// armed, the confirm button plus a Cancel when `cancel` is given — spread
// the result into the parent.
export interface ConfirmOpts {
  armed: boolean;
  arm: () => void;
  onConfirm: () => void;
  label: Child | Child[];
  confirmLabel: string;
  cls?: string; // idle button class
  confirmCls?: string; // armed button class (defaults to cls)
  cancel?: () => void;
  disabled?: boolean;
  title?: string; // idle tooltip
  confirmTitle?: string; // armed tooltip
}

export function confirmButton(o: ConfirmOpts): HTMLElement[] {
  const cls = o.cls ?? 'action-btn';
  const attrs = (c: string, title: string | undefined, onclick: () => void): Attrs => {
    const a: Attrs = { class: c };
    if (o.disabled !== undefined) a.disabled = o.disabled;
    if (title !== undefined) a.title = title;
    a.onclick = onclick;
    return a;
  };
  if (!o.armed) {
    const label = Array.isArray(o.label) ? o.label : [o.label];
    return [el('button', attrs(cls, o.title, o.arm), ...label)];
  }
  const confirm = el('button', attrs(o.confirmCls ?? cls, o.confirmTitle, o.onConfirm), o.confirmLabel);
  if (!o.cancel) return [confirm];
  return [confirm, el('button', { class: 'action-btn', onclick: o.cancel }, 'Cancel')];
}

// A row of tabs: icon + label, an optional count badge (`badgeFull` lights
// it), the active one marked and announced. Picking a tab is the caller's
// business (a module flag and a rebuild). Six bars built this inline.
export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  badge?: string | null;
  badgeFull?: boolean;
  title?: string;
}

export function tabBar<T extends string>(defs: ReadonlyArray<TabDef<T>>, activeId: T, onPick: (id: T) => void, cls = 'shop-tabs', tabCls = 'shop-tab'): HTMLElement {
  const bar = el('div', { class: cls });
  for (const t of defs) {
    const active = t.id === activeId;
    const attrs: Attrs = { class: `${tabCls}${active ? ' active' : ''}`, 'aria-pressed': String(active) };
    if (t.title !== undefined) attrs.title = t.title;
    attrs.onclick = () => onPick(t.id);
    bar.append(
      el(
        'button',
        attrs,
        icon(t.icon, 12),
        t.label,
        t.badge ? el('span', { class: `shop-tab-badge${t.badgeFull ? ' full' : ''}` }, t.badge) : null,
      ),
    );
  }
  return bar;
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
