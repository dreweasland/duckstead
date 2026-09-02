import type { Game } from '../game';
import type { Renderer } from '../render/renderer';
import { events } from '../events';
import { formatClock } from '../sim/time';
import { goalProgress, goalUnlocking, pendingGoals, tickGoals } from '../sim/goals';
import type { Unlockable } from '../sim/unlocks';
import { describeRequest, matchesRequest } from '../sim/visitors';
import { FESTIVAL_NAMES, festivalEnteredToday, festivalToday, festivalTitle, upcomingFestival } from '../sim/festivals';
import { openEggShow, openGrandPrix, openMarketStall, openWinterLights, type FestivalHost } from './festivalScreens';
import type { Duck } from '../sim/duck';
import { dayOf, isNight, TICKS_PER_HOUR } from '../sim/time';
import { dawnReport } from '../sim/daybook';
import { FOODS, TREATS, type FoodKind, type TreatKind } from '../sim/food';
import { describeCommission, duckFits } from '../sim/commissions';
import { isUnlocked, UNLOCK_LABELS, UNLOCKABLES } from '../sim/unlocks';
import { duckPortrait } from './portrait';
import { cleanPond, FEEDER_POS, isInPond, nestPos } from '../sim/pond';
import { GROUND_TOP, WORLD_H, WORLD_W } from '../state';
import { DECOR_ITEMS, duckCapacity, pondOccupancy } from '../sim/economy';

const WORLD_H_SAFE = WORLD_H - 15;
import { el } from './dom';
import { icon } from './icons';
import { railSignature, renderCardRail } from './cardRail';
import { backToPondRow, eventCard } from './eventCard';
import { renderDuckPanel } from './duckPanel';
import { renderBreedingPanel } from './breedingPanel';
import { renderShopPanel } from './shopPanel';
import { renderRosterPanel } from './rosterPanel';
import { renderSavePanel, resetSavePanelState } from './savePanel';
import { claimAndReload } from '../sync/sync';
import { renderBookPanel } from './bookPanel';
import { renderSettingsPanel } from './settingsPanel';
import { buildHud } from './hud';
import { bindCanvasInput } from './canvasInput';
import { installTooltips } from './tooltip';
import { actionForKey, loadSettings } from './settings';
import { keyCaptureActive } from './settingsPanel';
import { play, quack, setAmbienceNight, unlockAudio, wireGameAudio } from '../audio/audio';
import { WEATHER_NAMES, weatherOf } from '../sim/weather';
import { openRacePanel } from './racePanel';
import { describeLifeEvent, lifeEventChoices, resolveLifeEvent, type LifeEvent } from '../sim/lifeEvents';

