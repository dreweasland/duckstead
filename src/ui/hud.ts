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
import { keyFor, keyLabel } from './settings';
import { TUNING } from '../sim/tuning';

type HudCountKey = 'coin' | 'feed' | 'premium' | 'medicine' | 'soap' | 'pond' | 'flock' | 'eggs' | 'society' | 'line';

interface HudHost {
  game: Game;
  toast(msg: string): void;
  onFestivalChip(): void;
  togglePanel(kind: PanelKind): void;
  openHall(): void;
  toggleCareMenu(): void;
  toggleFeedMode(kind: FoodKind | 'brush'): void;
  showCards(): boolean;
  toggleCardRail(): void;
  setSpeed(speed: number): void;
  openRace(): void;
}

interface HudRefs {
  element: HTMLElement;
  hudClock: HTMLElement;
  festivalChip: HTMLElement;
  hudCounts: Record<HudCountKey, HTMLElement>;
  careCounts: Partial<Record<FoodKind, HTMLElement>>;
}

export function buildHud(host: HudHost): HudRefs {
  const careCounts: Partial<Record<FoodKind, HTMLElement>> = {};
  const hudCounts = {} as HudRefs['hudCounts'];
  const hudClock = el('span', { class: 'hud-clock' });
  const festivalChip = el('button', { class: 'hud-chip festival-chip', onclick: () => host.onFestivalChip() });
  // Cloud-sync status chip: only exists once a device has been linked.
  const syncChip = el('span', { class: 'hud-chip sync-chip', style: 'display:none' });
  events.on('sync-status', (status) => {
    const st = status as string;
    syncChip.style.display = '';
    syncChip.className = `hud-chip sync-chip sync-${st}`;
    const word = st === 'synced' ? 'synced' : st === 'syncing' ? 'syncing…' : st === 'offline' ? 'offline' : 'paused';
    syncChip.replaceChildren('☁', el('span', { class: 'chip-word' }, word));
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

  // The line: champions and deepest generation — the score of the game, in
  // the bar at all times. A button, since it opens the Hall of Champions.
  const lineCount = el('span', { class: 'hud-chip-count' }, '0');
  hudCounts.line = lineCount;
  const lineChip = el(
    'button',
    { class: 'hud-chip chip-line', title: 'The line: champions · deepest generation. Opens the Hall of Champions.', onclick: () => host.openHall() },
    icon('crown', 13),
    lineCount,
  );

  // Resource chips: the icon is built once; only the count span updates.
  const chip = (
    key: HudCountKey,
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
    chip('soap', 'bubbles', 'Soap — the bath house uses a bar per duck at dawn'),
    chip('eggs', 'egg', 'Egg basket — hens lay daily; sell at the shop'),
    chip('pond', 'bubbles', `Pond cleanliness — wild ducks only visit above ${TUNING.visitors.inviteCleanliness}%`),
    chip('flock', 'duck', 'Grown ducks on the pond / capacity — over it, the flock is stressed. Elders, the young, and penned ducks don\'t count.'),
    lineChip,
    chip('society', 'star', 'Society points — earned from champions, breed awards, commissions, festival placings, and new feather colours'),
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

  // The buttons live in one group so that, when the bar is too narrow for
  // everything on one line, they drop to a second row together instead of
  // wrapping wherever the width happens to run out.
  const actions = el(
    'span',
    { class: 'hud-actions' },
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
    el('button', { class: 'hud-btn settings-btn', title: `Settings and keyboard shortcuts (${keyLabel(keyFor('settings'))})`, onclick: () => host.togglePanel('settings') }, icon('star')),
    el('span', { class: 'hud-speed' }, ...speedBtns),
  );
  const element = el(
    'header',
    { class: 'hud' },
    el('span', { class: 'hud-title' }, icon('duck', 20), ''),
    hudClock,
    chips,
    festivalChip,
    syncChip,
    el('span', { class: 'hud-spacer' }),
    actions,
  );
  return { element, hudClock, festivalChip, hudCounts, careCounts };
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
