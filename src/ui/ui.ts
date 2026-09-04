import type { Game } from '../game';
import type { Renderer } from '../render/renderer';
import { events } from '../events';
import { formatClock } from '../sim/time';
import { goalUnlocking, type ChapterDef, type GoalGo } from '../sim/goals';
import type { Unlockable } from '../sim/unlocks';
import { FESTIVAL_NAMES, festivalEnteredToday, festivalToday, festivalTitle, upcomingFestival } from '../sim/festivals';
import { openEggShow, openGrandPrix, openMarketStall, openWinterLights, type FestivalHost } from './festivalScreens';
import type { Duck } from '../sim/duck';
import { isNight, TICKS_PER_HOUR } from '../sim/time';
import { FOODS, TREATS, type FoodKind, type TreatKind } from '../sim/food';
import { isUnlocked, UNLOCK_LABELS, UNLOCKABLES } from '../sim/unlocks';
import { cleanPond } from '../sim/pond';
import { duckById } from '../state';
import { duckCapacity, pondOccupancy } from '../sim/economy';
import { el } from './dom';
import { icon } from './icons';
import { railSignature, renderCardRail } from './cardRail';
import { renderDuckPanel } from './duckPanel';
import { renderBreedingPanel, showBreedingTab } from './breedingPanel';
import { renderShopPanel, showShopTab } from './shopPanel';
import { renderRosterPanel } from './rosterPanel';
import { renderSavePanel, resetSavePanelState } from './savePanel';
import { renderBookPanel, showBookTab } from './bookPanel';
import { renderGoalsPanel } from './goalsPanel';
import { renderSettingsPanel } from './settingsPanel';
import { buildHud } from './hud';
import { bindCanvasInput } from './canvasInput';
import { installTooltips } from './tooltip';
import { actionForKey, loadSettings } from './settings';
import { keyCaptureActive } from './settingsPanel';
import { play, quack, setAmbienceNight, unlockAudio, wireGameAudio } from '../audio/audio';
import { WEATHER_NAMES, weatherOf } from '../sim/weather';
import { openRacePanel } from './racePanel';
import { TUNING } from '../sim/tuning';
import { plural } from '../text';
import { FloatWindows } from './floatWindows';
import { DecorMode } from './decorMode';
import { Notices, type ToastTone } from './notices';
import { SideWidgets } from './sideWidgets';

export type PanelKind = 'duck' | 'breeding' | 'shop' | 'roster' | 'save' | 'book' | 'settings' | 'goals';

// UI preference, not game state — deliberately outside the save file.
const CARDS_PREF_KEY = 'ducksim:ui:cards';
// Inner scrollable lists whose scroll position must survive the periodic
// panel rebuild. Any new scroll region in a panel belongs in this list.
const SCROLL_REGIONS = '.chooser, .card-grid, .br-cand-grid, .dawn-body, .society-ladder, .chronicle, .nest-grid, .gene-table-wrap';

export class UI {
  private root: HTMLElement;
  private hudClock!: HTMLElement;
  private hudCounts: Record<'coin' | 'feed' | 'premium' | 'medicine' | 'pond' | 'flock' | 'eggs' | 'society', HTMLElement> =
    {} as Record<'coin' | 'feed' | 'premium' | 'medicine' | 'pond' | 'flock' | 'eggs' | 'society', HTMLElement>;
  private panelHost: HTMLElement;
  private toastHost: HTMLElement;
  private bannerHost: HTMLElement;
  // Two independent slots: the floating duck card and the centred modal
  // (shop/flock/book/breeding/save) can be open at the same time, so a card
  // pinned for comparison survives opening the Breeding or Shop panel.
  private openModalKind: Exclude<PanelKind, 'duck'> | null = null;
  private duckCardOpen = false;
  private justOpenedModal = false;
  private justOpenedDuck = false;
  private pointerDownInPanel = false;
  private pointerDownInRail = false;
  private feedMode: 'none' | FoodKind | 'brush' = 'none';
  private careCounts: Partial<Record<FoodKind, HTMLElement>> = {};
  private unlockedSeen = new Set<string>();
  private hudReady = false; // first HUD refresh seeds unlockedSeen silently
  private railHost!: HTMLElement;
  private side!: SideWidgets;
  private floatHost!: HTMLElement;
  private modalHost!: HTMLElement;
  // The floating duck card + pinned copies, and decoration placement, live
  // in their own modules; the UI keeps thin delegates for the public calls.
  private floats!: FloatWindows;
  private decor!: DecorMode;
  private notices!: Notices;
  private festivalChip!: HTMLElement;
  private lifeChip!: HTMLElement;
  private showCards = localStorage.getItem(CARDS_PREF_KEY) === '1';

