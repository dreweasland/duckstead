// The card rail: an always-on-screen strip of compact duck cards along the
// left edge, toggled from the HUD. Shows the same at-a-glance stats as the
// Flock panel without covering the pond.
import type { Game } from '../game';
import type { Duck, Needs } from '../sim/duck';
import { eggIncubationTicks } from '../sim/lifecycle';
import { el, needColor, statBar } from './dom';
import { icon, sexBadge, type IconName } from './icons';
import { duckPortrait } from './portrait';
import { quickActions, type QuickHandlers } from './quickActions';

export interface RailHandlers extends QuickHandlers {
  select(id: string): void;
}

const NEED_ROWS: Array<[keyof Needs, IconName]> = [
  ['hunger', 'wheat'],
  ['cleanliness', 'bubbles'],
  ['happiness', 'smile'],
  ['health', 'heart'],
];

export function renderCardRail(game: Game, handlers: RailHandlers): HTMLElement {
  const rail = el('div', { class: 'card-rail' });
  const sorted = [...game.state.ducks].sort(
    (a, b) => (a.stage === 'egg' ? 1 : 0) - (b.stage === 'egg' ? 1 : 0),
  );
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
  else if (Math.min(...NEED_ROWS.map(([k]) => duck.needs[k])) < 25)
    status = el('span', { class: 'chip chip-warn' }, icon('warning', 9), 'care');

  // A div, not a button — the quick-action buttons nest inside it.
  return el(
    'div',
    {
      class: `mini-card${duck.id === game.selectedDuckId ? ' selected' : ''}`,
      onclick: () => handlers.select(duck.id),
    },
    el(
      'div',
      { class: 'mini-top' },
      duckPortrait(duck, 34),
      el(
        'div',
        { class: 'mini-id' },
        el('div', { class: 'mini-name' }, sexBadge(duck.sex), ` ${duck.name}`),
        el('div', { class: 'muted mini-stage' }, duck.stage),
      ),
      status,
    ),
    needs,
    quickActions(game, duck, handlers),
  );
}

function miniEggCard(game: Game, egg: Duck, handlers: RailHandlers): HTMLElement {
  const pct = Math.min(100, (egg.incubationTicks / eggIncubationTicks(game.state)) * 100);
  return el(
    'div',
    {
      class: `mini-card${egg.id === game.selectedDuckId ? ' selected' : ''}`,
      onclick: () => handlers.select(egg.id),
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
