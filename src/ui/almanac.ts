// The almanac: the top-left corner card. A day-night dial and the time,
// big, with the date and a cloud-sync dot beside them; the weather and the
// festival chip beneath; and, to the right, the speed control as one
// segmented switch. "Sleep 'til dawn" joins that column at
// night. Two lines tall by design, whatever the content does.
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
  dial: SVGElement; // the disc that rides the ring; see setDialHour
  festivalChip: HTMLElement;
  actions: HTMLElement; // speed, sync, and whatever the night adds
}

const DIAL_R = 10;

// The dial: a 24-hour ring, noon at the top, midnight at the bottom, with a
// disc riding it — gold by day, pale at night. The upper half is the day.
function buildDial(): { svg: SVGSVGElement; disc: SVGElement } {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('class', 'almanac-dial');
  svg.setAttribute('aria-hidden', 'true');
  const day = document.createElementNS(ns, 'path');
  day.setAttribute('d', `M ${14 - DIAL_R} 14 A ${DIAL_R} ${DIAL_R} 0 0 1 ${14 + DIAL_R} 14`);
  day.setAttribute('class', 'dial-day');
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', '14');
  ring.setAttribute('cy', '14');
  ring.setAttribute('r', String(DIAL_R));
  ring.setAttribute('class', 'dial-ring');
  const disc = document.createElementNS(ns, 'circle');
  disc.setAttribute('r', '3.2');
  disc.setAttribute('class', 'dial-disc');
  svg.append(ring, day, disc);
  return { svg, disc };
}

export function setDialHour(disc: SVGElement, hour: number, night: boolean): void {
  const a = ((hour / 24) * Math.PI * 2) - Math.PI / 2 + Math.PI; // noon at the top
  disc.setAttribute('cx', (14 + Math.cos(a) * DIAL_R).toFixed(2));
  disc.setAttribute('cy', (14 + Math.sin(a) * DIAL_R).toFixed(2));
  disc.classList.toggle('night', night);
}

export function buildAlmanac(host: AlmanacHost): AlmanacRefs {
  const { svg, disc } = buildDial();
  const time = el('span', { class: 'almanac-time' }, '06:00');
  const date = el('span', { class: 'almanac-date' });
  const weather = el('span', { class: 'almanac-weather' });
  const festivalChip = el('button', { class: 'hud-chip festival-chip', onclick: () => host.onFestivalChip() });
  // Cloud-sync status: a small cloud after the date, coloured by state, with
  // the words in its tooltip. It only exists once a device has been linked.
  const syncChip = el('span', { class: 'sync-chip', style: 'display:none' }, '☁');
  events.on('sync-status', (status) => {
    const st = status as string;
    syncChip.style.display = '';
    syncChip.className = `sync-chip sync-${st}`;
    const word = st === 'synced' ? 'Cloud save is up to date' : st === 'syncing' ? 'Syncing…' : st === 'offline' ? 'Cloud unreachable — playing locally, will sync when it returns' : 'Another device owns the pond right now';
    syncChip.title = word;
    syncChip.setAttribute('aria-label', word);
  });
  if (isSyncConfigured()) {
    syncChip.style.display = '';
    syncChip.title = 'Cloud sync';
  }
  const speedBtns = [0, 1, 4, 16].map((s) =>
    el('button', { class: 'speed-btn', 'data-speed': s, title: s === 0 ? 'Pause' : `${s}× speed`, onclick: () => host.setSpeed(s) }, s === 0 ? icon('pause', 12) : `${s}×`),
  );
  speedBtns[1].classList.add('active');
  const actions = el('div', { class: 'almanac-side' }, el('span', { class: 'hud-speed', role: 'group', 'aria-label': 'Game speed' }, ...speedBtns));
  const element = el(
    'section',
    { class: 'corner-card almanac', 'aria-label': 'Clock and calendar' },
    svg,
    el(
      'div',
      { class: 'almanac-main' },
      el('div', { class: 'almanac-row' }, time, el('span', { class: 'almanac-when' }, date), syncChip),
      el('div', { class: 'almanac-row' }, weather, festivalChip),
    ),
    actions,
  );
  return { element, time, date, weather, dial: disc, festivalChip, actions };
}
