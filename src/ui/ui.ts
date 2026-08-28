import type { Game } from '../game';
import type { Renderer } from '../render/renderer';
import { events } from '../events';
import { formatClock } from '../sim/time';
import { catchBugAt } from '../sim/bugs';
import { claimHatch } from '../sim/lifecycle';
import { goalProgress, pendingGoals } from '../sim/goals';
import { describeRequest, treatVisitor, VISITOR_CLICK_RADIUS } from '../sim/visitors';
import {
  FESTIVAL_NAMES,
  festivalEnteredToday,
  festivalToday,
  generateMarketBuyers,
  LANTERN_WISHES,
  markFestivalEntered,
  marketHaggle,
  marketSell,
  runEggShow,
  upcomingFestival,
  winterCeremonyFinale,
  WINTER_WISHES,
  festivalPurseScale,
  festivalTier,
  festivalTitle,
  noteFestivalWinPublic,
  type MarketBuyer,
} from '../sim/festivals';
import { createDuck, type Duck } from '../sim/duck';
import { createRng } from '../rng';
import { dayOf, isNight } from '../sim/time';
import { dawnReport } from '../sim/daybook';
import { FOODS, TREATS, type FoodKind, type TreatKind } from '../sim/food';
import { describeCommission, duckFits } from '../sim/commissions';
import { isUnlocked, UNLOCK_LABELS, UNLOCKABLES } from '../sim/unlocks';
import { duckPortrait } from './portrait';
import { brushStroke, dropFood, fillFeeder, petStroke, tuckEgg } from '../sim/needs';
import { cleanPond, FEEDER_POS, isInPond, nestPos } from '../sim/pond';
import { GROUND_TOP, WORLD_H, WORLD_W } from '../state';
import { DECOR_ITEMS, duckCapacity, pondOccupancy } from '../sim/economy';

const WORLD_H_SAFE = WORLD_H - 15;
const DECOR_PICK_RADIUS = 26;
import { el } from './dom';
import { icon } from './icons';
import { railSignature, renderCardRail } from './cardRail';
import { renderDuckPanel } from './duckPanel';
import { pickMateFromPond, renderBreedingPanel } from './breedingPanel';
import { renderShopPanel } from './shopPanel';
import { renderRosterPanel } from './rosterPanel';
import { renderSavePanel, resetSavePanelState } from './savePanel';
import { claimAndReload } from '../sync/sync';
import { isSyncConfigured } from '../sync/syncMeta';
import { renderBookPanel } from './bookPanel';
import { openRacePanel, raceEligible, raceSpeed } from './racePanel';
import { clamp } from '../types';

export type PanelKind = 'duck' | 'breeding' | 'shop' | 'roster' | 'save' | 'book';

// UI preference, not game state — deliberately outside the save file.
const CARDS_PREF_KEY = 'ducksim:ui:cards';
// Inner scrollable lists whose scroll position must survive the periodic
// panel rebuild. Any new scroll region in a panel belongs in this list.
const SCROLL_REGIONS = '.chooser, .card-grid, .br-cand-grid, .dawn-body, .society-ladder, .chronicle, .nest-grid';

// A labelled stat tile for event recap cards (matches the race picker's).
function statTile(ic: Parameters<typeof icon>[0], value: string, label: string): HTMLElement {
  return el('div', { class: 'race-tile' }, icon(ic, 13), el('strong', {}, value), el('span', { class: 'race-tile-label' }, label));
}