  constructor(
    readonly game: Game,
    readonly renderer: Renderer,
  ) {
    this.root = document.getElementById('ui-root')!;
    loadSettings();
    wireGameAudio();
    // Browsers only open audio after a gesture; the first one anywhere does.
    window.addEventListener('pointerdown', () => unlockAudio(), { passive: true });
    window.addEventListener('keydown', () => unlockAudio());
    installTooltips();
    const hud = buildHud({
      game: this.game,
      toast: (m) => this.toast(m),
      onFestivalChip: () => this.onFestivalChip(),
      openLifeEvent: () => this.notices.openLifeEvent(),
      togglePanel: (k) => this.togglePanel(k),
      toggleCareMenu: () => this.toggleCareMenu(),
      toggleFeedMode: (k) => this.toggleFeedMode(k),
      showCards: () => this.showCards,
      toggleCardRail: () => this.toggleCardRail(),
      setSpeed: (sp) => this.setSpeed(sp),
      openRace: () => this.openRace(),
    });
    this.hudClock = hud.hudClock;
    this.festivalChip = hud.festivalChip;
    this.lifeChip = hud.lifeChip;
    this.hudCounts = hud.hudCounts;
    this.careCounts = hud.careCounts;
    this.root.append(hud.element);
    this.panelHost = el('div', { class: 'panel-host' });
    this.toastHost = el('div', { class: 'toast-host' });
    this.bannerHost = el('div', { class: 'banner-host' });
    this.railHost = el('div', { class: 'rail-host' });
    this.side = new SideWidgets({ game: this.game, openPanel: (k) => this.openPanel(k) });
    this.floatHost = el('div', { class: 'float-host' });
    this.modalHost = el('div', { class: 'modal-host' });
    this.root.append(this.railHost, this.side.element, this.panelHost, this.modalHost, this.floatHost, this.bannerHost, this.toastHost);
    this.floats = new FloatWindows({
      ui: this,
      root: this.root,
      floatHost: this.floatHost,
      modalHost: this.modalHost,
      modalOpen: () => this.openModalKind !== null,
      pointerDownInPanel: () => {
        this.pointerDownInPanel = true;
      },
    });
    this.floats.bindFloatDrag();
    this.decor = new DecorMode(this.game, this.renderer, (m) => this.toast(m));
    this.notices = new Notices({
      game: this.game,
      root: this.root,
      bannerHost: this.bannerHost,
      toastHost: this.toastHost,
      openPanel: (k) => this.openPanel(k),
      refreshPanel: () => this.refreshPanel(),
      closePanel: () => this.closePanel(),
    });
    this.railHost.addEventListener('pointerdown', () => {
      this.pointerDownInRail = true;
    });
    // A horizontal strip should side-scroll with a plain mouse wheel, not
    // just shift+wheel. Wheel events over cards bubble here.
    this.railHost.addEventListener(
      'wheel',
      (e) => {
        const rail = this.railHost.firstElementChild as HTMLElement | null;
        if (!rail || rail.scrollWidth <= rail.clientWidth) return;
        const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        rail.scrollLeft += delta;
        e.preventDefault();
      },
      { passive: false },
    );

    // Sim-originated toasts are things the player didn't do (a duck fell
    // sick, a festival opened): they get the louder, longer-lived look.
    events.on('toast', (msg) => this.toast(String(msg), 'alert'));
    events.on('dawn', () => this.notices.showDawnCard());
    events.on('favourite-found', (d) => {
      const duck = d as { pos: { x: number; y: number } };
      for (let i = 0; i < 6; i += 1) this.renderer.spawnParticle(duck.pos.x, duck.pos.y - 18, 'heart');
      if (this.duckCardOpen) this.refreshPanel();
    });
    events.on('duck-grew', (payload) => {
      const { duck, to } = payload as { duck: Duck; to: 'juvenile' | 'adult' | 'elder' };
      for (let i = 0; i < (to === 'juvenile' ? 6 : 10); i += 1) {
        this.renderer.spawnParticle(duck.pos.x, duck.pos.y - 14, 'sparkle');
      }
      if (to === 'adult') {
        this.notices.lifeBanner('grown', duck, `${duck.name} is all grown up`, [
          'Come of age — ready to nest, race, and win rosettes.',
        ]);
      } else if (to === 'elder') {
        this.notices.lifeBanner('elder', duck, `${duck.name} is an elder now`, [
          'A wise old bird — done with nesting, honoured on the bank.',
        ]);
      }
    });
    events.on('duck-died', (payload) => {
      const { duck, descendants, honoured, ageDays } = payload as {
        duck: Duck; descendants: number; honoured: number; ageDays?: number;
      };
      for (let i = 0; i < 9; i += 1) this.renderer.spawnParticle(duck.pos.x, duck.pos.y - 6, 'feather');
      const lines = [
        duck.stage === 'elder'
          ? `Passed peacefully${ageDays !== undefined ? ` at ${ageDays} days` : ''}.`
          : `Died young${ageDays !== undefined ? ` at ${ageDays} days` : ''}.`,
      ];
      if (descendants > 0) lines.push(`${duck.sex === 'F' ? 'Her' : 'His'} line lives on in ${plural(descendants, 'duck')}.`);
      if (honoured > 0) lines.push(`A feather rests in the album — the Society honours a life well lived (+${honoured}).`);
      this.notices.lifeBanner('passing', duck, `Farewell, ${duck.name}`, lines);
      if (this.duckCardOpen) this.refreshPanel();
    });
    events.on('chapter-done', (payload) => this.notices.chapterBanner(payload as ChapterDef));
    events.on('takeover', (payload) => this.notices.showTakeoverOverlay(Boolean((payload as { remote?: boolean } | undefined)?.remote)));
    // The companion put the pond down: the state was reloaded from the cloud
    // and play may carry on where the phone left it.
    events.on('resumed', () => {
      this.root.querySelector('.takeover-overlay')?.remove();
      this.closePanel();
      this.setSpeed(1);
      this.toast('The pond is back — carrying on from where the other device left it.');
    });
    events.on('life-event', () => this.notices.openLifeEvent());

    // Never rebuild the panel mid-press: a rebuild between pointerdown and
    // pointerup destroys the button under the cursor and swallows the click.
    this.panelHost.addEventListener('pointerdown', () => {
      this.pointerDownInPanel = true;
    });
    this.floatHost.addEventListener('pointerdown', () => {
      this.pointerDownInPanel = true;
    });
    this.modalHost.addEventListener('pointerdown', () => {
      this.pointerDownInPanel = true;
    });
    window.addEventListener('pointerup', () => {
      this.pointerDownInPanel = false;
      this.pointerDownInRail = false;
    });

    window.addEventListener('keydown', (e) => this.onKey(e));

    this.bindCanvas();
    this.refreshCardRail();
    setInterval(() => {
      this.refreshPanel();
      this.refreshCardRail();
    }, 500);
    setInterval(() => this.refreshHud(), 250);
  }

