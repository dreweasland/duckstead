import type { Game } from '../game';
import type { Renderer } from '../render/renderer';
import { events } from '../events';
import { formatDate, formatTime } from '../sim/time';
import { goalUnlocking, type ChapterDef, type GoalGo } from '../sim/goals';
import type { Unlockable } from '../sim/unlocks';
import { FESTIVAL_NAMES, festivalEnteredToday, festivalToday, festivalTitle, upcomingFestival } from '../sim/festivals';
import { openEggShow, openGrandPrix, openMarketStall, openWinterLights, type FestivalHost } from './festivalScreens';
import type { Duck } from '../sim/duck';
import { hourOf, isNight, TICKS_PER_HOUR } from '../sim/time';
import { FOODS, TREATS, type FoodKind, type TreatKind } from '../sim/food';
import { isUnlocked, UNLOCK_LABELS, UNLOCKABLES } from '../sim/unlocks';
import { duckById } from '../state';
import { duckCapacity, pondOccupancy } from '../sim/economy';
import { el } from './dom';
import { icon } from './icons';
import { flockSignature, renderFlockBar } from './flockBar';
import { renderDuckPanel } from './duckPanel';
import { renderBreedingPanel, showBreedingTab } from './breedingPanel';
import { renderShopPanel, showShopTab } from './shopPanel';
import { renderRosterPanel } from './rosterPanel';
import { renderSavePanel, resetSavePanelState } from './savePanel';
import { renderBookPanel, showBookTab } from './bookPanel';
import { breedKey, breedLabel } from '../sim/breedBook';
import { championCheck } from '../sim/line';
import { renderGoalsPanel } from './goalsPanel';
import { renderSettingsPanel } from './settingsPanel';
import { buildAlmanac, setDialHour } from './almanac';
import { MARKS, type Mark } from '../sim/marks';
import { buildLedger, type LedgerKey } from './ledger';
import { bindCanvasInput } from './canvasInput';
import { installTooltips } from './tooltip';
import { actionForKey, loadSettings } from './settings';
import { keyCaptureActive } from './settingsPanel';
import { quack, setAmbienceNight, unlockAudio, wireGameAudio } from '../audio/audio';
import { WEATHER_NAMES, weatherOf } from '../sim/weather';
import { openRacePanel } from './racePanel';
import { TUNING } from '../sim/tuning';
import { plural } from '../text';
import { DuckDock } from './duckDock';
import { DecorMode } from './decorMode';
import { Notices, type ToastTone } from './notices';
import { NoticeColumn } from './noticeColumn';
import { buildBottomDock } from './bottomDock';
import { SideWidgets } from './sideWidgets';

export type PanelKind = 'duck' | 'breeding' | 'shop' | 'roster' | 'save' | 'book' | 'settings' | 'goals';

// UI preference, not game state — deliberately outside the save file.
const FLOCK_BAR_PREF_KEY = 'ducksim:ui:flockBar';
// Inner scrollable lists whose scroll position must survive the periodic
// panel rebuild. Any new scroll region in a panel belongs in this list.
const SCROLL_REGIONS = '.chooser, .card-grid, .br-cand-grid, .dawn-body, .society-ladder, .chronicle, .nest-grid, .gene-table-wrap';

