// Everything that pops up over the pond without being a panel: toasts,
// the life and chapter banners, the dawn card, the life-event card, and
// the takeover overlay. The UI keeps a `toast` delegate; the rest are
// called on this object directly.
import type { Game } from '../game';
import type { Duck } from '../sim/duck';
import type { LifeEvent } from '../sim/lifeEvents';
import { describeLifeEvent, lifeEventChoices, resolveLifeEvent } from '../sim/lifeEvents';
import { CHAPTERS, type ChapterDef } from '../sim/goals';
import { dawnReport } from '../sim/daybook';
import { TUNING } from '../sim/tuning';
import { duckById } from '../state';
import { claimAndReload } from '../sync/sync';
import { el } from './dom';
import { icon } from './icons';
import { duckPortrait } from './portrait';
import { backToPondRow, eventCard } from './eventCard';
import type { PanelKind } from './ui';

interface NoticesHost {
  game: Game;
  root: HTMLElement;
  bannerHost: HTMLElement;
  toastHost: HTMLElement;
  openPanel(kind: PanelKind): void;
  refreshPanel(): void;
  closePanel(): void;
}

// How much a toast is allowed to interrupt. `echo` is feedback for the
// thing you just clicked (a pickup, a pour): it appears at the pointer for
// a moment and never enters the main stack. `info` is the default. `alert`
// is something you didn't cause — a duck fell sick, a festival opened — so
// it lives longer, looks louder, and is never pushed off by echoes.
export type ToastTone = 'echo' | 'info' | 'alert';

const TOAST_STACK_MAX = 3;
const TOAST_LIFE_MS: Record<Exclude<ToastTone, 'echo'>, number> = { info: 3500, alert: 6000 };
const ECHO_LIFE_MS = 1300;

interface LiveToast {
  msg: string;
  node: HTMLElement;
  count: number;
  countNode: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
}

export class Notices {
  // Where the last pointer press landed, so echoes can appear beside it.
  private lastPointer = { x: window.innerWidth / 2, y: 120 };
  private echoHost: HTMLElement;
  private live: LiveToast[] = [];

  constructor(private host: NoticesHost) {
    this.echoHost = el('div', { class: 'echo-host' });
    host.root.append(this.echoHost);
    window.addEventListener('pointerdown', (e) => {
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }, { passive: true });
  }

  // A chapter closing is a moment, not a toast.
  chapterBanner(ch: ChapterDef): void {
    const idx = CHAPTERS.findIndex((c) => c.id === ch.id);
    const next = CHAPTERS[idx + 1];
    this.showBanner(
      'chapter',
      el('span', { class: 'life-portrait chapter-icon' }, icon('flag', 26)),
      `Chapter complete: ${ch.title}`,
      [`+${ch.reward} coins for the purse.`, next ? `Next: ${next.title} — ${next.blurb}` : 'Every chapter done. The pond is yours.'],
      10_000,
      () => this.host.openPanel('goals'),
    );
  }

  // A centred, longer-lived notice that can't slip past the way a toast can:
  // at most three on screen (oldest evicted), click to dismiss, gone after
  // `ttlMs`. Life moments and chapter closings both come through here.
  private showBanner(cls: string, portrait: HTMLElement, title: string, lines: string[], ttlMs: number, onClick?: () => void): void {
    while (this.host.bannerHost.children.length >= 3) this.host.bannerHost.firstElementChild!.remove();
    const node = el(
      'div',
      { class: `life-banner ${cls}` },
      portrait,
      el(
        'div',
        { class: 'life-text' },
        el('div', { class: 'life-title' }, title),
        ...lines.map((l) => el('div', { class: 'life-line' }, l)),
      ),
    );
    const dismiss = () => {
      if (!node.isConnected) return;
      node.classList.remove('show');
      setTimeout(() => node.remove(), 400);
    };
    node.addEventListener('click', () => {
      dismiss();
      onClick?.();
    });
    this.host.bannerHost.append(node);
    setTimeout(() => node.classList.add('show'), 10);
    setTimeout(dismiss, ttlMs);
  }