  // Keyboard: Esc closes whatever is on top; number keys open the panels;
  // Tab is kept inside an open modal. Typing in a field is left alone.
  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if (e.key === 'Escape') {
      if (this.decorModeActive()) {
        this.endDecorMode();
        this.toast('Cancelled');
        return;
      }
      const overlayClose = document.querySelector<HTMLElement>('.race-overlay .close-btn');
      if (overlayClose) {
        overlayClose.click();
        return;
      }
      if (typing) {
        target.blur();
        return;
      }
      if (this.openModalKind) this.closeModal();
      else if (this.duckCardOpen) this.closeDuckCard();
      return;
    }
    if (e.key === 'Tab' && this.openModalKind && this.modalHost.firstElementChild) {
      const focusables = [...this.modalHost.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (focusables.length > 0) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!this.modalHost.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || keyCaptureActive()) return;
    if (document.querySelector('.race-overlay')) return; // the paddle key belongs to the race
    switch (actionForKey(e.key)) {
      case 'breeding': this.togglePanel('breeding'); break;
      case 'shop': this.togglePanel('shop'); break;
      case 'roster': this.togglePanel('roster'); break;
      case 'book': this.togglePanel('book'); break;
      case 'race': this.openRace(); break;
      case 'save': this.togglePanel('save'); break;
      case 'cards': this.toggleCardRail(); break;
      case 'settings': this.togglePanel('settings'); break;
      case 'pause': this.setSpeed(this.game.speed === 0 ? 1 : 0); break;
      case 'faster': this.setSpeed(this.game.speed === 0 ? 1 : this.game.speed === 1 ? 4 : 16); break;
      case 'slower': this.setSpeed(this.game.speed === 16 ? 4 : this.game.speed === 4 ? 1 : 0); break;
      default: return;
    }
    e.preventDefault();
  }

