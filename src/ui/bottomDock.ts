// The bottom dock: a strip along the lowest band of the screen, where no
// duck ever walks (they stop 50 world-px short of the edge). Left: the care
// hotbar — every hands-on tool as a slot with its count, one click to arm,
// the way a farm sim's hotbar works. Right: the panel buttons. Built once;
// the UI updates the counts and toggles the armed slot.
import { FOODS, TREATS, type FoodKind } from '../sim/food';
import { el } from './dom';
import { icon } from './icons';
import { keyFor, keyLabel } from './settings';
import type { PanelKind } from './ui';

interface BottomDockHost {
  togglePanel(kind: PanelKind): void;
  toggleFeedMode(kind: FoodKind | 'brush'): void;
  openRace(): void;
  showCards(): boolean;
  toggleCardRail(): void;
}

interface BottomDockRefs {
  element: HTMLElement;
  careCounts: Partial<Record<FoodKind, HTMLElement>>;
}

export function buildBottomDock(host: BottomDockHost): BottomDockRefs {
  const careCounts: Partial<Record<FoodKind, HTMLElement>> = {};
  const slot = (kind: FoodKind | 'brush', badge: Element, label: string, title: string): HTMLElement => {
    const count = kind === 'brush' ? null : el('span', { class: 'care-slot-count' }, '0');
    if (count) careCounts[kind as FoodKind] = count;
    return el(
      'button',
      { class: 'hud-btn care-slot', 'data-kind': kind, title, onclick: () => host.toggleFeedMode(kind) },
      badge,
      el('span', { class: 'care-slot-label' }, label),
      count,
    );
  };
  const dot = (kind: FoodKind): HTMLElement => {
    const d = el('span', { class: 'treat-dot' });
    d.style.background = FOODS[kind].color;
    return d;
  };
  const hotbar = el(
    'div',
    { class: 'care-hotbar' },
    slot('feed', icon('wheat', 13), 'Feed', 'Feed — click the pond to scatter it'),
    slot('premiumFeed', icon('sparkle', 13), 'Premium', 'Premium feed — more filling, and what a wild visitor wants'),
    ...TREATS.map((kind) => slot(kind, dot(kind), FOODS[kind].name, `${FOODS[kind].name} — every duck secretly loves one treat`)),
    slot('brush', icon('bubbles', 13), 'Brush', 'Brush — rub a grubby duck to scrub it clean'),
  );
  const actions = el(
    'div',
    { class: 'dock-actions' },
    el('button', { class: 'hud-btn unlock-breeding', onclick: () => host.togglePanel('breeding') }, icon('heart'), el('span', { class: 'hud-btn-label' }, 'Breed')),
    el('button', { class: 'hud-btn unlock-shop', onclick: () => host.togglePanel('shop') }, icon('cart'), el('span', { class: 'hud-btn-label' }, 'Shop')),
    el('button', { class: 'hud-btn', onclick: () => host.togglePanel('roster') }, icon('list'), el('span', { class: 'hud-btn-label' }, 'Flock')),
    el('button', { class: 'hud-btn unlock-book', onclick: () => host.togglePanel('book') }, icon('book'), el('span', { class: 'hud-btn-label' }, 'Book')),
    el('button', { class: 'hud-btn unlock-race', onclick: () => host.openRace() }, icon('flag'), el('span', { class: 'hud-btn-label' }, 'Race')),
    el(
      'button',
      { class: `hud-btn cards-btn${host.showCards() ? ' active' : ''}`, title: 'Show duck cards on the main screen', onclick: () => host.toggleCardRail() },
      icon('cards'),
      el('span', { class: 'hud-btn-label' }, 'Cards'),
    ),
    el('button', { class: 'hud-btn', onclick: () => host.togglePanel('save') }, icon('disk'), el('span', { class: 'hud-btn-label' }, 'Save')),
    el('button', { class: 'hud-btn settings-btn', title: `Settings and keyboard shortcuts (${keyLabel(keyFor('settings'))})`, onclick: () => host.togglePanel('settings') }, icon('star')),
  );
  return { element: el('div', { class: 'bottom-dock' }, hotbar, actions), careCounts };
}
