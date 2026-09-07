// The top bar: clock, resource chips, the festival and sync chips, and the
// speed controls. Tools and panel buttons live in the bottom dock. Built once; the UI keeps the
// refs it needs to update counts and chips.
import type { Game } from '../game';
import { events } from '../events';
import { isSyncConfigured } from '../sync/syncMeta';
import { el } from './dom';
import { icon } from './icons';
import { TUNING } from '../sim/tuning';

type HudCountKey = 'coin' | 'feed' | 'premium' | 'medicine' | 'soap' | 'pond' | 'flock' | 'eggs' | 'society' | 'line';

interface HudHost {
  game: Game;
  toast(msg: string): void;
  onFestivalChip(): void;
  openHall(): void;
  setSpeed(speed: number): void;
}

interface HudRefs {
  element: HTMLElement;
  hudClock: HTMLElement;
  festivalChip: HTMLElement;
  hudCounts: Record<HudCountKey, HTMLElement>;
}

export function buildHud(host: HudHost): HudRefs {
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

  const speed = el('span', { class: 'hud-speed' }, ...speedBtns);
  const element = el(
    'header',
    { class: 'hud' },
    el('span', { class: 'hud-title' }, icon('duck', 20), ''),
    hudClock,
    chips,
    festivalChip,
    syncChip,
    el('span', { class: 'hud-spacer' }),
    speed,
  );
  return { element, hudClock, festivalChip, hudCounts };
}