  setSpeed(speed: number): void {
    this.game.speed = speed;
    this.root.querySelectorAll('.speed-btn').forEach((b) => b.classList.toggle('active', Number(b.getAttribute('data-speed')) === speed));
  }


  toggleFeedMode(mode: FoodKind | 'brush'): void {
    this.feedMode = this.feedMode === mode ? 'none' : mode;
    document.body.classList.toggle('feeding', this.feedMode !== 'none');
    const careBtn = this.root.querySelector('.care-btn')!;
    careBtn.classList.toggle('active', this.feedMode !== 'none');
    const label = this.root.querySelector('.care-label')!;
    label.textContent =
      this.feedMode === 'none'
        ? 'Care'
        : this.feedMode === 'brush'
          ? 'Brush'
          : FOODS[this.feedMode].name;
    this.root.querySelectorAll<HTMLElement>('.treat-pick').forEach((b) => b.classList.toggle('active', b.dataset.kind === this.feedMode));
    this.root.querySelector('.care-menu')?.classList.remove('open');
    if (this.feedMode === 'brush') this.toast('Rub a grubby duck to brush it clean!');
    else if (TREATS.includes(this.feedMode as TreatKind)) this.toast(`Click the pond to toss ${FOODS[this.feedMode as FoodKind].name.toLowerCase()}`);
  }


  private toggleCareMenu(): void {
    this.root.querySelector('.care-menu')?.classList.toggle('open');
  }

  private bindCanvas(): void {
    bindCanvasInput(this);
  }

  // ---- decoration placement (see decorMode.ts) ----
  decorClick(world: { x: number; y: number }): void {
    this.decor.decorClick(world);
  }

  decorModeActive(): boolean {
    return this.decor.decorModeActive();
  }

  startMovingDecor(idx: number, world: { x: number; y: number }): void {
    this.decor.startMovingDecor(idx, world);
  }

  startPlacingDecor(def: import('../sim/economy').DecorDef): void {
    this.decor.startPlacingDecor(def);
  }

  endDecorMode(): void {
    this.decor.endDecorMode();
  }

  updateDecorGhost(world: { x: number; y: number }): void {
    this.decor.updateDecorGhost(world);
  }