  showTakeoverOverlay(remote = false): void {
    this.host.closePanel();
    // Both the cross-tab and cross-device paths can fire — never stack two.
    this.host.root.querySelector('.takeover-overlay')?.remove();
    this.host.root.append(
      el(
        'div',
        { class: 'takeover-overlay' },
        el(
          'div',
          { class: 'takeover-card' },
          icon('duck', 34),
          el('strong', {}, remote ? 'The pond is on another device' : 'Pond opened in another tab'),
          el(
            'div',
            { class: 'muted' },
            remote
              ? 'This device has paused so the two copies cannot overwrite each other. When the other device puts the pond down, play picks up here on its own.'
              : 'This tab has stopped playing and saving so the two tabs cannot overwrite each other.',
          ),
          el(
            'button',
            {
              class: 'action-btn primary',
              onclick: () => {
                if (remote) claimAndReload().catch(() => this.toast('Could not reach the cloud — try again in a moment.'));
                else location.reload();
              },
            },
            remote ? 'Take it back now' : 'Play in this tab instead',
          ),
        ),
      ),
    );
  }

  // A life event card: what's happening, who it's happening to, and the
  // choices — each with its trade-off spelled out. Closing without choosing
  // leaves the chip lit; by evening the flock decides for itself.
  openLifeEvent(): void {
    const state = this.host.game.state;
    const ev: LifeEvent | null = state.lifeEvent;
    if (!ev) return;
    const card = eventCard(this.host.root, 'life');
    if (!card) return;
    const { text, title } = describeLifeEvent(state, ev);
    const duck = duckById(state, ev.duckId);
    const other = duckById(state, ev.otherId);
    const portraits = el('div', { class: 'life-event-portraits' });
    if (duck) portraits.append(duckPortrait(duck, 64));
    if (other) portraits.append(el('span', { class: 'life-event-vs' }, 'vs'), duckPortrait(other, 64));
    const choices = el('div', { class: 'life-event-choices' });
    for (const c of lifeEventChoices(state, ev)) {
      choices.append(
        el(
          'button',
          {
            class: 'life-choice',
            disabled: !c.ok,
            title: c.reason ?? '',
            onclick: () => {
              const outcome = resolveLifeEvent(state, this.host.game.rng, c.id);
              if (outcome === null) return;
              card.card.replaceChildren(
                card.header('duck', title),
                portraits,
                el('div', { class: 'life-event-outcome' }, outcome),
                backToPondRow(card.close),
              );
              this.host.refreshPanel();
            },
          },
          el('strong', {}, c.label),
          el('span', { class: 'muted small' }, c.ok ? c.blurb : c.reason ?? c.blurb),
        ),
      );
    }
    card.card.append(
      card.header('duck', title),
      portraits,
      el('div', { class: 'life-event-text' }, text),
      choices,
      el('div', { class: 'muted small life-event-hint' }, 'Decide later from the HUD — by evening the flock settles it their own way.'),
    );
  }

