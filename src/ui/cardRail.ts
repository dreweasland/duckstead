// The card rail: an always-on-screen strip of compact duck cards along the
// left edge, toggled from the HUD. Shows the same at-a-glance stats as the
// Flock panel without covering the pond.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import { incubationPct } from '../sim/lifecycle';
import { el, NEED_ROWS, needColor, statBar } from './dom';
import { icon, sexBadge, type IconName } from './icons';
import { duckPortrait } from './portrait';
import { quickActions, type QuickHandlers } from './quickActions';
import { byAge, byHunger, byName, byPedigree } from './duckSort';
import { drillsLeft, isTrainingDay } from '../sim/training';
import { plural } from '../text';

interface RailHandlers extends QuickHandlers {
  select(id: string, pin?: boolean): void;
}

// Rail sort order, cycled by the little control at the head of the rail
// and remembered between sessions.
type RailSort = 'age' | 'drakes' | 'hens' | 'hungry' | 'pedigree' | 'name';
const RAIL_SORTS: Array<{ id: RailSort; label: string; icon: IconName }> = [
  { id: 'age', label: 'Oldest first', icon: 'list' },
  { id: 'drakes', label: 'Drakes first', icon: 'duck' },
  { id: 'hens', label: 'Hens first', icon: 'egg' },
  { id: 'hungry', label: 'Hungriest first', icon: 'wheat' },
  { id: 'pedigree', label: 'Best pedigree first', icon: 'star' },
  { id: 'name', label: 'By name', icon: 'book' },
];
const RAIL_SORT_KEY = 'ducksim:ui:railSort';
let railSort: RailSort = (() => {
  try {
    const v = localStorage.getItem(RAIL_SORT_KEY) as RailSort | null;
    return v && RAIL_SORTS.some((s) => s.id === v) ? v : 'age';
  } catch {
    return 'age';
  }
})();

// Every rail order but "oldest" keeps the eggs at the bottom.
function railCompare(sort: RailSort): (a: Duck, b: Duck) => number {
  const egg = (d: Duck) => (d.stage === 'egg' ? 1 : 0);
  const bySex = (first: 'M' | 'F') => (a: Duck, b: Duck) =>
    egg(a) - egg(b) || (a.sex === first ? 0 : 1) - (b.sex === first ? 0 : 1) || byAge(a, b);
  switch (sort) {
    case 'drakes':
      return bySex('M');
    case 'hens':
      return bySex('F');
    case 'hungry':
      return (a, b) => egg(a) - egg(b) || byHunger(a, b);
    case 'pedigree':
      return (a, b) => egg(a) - egg(b) || byPedigree(a, b);
    case 'name':
      return (a, b) => egg(a) - egg(b) || byName(a, b);
    case 'age':
    default:
      return byAge;
  }
}

// Everything the rail visibly shows, hashed cheaply — when this string is
// unchanged the 500ms refresh skips the whole rebuild (and its portraits).
export function railSignature(game: Game): string {
  const inv = game.state.inventory;
  let s = `${railSort}|${game.selectedDuckId}|${inv.feed > 0 ? 1 : 0}${inv.medicine > 0 ? 1 : 0}|`;
  for (const d of game.state.ducks) {
    if (d.stage === 'egg') {
      s += `${d.id}~${Math.round(d.incubationTicks / 150)}${d.readyToHatch ? 'r' : ''};`;
    } else {
      s += `${d.id}~${d.stage[0]}${d.sick ? 's' : ''}${d.penned ? 'p' : ''}${d.petCooldownTicks > 0 ? 'c' : ''}${d.stage === 'duckling' ? '' : `t${drillsLeft(game.state, d)}`}${d.name}#${Math.round(d.needs.hunger)},${Math.round(d.needs.cleanliness)},${Math.round(d.needs.happiness)},${Math.round(d.needs.health)};`;
    }
  }
  return s;
}