  // ---- pinned comparison cards (see floatWindows.ts) ----
  pinDuck(id: string): void {
    this.floats.pinDuck(id);
  }

  unpinDuck(id: string): void {
    this.floats.unpinDuck(id);
  }

  isPinned(id: string): boolean {
    return this.floats.isPinned(id);
  }

  feedModeNow(): 'none' | FoodKind | 'brush' {
    return this.feedMode;
  }

  duckCardIsOpen(): boolean {
    return this.duckCardOpen;
  }

  modalKindNow(): Exclude<PanelKind, 'duck'> | null {
    return this.openModalKind;
  }

  // A locked panel explains itself instead of doing nothing: the goal that
  // opens it is the answer, and the Goals list is where it lives.
  private gate(what: Unlockable): boolean {
    if (isUnlocked(this.game.state, what)) return true;
    const goal = goalUnlocking(what);
    this.toast(goal ? `${UNLOCK_LABELS[what]} is locked — "${goal.label}" (in Goals) unlocks it.` : `${UNLOCK_LABELS[what]} is locked.`);
    return false;
  }

  openRace(): void {
    if (!this.gate('race')) return;
    openRacePanel(this.game, { toast: (m) => this.toast(m) }, { league: true });
  }

  togglePanel(kind: PanelKind): void {
    if ((kind === 'breeding' || kind === 'shop' || kind === 'book') && !this.gate(kind)) return;
    const open = kind === 'duck' ? this.duckCardOpen : this.openModalKind === kind;
    if (open) {
      if (kind === 'duck') this.closeDuckCard();
      else this.closeModal();
    } else this.openPanel(kind);
  }

  openPanel(kind: PanelKind): void {
    // Animate only when the panel actually appears or changes kind — swapping
    // ducks inside an open panel should feel instant, not replay the slide.
    if (kind === 'duck') {
      this.justOpenedDuck = !this.duckCardOpen;
      this.duckCardOpen = true;
    } else {
      this.justOpenedModal = this.openModalKind !== kind;
      this.openModalKind = kind;
    }
    this.refreshPanel();
  }

  closeDuckCard(): void {
    this.duckCardOpen = false;
    this.floatHost.classList.remove('above-overlay');
    this.floatHost.replaceChildren();
  }

  closeModal(): void {
    this.openModalKind = null;
    this.panelHost.replaceChildren();
    this.modalHost.replaceChildren();
    resetSavePanelState();
  }

  // Close everything (used by the takeover overlay).
  closePanel(): void {
    this.closeDuckCard();
    this.closeModal();
  }

  // Open a duck's card; with `pin` (ctrl/cmd-click) it opens as a pinned
  // comparison window instead of replacing the main card.
  selectDuck(id: string, pin = false): void {
    if (pin) {
      if (this.isPinned(id)) return;
      if (!this.duckCardOpen) {
        // Nothing to compare against yet: just open it normally.
        this.game.selectedDuckId = id;
        this.openPanel('duck');
        return;
      }
      this.pinDuck(id);
      return;
    }
    this.game.selectedDuckId = id;
    this.openPanel('duck');
    const duck = duckById(this.game.state, id);
    if (duck && duck.stage !== 'egg') quack(duck.phenotype.sizeScale, duck.sex, duck.stage === 'duckling' ? 2 : 1);
  }