export class UI {
  private root: HTMLElement;
  private almanac!: ReturnType<typeof buildAlmanac>;
  private festivalSig = '';
  private hudCounts!: Record<LedgerKey, HTMLElement>;
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
  private pointerDownInFlockBar = false;
  private feedMode: 'none' | FoodKind | 'brush' = 'none';
  private careCounts: Partial<Record<FoodKind, HTMLElement>> = {};
  private unlockedSeen = new Set<string>();
  private hudReady = false; // first HUD refresh seeds unlockedSeen silently
  private flockBarHost!: HTMLElement;
  private side!: SideWidgets;
  private dockHost!: HTMLElement;
  private modalHost!: HTMLElement;
  // The floating duck card + pinned copies, and decoration placement, live
  // in their own modules; the UI keeps thin delegates for the public calls.
  private dock!: DuckDock;
  private decor!: DecorMode;
  private notices!: Notices;
  private noticeColumn!: NoticeColumn;
  private showFlockBar = localStorage.getItem(FLOCK_BAR_PREF_KEY) !== '0';

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
    this.almanac = buildAlmanac({
      onFestivalChip: () => this.onFestivalChip(),
      setSpeed: (sp) => this.setSpeed(sp),
    });
    const ledger = buildLedger({ openHall: () => this.openHall() });
    const dock = buildBottomDock({
      togglePanel: (k) => this.togglePanel(k),
      toggleFeedMode: (k) => this.toggleFeedMode(k),
      openRace: () => this.openRace(),
    });
    this.hudCounts = ledger.counts;
    this.careCounts = dock.careCounts;
    this.root.append(this.almanac.element, ledger.element);
    // Each column below the top anchors to what is actually above it — the
    // widgets to the almanac, the notices to the ledger, the windows to the
    // flock bar — and those heights depend on wrapping and content, so the
    // surfaces publish them rather than CSS guessing.
    this.publishHeight([this.almanac.element], '--almanac-h', 0);
    this.publishHeight([ledger.element], '--ledger-h', 0);
    this.publishHeight([this.almanac.element, ledger.element], '--corner-h', 10);
    this.noticeColumn = new NoticeColumn({
      game: this.game,
      renderer: this.renderer,
      toast: (m, tone) => this.toast(m, tone),
      openLifeEvent: () => this.openLifeEvent(),
      selectDuck: (id) => this.selectDuck(id),
      openPanel: (k) => this.openPanel(k),
      refreshPanel: () => this.refreshPanel(),
    });
    this.toastHost = this.noticeColumn.toastHost;
    // The duck dock starts below the notices, however many there are.
    this.publishHeight([this.noticeColumn.stack], '--notices-h', 0);
    this.bannerHost = el('div', { class: 'banner-host' });
    this.flockBarHost = el('div', { class: 'flock-bar-host' });
    this.publishHeight([this.flockBarHost], '--flock-h', 0);
    this.side = new SideWidgets({ game: this.game, openPanel: (k) => this.openPanel(k), openHall: () => this.openHall() });
    this.dockHost = el('div', { class: 'duck-dock' });
    this.modalHost = el('div', { class: 'modal-host' });
    this.root.append(this.flockBarHost, this.side.element, this.modalHost, this.dockHost, this.bannerHost, this.noticeColumn.element, dock.element);
    this.dock = new DuckDock({
      ui: this,
      dock: this.dockHost,
      pointerDownInPanel: () => {
        this.pointerDownInPanel = true;
      },
      toast: (m) => this.toast(m),
    });
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
    this.flockBarHost.addEventListener('pointerdown', () => {
      this.pointerDownInFlockBar = true;
    });

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
      const { duck, to, marks = [] } = payload as { duck: Duck; to: 'juvenile' | 'adult' | 'elder'; marks?: Mark[] };
      for (let i = 0; i < (to === 'juvenile' ? 6 : 10); i += 1) {
        this.renderer.spawnParticle(duck.pos.x, duck.pos.y - 14, 'sparkle');
      }
      if (to === 'adult') {
        this.notices.lifeBanner('grown', duck, `${duck.name} is all grown up`, [
          'Come of age — ready to nest, race, and win rosettes.',
          ...marks.map((m) => `${MARKS[m].label}: ${MARKS[m].blurb}`),
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
    events.on('champion', (payload) => {
      const duck = payload as Duck;
      const check = championCheck(duck);
      this.notices.lifeBanner('champion', duck, `${duck.name} is a Champion`, [
        `A ${breedLabel(breedKey(duck.genome))} at the standard, purebred, gen ${check.gen} of the ${this.game.state.line.name} line.`,
        'Recorded in the Hall of Champions for good.',
      ]);
    });
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
    this.modalHost.addEventListener('pointerdown', () => {
      this.pointerDownInPanel = true;
    });
    window.addEventListener('pointerup', () => {
      this.pointerDownInPanel = false;
      this.pointerDownInFlockBar = false;
    });

    window.addEventListener('keydown', (e) => this.onKey(e));

    this.bindCanvas();
    this.refreshFlockBar();
    setInterval(() => {
      this.refreshPanel();
      this.refreshFlockBar();
      this.noticeColumn.refresh();
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
      case 'cards': this.toggleFlockBar(); break;
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
    this.root.querySelectorAll<HTMLElement>('.care-slot').forEach((b) => b.classList.toggle('active', b.dataset.kind === this.feedMode));
    if (this.feedMode === 'brush') this.toast('Rub a grubby duck to brush it clean!');
    else if (TREATS.includes(this.feedMode as TreatKind)) this.toast(`Click the pond to toss ${FOODS[this.feedMode as FoodKind].name.toLowerCase()}`);
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

  // ---- pinned comparison cards (see duckDock.ts) ----
  pinDuck(id: string): void {
    this.dock.pinDuck(id);
  }

  unpinDuck(id: string): void {
    this.dock.unpinDuck(id);
  }

  isPinned(id: string): boolean {
    return this.dock.isPinned(id);
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
      // The dock takes the right edge: modals and overlays make room for it.
      this.root.classList.add('dock-open');
      this.dockHost.classList.add('has-cards');
    } else {
      this.justOpenedModal = this.openModalKind !== kind;
      this.openModalKind = kind;
    }
    this.refreshPanel();
  }

  // A life event card (a broody hen, a rivalry) — the notices column opens
  // it, and so can the smoke test.
  openLifeEvent(): void {
    this.notices.openLifeEvent();
  }

  // The Hall of Champions lives in the Book.
  openHall(): void {
    showBookTab('hall');
    this.openPanel('book');
  }

  closeDuckCard(): void {
    this.duckCardOpen = false;
    this.dockHost.classList.remove('above-overlay');
    this.dock.mainSlot.replaceChildren();
    this.root.classList.remove('dock-open');
    if (!this.dock.hasPins()) this.dockHost.classList.remove('has-cards');
  }

  closeModal(): void {
    this.openModalKind = null;
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
    const typingInPin = active0 && this.dock.pinnedContains(active0) && midEntry(active0);
    if (!typingInPin) this.dock.refreshPinned();
    if (!this.duckCardOpen && !this.openModalKind) return;
    const active = document.activeElement;
    if (
      active &&
      (this.dockHost.contains(active) || this.modalHost.contains(active)) &&
      midEntry(active)
    ) {
      return;
    }

    // The floating duck card and the centred modal render independently, so
    // both can be on screen at once.
    if (this.duckCardOpen) {
      const panel = renderDuckPanel({ game: this.game, ui: this, close: () => this.closeDuckCard() });
      if (panel) {
        panel.classList.add('docked');
        if (!this.justOpenedDuck) panel.classList.add('no-anim');
        this.justOpenedDuck = false;
        this.swapPanel(this.dock.mainSlot, panel);
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
        // "Show me" for a care goal: arm the feed so the next click on the pond does it.
        if (this.feedMode === 'none') this.toggleFeedMode('feed');
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

  // The corner cards publish their taller height as a CSS variable, since
  // what hangs below them anchors to it.
  private publishHeight(nodes: HTMLElement[], varName: string, pad: number): void {
    if (typeof ResizeObserver === 'undefined') return;
    const publish = (): void => this.root.style.setProperty(varName, `${Math.max(...nodes.map((n) => n.offsetHeight)) + pad}px`);
    const ro = new ResizeObserver(publish);
    for (const n of nodes) ro.observe(n);
    publish();
  }

  private refreshHud(): void {
    this.side.refresh();
    this.refreshAlmanac();
    this.refreshLedger();
    this.refreshDock();
  }

  // Clock, weather, date, the festival chip, and the night's sleep button.
  private refreshAlmanac(): void {
    const s = this.game.state;
    this.refreshFestivalChip();
    const weather = weatherOf(s);
    this.almanac.time.textContent = formatTime(s.clock);
    this.almanac.weather.textContent = weather === 'clear' ? '' : WEATHER_NAMES[weather];
    this.almanac.date.textContent = formatDate(s.clock);
    setDialHour(this.almanac.dial, hourOf(s.clock), isNight(s.clock));
    setAmbienceNight(isNight(s.clock));
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
        this.almanac.actions.append(btn);
      }
    } else {
      sleepBtn?.remove();
    }
  }

  // Coins, points, the line, flock against capacity, pond cleanliness.
  private refreshLedger(): void {
    const s = this.game.state;
    this.hudCounts.coin.textContent = String(s.money);
    this.hudCounts.society.textContent = String(s.society.points);
    this.hudCounts.line.textContent = `${s.line.championsTotal} · gen ${s.stats.deepestGen}`;
    this.hudCounts.line.parentElement!.title = `The ${s.line.name} line — ${plural(s.line.championsTotal, 'champion')}, deepest generation ${s.stats.deepestGen}. Opens the Hall of Champions.`;
    const occ = pondOccupancy(s);
    const cap = duckCapacity(s);
    this.hudCounts.flock.textContent = `${occ}/${cap}`;
    this.hudCounts.flock.parentElement?.classList.toggle('chip-bad', occ > cap);
    this.hudCounts.flock.parentElement?.classList.toggle('chip-low', occ === cap);
    const pondPct = Math.round(s.pond.cleanliness);
    this.hudCounts.pond.textContent = `${pondPct}%`;
    this.hudCounts.pond.parentElement?.classList.toggle('chip-low', pondPct < TUNING.visitors.inviteCleanliness);
  }

  // The care counts, and the panel buttons' locks as the goal chain opens them.
  private refreshDock(): void {
    const s = this.game.state;
    for (const [kind, node] of Object.entries(this.careCounts)) {
      node.textContent = String(s.inventory[kind as keyof typeof s.inventory]);
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
  }

  toggleFlockBar(): void {
    this.showFlockBar = !this.showFlockBar;
    localStorage.setItem(FLOCK_BAR_PREF_KEY, this.showFlockBar ? '1' : '0');
    this.refreshFlockBar();
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
        this.refreshFlockBar();
      }
    };
    step();
  }

  private lastFlockSig = '';

  private refreshFlockBar(): void {
    if (!this.showFlockBar) {
      this.flockBarHost.replaceChildren();
      this.lastFlockSig = '';
      return;
    }
    if (this.pointerDownInFlockBar) return;
    // Skip the rebuild (and its portraits) when nothing visible changed —
    // the 500ms cadence mostly fires on an unchanged flock.
    const sig = flockSignature(this.game, (id) => this.isPinned(id));
    if (sig === this.lastFlockSig && this.flockBarHost.firstElementChild) return;
    this.lastFlockSig = sig;
    this.flockBarHost.replaceChildren(
      renderFlockBar(this.game, {
        select: (id, pin) => this.selectDuck(id, pin),
        isPinned: (id) => this.isPinned(id),
        refresh: () => {
          this.lastFlockSig = '';
          this.refreshFlockBar();
        },
      }),
    );
  }

  private refreshFestivalChip(): void {
    const clock = this.game.state.clock;
    const today = festivalToday(clock);
    const chip = this.almanac.festivalChip;
    const sig = today ? `${today}:${festivalEnteredToday(this.game.state, today)}` : `${upcomingFestival(clock).kind}:${upcomingFestival(clock).inDays}`;
    if (sig === this.festivalSig) return;
    this.festivalSig = sig;
    if (today) {
      const entered =
        (today === 'eggShow' || today === 'grandPrix') &&
        festivalEnteredToday(this.game.state, today);
      // The name is its own span so a narrow bar can keep the chip short.
      chip.replaceChildren(
        icon('flag', 11),
        el('span', { class: 'chip-word' }, festivalTitle(this.game.state, today)),
        entered ? icon('check', 11) : 'today',
      );
      chip.classList.add('today');
    } else {
      const { kind, inDays } = upcomingFestival(clock);
      chip.replaceChildren(
        icon('flag', 11),
        el('span', { class: 'chip-word' }, `${festivalTitle(this.game.state, kind)} in`),
        `${inDays}d`,
      );
      chip.classList.remove('today');
    }
  }

  private festivalHost(): FestivalHost {
    return {
      game: this.game,
      root: this.root,
      dockHost: this.dockHost,
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
