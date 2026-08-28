// The top bar: clock, resource chips, festival and life-event chips, the
// care menu, panel buttons, and speed controls. Built once; the UI keeps the
// refs it needs to update counts and chips.
import type { Game } from '../game';
import type { PanelKind } from './ui';
import { events } from '../events';
import { isSyncConfigured } from '../sync/syncMeta';
import { FOODS, TREATS, type FoodKind } from '../sim/food';
import { el } from './dom';
import { icon } from './icons';

export type HudCountKey = 'coin' | 'feed' | 'premium' | 'medicine' | 'pond' | 'flock' | 'eggs' | 'society';

export interface HudHost {
  game: Game;
  toast(msg: string): void;
  onFestivalChip(): void;
  openLifeEvent(): void;
  togglePanel(kind: PanelKind): void;
  toggleCareMenu(): void;
  toggleFeedMode(kind: FoodKind | 'brush'): void;
  showCards(): boolean;
  toggleCardRail(): void;
  setSpeed(speed: number): void;
  openRace(): void;
}

export interface HudRefs {
  element: HTMLElement;
  hudClock: HTMLElement;
  festivalChip: HTMLElement;
  lifeChip: HTMLElement;
  hudCounts: Record<HudCountKey, HTMLElement>;
  careCounts: Partial<Record<FoodKind, HTMLElement>>;
}

export function buildHud(host: HudHost): HudRefs {
  const careCounts: Partial<Record<FoodKind, HTMLElement>> = {};
  const hudCounts = {} as HudRefs['hudCounts'];
  const hudClock = el('span', { class: 'hud-clock' });
  const festivalChip = el('button', { class: 'hud-chip festival-chip', onclick: () => host.onFestivalChip() });
  // A pending life event: shown until answered (or until evening settles it).
  const lifeChip = el(
    'button',
    { class: 'hud-chip life-chip', style: 'display:none', title: 'Something is happening on the pond — click to decide', onclick: () => host.openLifeEvent() },
    icon('warning', 12),
    el('span', {}, 'Decide'),
  );

  // Cloud-sync status chip: only exists once a device has been linked.
  const syncChip = el('span', { class: 'hud-chip sync-chip', style: 'display:none' });
  events.on('sync-status', (status) => {
    const st = status as string;
    syncChip.style.display = '';
    syncChip.className = `hud-chip sync-chip sync-${st}`;
    syncChip.textContent =
      st === 'synced' ? '☁ synced' : st === 'syncing' ? '☁ syncing…' : st === 'offline' ? '☁ offline' : '☁ paused';
    syncChip.title =
      st === 'offline'
        ? 'Cloud unreachable — playing locally, will sync when it returns'
        : st === 'stale'
          ? 'Another device owns the pond right now'
          : 'Cloud save is up to date';
  });
  if (isSyncConfigured()) {
    syncChip.style.display = '';
    syncChip.textContent = '☁';
  }

  // Resource chips: the icon is built once; only the count span updates.
  const chip = (
    key: 'coin' | 'feed' | 'premium' | 'medicine' | 'pond' | 'flock' | 'eggs' | 'society',
    iconName: Parameters<typeof icon>[0],
    label: string,
  ): HTMLElement => {
    const count = el('span', { class: 'hud-chip-count' }, '0');
    hudCounts[key] = count;
    return el('span', { class: `hud-chip chip-${key}`, title: label }, icon(iconName, 13), count);
  };
  const chips = el(
    'span',
    { class: 'hud-chips' },
    chip('coin', 'coin', 'Coins'),
    chip('feed', 'wheat', 'Feed'),
    chip('premium', 'sparkle', 'Premium feed'),
    chip('medicine', 'pill', 'Medicine'),
    chip('eggs', 'egg', 'Egg basket — hens lay daily; sell at the shop'),
    chip('pond', 'bubbles', 'Pond cleanliness — wild ducks only visit above 70%'),
    chip('flock', 'duck', 'Ducks on the pond / capacity — over it, the flock is stressed. Elders have earned a free spot and don\'t count.'),
    chip('society', 'star', 'Society points — earned from breed awards, commissions, and festival placings'),
  );

  const speedBtns = [0, 1, 4, 16].map((s) =>
    el(
      'button',
      {
        class: 'speed-btn',
        'data-speed': s,
        onclick: () => host.setSpeed(s),
      },
      s === 0 ? icon('pause', 12) : `${s}×`,
    ),
  );
  speedBtns[1].classList.add('active');

  const element = el(
    'header',
    { class: 'hud' },
    el('span', { class: 'hud-title' }, icon('duck', 20), ''),
    hudClock,
    chips,
    festivalChip,
    lifeChip,
    syncChip,
    el('span', { class: 'hud-spacer' }),
    el(
      'span',
      { class: 'treats-wrap care-wrap' },
      el(
        'button',
        {
          class: 'hud-btn care-btn',
          title: 'Care tools: feed, treats, and the brush',
          onclick: () => host.toggleCareMenu(),
        },
        icon('wheat'),
        el('span', { class: 'hud-btn-label care-label' }, 'Care'),
      ),
      buildCareMenu(host, careCounts),
    ),
    el(
      'button',
      { class: 'hud-btn unlock-breeding', onclick: () => host.togglePanel('breeding') },
      icon('heart'),
      el('span', { class: 'hud-btn-label' }, 'Breed'),
    ),
    el('button', { class: 'hud-btn unlock-shop', onclick: () => host.togglePanel('shop') }, icon('cart'), el('span', { class: 'hud-btn-label' }, 'Shop')),
    el('button', { class: 'hud-btn', onclick: () => host.togglePanel('roster') }, icon('list'), el('span', { class: 'hud-btn-label' }, 'Flock')),
    el('button', { class: 'hud-btn unlock-book', onclick: () => host.togglePanel('book') }, icon('book'), el('span', { class: 'hud-btn-label' }, 'Book')),
    el(
      'button',
      { class: 'hud-btn unlock-race', onclick: () => host.openRace() },
      icon('flag'),
      el('span', { class: 'hud-btn-label' }, 'Race'),
    ),
    el(
      'button',
      {
        class: `hud-btn cards-btn${host.showCards() ? ' active' : ''}`,
        title: 'Show duck cards on the main screen',
        onclick: () => host.toggleCardRail(),
      },
      icon('cards'),
      el('span', { class: 'hud-btn-label' }, 'Cards'),
    ),
    el('button', { class: 'hud-btn', onclick: () => host.togglePanel('save') }, icon('disk'), el('span', { class: 'hud-btn-label' }, 'Save')),
    el('button', { class: 'hud-btn settings-btn', title: 'Settings and keyboard shortcuts (?)', onclick: () => host.togglePanel('settings') }, icon('star')),
    ...speedBtns,
  );
  return { element, hudClock, festivalChip, lifeChip, hudCounts, careCounts };
}