  refreshPanel(): void {
    if (this.pointerDownInPanel) return;
    // Don't rebuild while the user is mid-entry in a panel field — a rebuild
    // would replace the control and steal focus mid-keystroke (or mid-drag,
    // for a slider). A focused checkbox doesn't count: its click *is* the
    // change, and holding the rebuild would hide what it just toggled.
    const midEntry = (node: Element | null): boolean => {
      if (!node) return false;
      if (node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) return true;
      return node instanceof HTMLInputElement && node.type !== 'checkbox' && node.type !== 'radio' && node.type !== 'button';
    };
    const active0 = document.activeElement;
    const typingInPin = active0 && this.floats.pinnedContains(active0) && midEntry(active0);
    if (!typingInPin) this.floats.refreshPinned();
    if (!this.duckCardOpen && !this.openModalKind) return;
    const active = document.activeElement;
    if (
      active &&
      (this.panelHost.contains(active) || this.floatHost.contains(active) || this.modalHost.contains(active)) &&
      midEntry(active)
    ) {
      return;
    }

    // The floating duck card and the centred modal render independently, so
    // both can be on screen at once.
    if (this.duckCardOpen) {
      const panel = renderDuckPanel({ game: this.game, ui: this, close: () => this.closeDuckCard() });
      if (panel) {
        panel.classList.add('floating');
        this.floats.applyFloatPos();
        if (!this.justOpenedDuck) panel.classList.add('no-anim');
        this.justOpenedDuck = false;
        this.swapPanel(this.floatHost, panel);
      } else {
        this.closeDuckCard();
      }
    }

    if (this.openModalKind) {
      const ctx = { game: this.game, ui: this, close: () => this.closeModal() };
      let panel: HTMLElement | null = null;
      switch (this.openModalKind) {
        case 'breeding':
          panel = renderBreedingPanel(ctx);
          break;
        case 'shop':
          panel = renderShopPanel(ctx);
          break;
        case 'roster':
          panel = renderRosterPanel(ctx);
          break;
        case 'save':
          panel = renderSavePanel(ctx);
          break;
        case 'book':
          panel = renderBookPanel(ctx);
          break;
        case 'settings':
          panel = renderSettingsPanel(ctx);
          break;
        case 'goals':
          panel = renderGoalsPanel(ctx);
          break;
      }
      if (panel) {
        panel.classList.add('modal');
        if (!this.justOpenedModal) panel.classList.add('no-anim');
        this.justOpenedModal = false;
        this.swapPanel(this.modalHost, panel);
      } else {
        this.closeModal();
      }
    }
  }

  // Swap a host's panel for a freshly built one, preserving scroll positions
  // (panel body + any scrollable lists) across the rebuild, or periodic
  // refreshes would yank the user back to the top.
  private swapPanel(host: HTMLElement, panel: HTMLElement): void {
    const oldPanel = host.firstElementChild as HTMLElement | null;
    const panelScroll = oldPanel?.scrollTop ?? 0;
    const listScrolls = [...(oldPanel?.querySelectorAll(SCROLL_REGIONS) ?? [])].map(
      (n) => n.scrollTop,
    );
    host.replaceChildren(panel);
    panel.scrollTop = panelScroll;
    [...panel.querySelectorAll(SCROLL_REGIONS)].forEach((n, i) => {
      if (listScrolls[i] !== undefined) n.scrollTop = listScrolls[i];
    });
  }

  // "Show me": land where a goal is done. Locked panels explain themselves.
  goTo(go: GoalGo): void {
    this.closeModal();
    switch (go.panel) {
      case 'care':
        this.toggleCareMenu();
        return;
      case 'race':
        if (!this.gate('race')) return;
        this.openRace();
        return;
      case 'shop':
        if (go.tab) showShopTab(go.tab);
        break;
      case 'book':
        if (go.tab) showBookTab(go.tab);
        break;
      case 'breeding':
        if (go.tab) showBreedingTab(go.tab);
        break;
      default:
        break;
    }
    this.togglePanel(go.panel);
  }