export function renderCardRail(game: Game, handlers: RailHandlers): HTMLElement {
  const rail = el('div', { class: 'card-rail' });
  const current = RAIL_SORTS.find((s) => s.id === railSort)!;
  rail.append(
    el(
      'button',
      {
        class: 'rail-sort',
        title: `Sorted: ${current.label}. Click to change.`,
        onclick: (e) => {
          e.stopPropagation();
          const i = RAIL_SORTS.findIndex((s) => s.id === railSort);
          railSort = RAIL_SORTS[(i + 1) % RAIL_SORTS.length].id;
          try {
            localStorage.setItem(RAIL_SORT_KEY, railSort);
          } catch {
            /* private mode */
          }
          handlers.refresh();
        },
      },
      el('span', { class: 'rail-sort-hint' }, 'Sort'),
      icon(current.icon, 14),
      el('span', { class: 'rail-sort-label' }, current.label),
    ),
  );
  const sorted = [...game.state.ducks].sort(railCompare(railSort));
  for (const duck of sorted) {
    rail.append(
      duck.stage === 'egg' ? miniEggCard(game, duck, handlers) : miniCard(game, duck, handlers),
    );
  }
  return rail;
}

function miniCard(game: Game, duck: Duck, handlers: RailHandlers): HTMLElement {
  const needs = el('div', { class: 'mini-needs' });
  for (const [key, iconName] of NEED_ROWS) {
    const value = duck.needs[key];
    needs.append(
      el('div', { class: 'card-need-row' }, icon(iconName, 10), statBar(value, needColor(value), true)),
    );
  }

  let status: HTMLElement | null = null;
  if (duck.sick) status = el('span', { class: 'chip chip-sick' }, icon('cross', 9), 'sick');
  else if (duck.penned) status = el('span', { class: 'chip chip-trait' }, 'pen');
  else if (Math.min(...NEED_ROWS.map(([k]) => duck.needs[k])) < 25)
    status = el('span', { class: 'chip chip-warn' }, icon('warning', 9), 'care');

  // A div, not a button — the quick-action buttons nest inside it.
  return el(
    'div',
    {
      class: `mini-card${duck.id === game.selectedDuckId ? ' selected' : ''}`,
      onclick: (e) => handlers.select(duck.id, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey),
    },
    el(
      'div',
      { class: 'mini-top' },
      duckPortrait(duck, 34),
      el(
        'div',
        { class: 'mini-id' },
        el('div', { class: 'mini-name' }, sexBadge(duck.sex), ` ${duck.name}`),
        // Whether today's drills are done sits by the stage: the question
        // asked most at a glance.
        el('div', { class: 'mini-stage-row' }, el('span', { class: 'muted mini-stage' }, duck.stage), trainingChip(game, duck, 9, true)),
      ),
      status,
    ),
    needs,
    quickActions(game, duck, handlers),
  );
}

// A duck's training for the day, as a chip: drills still to run, or done.
// Ducklings can't train and get nothing.
export function trainingChip(game: Game, duck: Duck, size = 10, compact = false): HTMLElement | null {
  if (duck.stage === 'egg' || duck.stage === 'duckling' || !isTrainingDay(game.state)) return null;
  const left = drillsLeft(game.state, duck);
  if (left > 0) {
    const label = compact ? (left > 1 ? String(left) : '') : left > 1 ? `${left} drills` : 'drill';
    return el('span', { class: 'chip chip-drill', title: `${plural(left, 'drill')} left today — open the card to train` }, icon('flag', size), label);
  }
  return el('span', { class: 'chip chip-trained', title: 'Trained today' }, icon('check', size), compact ? '' : 'trained');
}

function miniEggCard(game: Game, egg: Duck, handlers: RailHandlers): HTMLElement {
  const pct = incubationPct(game.state, egg);
  return el(
    'div',
    {
      class: `mini-card${egg.id === game.selectedDuckId ? ' selected' : ''}`,
      onclick: (e) => handlers.select(egg.id, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey),
    },
    el(
      'div',
      { class: 'mini-top' },
      icon('egg', 18),
      el(
        'div',
        { class: 'mini-id' },
        el('div', { class: 'mini-name' }, 'Egg'),
        el('div', { class: 'muted mini-stage' }, `${pct.toFixed(0)}%`),
      ),
    ),
    statBar(pct, '#e8b83a', true),
  );
}
