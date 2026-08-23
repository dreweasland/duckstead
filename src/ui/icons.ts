// Hand-drawn SVG icon set — no emojis anywhere. Icons are authored as shape
// lists on a 24x24 viewBox and inherit color from CSS via currentColor.

export type IconName =
  | 'duck'
  | 'coin'
  | 'wheat'
  | 'sparkle'
  | 'heart'
  | 'heartOutline'
  | 'cart'
  | 'list'
  | 'disk'
  | 'pause'
  | 'bubbles'
  | 'smile'
  | 'pill'
  | 'hand'
  | 'egg'
  | 'star'
  | 'starOutline'
  | 'warning'
  | 'cross'
  | 'grave'
  | 'broom'
  | 'close'
  | 'cards'
  | 'flag'
  | 'book';

interface Shape {
  t: string;
  a: Record<string, string>;
}

const stroke2 = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const fillCur = { fill: 'currentColor' };

const ICONS: Record<IconName, Shape[]> = {
  duck: [
    { t: 'circle', a: { cx: '15.5', cy: '7.5', r: '3.6', ...fillCur } },
    { t: 'path', a: { d: 'M18.6 6.4l3.9-.9v2.6l-3.9.4z', ...fillCur } },
    {
      t: 'path',
      a: {
        d: 'M3.5 13.5c0 4 3.2 6.5 7.5 6.5h3.5c3.4 0 5.9-2 5.9-4.9 0-.5-.1-1-.2-1.4l-3.4.8c-2.1.5-4.1-1.1-4.1-3.2v-1c-.9-.5-2.1-.8-3.4-.8-3.4 0-5.8 1.6-5.8 4z',
        ...fillCur,
      },
    },
  ],
  coin: [
    { t: 'circle', a: { cx: '12', cy: '12', r: '8.5', ...stroke2 } },
    { t: 'circle', a: { cx: '12', cy: '12', r: '4.2', ...stroke2, 'stroke-width': '1.6' } },
  ],
  wheat: [
    { t: 'path', a: { d: 'M12 21V6', ...stroke2 } },
    { t: 'ellipse', a: { cx: '12', cy: '4.5', rx: '1.8', ry: '2.8', ...fillCur } },
    { t: 'ellipse', a: { cx: '8.6', cy: '9', rx: '1.8', ry: '2.8', transform: 'rotate(-35 8.6 9)', ...fillCur } },
    { t: 'ellipse', a: { cx: '15.4', cy: '9', rx: '1.8', ry: '2.8', transform: 'rotate(35 15.4 9)', ...fillCur } },
    { t: 'ellipse', a: { cx: '8.6', cy: '14', rx: '1.8', ry: '2.8', transform: 'rotate(-35 8.6 14)', ...fillCur } },
    { t: 'ellipse', a: { cx: '15.4', cy: '14', rx: '1.8', ry: '2.8', transform: 'rotate(35 15.4 14)', ...fillCur } },
  ],
  sparkle: [
    { t: 'path', a: { d: 'M12 2.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5L3.5 11l6.5-2z', ...fillCur } },
    { t: 'path', a: { d: 'M19 16l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z', ...fillCur } },
  ],
  heart: [
    {
      t: 'path',
      a: {
        d: 'M12 20.5S4.5 15.8 2.9 11.2C1.8 8.1 3.8 5 7 5c2 0 3.6 1.2 4.4 2.7h1.2C13.4 6.2 15 5 17 5c3.2 0 5.2 3.1 4.1 6.2C19.5 15.8 12 20.5 12 20.5z',
        ...fillCur,
      },
    },
  ],
  heartOutline: [
    {
      t: 'path',
      a: {
        d: 'M12 20.5S4.5 15.8 2.9 11.2C1.8 8.1 3.8 5 7 5c2 0 3.6 1.2 4.4 2.7h1.2C13.4 6.2 15 5 17 5c3.2 0 5.2 3.1 4.1 6.2C19.5 15.8 12 20.5 12 20.5z',
        ...stroke2,
      },
    },
  ],
  cart: [
    { t: 'path', a: { d: 'M3 5h2.4L8 16h10.5l2.5-8H7', ...stroke2 } },
    { t: 'circle', a: { cx: '9.5', cy: '20', r: '1.6', ...fillCur } },
    { t: 'circle', a: { cx: '16.5', cy: '20', r: '1.6', ...fillCur } },
  ],
  list: [
    { t: 'circle', a: { cx: '5', cy: '7', r: '1.5', ...fillCur } },
    { t: 'circle', a: { cx: '5', cy: '12', r: '1.5', ...fillCur } },
    { t: 'circle', a: { cx: '5', cy: '17', r: '1.5', ...fillCur } },
    { t: 'path', a: { d: 'M9 7h11M9 12h11M9 17h11', ...stroke2 } },
  ],
  disk: [
    { t: 'path', a: { d: 'M4 6a2 2 0 0 1 2-2h10l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', ...stroke2 } },
    { t: 'path', a: { d: 'M8 4v5h7V4', ...stroke2, 'stroke-width': '1.8' } },
    { t: 'rect', a: { x: '8', y: '13', width: '8', height: '7', rx: '1', ...stroke2, 'stroke-width': '1.8' } },
  ],
  pause: [
    { t: 'rect', a: { x: '6.5', y: '5', width: '3.6', height: '14', rx: '1.2', ...fillCur } },
    { t: 'rect', a: { x: '13.9', y: '5', width: '3.6', height: '14', rx: '1.2', ...fillCur } },
  ],
  bubbles: [
    { t: 'circle', a: { cx: '9', cy: '14.5', r: '5', ...stroke2 } },
    { t: 'circle', a: { cx: '16.5', cy: '7.5', r: '3.2', ...stroke2, 'stroke-width': '1.8' } },
    { t: 'circle', a: { cx: '18', cy: '15.5', r: '2', ...fillCur } },
  ],
  smile: [
    { t: 'circle', a: { cx: '12', cy: '12', r: '8.5', ...stroke2 } },
    { t: 'circle', a: { cx: '9', cy: '10', r: '1.3', ...fillCur } },
    { t: 'circle', a: { cx: '15', cy: '10', r: '1.3', ...fillCur } },
    { t: 'path', a: { d: 'M8.3 14.3c1 1.6 2.3 2.4 3.7 2.4s2.7-.8 3.7-2.4', ...stroke2, 'stroke-width': '1.8' } },
  ],
  pill: [
    { t: 'rect', a: { x: '8', y: '3.5', width: '8', height: '17', rx: '4', transform: 'rotate(45 12 12)', ...stroke2 } },
    { t: 'path', a: { d: 'M9 9l6 6', ...stroke2 } },
  ],
  hand: [
    {
      t: 'path',
      a: {
        d: 'M7.5 11.5V6a1.4 1.4 0 0 1 2.8 0v4m0-4.6V4.6a1.4 1.4 0 0 1 2.8 0V10m0-4.6a1.4 1.4 0 0 1 2.8 0V11m0-2.6a1.4 1.4 0 0 1 2.8 0v6.1c0 3.9-2.6 6.5-6.4 6.5-3.1 0-4.9-1.5-6-4.3l-1.6-3.9c-.4-1 .3-2 1.4-2 .6 0 1.2.3 1.5.9z',
        ...stroke2,
        'stroke-width': '1.7',
      },
    },
  ],
  egg: [
    {
      t: 'path',
      a: { d: 'M12 3c3.4 0 6.8 5.7 6.8 10.2a6.8 6.8 0 0 1-13.6 0C5.2 8.7 8.6 3 12 3z', ...stroke2 },
    },
  ],
  star: [
    {
      t: 'path',
      a: { d: 'M12 2.8l2.6 6 6.4.6-4.9 4.3 1.5 6.3L12 16.6 6.4 20l1.5-6.3L3 9.4l6.4-.6z', ...fillCur },
    },
  ],
  starOutline: [
    {
      t: 'path',
      a: {
        d: 'M12 2.8l2.6 6 6.4.6-4.9 4.3 1.5 6.3L12 16.6 6.4 20l1.5-6.3L3 9.4l6.4-.6z',
        ...stroke2,
        'stroke-width': '1.7',
      },
    },
  ],
  warning: [
    { t: 'path', a: { d: 'M12 3.5L22 20H2z', ...stroke2 } },
    { t: 'path', a: { d: 'M12 9.5v4.5', ...stroke2 } },
    { t: 'circle', a: { cx: '12', cy: '17', r: '1.2', ...fillCur } },
  ],
  cross: [
    { t: 'path', a: { d: 'M9.2 3.5h5.6v5.7h5.7v5.6h-5.7v5.7H9.2v-5.7H3.5V9.2h5.7z', ...fillCur } },
  ],
  grave: [
    { t: 'path', a: { d: 'M7 20v-9.5a5 5 0 0 1 10 0V20', ...stroke2 } },
    { t: 'path', a: { d: 'M4.5 20.5h15M12 9.5v5M10 11.5h4', ...stroke2, 'stroke-width': '1.8' } },
  ],
  broom: [
    { t: 'path', a: { d: 'M14.5 3.5l-4.2 8.2', ...stroke2 } },
    {
      t: 'path',
      a: {
        d: 'M10.6 11.2c-2.6.9-4.4 3.3-5.1 6.9-.1.6 0 1.2.8 1.5 3.4 1.3 6.4 1 8.6-.7l-1.8-4.4z',
        ...stroke2,
        'stroke-width': '1.8',
      },
    },
  ],
  close: [{ t: 'path', a: { d: 'M6 6l12 12M18 6L6 18', ...stroke2 } }],
  cards: [
    { t: 'rect', a: { x: '3.5', y: '4', width: '8', height: '7', rx: '1.5', ...fillCur } },
    { t: 'rect', a: { x: '13.5', y: '4', width: '7', height: '7', rx: '1.5', ...stroke2, 'stroke-width': '1.7' } },
    { t: 'rect', a: { x: '3.5', y: '13.5', width: '7', height: '7', rx: '1.5', ...stroke2, 'stroke-width': '1.7' } },
    { t: 'rect', a: { x: '12.5', y: '13.5', width: '8', height: '7', rx: '1.5', ...fillCur } },
  ],
  flag: [
    { t: 'path', a: { d: 'M6 21V4', ...stroke2 } },
    { t: 'path', a: { d: 'M6 4.5c2.5-1.4 5-1.4 7.5 0s5 1.4 7 .3V13c-2 1.1-4.5 1.1-7-.3s-5-1.4-7.5 0z', ...fillCur } },
  ],
  book: [
    { t: 'path', a: { d: 'M12 6c-2-1.6-4.8-2.2-8-2v14.5c3.2-.2 6 .4 8 2 2-1.6 4.8-2.2 8-2V4c-3.2-.2-6 .4-8 2z', ...stroke2 } },
    { t: 'path', a: { d: 'M12 6v14.5', ...stroke2, 'stroke-width': '1.7' } },
  ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name: IconName, size = 14, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of ICONS[name]) {
    const node = document.createElementNS(SVG_NS, shape.t);
    for (const [key, value] of Object.entries(shape.a)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

// Row of rarity stars (filled up to `n`, capped at 5; a lone outline at 0).
export function starRow(n: number, size = 12): HTMLElement {
  const span = document.createElement('span');
  span.className = 'star-row';
  const count = Math.min(5, n);
  if (count === 0) {
    span.append(icon('starOutline', size, 'star-dim'));
    return span;
  }
  for (let i = 0; i < count; i += 1) span.append(icon('star', size, 'star-gold'));
  return span;
}

// Sex badge: a small hand-styled M/F chip instead of gender glyphs.
export function sexBadge(sex: 'M' | 'F'): HTMLElement {
  const span = document.createElement('span');
  span.className = `sex-badge ${sex === 'M' ? 'sex-m' : 'sex-f'}`;
  span.textContent = sex;
  return span;
}