export type PanelKind = 'duck' | 'breeding' | 'shop' | 'roster' | 'save' | 'book' | 'settings';

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
  private placingDecor: import('../sim/economy').DecorDef | null = null;
  private movingDecor: number | null = null; // index into state.decorations
  private careCounts: Partial<Record<FoodKind, HTMLElement>> = {};
  private unlockedSeen = new Set<string>();
  private hudReady = false; // first HUD refresh seeds unlockedSeen silently
  private railHost!: HTMLElement;
  private goalsHost!: HTMLElement;
  private floatHost!: HTMLElement;
  private modalHost!: HTMLElement;
  private festivalChip!: HTMLElement;
  private lifeChip!: HTMLElement;
  // Where the floating duck card sits; remembered across opens this session.
  private floatPos: { x: number; y: number } | null = null;
  // Pinned duck cards: extra floating copies kept open for comparison.
  private pinned: Array<{ id: string; host: HTMLElement; pos: { x: number; y: number }; dispose: () => void }> = [];
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
      openLifeEvent: () => this.openLifeEvent(),
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
    this.goalsHost = el('div', { class: 'goals-widget' });
    this.floatHost = el('div', { class: 'float-host' });
    this.modalHost = el('div', { class: 'modal-host' });
    this.root.append(this.railHost, this.goalsHost, this.panelHost, this.modalHost, this.floatHost, this.bannerHost, this.toastHost);
    this.bindFloatDrag();
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

    events.on('toast', (msg) => this.toast(String(msg)));
    events.on('dawn', () => this.showDawnCard());
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
        this.lifeBanner('grown', duck, `${duck.name} is all grown up`, [
          'Come of age — ready to nest, race, and win rosettes.',
        ]);
      } else if (to === 'elder') {
        this.lifeBanner('elder', duck, `${duck.name} is an elder now`, [
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
      if (descendants > 0) lines.push(`${duck.sex === 'F' ? 'Her' : 'His'} line lives on in ${descendants} duck${descendants === 1 ? '' : 's'}.`);
      if (honoured > 0) lines.push(`A feather rests in the album — the Society honours a life well lived (+${honoured}).`);
      this.lifeBanner('passing', duck, `Farewell, ${duck.name}`, lines);
      if (this.duckCardOpen) this.refreshPanel();
    });
    events.on('takeover', (payload) => this.showTakeoverOverlay(Boolean((payload as { remote?: boolean } | undefined)?.remote)));
    // The companion put the pond down: the state was reloaded from the cloud
    // and play may carry on where the phone left it.
    events.on('resumed', () => {
      this.root.querySelector('.takeover-overlay')?.remove();
      this.closePanel();
      this.setSpeed(1);
      this.toast('The pond is back — carrying on from where the other device left it.');
    });
    events.on('life-event', () => this.openLifeEvent());

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
      if (this.placingDecor || this.movingDecor !== null) {
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

  // A click while placing or moving a decoration: set it down (or explain
  // why it can't go there). Called by the canvas input layer.
  decorClick(world: { x: number; y: number }): void {

    const problem = this.decorSpotProblem(world);
    if (problem) {
      this.toast(problem);
      return;
    }
    if (this.movingDecor !== null) {
      const decor = this.game.state.decorations[this.movingDecor];
      if (decor) {
        decor.pos = { x: world.x, y: world.y };
        this.toast('Moved!');
      }
      this.endDecorMode();
      return;
    }
    const def = this.placingDecor!;
    if (this.game.state.money < def.cost) {
      this.toast('Not enough coins any more!');
      this.endDecorMode();
      return;
    }
    this.game.state.money -= def.cost;
    this.game.state.decorations.push({ kind: def.kind, pos: { x: world.x, y: world.y } });
    events.emit('purchase'); // persist the placement like any spend
    this.toast(`${def.name} placed!`);
    this.endDecorMode();
    return;
  }

  decorModeActive(): boolean {
    return Boolean(this.placingDecor) || this.movingDecor !== null;
  }

  // Pick up a placed decoration to move it.
  startMovingDecor(idx: number, world: { x: number; y: number }): void {
    this.movingDecor = idx;
    document.body.classList.add('feeding');
    this.updateDecorGhost(world);
    const def = DECOR_ITEMS.find((d) => d.kind === this.game.state.decorations[idx].kind);
    this.toast(`Moving the ${def?.name ?? 'decoration'} — click the grass to set it down (Esc to cancel)`);
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

  // Drag the floating duck card by its header. Delegated so it survives the
  // panel's periodic rebuilds.
  private bindFloatDrag(): void {
    this.bindDrag(this.floatHost, (p) => {
      this.floatPos = p;
      this.applyFloatPos();
    });
    window.addEventListener('resize', () => {
      if (this.floatPos) {
        this.floatPos = this.clampFloatPos(this.floatPos.x, this.floatPos.y);
        this.applyFloatPos();
      }
      for (const entry of this.pinned) {
        entry.pos = this.clampFloatPos(entry.pos.x, entry.pos.y, entry.host);
        entry.host.style.left = `${entry.pos.x}px`;
        entry.host.style.top = `${entry.pos.y}px`;
      }
    });
  }

  // Drag a floating host by its header. Delegated so it survives rebuilds.
  // Returns a disposer: the window-level listeners must die with the host,
  // or every pin/unpin cycle leaks two permanent handlers.
  private bindDrag(host: HTMLElement, set: (p: { x: number; y: number }) => void): () => void {
    let drag: { dx: number; dy: number } | null = null;
    host.addEventListener('pointerdown', (e) => {
      const header = (e.target as HTMLElement).closest('.panel-header');
      if (!header || (e.target as HTMLElement).closest('button, input')) return;
      const rect = host.getBoundingClientRect();
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      host.classList.add('dragging');
      // Bring the dragged card to the front — unless it's been lifted above
      // an event overlay (Market Day's pedestal), where the class sets the
      // stacking and an inline value would drop it back under the overlay.
      if (host.classList.contains('above-overlay')) host.style.zIndex = '';
      else host.style.zIndex = String(30 + (this.zTop += 1));
      e.preventDefault();
    });
    const onMove = (e: PointerEvent): void => {
      if (!drag) return;
      const p = this.clampFloatPos(e.clientX - drag.dx, e.clientY - drag.dy, host);
      set(p);
      if (host !== this.floatHost) {
        host.style.left = `${p.x}px`;
        host.style.top = `${p.y}px`;
      }
    };
    const onUp = (): void => {
      drag = null;
      host.classList.remove('dragging');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }

  private zTop = 0;

  private clampFloatPos(x: number, y: number, host: HTMLElement = this.floatHost): { x: number; y: number } {
    const w = host.offsetWidth || 340;
    const h = host.offsetHeight || 200;
    return {
      x: Math.max(4, Math.min(window.innerWidth - w - 4, x)),
      y: Math.max(48, Math.min(window.innerHeight - Math.min(h, 120), y)),
    };
  }

  private applyFloatPos(): void {
    if (!this.floatPos) {
      // Default: centered horizontally, upper third of the screen — unless a
      // modal is open, in which case the card steps aside so both stay
      // readable (a drag still puts it anywhere).
      if (this.openModalKind || document.querySelector('.race-overlay')) {
        const modal = (this.modalHost.firstElementChild ?? document.querySelector('.race-overlay .race-card')) as HTMLElement | null;
        const modalLeft = modal ? modal.getBoundingClientRect().left : window.innerWidth / 2 - 390;
        const w = this.floatHost.offsetWidth || 340;
        const x = Math.max(4, Math.min(modalLeft - w - 12, window.innerWidth - w - 4));
        this.floatHost.style.left = `${x}px`;
        this.floatHost.style.top = '90px';
        this.floatHost.style.transform = 'none';
        return;
      }
      this.floatHost.style.left = '50%';
      this.floatHost.style.top = '90px';
      this.floatHost.style.transform = 'translateX(-50%)';
      return;
    }
    this.floatHost.style.left = `${this.floatPos.x}px`;
    this.floatHost.style.top = `${this.floatPos.y}px`;
    this.floatHost.style.transform = 'none';
  }

  startPlacingDecor(def: import('../sim/economy').DecorDef): void {
    this.movingDecor = null;
    this.placingDecor = def;
    document.body.classList.add('feeding'); // reuse the crosshair cursor
    this.toast(`Click the grass to place your ${def.name}`);
  }

  endDecorMode(): void {
    this.placingDecor = null;
    this.movingDecor = null;
    this.renderer.decorGhost = null;
    document.body.classList.remove('feeding');
  }

  updateDecorGhost(world: { x: number; y: number }): void {
    const kind =
      this.movingDecor !== null
        ? this.game.state.decorations[this.movingDecor]?.kind
        : this.placingDecor?.kind;
    if (!kind) {
      this.renderer.decorGhost = null;
      return;
    }
    this.renderer.decorGhost = {
      kind,
      pos: { x: world.x, y: world.y },
      ok: this.decorSpotProblem(world) === null,
      hideIndex: this.movingDecor,
    };
  }

  // Why a decoration can't go at this world point, or null if it can. Each
  // reason is specific — "not in the pond" when the click was by the trough
  // sent people hunting for water that wasn't there.
  private decorSpotProblem(world: { x: number; y: number }): string | null {
    if (world.y < GROUND_TOP) return 'Too high — that is the sky. Place it on the grass.';
    if (world.y >= WORLD_H_SAFE) return 'Too low — it would hide under the cards.';
    if (world.x < 30 || world.x > WORLD_W - 30) return 'Too close to the edge.';
    if (isInPond(this.game.state, world)) return 'That is in the pond — place it on the grass.';
    if (Math.hypot(world.x - FEEDER_POS.x, world.y - FEEDER_POS.y) <= 75) return 'Too close to the feeding trough.';
    const nest = nestPos();
    if (Math.hypot(world.x - nest.x, world.y - nest.y) <= 90) return 'Too close to the nest.';
    const other = this.game.state.decorations.findIndex(
      (d, i) => i !== this.movingDecor && Math.hypot(d.pos.x - world.x, d.pos.y - world.y) < 28,
    );
    if (other >= 0) return 'Something is already there.';
    return null;
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

  // Pin the current duck card: it becomes its own floating window that stays
  // open (and live) while you open other ducks to compare.
  pinDuck(id: string): void {
    if (this.pinned.some((p) => p.id === id)) return;
    // Slot the pinned copy beside the main card (left if there's room, else
    // right), stepping further out for each additional pin.
    const rect = this.floatHost.getBoundingClientRect();
    const base = this.floatPos ?? { x: rect.left, y: rect.top || 90 };
    const w = (this.floatHost.offsetWidth || 340) + 12;
    const n = this.pinned.length + 1;
    const leftX = base.x - w * n;
    const rightX = base.x + w * n;
    const x = leftX >= 4 ? leftX : rightX + (this.floatHost.offsetWidth || 340) <= window.innerWidth - 4 ? rightX : base.x + 28 * n;
    const pos = this.clampFloatPos(x, base.y + (x === base.x + 28 * n ? 28 * n : 0));
    const host = el('div', { class: 'float-host pinned' });
    host.style.left = `${pos.x}px`;
    host.style.top = `${pos.y}px`;
    host.style.transform = 'none';
    this.root.append(host);
    const entry = { id, host, pos, dispose: () => {} };
    this.pinned.push(entry);
    entry.dispose = this.bindDrag(host, (p) => { entry.pos = p; });
    host.addEventListener('pointerdown', () => { this.pointerDownInPanel = true; });
    this.refreshPinned();
  }

  unpinDuck(id: string): void {
    const i = this.pinned.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.pinned[i].dispose();
    this.pinned[i].host.remove();
    this.pinned.splice(i, 1);
  }

  isPinned(id: string): boolean {
    return this.pinned.some((p) => p.id === id);
  }

  private refreshPinned(): void {
    for (const entry of [...this.pinned]) {
      if (!this.game.state.ducks.some((d) => d.id === entry.id)) {
        this.unpinDuck(entry.id);
        continue;
      }
      const panel = renderDuckPanel({
        game: this.game,
        ui: this,
        duckId: entry.id,
        pinned: true,
        close: () => this.unpinDuck(entry.id),
      });
      if (!panel) {
        this.unpinDuck(entry.id);
        continue;
      }
      panel.classList.add('floating', 'no-anim');
      const old = entry.host.firstElementChild as HTMLElement | null;
      const scroll = old?.scrollTop ?? 0;
      entry.host.replaceChildren(panel);
      panel.scrollTop = scroll;
    }
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
    const duck = this.game.state.ducks.find((d) => d.id === id);
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
    const typingInPin = active0 && this.pinned.some((p) => p.host.contains(active0)) && midEntry(active0);
    if (!typingInPin) this.refreshPinned();
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
        this.applyFloatPos();
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

  private refreshGoals(): void {
    // Goals are settled by the sim tick, but the buttons they unlock read
    // the stats directly — so while the game is paused a fourth pet opens
    // Breeding at once and the goal would sit at 4/4 until time resumed.
    // Settle them here whenever the clock isn't running.
    if (this.game.speed === 0 && !this.game.stale) tickGoals(this.game.state);
    const pending = pendingGoals(this.game.state);
    const request = this.game.state.request;
    const commissions = this.game.state.commissions;
    if (pending.length === 0 && !request && commissions.length === 0) {
      this.goalsHost.replaceChildren();
      return;
    }
    const SHOWN = 6;
    // Goals that open part of the game come first and look like gates —
    // they're the early tutorial, not side quests.
    const gates = (g: (typeof pending)[number]) => Boolean(g.unlocks && !isUnlocked(this.game.state, g.unlocks));
    const ordered = [...pending].sort((a, b) => Number(gates(b)) - Number(gates(a)));
    const anyGate = ordered.some(gates);
    const rows = ordered.slice(0, SHOWN).map((goal) => {
      const progress = goalProgress(this.game.state, goal);
      const isGate = gates(goal);
      const row = el(
        'div',
        { class: `goal-row${isGate ? ' unlock' : ''}`, title: isGate ? `Completing this opens the ${UNLOCK_LABELS[goal.unlocks!]} button in the top bar` : '' },
        isGate ? el('span', { class: 'goal-lock' }, icon('lock', 10)) : el('span', { class: 'goal-dot' }),
        el(
          'span',
          { class: 'goal-label' },
          goal.label,
          isGate
            ? el('span', { class: 'goal-unlock' }, `unlocks ${UNLOCK_LABELS[goal.unlocks!]}`)
            : null,
        ),
        goal.target > 1
          ? el('span', { class: 'goal-progress' }, `${progress}/${goal.target}`)
          : null,
        el('span', { class: 'goal-reward with-icon' }, icon('coin', 10), `${goal.reward}`),
      );
      if (goal.target > 1) {
        const fill = el('div', { class: 'goal-bar-fill' });
        fill.style.width = `${(progress / goal.target) * 100}%`;
        row.append(el('div', { class: 'goal-bar' }, fill));
      }
      return row;
    });
    const children: Array<HTMLElement> = [];
    if (rows.length > 0) {
      children.push(
        el('div', { class: 'goals-title' }, 'Goals', anyGate ? el('span', { class: 'goals-sub' }, ' · locked goals open the pond') : null),
        ...rows,
      );
      if (pending.length > SHOWN) {
        children.push(el('div', { class: 'muted goals-more' }, `+${pending.length - SHOWN} more to come`));
      }
    }
    if (commissions.length > 0) {
      const today = dayOf(this.game.state.clock);
      children.push(el('div', { class: 'goals-title request-title' }, 'Commissions'));
      for (const c of commissions) {
        const fits = this.game.state.ducks.some((d) => duckFits(d, c));
        const left = Math.max(0, c.expiresDay - today);
        children.push(
          el(
            'div',
            { class: 'goal-row', title: `${c.client} · ${describeCommission(c)} · ${left}d left` },
            el('span', { class: `goal-dot request-dot${fits ? ' fits' : ''}` }),
            el('span', { class: 'goal-label' }, describeCommission(c)),
            el('span', { class: 'goal-reward with-icon' }, icon('coin', 10), `${c.reward}`),
          ),
        );
      }
    }
    if (request) {
      const daysLeft = Math.max(0, request.expiresDay - dayOf(this.game.state.clock));
      children.push(
        el('div', { class: 'goals-title request-title' }, 'Buyer request'),
        el(
          'div',
          { class: 'goal-row', title: 'A buyer pays this multiple of the sell price for any matching duck — sell from the duck\'s card' },
          el('span', { class: `goal-dot request-dot${this.game.state.ducks.some((d) => matchesRequest(d, request)) ? ' fits' : ''}` }),
          el('span', { class: 'goal-label' }, `wants a ${describeRequest(request)} duck`),
          el('span', { class: 'goal-reward' }, `×${request.multiplier}`),
        ),
        el(
          'div',
          { class: 'muted request-expiry' },
          daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'leaving today',
        ),
      );
    }
    this.goalsHost.replaceChildren(...children);
  }

  private refreshHud(): void {
    const s = this.game.state;
    this.refreshGoals();
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
    this.hudCounts.pond.parentElement?.classList.toggle('chip-low', pondPct < 70);
    // Pond cleanliness nudge. Wild ducks stop visiting below 70%, so the
    // scrub button shows from there — urgently once the water is truly foul.
    const existing = this.root.querySelector<HTMLElement>('.pond-warn');
    if (pondPct < 70) {
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
      this.toast(`The ${FESTIVAL_NAMES[kind]} is in ${inDays} day${inDays === 1 ? '' : 's'}!`);
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

  private showTakeoverOverlay(remote = false): void {
    this.closePanel();
    // Both the cross-tab and cross-device paths can fire — never stack two.
    this.root.querySelector('.takeover-overlay')?.remove();
    this.root.append(
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
  private openLifeEvent(): void {
    const state = this.game.state;
    const ev: LifeEvent | null = state.lifeEvent;
    if (!ev) return;
    const card = eventCard(this.root, 'life');
    if (!card) return;
    const { text, title } = describeLifeEvent(state, ev);
    const duck = state.ducks.find((d) => d.id === ev.duckId);
    const other = state.ducks.find((d) => d.id === ev.otherId);
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
              const outcome = resolveLifeEvent(state, this.game.rng, c.id);
              if (outcome === null) return;
              card.card.replaceChildren(
                card.header('duck', title),
                portraits,
                el('div', { class: 'life-event-outcome' }, outcome),
                backToPondRow(card.close),
              );
              this.refreshPanel();
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
  private showDawnCard(): void {
    this.root.querySelector('.dawn-card')?.remove();
    const report = dawnReport(this.game.state);

    const tile = (iconName: Parameters<typeof icon>[0], value: string, label: string, cls = '') =>
      el('div', { class: `dawn-tile ${cls}` }, icon(iconName, 14), el('strong', {}, value), el('span', { class: 'dawn-tile-label' }, label));
    const { stats } = report;
    const tiles = el(
      'div',
      { class: 'dawn-tiles' },
      tile('coin', String(stats.coins), 'coins'),
      tile('duck', `${stats.occupancy}/${stats.capacity}`, stats.occupancy > stats.capacity ? 'overcrowded' : 'on the pond', stats.occupancy >= stats.capacity ? 'warn' : ''),
      tile('egg', String(stats.eggs), stats.eggs === 1 ? 'egg' : 'eggs'),
      tile('bubbles', `${stats.pond}%`, 'pond', stats.pond < 70 ? 'warn' : ''),
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
    this.root.append(card);
    requestAnimationFrame(() => card.classList.add('show'));
    setTimeout(() => {
      if (card.isConnected) dismiss();
    }, 20_000);
  }

  // A centred, longer-lived notice for the pond's big life moments — coming
  // of age, elderhood, and passings — with the duck's portrait, so they can't
  // slip past the way a toast can. Click to dismiss.
  private lifeBanner(tone: 'grown' | 'elder' | 'passing', duck: Duck, title: string, lines: string[]): void {
    while (this.bannerHost.children.length >= 3) this.bannerHost.firstElementChild!.remove();
    const node = el(
      'div',
      { class: `life-banner ${tone}` },
      el('span', { class: 'life-portrait' }, duckPortrait(duck, 44)),
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
    node.addEventListener('click', dismiss);
    this.bannerHost.append(node);
    setTimeout(() => node.classList.add('show'), 10);
    setTimeout(dismiss, tone === 'passing' ? 12_000 : 8_000);
  }

  toast(msg: string): void {
    const node = el('div', { class: 'toast' }, msg);
    this.toastHost.append(node);
    setTimeout(() => node.classList.add('show'), 10);
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 400);
    }, 3500);
  }
}

export interface PanelCtx {
  game: Game;
  ui: UI;
  close: () => void;
  duckId?: string; // for duck cards: which duck (defaults to the selected one)
  pinned?: boolean; // this card is a pinned comparison copy
}