// One menu for every hands-on tool: scatter feed, toss treats, brush.
function buildCareMenu(host: HudHost, careCounts: Partial<Record<FoodKind, HTMLElement>>): HTMLElement {
  const menu = el('div', { class: 'treats-menu care-menu' });
  const foodPick = (kind: FoodKind, iconName: Parameters<typeof icon>[0], label: string): void => {
    const count = el('span', { class: 'treat-count' }, '0');
    careCounts[kind] = count;
    menu.append(
      el(
        'button',
        { class: 'treat-pick', 'data-kind': kind, onclick: () => host.toggleFeedMode(kind) },
        icon(iconName, 13),
        label,
        count,
      ),
    );
  };
  foodPick('feed', 'wheat', 'Feed');
  foodPick('premiumFeed', 'sparkle', 'Premium');
  for (const kind of TREATS) {
    const count = el('span', { class: 'treat-count' }, '0');
    careCounts[kind] = count;
    menu.append(
      el(
        'button',
        { class: 'treat-pick', 'data-kind': kind, onclick: () => host.toggleFeedMode(kind) },
        el('span', { class: 'treat-dot' }),
        FOODS[kind].name,
        count,
      ),
    );
    (menu.lastElementChild!.querySelector('.treat-dot') as HTMLElement).style.background = FOODS[kind].color;
  }
  menu.append(
    el(
      'button',
      { class: 'treat-pick', 'data-kind': 'brush', title: 'Rub over a duck to scrub it clean', onclick: () => host.toggleFeedMode('brush') },
      icon('bubbles', 13),
      'Brush',
    ),
    el('div', { class: 'muted small treat-hint' }, 'Every duck secretly loves one treat.'),
  );
  return menu;
}
