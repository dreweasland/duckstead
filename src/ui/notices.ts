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

export class Notices {
  constructor(private host: NoticesHost) {}

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

  toast(msg: string): void {
    const node = el('div', { class: 'toast' }, msg);
    this.host.toastHost.append(node);
    setTimeout(() => node.classList.add('show'), 10);
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 400);
    }, 3500);
  }
}
