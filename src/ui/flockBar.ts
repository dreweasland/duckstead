// The flock bar: one small portrait per duck in a row across the sky, the
// region of the screen no duck ever enters. Each dot wears a thin ring for
// its lowest need (coloured by which need, filled by how low), a crown for
// a champion, and a mark when sick or penned; eggs sit at the end with
// their incubation as the ring. Click to open the card, Ctrl/Cmd-click to
// pin. Rebuilt only when the signature changes, never under the pointer.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { incubationPct } from '../sim/lifecycle';
import { isChampion } from '../sim/line';
import { el, NEED_ROWS } from './dom';
import { icon } from './icons';
import { duckPortrait } from './portrait';
import { FLOCK_SORTS, flockCompare, loadFlockSort, saveFlockSort } from './duckSort';

interface FlockBarHandlers {
  select(id: string, pin?: boolean): void;
  isPinned(id: string): boolean;
  refresh(): void;
}

// Below this the ring is a neutral hairline: a content flock reads calm.
const CALM_AT = 60;
// Past this many dots the bar goes dense (smaller portraits, two rows).
const DENSE_AT = 24;

const NEED_COLOR: Record<(typeof NEED_ROWS)[number][0], string> = {
  hunger: 'var(--amber)',
  cleanliness: '#7fb4d8',
  happiness: '#eeaad4',
  health: '#e08585',
};
const NEED_LABEL: Record<(typeof NEED_ROWS)[number][0], string> = {
  hunger: 'hungry',
  cleanliness: 'grubby',
  happiness: 'glum',
  health: 'poorly',
};

function lowestNeed(duck: Duck): { key: (typeof NEED_ROWS)[number][0]; value: number } {
  let best = NEED_ROWS[0][0];
  for (const [key] of NEED_ROWS) if (duck.needs[key] < duck.needs[best]) best = key;
  return { key: best, value: Math.round(duck.needs[best]) };
}

// Everything the bar shows, hashed cheaply; unchanged means no rebuild.
export function flockSignature(game: Game, isPinned: (id: string) => boolean): string {
  let s = `${loadFlockSort()}|${game.selectedDuckId}|`;
  for (const d of game.state.ducks) {
    if (d.stage === 'egg') {
      s += `${d.id}~e${Math.round(incubationPct(game.state, d) / 10)}${d.readyToHatch ? 'r' : ''};`;
    } else {
      const low = lowestNeed(d);
      s += `${d.id}~${d.stage[0]}${d.sick ? 's' : ''}${d.penned ? 'p' : ''}${isChampion(d) ? 'c' : ''}${isPinned(d.id) ? '*' : ''}${low.key[0]}${Math.round(low.value / 10)};`;
    }
  }
  return s;
}

export function renderFlockBar(game: Game, h: FlockBarHandlers): HTMLElement {
  const sort = loadFlockSort();
  const current = FLOCK_SORTS.find((s) => s.id === sort)!;
  const ducks = [...game.state.ducks].sort(flockCompare(sort));
  const dense = ducks.length > DENSE_AT;
  const bar = el('div', { class: `flock-bar${dense ? ' dense' : ''}` });
  bar.append(
    el(
      'button',
      {
        class: 'flock-sort',
        title: `Sorted: ${current.label}. Click to change.`,
        onclick: (e) => {
          e.stopPropagation();
          const i = FLOCK_SORTS.findIndex((s) => s.id === sort);
          saveFlockSort(FLOCK_SORTS[(i + 1) % FLOCK_SORTS.length].id);
          h.refresh();
        },
      },
      icon(current.icon, 12),
    ),
  );
  const size = dense ? 28 : 36;
  for (const duck of ducks) bar.append(duck.stage === 'egg' ? eggDot(game, duck, h) : duckDot(game, duck, h, size));
  return bar;
}

function ring(color: string, value: number, calm: boolean): HTMLElement {
  const r = el('span', { class: `flock-ring${calm ? ' calm' : ''}` });
  r.style.setProperty('--ring-c', color);
  r.style.setProperty('--ring-v', String(value));
  return r;
}

function duckDot(game: Game, duck: Duck, h: FlockBarHandlers, size: number): HTMLElement {
  const low = lowestNeed(duck);
  const calm = low.value >= CALM_AT;
  const state = duck.sick ? 'sick' : duck.penned ? 'in the pen' : calm ? 'content' : `${NEED_LABEL[low.key]} ${low.value}%`;
  const dot = el(
    'button',
    {
      class: `flock-dot${duck.id === game.selectedDuckId ? ' selected' : ''}${h.isPinned(duck.id) ? ' pinned' : ''}`,
      'data-id': duck.id,
      title: `${duck.name} · ${duck.stage} · ${state}`,
      onclick: (e) => h.select(duck.id, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey),
    },
    duckPortrait(duck, size),
    ring(NEED_COLOR[low.key], low.value, calm),
  );
  if (isChampion(duck)) dot.append(el('span', { class: 'flock-mark crown' }, icon('crown', 10)));
  else if (duck.sick) dot.append(el('span', { class: 'flock-mark sick' }, icon('cross', 9)));
  else if (duck.penned) dot.append(el('span', { class: 'flock-mark pen' }, icon('cross', 9)));
  return dot;
}

function eggDot(game: Game, egg: Duck, h: FlockBarHandlers): HTMLElement {
  const pct = Math.round(incubationPct(game.state, egg));
  return el(
    'button',
    {
      class: `flock-dot egg${egg.id === game.selectedDuckId ? ' selected' : ''}${egg.readyToHatch ? ' ready' : ''}`,
      'data-id': egg.id,
      title: egg.readyToHatch ? 'An egg, cracking — open it to hatch' : `An egg · ${pct}% incubated`,
      onclick: (e) => h.select(egg.id, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey),
    },
    icon('egg', 16),
    ring('var(--gold)', pct, false),
  );
}