  // The 06:00 briefing: a morning postcard — seasonal header, stat tiles,
  // then grouped lines. Dismissed by its button, a click outside, or a timer.
  showDawnCard(): void {
    this.host.root.querySelector('.dawn-card')?.remove();
    const report = dawnReport(this.host.game.state);

    const tile = (iconName: Parameters<typeof icon>[0], value: string, label: string, cls = '') =>
      el('div', { class: `dawn-tile ${cls}` }, icon(iconName, 14), el('strong', {}, value), el('span', { class: 'dawn-tile-label' }, label));
    const { stats } = report;
    const tiles = el(
      'div',
      { class: 'dawn-tiles' },
      tile('coin', String(stats.coins), 'coins'),
      tile('duck', `${stats.occupancy}/${stats.capacity}`, stats.occupancy > stats.capacity ? 'overcrowded' : 'on the pond', stats.occupancy >= stats.capacity ? 'warn' : ''),
      tile('egg', String(stats.eggs), stats.eggs === 1 ? 'egg' : 'eggs'),
      tile('bubbles', `${stats.pond}%`, 'pond', stats.pond < TUNING.visitors.inviteCleanliness ? 'warn' : ''),
    );

    const body = el('div', { class: 'dawn-body' }, tiles);
    for (const section of report.sections) {
      body.append(el('div', { class: 'dawn-section-title' }, section.title));
      for (const line of section.lines) {
        const badge = line.duck
          ? el('span', { class: 'dawn-badge portrait' }, duckPortrait(line.duck, 34))
          : el('span', { class: `dawn-badge ${line.urgent ? 'urgent' : ''}` }, icon(line.icon, 14));
        body.append(
          el(
            'div',
            { class: `dawn-line${line.urgent ? ' urgent' : ''}` },
            badge,
            el('div', { class: 'dawn-text' }, el('div', {}, line.text), line.detail ? el('div', { class: 'dawn-detail' }, line.detail) : null),
          ),
        );
      }
    }

    const card = el(
      'div',
      { class: `dawn-card ${report.season}` },
      el(
        'div',
        { class: 'dawn-header' },
        el('div', { class: 'dawn-sun' }),
        el(
          'div',
          { class: 'dawn-header-text' },
          el('div', { class: 'dawn-day' }, report.dayLabel),
          el('div', { class: 'dawn-greeting' }, report.greeting),
        ),
        report.festivalChip ? el('span', { class: 'dawn-festival with-icon' }, icon('flag', 11), report.festivalChip) : null,
      ),
      body,
      el('div', { class: 'dawn-footer' }, el('button', { class: 'action-btn primary', onclick: () => dismiss() }, 'Start the day')),
    );
    const dismiss = () => {
      card.classList.remove('show');
      setTimeout(() => card.remove(), 300);
    };
    card.addEventListener('click', (e) => {
      // A click on the card body keeps it open; the button dismisses.
      e.stopPropagation();
    });
    this.host.root.append(card);
    requestAnimationFrame(() => card.classList.add('show'));
    setTimeout(() => {
      if (card.isConnected) dismiss();
    }, 20_000);
  }

  // The pond's big life moments — coming of age, elderhood, and passings —
  // with the duck's portrait.
  lifeBanner(tone: 'grown' | 'elder' | 'passing', duck: Duck, title: string, lines: string[]): void {
    this.showBanner(tone, el('span', { class: 'life-portrait' }, duckPortrait(duck, 44)), title, lines, tone === 'passing' ? 12_000 : 8_000);
  }

  toast(msg: string, tone: ToastTone = 'info'): void {
    if (tone === 'echo') {
      this.echo(msg);
      return;
    }
    // The same message again while it's still up: bump its count and give
    // it a fresh life instead of stacking three copies of "got sick!".
    const same = this.live.find((t) => t.msg === msg);
    if (same) {
      same.count += 1;
      same.countNode.textContent = `×${same.count}`;
      clearTimeout(same.timer);
      same.timer = setTimeout(() => this.dismissToast(same), TOAST_LIFE_MS[tone]);
      return;
    }
    while (this.live.length >= TOAST_STACK_MAX) this.dismissToast(this.live[0]);
    const countNode = el('span', { class: 'toast-count' });
    const node = el('div', { class: `toast ${tone}` }, msg, countNode);
    const entry: LiveToast = { msg, node, count: 1, countNode, timer: setTimeout(() => this.dismissToast(entry), TOAST_LIFE_MS[tone]) };
    this.live.push(entry);
    this.host.toastHost.append(node);
    setTimeout(() => node.classList.add('show'), 10);
  }

  private dismissToast(entry: LiveToast): void {
    const i = this.live.indexOf(entry);
    if (i >= 0) this.live.splice(i, 1);
    clearTimeout(entry.timer);
    entry.node.classList.remove('show');
    setTimeout(() => entry.node.remove(), 400);
  }

  // A short label that floats up from where you clicked and is gone. Kept
  // out of the top stack on purpose: a burst of pickups must not bury the
  // notice that a duck fell sick.
  private echo(msg: string): void {
    const rect = this.host.root.getBoundingClientRect();
    const node = el('div', { class: 'echo' }, msg);
    node.style.left = `${this.lastPointer.x - rect.left}px`;
    node.style.top = `${this.lastPointer.y - rect.top - 28}px`;
    while (this.echoHost.children.length >= TOAST_STACK_MAX) this.echoHost.firstElementChild!.remove();
    this.echoHost.append(node);
    setTimeout(() => node.classList.add('show'), 10);
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 300);
    }, ECHO_LIFE_MS);
  }
}