  private refreshHud(): void {
    const s = this.game.state;
    this.side.refresh();
    this.refreshFestivalChip();
    this.lifeChip.style.display = s.lifeEvent ? '' : 'none';
    const weather = weatherOf(s);
    this.hudClock.textContent = weather === 'clear' ? formatClock(s.clock) : `${formatClock(s.clock)} · ${WEATHER_NAMES[weather]}`;
    setAmbienceNight(isNight(s.clock));
    this.hudCounts.coin.textContent = String(s.money);
    this.hudCounts.feed.textContent = String(s.inventory.feed);
    this.hudCounts.premium.textContent = String(s.inventory.premiumFeed);
    this.hudCounts.medicine.textContent = String(s.inventory.medicine);
    this.hudCounts.eggs.textContent = String(s.inventory.eggs);
    this.hudCounts.society.textContent = String(s.society.points);
    for (const [kind, node] of Object.entries(this.careCounts)) {
      node.textContent = String(s.inventory[kind as keyof typeof s.inventory]);
    }
    // Night: offer to sleep through to dawn.
    const sleepBtn = this.root.querySelector<HTMLElement>('.sleep-btn');
    if (isNight(s.clock) && !this.game.stale) {
      if (!sleepBtn) {
        const btn = el(
          'button',
          {
            class: 'hud-btn sleep-btn',
            title: 'Skip to 06:00 — the flock is asleep anyway',
            onclick: () => {
              this.sleepToDawnAnimated();
            },
          },
          icon('pause', 13),
          "Sleep 'til dawn",
        );
        this.root.querySelector('.hud')!.append(btn);
      }
    } else {
      sleepBtn?.remove();
    }
    // Progressive reveal: panels appear as the goal chain introduces them.
    for (const what of UNLOCKABLES) {
      const open = isUnlocked(s, what);
      const btn = this.root.querySelector<HTMLElement>(`.unlock-${what}`);
      if (btn) {
        btn.classList.toggle('locked', !open);
        const badge = btn.querySelector('.lock-badge');
        if (!open && !badge) {
          btn.append(el('span', { class: 'lock-badge' }, icon('lock', 9)));
          const goal = goalUnlocking(what);
          btn.setAttribute('data-tip', goal ? `Locked — complete "${goal.label}" (in Goals) to open ${UNLOCK_LABELS[what]}` : 'Locked');
        } else if (open && badge) {
          badge.remove();
          btn.removeAttribute('data-tip');
        }
      }
      if (open && !this.unlockedSeen.has(what)) {
        this.unlockedSeen.add(what);
        if (this.hudReady) this.toast(`${UNLOCK_LABELS[what]} unlocked!`);
      }
    }
    this.hudReady = true;
    const occ = pondOccupancy(s);
    const cap = duckCapacity(s);
    this.hudCounts.flock.textContent = `${occ}/${cap}`;
    this.hudCounts.flock.parentElement?.classList.toggle('chip-bad', occ > cap);
    this.hudCounts.flock.parentElement?.classList.toggle('chip-low', occ === cap);
    const pondPct = Math.round(s.pond.cleanliness);
    this.hudCounts.pond.textContent = `${pondPct}%`;
    this.hudCounts.pond.parentElement?.classList.toggle('chip-low', pondPct < TUNING.visitors.inviteCleanliness);
    // Pond cleanliness nudge. Wild ducks stop visiting below 70%, so the
    // scrub button shows from there — urgently once the water is truly foul.
    const existing = this.root.querySelector<HTMLElement>('.pond-warn');
    if (pondPct < TUNING.visitors.inviteCleanliness) {
      const urgent = pondPct < 30;
      if (!existing) {
        const warn = el(
          'button',
          {
            class: 'hud-btn pond-warn',
            onclick: () => {
              cleanPond(this.game.state);
              play('splash');
              this.toast('You scrubbed the pond sparkling clean!');
              warn.remove();
            },
          },
          icon('broom'),
          el('span', { class: 'pond-warn-label' }, urgent ? 'Clean pond!' : 'Scrub pond'),
        );
        warn.classList.toggle('urgent', urgent);
        this.root.querySelector('.hud')!.append(warn);
      } else {
        existing.classList.toggle('urgent', urgent);
        existing.querySelector('.pond-warn-label')!.textContent = urgent ? 'Clean pond!' : 'Scrub pond';
      }
    } else {
      existing?.remove();
    }
  }

  private toggleCardRail(): void {
    this.showCards = !this.showCards;
    localStorage.setItem(CARDS_PREF_KEY, this.showCards ? '1' : '0');
    this.root.querySelector('.cards-btn')?.classList.toggle('active', this.showCards);
    this.refreshCardRail();
  }