// A row of already-lit lanterns for Winter Lights recaps.
function litLanternRow(): HTMLElement {
  const row = el('div', { class: 'lantern-row static' });
  for (let i = 0; i < 5; i += 1) row.append(el('span', { class: 'lantern lit' }, el('span', { class: 'lantern-flame' })));
  return row;
}

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
  // Active stroke session: petting (bare hand) or brushing (brush tool).
  private stroke: { duckId: string; lastX: number; lastY: number; travelled: number } | null =
    null;
  private suppressNextClick = false;
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
  // Where the floating duck card sits; remembered across opens this session.
  private floatPos: { x: number; y: number } | null = null;
  // Pinned duck cards: extra floating copies kept open for comparison.
  private pinned: Array<{ id: string; host: HTMLElement; pos: { x: number; y: number }; dispose: () => void }> = [];
  private showCards = localStorage.getItem(CARDS_PREF_KEY) === '1';

  constructor(
    private game: Game,
    private renderer: Renderer,
  ) {
    this.root = document.getElementById('ui-root')!;
    this.root.append(this.buildHud());
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

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (this.placingDecor || this.movingDecor !== null)) {
        this.endDecorMode();
        this.toast('Cancelled');
      }
    });

    this.bindCanvas();
    this.refreshCardRail();
    setInterval(() => {
      this.refreshPanel();
      this.refreshCardRail();
    }, 500);
    setInterval(() => this.refreshHud(), 250);
  }

  private buildHud(): HTMLElement {
    this.hudClock = el('span', { class: 'hud-clock' });
    this.festivalChip = el('button', { class: 'hud-chip festival-chip', onclick: () => this.onFestivalChip() });

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
      this.hudCounts[key] = count;
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
          onclick: () => {
            this.game.speed = s;
            this.root
              .querySelectorAll('.speed-btn')
              .forEach((b) =>
                b.classList.toggle('active', Number(b.getAttribute('data-speed')) === s),
              );
          },
        },
        s === 0 ? icon('pause', 12) : `${s}×`,
      ),
    );
    speedBtns[1].classList.add('active');

    return el(
      'header',
      { class: 'hud' },
      el('span', { class: 'hud-title' }, icon('duck', 20), ''),
      this.hudClock,
      chips,
      this.festivalChip,
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
            onclick: () => this.toggleCareMenu(),
          },
          icon('wheat'),
          el('span', { class: 'hud-btn-label care-label' }, 'Care'),
        ),
        this.buildCareMenu(),
      ),
      el(
        'button',
        { class: 'hud-btn unlock-breeding', onclick: () => this.togglePanel('breeding') },
        icon('heart'),
        el('span', { class: 'hud-btn-label' }, 'Breed'),
      ),
      el('button', { class: 'hud-btn unlock-shop', onclick: () => this.togglePanel('shop') }, icon('cart'), el('span', { class: 'hud-btn-label' }, 'Shop')),
      el('button', { class: 'hud-btn', onclick: () => this.togglePanel('roster') }, icon('list'), el('span', { class: 'hud-btn-label' }, 'Flock')),
      el('button', { class: 'hud-btn unlock-book', onclick: () => this.togglePanel('book') }, icon('book'), el('span', { class: 'hud-btn-label' }, 'Book')),
      el(
        'button',
        { class: 'hud-btn unlock-race', onclick: () => openRacePanel(this.game, { toast: (m) => this.toast(m) }, { league: true }) },
        icon('flag'),
        el('span', { class: 'hud-btn-label' }, 'Race'),
      ),
      el(
        'button',
        {
          class: `hud-btn cards-btn${this.showCards ? ' active' : ''}`,
          title: 'Show duck cards on the main screen',
          onclick: () => this.toggleCardRail(),
        },
        icon('cards'),
        el('span', { class: 'hud-btn-label' }, 'Cards'),
      ),
      el('button', { class: 'hud-btn', onclick: () => this.togglePanel('save') }, icon('disk'), el('span', { class: 'hud-btn-label' }, 'Save')),
      ...speedBtns,
    );
  }

  private toggleFeedMode(mode: FoodKind | 'brush'): void {
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

  // One menu for every hands-on tool: scatter feed, toss treats, brush.
  private buildCareMenu(): HTMLElement {
    const menu = el('div', { class: 'treats-menu care-menu' });
    const foodPick = (kind: FoodKind, iconName: Parameters<typeof icon>[0], label: string): void => {
      const count = el('span', { class: 'treat-count' }, '0');
      this.careCounts[kind] = count;
      menu.append(
        el(
          'button',
          { class: 'treat-pick', 'data-kind': kind, onclick: () => this.toggleFeedMode(kind) },
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
      this.careCounts[kind] = count;
      menu.append(
        el(
          'button',
          { class: 'treat-pick', 'data-kind': kind, onclick: () => this.toggleFeedMode(kind) },
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
        { class: 'treat-pick', 'data-kind': 'brush', title: 'Rub over a duck to scrub it clean', onclick: () => this.toggleFeedMode('brush') },
        icon('bubbles', 13),
        'Brush',
      ),
      el('div', { class: 'muted small treat-hint' }, 'Every duck secretly loves one treat.'),
    );
    return menu;
  }

  private toggleCareMenu(): void {
    this.root.querySelector('.care-menu')?.classList.toggle('open');
  }

  private bindCanvas(): void {
    const canvas = document.getElementById('pond-canvas')!;

    // Stroke gestures: press on a duck and rub to pet (bare hand, hearts) or
    // scrub (brush tool, bubbles). A near-still press stays a normal click.
    canvas.addEventListener('pointerdown', (e) => {
      const world = this.renderer.toWorld(e.clientX, e.clientY);
      if (this.feedMode !== 'none' && this.feedMode !== 'brush') return;
      const id = this.renderer.pickDuck(world.x, world.y);
      if (id) this.stroke = { duckId: id, lastX: world.x, lastY: world.y, travelled: 0 };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.placingDecor || this.movingDecor !== null) {
        const world = this.renderer.toWorld(e.clientX, e.clientY);
        this.updateDecorGhost(world);
      }
      if (!this.stroke) return;
      const state = this.game.state;
      const duck = state.ducks.find((d) => d.id === this.stroke!.duckId);
      const world = this.renderer.toWorld(e.clientX, e.clientY);
      const step = Math.hypot(world.x - this.stroke.lastX, world.y - this.stroke.lastY);
      this.stroke.lastX = world.x;
      this.stroke.lastY = world.y;
      if (!duck || duck.stage === 'egg') return;
      // Stay near the duck for the stroke to count.
      if (Math.hypot(world.x - duck.pos.x, world.y - duck.pos.y) > 55) return;
      this.stroke.travelled += step;
      if (this.stroke.travelled > 8) this.suppressNextClick = true;
      while (this.stroke.travelled >= 22) {
        this.stroke.travelled -= 22;
        if (this.feedMode === 'brush') {
          if (brushStroke(state, duck.id, 6) > 0) {
            this.renderer.spawnParticle(world.x, world.y, 'bubble');
            this.renderer.spawnParticle(duck.pos.x, duck.pos.y - 10, 'bubble');
          }
        } else if (petStroke(state, duck.id, 2) > 0) {
          this.renderer.spawnParticle(duck.pos.x, duck.pos.y - 20, 'heart');
        }
      }
    });
    window.addEventListener('pointerup', () => {
      this.stroke = null;
    });

    canvas.addEventListener('click', (e) => {
      if (this.suppressNextClick) {
        this.suppressNextClick = false;
        return;
      }
      const me = e as MouseEvent;
      const world = this.renderer.toWorld(me.clientX, me.clientY);

      // Decoration placement (new purchase, or moving an existing one) takes
      // over the next click.
      if (this.placingDecor || this.movingDecor !== null) {
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

      // A visiting wild duck: clicking it offers a premium treat.
      const visitor = this.game.state.visitor;
      if (visitor) {
        const vdx = world.x - visitor.duck.pos.x;
        const vdy = world.y - visitor.duck.pos.y;
        if (vdx * vdx + vdy * vdy < VISITOR_CLICK_RADIUS * VISITOR_CLICK_RADIUS) {
          const result = treatVisitor(this.game.state);
          if (result === 'no-feed') this.toast('It wants premium feed — buy some at the shop!');
          else if (result === 'landing') this.toast('Let it land first!');
          return;
        }
      }

      // Bugs are small, precise targets — give them first claim on the click,
      // otherwise the trough's larger hit area swallows catches near it.
      const pickup = catchBugAt(this.game.state, world.x, world.y);
      if (pickup) {
        this.renderer.spawnParticle(world.x, world.y, 'sparkle');
        switch (pickup.kind) {
          case 'feather':
            this.toast(`${pickup.source ?? 'A duck'}'s feather — added to the album (+${pickup.coins} coins)`);
            break;
          case 'duckweed':
            this.toast(`Gathered duckweed — +${pickup.feed} feed`);
            break;
          case 'firefly':
            this.toast(`Caught a firefly! +${pickup.coins} coin`);
            break;
          case 'henEgg':
            this.toast(`${pickup.source ?? 'A hen'} laid an egg — basket: ${this.game.state.inventory.eggs}`);
            break;
          default:
            this.toast(`Caught it! +${pickup.coins} coins`);
        }
        return;
      }

      // Clicking the trough tops it up from the feed inventory. Hit area
      // matches the drawn trough (plus a small margin), not a big circle.
      if (
        (this.game.state.upgrades.feedingTrough ?? 0) > 0 &&
        Math.abs(world.x - FEEDER_POS.x) < 52 &&
        world.y > FEEDER_POS.y - 22 &&
        world.y < FEEDER_POS.y + 28
      ) {
        const moved = fillFeeder(this.game.state);
        if (moved > 0) this.toast(`Poured ${moved} feed into the trough`);
        else if (this.game.state.inventory.feed <= 0)
          this.toast('No feed to pour — visit the shop!');
        else this.toast('The trough is already full');
        return;
      }

      if (this.feedMode !== 'none' && this.feedMode !== 'brush') {
        const ok = dropFood(this.game.state, world, this.feedMode);
        if (!ok) {
          this.toast(`Out of ${FOODS[this.feedMode].name.toLowerCase()} — visit the shop!`);
          this.toggleFeedMode(this.feedMode);
        }
        return;
      }

      const id = this.renderer.pickDuck(world.x, world.y);
      // No duck under the cursor: a decoration there gets picked up to move.
      if (!id && this.feedMode === 'none') {
        const idx = this.game.state.decorations.findIndex(
          (d) => Math.hypot(d.pos.x - world.x, d.pos.y - world.y) < DECOR_PICK_RADIUS,
        );
        if (idx >= 0) {
          this.movingDecor = idx;
          document.body.classList.add('feeding');
          this.updateDecorGhost(world);
          const def = DECOR_ITEMS.find((d) => d.kind === this.game.state.decorations[idx].kind);
          this.toast(`Moving the ${def?.name ?? 'decoration'} — click the grass to set it down (Esc to cancel)`);
          return;
        }
      }
      // Eggs are tended by tapping: a cracked egg hatches, otherwise it gets
      // tucked back into the warm straw.
      const egg = id ? this.game.state.ducks.find((d) => d.id === id) : undefined;
      if (egg && egg.stage === 'egg') {
        if (claimHatch(this.game.state, this.game.rng, egg.id)) {
          for (let i = 0; i < 5; i += 1) this.renderer.spawnParticle(egg.pos.x, egg.pos.y - 10, 'heart');
          this.game.selectedDuckId = egg.id;
          this.openPanel('duck');
          return;
        }
        if (tuckEgg(this.game.state, egg.id)) {
          this.renderer.spawnParticle(egg.pos.x, egg.pos.y - 14, 'heart');
          this.toast('Tucked the egg into the warm straw');
        }
      }
      // With the Breeding panel open, clicking an adult on the pond drops it
      // straight into a mate slot — no detour through the duck cards.
      if (id && this.openModalKind === 'breeding' && pickMateFromPond(this.game.state, id)) {
        const picked = this.game.state.ducks.find((d) => d.id === id);
        if (picked) this.renderer.spawnParticle(picked.pos.x, picked.pos.y - 20, 'heart');
        this.refreshPanel();
        return;
      }
      if (id && (me.ctrlKey || me.metaKey)) {
        this.selectDuck(id, true);
        return;
      }
      this.game.selectedDuckId = id;
      if (id) this.openPanel('duck');
      else if (this.duckCardOpen) this.closeDuckCard();
    });
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
      // Bring the dragged card to the front.
      host.style.zIndex = String(30 + (this.zTop += 1));
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

  private endDecorMode(): void {
    this.placingDecor = null;
    this.movingDecor = null;
    this.renderer.decorGhost = null;
    document.body.classList.remove('feeding');
  }

  private updateDecorGhost(world: { x: number; y: number }): void {
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

  togglePanel(kind: PanelKind): void {
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
  }

  refreshPanel(): void {
    if (this.pointerDownInPanel) return;
    const active0 = document.activeElement;
    const typingInPin = active0 && this.pinned.some((p) => p.host.contains(active0)) && (active0 instanceof HTMLInputElement || active0 instanceof HTMLSelectElement);
    if (!typingInPin) this.refreshPinned();
    if (!this.duckCardOpen && !this.openModalKind) return;
    // Don't rebuild while the user is typing in a panel field — a rebuild
    // would replace the input and steal focus mid-keystroke.
    const active = document.activeElement;
    if (
      active &&
      (this.panelHost.contains(active) || this.floatHost.contains(active) || this.modalHost.contains(active)) &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)
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
    const pending = pendingGoals(this.game.state);
    const request = this.game.state.request;
    const commissions = this.game.state.commissions;
    if (pending.length === 0 && !request && commissions.length === 0) {
      this.goalsHost.replaceChildren();
      return;
    }
    const SHOWN = 6;
    const rows = pending.slice(0, SHOWN).map((goal) => {
      const progress = goalProgress(this.game.state, goal);
      const row = el(
        'div',
        { class: 'goal-row' },
        el('span', { class: 'goal-dot' }),
        el(
          'span',
          { class: 'goal-label' },
          goal.label,
          goal.unlocks && !isUnlocked(this.game.state, goal.unlocks)
            ? el('span', { class: 'goal-unlock' }, `→ ${UNLOCK_LABELS[goal.unlocks]}`)
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
      children.push(el('div', { class: 'goals-title' }, 'Goals'), ...rows);
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
          { class: 'goal-row' },
          el('span', { class: 'goal-dot request-dot' }),
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
    this.hudClock.textContent = formatClock(s.clock);
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
              const slept = this.game.sleepUntilDawn();
              if (slept > 0) {
                this.toast('You dozed off by the pond and woke at dawn');
                this.refreshPanel();
                this.refreshCardRail();
              }
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
      this.root.querySelector(`.unlock-${what}`)?.classList.toggle('locked', !open);
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

  private onFestivalChip(): void {
    const state = this.game.state;
    const today = festivalToday(state.clock);
    if (!today) {
      const { kind, inDays } = upcomingFestival(state.clock);
      this.toast(`The ${FESTIVAL_NAMES[kind]} is in ${inDays} day${inDays === 1 ? '' : 's'}!`);
      return;
    }
    switch (today) {
      case 'eggShow':
        this.openEggShow();
        break;
      case 'grandPrix':
        if (festivalEnteredToday(state, 'grandPrix')) {
          const last = state.lastFestival;
          if (last?.kind === 'grandPrix' && last.day === dayOf(state.clock) && last.race) {
            this.showRaceRecap(last.race);
          } else {
            this.toast('You already raced the Grand Prix today!');
          }
        } else {
          // Two-round tournament: top two in the heat advance to the final.
          // The field scales to the player's best racer; reputation tiers
          // raise the purse and the competition.
          const best = Math.max(52, ...raceEligible(this.game).map(raceSpeed));
          const tier = festivalTier(state, 'grandPrix');
          const scale = festivalPurseScale(state, 'grandPrix');
          const fieldBoost = clamp((best / 52) * (1 + tier * 0.05), 1, 1.5);
          const gpTitle = festivalTitle(state, 'grandPrix');
          openRacePanel(this.game, { toast: (m) => this.toast(m) }, {
            title: `${gpTitle} — Qualifying Heat`,
            entryFee: 15,
            prizes: [0, 0, 0, 0],
            aiBoost: fieldBoost * 0.92,
            ignoreDailyLimit: true,
            onFinish: (heatPlace) => {
              markFestivalEntered(state, 'grandPrix');
              state.lastFestival = { day: dayOf(state.clock), kind: 'grandPrix', race: { heatPlace, prize: 0 } };
            },
            nextRace: (place) =>
              place <= 1
                ? {
                    title: `${gpTitle} — Final`,
                    entryFee: 0,
                    prizes: [Math.round(75 * scale), Math.round(25 * scale), 0, 0],
                    aiBoost: fieldBoost,
                    ignoreDailyLimit: true,
                    onFinish: (finalPlace) => {
                      if (finalPlace === 0) noteFestivalWinPublic(state, 'grandPrix');
                      if (state.lastFestival?.race) {
                        state.lastFestival.race.finalPlace = finalPlace;
                        state.lastFestival.race.prize = finalPlace === 0 ? Math.round(75 * scale) : finalPlace === 1 ? Math.round(25 * scale) : 0;
                      }
                    },
                  }
                : null,
          });
        }
        break;
      case 'marketDay':
        this.openMarketStall();
        break;
      case 'winterLights':
        this.openWinterLights();
        break;
    }
  }

  // A finished Grand Prix, recapped from the festival chip.
  private showRaceRecap(race: { heatPlace: number; finalPlace?: number; prize: number }): void {
    if (document.querySelector('.race-overlay')) return;
    const overlay = el('div', { class: 'race-overlay' });
    const won = race.finalPlace === 0;
    const card = el('div', { class: `race-card theme-derby${won ? ' win' : ''}` });
    const round = (label: string, placed: number, note: string, reward: number) =>
      el(
        'div',
        { class: 'race-result-row mine' },
        el('span', { class: `race-place p${placed + 1}` }, String(placed + 1)),
        el('span', { class: 'race-result-name' }, label),
        el('span', { class: 'muted small' }, note),
        reward > 0 ? el('span', { class: 'goal-reward with-icon' }, icon('coin', 11), String(reward)) : null,
      );
    const rows = el(
      'div',
      { class: 'race-results' },
      round('Qualifying Heat', race.heatPlace, race.heatPlace <= 1 ? 'advanced to the final' : 'eliminated', 0),
    );
    if (race.finalPlace !== undefined) rows.append(round('Final', race.finalPlace, won ? 'champion!' : 'finished', race.prize));
    card.append(
      el(
        'div',
        { class: 'race-header' },
        el('strong', { class: 'with-icon' }, icon('flag', 16), won ? 'Grand Prix champions!' : festivalTitle(this.game.state, 'grandPrix')),
        el('button', { class: 'close-btn', onclick: () => overlay.remove() }, icon('close', 13)),
      ),
      rows,
      el('div', { class: 'actions race-actions' }, el('button', { class: 'action-btn primary', onclick: () => overlay.remove() }, 'Back to the pond')),
    );
    overlay.append(card);
    this.root.append(overlay);
  }

  // Market Day: a queue of smitten buyers; accept, haggle, or send them off.
  private openMarketStall(): void {
    if (document.querySelector('.race-overlay')) return;
    const state = this.game.state;
    const today = dayOf(state.clock);
    // The day's buyers are generated once and kept, so you can close the stall
    // to think it over and come back to the same queue.
    // The stored queue is the lock: a finished market leaves an empty queue
    // for the day. (Saves from before the queue existed carry only the old
    // "entered" mark, which is ignored so they aren't locked out.)
    if (!state.market || state.market.day !== today) {
      const fresh = generateMarketBuyers(state, this.game.rng);
      if (fresh.length === 0) {
        this.toast('No ducks to show at market — the stalls stay quiet.');
        return;
      }
      state.market = { day: today, buyers: fresh, sold: 0, earned: 0 };
    }
    const market = state.market!;
    const buyers = market.buyers;
    if (buyers.length === 0) {
      // Packed up: show the day's tally instead of a shrug.
      const overlay0 = el('div', { class: 'race-overlay' });
      const card0 = el('div', { class: 'race-card theme-market' });
      card0.append(
        el(
          'div',
          { class: 'race-header' },
          el('strong', { class: 'with-icon' }, icon('cart', 16), 'Market Day — closed'),
          el('button', { class: 'close-btn', onclick: () => overlay0.remove() }, icon('close', 13)),
        ),
        el(
          'div',
          { class: 'race-stats fit' },
          statTile('duck', String(market.sold), market.sold === 1 ? 'duck sold' : 'ducks sold'),
          statTile('coin', String(market.earned), 'earned'),
        ),
        el(
          'div',
          { class: 'egg-comment' },
          market.sold > 0 ? 'The stalls have packed up until next autumn.' : 'The stalls have packed up — nothing sold this year.',
        ),
        el('div', { class: 'actions race-actions' }, el('button', { class: 'action-btn primary', onclick: () => overlay0.remove() }, 'Back to the pond')),
      );
      overlay0.append(card0);
      this.root.append(overlay0);
      return;
    }

    const overlay = el('div', { class: 'race-overlay' });
    const card = el('div', { class: 'race-card theme-market' });
    const close = () => {
      overlay.remove();
      this.floatHost.classList.remove('above-overlay');
    };
    let index = 0;
    // A buyer leaves the queue when dealt with; the stall is "entered" once
    // the last one goes.
    const dismiss = (buyer: MarketBuyer) => {
      const i = buyers.indexOf(buyer);
      if (i >= 0) buyers.splice(i, 1);
      if (buyers.length === 0) markFestivalEntered(state, 'marketDay');
    };

    const showBuyer = () => {
      if (index >= buyers.length) {
        card.replaceChildren(
          el(
            'div',
            { class: 'race-header' },
            el('strong', { class: 'with-icon' }, icon('cart', 16), 'Market Day'),
            el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
          ),
          el(
            'div',
            { class: 'race-stats fit' },
            statTile('duck', String(market.sold), market.sold === 1 ? 'duck sold' : 'ducks sold'),
            statTile('coin', String(market.earned), 'earned'),
          ),
          el('div', { class: 'egg-comment' }, 'The last buyer tips their hat. The stalls pack up until next autumn.'),
          el(
            'div',
            { class: 'actions race-actions' },
            el('button', { class: 'action-btn primary', onclick: close }, 'Back to the pond'),
          ),
        );
        return;
      }
      const buyer = buyers[index];
      const duck = state.ducks.find((d) => d.id === buyer.duckId);
      if (!duck) {
        dismiss(buyer);
        showBuyer();
        return;
      }
      const actions = el(
        'div',
        { class: 'actions race-actions' },
        el(
          'button',
          {
            class: 'action-btn primary',
            onclick: () => {
              marketSell(state, buyer);
              dismiss(buyer);
              showBuyer();
            },
          },
          'Accept ',
          icon('coin', 11),
          ` ${buyer.offer}`,
        ),
        buyer.haggled
          ? null
          : el(
              'button',
              {
                class: 'action-btn',
                title: 'Push for 25% more — but they may walk away',
                onclick: () => {
                  if (marketHaggle(buyer, this.game.rng)) {
                    this.toast(`They grumble… and agree to ${buyer.offer}!`);
                    showBuyer();
                  } else {
                    this.toast('“Outrageous!” The buyer storms off.');
                    dismiss(buyer);
                    showBuyer();
                  }
                },
              },
              'Haggle for more',
            ),
        el(
          'button',
          {
            class: 'action-btn',
            onclick: () => {
              dismiss(buyer);
              showBuyer();
            },
          },
          `Not for sale`,
        ),
      );
      card.replaceChildren(
        el(
          'div',
          { class: 'race-header' },
          el('strong', { class: 'with-icon' }, icon('cart', 16), `Market Day — ${buyers.length} buyer${buyers.length === 1 ? '' : 's'} waiting`),
          el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
        ),
        el(
          'div',
          { class: 'egg-stage market-stage' },
          el('div', { class: 'egg-breeder' }, buyer.name),
          el('div', { class: 'egg-comment' }, buyer.quote),
          el(
            'button',
            {
              class: 'egg-pedestal pedestal-btn',
              title: `Look ${duck.name} over before you decide`,
              onclick: () => {
                // The duck card normally sits under the stall overlay; lift
                // it above and it steps aside so both stay readable.
                this.floatHost.classList.add('above-overlay');
                this.selectDuck(duck.id);
              },
            },
            duckPortrait(duck, 64),
          ),
          el('div', { class: 'muted small' }, `${duck.name} — offering `, icon('coin', 11), ` ${buyer.offer}`),
          el('div', { class: 'muted small pedestal-hint' }, 'tap the pedestal to look them over'),
        ),
        actions,
      );
    };

    overlay.append(card);
    this.root.append(overlay);
    showBuyer();
  }

  // Winter Lights: light the five wish-lanterns, then the flock gathers.
  private openWinterLights(): void {
    if (document.querySelector('.race-overlay')) return;
    const state = this.game.state;
    if (festivalEnteredToday(state, 'winterLights')) {
      const last = state.lastFestival;
      if (last?.kind === 'winterLights' && last.day === dayOf(state.clock) && last.winter) {
        const overlay0 = el('div', { class: 'race-overlay' });
        const card0 = el('div', { class: 'race-card theme-winter' });
        card0.append(
          el(
            'div',
            { class: 'race-header' },
            el('strong', { class: 'with-icon' }, icon('sparkle', 16), 'The pond glows'),
            el('button', { class: 'close-btn', onclick: () => overlay0.remove() }, icon('close', 13)),
          ),
          litLanternRow(),
          el(
            'div',
            { class: 'race-stats fit' },
            statTile('coin', `+${last.winter.coins}`, 'coins'),
            statTile('wheat', `+${last.winter.premiumFeed}`, 'premium feed'),
          ),
          el('div', { class: 'egg-comment' }, last.winter.wishText),
          el('div', { class: 'actions race-actions' }, el('button', { class: 'action-btn primary', onclick: () => overlay0.remove() }, 'Back to the pond')),
        );
        overlay0.append(card0);
        this.root.append(overlay0);
        return;
      }
      this.toast('The lanterns already burn bright — enjoy the glow.');
      return;
    }
    const overlay = el('div', { class: 'race-overlay' });
    const card = el('div', { class: 'race-card theme-winter' });
    let wishTimer = 0;
    const close = () => {
      window.clearTimeout(wishTimer);
      overlay.remove();
    };
    let lit = 0;

    const wishLine = el('div', { class: 'egg-comment' }, 'Light each lantern and make a wish…');
    const lanternRow = el('div', { class: 'lantern-row' });
    LANTERN_WISHES.forEach((wish, i) => {
      const lantern = el(
        'button',
        {
          class: 'lantern',
          onclick: () => {
            if (lantern.classList.contains('lit')) return;
            lantern.classList.add('lit');
            lit += 1;
            wishLine.textContent = wish;
            if (lit === LANTERN_WISHES.length) {
              // The fifth lantern is the player's own wish.
              wishTimer = window.setTimeout(() => {
                const choices = el('div', { class: 'wish-choices' });
                for (const w of WINTER_WISHES) {
                  choices.append(
                    el(
                      'button',
                      { class: 'wish-choice', onclick: () => showFinale(winterCeremonyFinale(state, w.id)) },
                      el('strong', {}, w.label),
                      el('span', { class: 'muted small' }, w.blurb),
                    ),
                  );
                }
                card.replaceChildren(
                  el(
                    'div',
                    { class: 'race-header' },
                    el('strong', { class: 'with-icon' }, icon('sparkle', 16), 'The last lantern is yours'),
                    el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
                  ),
                  el('div', { class: 'egg-comment' }, 'Four wishes for the flock. The fifth is for the pond. Choose.'),
                  choices,
                );
              }, 700);
              const showFinale = (reward: ReturnType<typeof winterCeremonyFinale>) => {
                const finale = el(
                  'div',
                  {},
                  el(
                    'div',
                    { class: 'race-header' },
                    el('strong', { class: 'with-icon' }, icon('sparkle', 16), 'The pond glows'),
                    el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
                  ),
                  el(
                    'div',
                    { class: 'egg-comment' },
                    'The whole flock drifts in beneath the lights, feathers silvered by the glow. Somebody quacks softly. It is perfect.',
                  ),
                  litLanternRow(),
                  reward
                    ? el(
                        'div',
                        { class: 'race-stats fit' },
                        statTile('coin', `+${reward.coins}`, 'coins'),
                        statTile('wheat', `+${reward.premiumFeed}`, 'premium feed'),
                      )
                    : null,
                  reward ? el('div', { class: 'muted small race-blurb' }, 'And a very happy flock.') : null,
                  reward ? el('div', { class: 'egg-comment' }, reward.wishText) : null,
                  el(
                    'div',
                    { class: 'actions race-actions' },
                    el('button', { class: 'action-btn primary', onclick: close }, 'Stay a while, then head back'),
                  ),
                );
                if (reward) state.lastFestival = { day: dayOf(state.clock), kind: 'winterLights', winter: reward };
                card.replaceChildren(finale);
              };
            }
          },
        },
        el('span', { class: 'lantern-flame' }),
      );
      void i;
      lanternRow.append(lantern);
    });

    card.append(
      el(
        'div',
        { class: 'race-header' },
        el('strong', { class: 'with-icon' }, icon('sparkle', 16), 'Winter Lights'),
        el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
      ),
      wishLine,
      lanternRow,
    );
    overlay.append(card);
    this.root.append(overlay);
  }

  private openEggShow(): void {
    if (document.querySelector('.race-overlay')) return;
    const state = this.game.state;
    const eggs = state.ducks.filter((d) => d.stage === 'egg');
    const overlay = el('div', { class: 'race-overlay' });
    const card = el('div', { class: 'race-card egg-show theme-egg' });
    const timers: number[] = [];
    const close = () => {
      timers.forEach((t) => clearTimeout(t));
      overlay.remove();
    };
    const header = () =>
      el(
        'div',
        { class: 'race-header' },
        el('strong', { class: 'with-icon' }, icon('egg', 16), 'Spring Egg Show'),
        el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
      );

    const showStandings = (result: import('../sim/festivals').EggShowResult, replay = false) => {
      timers.forEach((t) => clearTimeout(t));
      const list = el('div', { class: 'race-results' });
      result.entries.forEach((entry, i) => {
        const rng = createRng(7);
        const sample = createDuck(rng, {
          genome: entry.genome,
          stage: 'egg',
          pos: { x: 0, y: 0 },
          name: 'egg',
        });
        list.append(
          el(
            'div',
            { class: `race-result-row${entry.isPlayer ? ' mine' : ''}` },
            el('span', { class: `race-place p${i + 1}` }, `${i + 1}`),
            duckPortrait(sample, 34),
            el(
              'span',
              { class: 'race-result-name egg-standing' },
              el('span', {}, `${entry.eggName} — ${entry.breeder}`),
              el('span', { class: 'chip chip-trait' }, entry.breed),
            ),
            el('span', { class: 'muted small' }, `${entry.score} pts`),
            entry.isPlayer && result.prize > 0
              ? el('span', { class: 'goal-reward with-icon' }, icon('coin', 11), `${result.prize}`)
              : null,
          ),
        );
      });
      card.classList.toggle('win', result.playerPlace === 0);
      card.replaceChildren(
        el(
          'div',
          { class: 'race-header' },
          el(
            'strong',
            { class: 'with-icon' },
            icon('egg', 16),
            result.playerPlace === 0 ? 'Best in Show!' : 'Final standings',
          ),
          el('button', { class: 'close-btn', onclick: close }, icon('close', 13)),
        ),
        el(
          'div',
          { class: 'muted small' },
          'The judges reveal each bloodline after the verdict:',
        ),
        list,
        el(
          'div',
          { class: 'actions race-actions' },
          el('button', { class: 'action-btn primary', onclick: close }, 'Back to the pond'),
        ),
      );
      if (result.prize > 0 && !replay) this.toast(`Placed ${result.playerPlace + 1}${['st', 'nd', 'rd'][result.playerPlace] ?? 'th'} — +${result.prize} coins!`);
    };

    const runCeremony = (result: import('../sim/festivals').EggShowResult) => {
      // Judge from the bottom of the field up, so the winner lands last.
      const order = [...result.entries].reverse();
      const stage = el('div', { class: 'egg-stage' });
      card.replaceChildren(
        header(),
        stage,
        el(
          'div',
          { class: 'actions race-actions' },
          el('button', { class: 'action-btn', onclick: () => showStandings(result) }, 'Skip to results'),
        ),
      );
      order.forEach((entry, i) => {
        timers.push(
          window.setTimeout(() => {
            const rng = createRng(7);
            const sample = createDuck(rng, {
              genome: entry.genome,
              stage: 'egg',
              pos: { x: 0, y: 0 },
              name: 'egg',
            });
            stage.replaceChildren(
              el('div', { class: 'muted small' }, `Now judging entry ${i + 1} of ${order.length}…`),
              el(
                'div',
                { class: 'egg-pedestal' },
                duckPortrait(sample, 72),
              ),
              el('div', { class: 'egg-breeder' }, `${entry.eggName} — ${entry.breeder}${entry.isPlayer ? ' (you)' : ''}`),
              el('div', { class: 'egg-comment' }, `“${entry.comment}”`),
              el('div', { class: 'egg-score' }, `${entry.score} points`),
            );
          }, i * 2100),
        );
      });
      timers.push(window.setTimeout(() => showStandings(result), order.length * 2100 + 700));
    };

    card.append(header());
    const last = state.lastFestival;
    if (festivalEnteredToday(state, 'eggShow') && last?.kind === 'eggShow' && last.day === dayOf(state.clock) && last.eggShow) {
      showStandings(last.eggShow, true);
      overlay.append(card);
      this.root.append(overlay);
      return;
    }
    if (festivalEnteredToday(state, 'eggShow')) {
      card.append(el('div', { class: 'muted' }, 'You already entered an egg this year — see you next spring!'));
    } else if (eggs.length === 0) {
      card.append(el('div', { class: 'muted' }, 'No eggs in the nest to enter. Nest a pair and come back before sundown!'));
    } else {
      card.append(
        el(
          'div',
          { class: 'muted' },
          'Enter one egg against four rival breeders. Judges score hidden genetics and how well its parents are kept.',
        ),
      );
      const grid = el('div', { class: 'race-picker' });
      for (const egg of eggs) {
        grid.append(
          el(
            'button',
            {
              class: 'race-pick',
              onclick: () => {
                const result = runEggShow(state, egg.id, this.game.rng);
                if (result) {
                  state.lastFestival = { day: dayOf(state.clock), kind: 'eggShow', eggShow: result };
                  runCeremony(result);
                } else close();
              },
            },
            duckPortrait(egg, 48),
            el('span', { class: 'small' }, 'Egg'),
          ),
        );
      }
      card.append(grid);
    }
    overlay.append(card);
    this.root.append(overlay);
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
          el('strong', {}, remote ? 'Pond opened on another device' : 'Pond opened in another tab'),
          el(
            'div',
            { class: 'muted' },
            remote
              ? 'This device has stopped playing and saving so the two copies cannot overwrite each other.'
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
            remote ? 'Play here instead' : 'Play in this tab instead',
          ),
        ),
      ),
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
