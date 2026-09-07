// The almanac: the top-left corner card — the time, big; the weather and
// the date; the festival and cloud chips; and the speed controls, which
// belong with the clock. "Sleep 'til dawn" joins the actions row at night.
// Built once; the UI writes the text and swaps the festival chip's contents
// only when they change.
import { events } from '../events';
import { isSyncConfigured } from '../sync/syncMeta';
import { el } from './dom';
import { icon } from './icons';

interface AlmanacHost {
  onFestivalChip(): void;
  setSpeed(speed: number): void;
}

interface AlmanacRefs {
  element: HTMLElement;
  time: HTMLElement;
  date: HTMLElement;
  weather: HTMLElement;
  festivalChip: HTMLElement;
  actions: HTMLElement; // the speed controls, and whatever the night adds
}

export function buildAlmanac(host: AlmanacHost): AlmanacRefs {
  const time = el('span', { class: 'almanac-time' }, '06:00');
  const weather = el('span', { class: 'almanac-weather muted' });
  const date = el('div', { class: 'almanac-date muted' });
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
  const speedBtns = [0, 1, 4, 16].map((s) =>
    el('button', { class: 'speed-btn', 'data-speed': s, onclick: () => host.setSpeed(s) }, s === 0 ? icon('pause', 12) : `${s}×`),
  );
  speedBtns[1].classList.add('active');
  const actions = el('div', { class: 'almanac-row actions' }, el('span', { class: 'hud-speed' }, ...speedBtns));
  const element = el(
    'section',
    { class: 'corner-card almanac', 'aria-label': 'Clock and calendar' },
    el('div', { class: 'almanac-row clock' }, time, weather),
    date,
    el('div', { class: 'almanac-row chips' }, festivalChip, syncChip),
    actions,
  );
  return { element, time, date, weather, festivalChip, actions };
}