  // Sleep 'til dawn, spread across animation frames: ~600 ticks per frame
  // keeps the night visibly sweeping past instead of freezing the tab.
  private sleepingToDawn = false;

  private sleepToDawnAnimated(): void {
    if (this.sleepingToDawn) return;
    this.sleepingToDawn = true;
    const limit = 10 * TICKS_PER_HOUR;
    let total = 0;
    const step = (): void => {
      const { slept, done } = this.game.sleepChunk(Math.min(600, limit - total));
      total += slept;
      if (!done && slept > 0 && total < limit) {
        requestAnimationFrame(step);
        return;
      }
      this.sleepingToDawn = false;
      if (total > 0) {
        this.game.save();
        this.toast('You dozed off by the pond and woke at dawn');
        this.refreshPanel();
        this.refreshCardRail();
      }
    };
    step();
  }

  private lastRailSig = '';

  private refreshCardRail(): void {
    document.body.classList.toggle('cards-on', this.showCards);
    if (!this.showCards) {
      this.railHost.replaceChildren();
      return;
    }
    if (this.pointerDownInRail) return;
    // Skip the rebuild (and its 20 portraits) when nothing visible changed —
    // the 500ms cadence mostly fires on an unchanged flock.
    const sig = railSignature(this.game);
    if (sig === this.lastRailSig && this.railHost.firstElementChild) return;
    this.lastRailSig = sig;
    // Preserve horizontal scroll across rebuilds.
    const prevScroll = (this.railHost.firstElementChild as HTMLElement | null)?.scrollLeft ?? 0;
    const rail = renderCardRail(this.game, {
      select: (id, pin) => this.selectDuck(id, pin),
      refresh: () => this.refreshCardRail(),
      toast: (msg) => this.toast(msg),
    });
    this.railHost.replaceChildren(rail);
    rail.scrollLeft = prevScroll;
  }

  private refreshFestivalChip(): void {
    const clock = this.game.state.clock;
    const today = festivalToday(clock);
    if (today) {
      const entered =
        (today === 'eggShow' || today === 'grandPrix') &&
        festivalEnteredToday(this.game.state, today);
      this.festivalChip.replaceChildren(
        icon('flag', 11),
        ` ${festivalTitle(this.game.state, today)}${entered ? ' (entered)' : ''}`,
      );
      this.festivalChip.classList.add('today');
    } else {
      const { kind, inDays } = upcomingFestival(clock);
      this.festivalChip.replaceChildren(icon('flag', 11), ` ${festivalTitle(this.game.state, kind)} in ${inDays}d`);
      this.festivalChip.classList.remove('today');
    }
  }

  private festivalHost(): FestivalHost {
    return {
      game: this.game,
      root: this.root,
      floatHost: this.floatHost,
      toast: (m) => this.toast(m),
      selectDuck: (id) => this.selectDuck(id),
    };
  }

  private onFestivalChip(): void {
    const state = this.game.state;
    const today = festivalToday(state.clock);
    if (!today) {
      const { kind, inDays } = upcomingFestival(state.clock);
      this.toast(`The ${FESTIVAL_NAMES[kind]} is in ${plural(inDays, 'day')}!`);
      return;
    }
    const host = this.festivalHost();
    switch (today) {
      case 'eggShow':
        openEggShow(host);
        break;
      case 'grandPrix':
        openGrandPrix(host);
        break;
      case 'marketDay':
        openMarketStall(host);
        break;
      case 'winterLights':
        openWinterLights(host);
        break;
    }
  }

  toast(msg: string, tone?: ToastTone): void {
    this.notices.toast(msg, tone);
  }
}

export interface PanelCtx {
  game: Game;
  ui: UI;
  close: () => void;
  duckId?: string; // for duck cards: which duck (defaults to the selected one)
  pinned?: boolean; // this card is a pinned comparison copy
}
