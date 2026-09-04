// Pointer input on the pond canvas: petting and brushing strokes, feeding,
// decor placement, visitor treats, pickups, the trough, eggs, and picking a
// duck. Talks to the UI through a small host interface so the click cascade
// can be read (and reordered) in one place.
import type { Game } from '../game';
import type { Renderer } from '../render/renderer';
import type { PanelKind } from './ui';
import type { ToastTone } from './notices';
import { catchBugAt } from '../sim/bugs';
import { claimHatch } from '../sim/lifecycle';
import { treatVisitor, VISITOR_CLICK_RADIUS } from '../sim/visitors';
import { FOODS, type FoodKind } from '../sim/food';
import { brushStroke, dropFood, fillFeeder, petStroke, tuckEgg } from '../sim/needs';
import { FEEDER_POS } from '../sim/pond';
import { play } from '../audio/audio';
import { pickMateFromPond } from './breedingPanel';
import { duckById } from '../state';

const DECOR_PICK_RADIUS = 26;

interface CanvasHost {
  game: Game;
  renderer: Renderer;
  toast(msg: string, tone?: ToastTone): void;
  feedModeNow(): 'none' | FoodKind | 'brush';
  toggleFeedMode(kind: FoodKind | 'brush'): void;
  decorModeActive(): boolean;
  decorClick(world: { x: number; y: number }): void;
  updateDecorGhost(world: { x: number; y: number }): void;
  startMovingDecor(idx: number, world: { x: number; y: number }): void;
  modalKindNow(): Exclude<PanelKind, 'duck'> | null;
  duckCardIsOpen(): boolean;
  closeDuckCard(): void;
  openPanel(kind: PanelKind): void;
  selectDuck(id: string, pin?: boolean): void;
  refreshPanel(): void;
}

export function bindCanvasInput(host: CanvasHost): void {
  let stroke: { duckId: string; lastX: number; lastY: number; travelled: number } | null = null;
  let suppressNextClick = false;
  const canvas = document.getElementById('pond-canvas');
  if (!canvas) throw new Error('bindCanvasInput: #pond-canvas is missing from the page');

  // Stroke gestures: press on a duck and rub to pet (bare hand, hearts) or
  // scrub (brush tool, bubbles). A near-still press stays a normal click.
  canvas.addEventListener('pointerdown', (e) => {
    const feedMode = host.feedModeNow();
    const world = host.renderer.toWorld(e.clientX, e.clientY);
    if (feedMode !== 'none' && feedMode !== 'brush') return;
    const id = host.renderer.pickDuck(world.x, world.y);
    if (id) stroke = { duckId: id, lastX: world.x, lastY: world.y, travelled: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (host.decorModeActive()) {
      const world = host.renderer.toWorld(e.clientX, e.clientY);
      host.updateDecorGhost(world);
    }
    if (!stroke) return;
    const feedMode = host.feedModeNow();
    const state = host.game.state;
    const duck = duckById(state, stroke!.duckId);
    const world = host.renderer.toWorld(e.clientX, e.clientY);
    const step = Math.hypot(world.x - stroke.lastX, world.y - stroke.lastY);
    stroke.lastX = world.x;
    stroke.lastY = world.y;
    if (!duck || duck.stage === 'egg') return;
    // Stay near the duck for the stroke to count.
    if (Math.hypot(world.x - duck.pos.x, world.y - duck.pos.y) > 55) return;
    stroke.travelled += step;
    if (stroke.travelled > 8) suppressNextClick = true;
    while (stroke.travelled >= 22) {
      stroke.travelled -= 22;
      if (feedMode === 'brush') {
        if (brushStroke(state, duck.id, 6) > 0) {
          host.renderer.spawnParticle(world.x, world.y, 'bubble');
          host.renderer.spawnParticle(duck.pos.x, duck.pos.y - 10, 'bubble');
        }
      } else if (petStroke(state, duck.id, 2) > 0) {
        host.renderer.spawnParticle(duck.pos.x, duck.pos.y - 20, 'heart');
      }
    }
  });
  window.addEventListener('pointerup', () => {
    stroke = null;
  });

  canvas.addEventListener('click', (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const me = e as MouseEvent;
    const feedMode = host.feedModeNow();
    const world = host.renderer.toWorld(me.clientX, me.clientY);

    if (host.decorModeActive()) {
      host.decorClick(world);
      return;
    }

    // A visiting wild duck: clicking it offers a premium treat.
    const visitor = host.game.state.visitor;
    if (visitor) {
      const vdx = world.x - visitor.duck.pos.x;
      const vdy = world.y - visitor.duck.pos.y;
      if (vdx * vdx + vdy * vdy < VISITOR_CLICK_RADIUS * VISITOR_CLICK_RADIUS) {
        const result = treatVisitor(host.game.state);
        if (result === 'no-feed') host.toast('It wants premium feed — buy some at the shop!');
        else if (result === 'landing') host.toast('Let it land first!');
        return;
      }
    }

    // Bugs are small, precise targets — give them first claim on the click,
    // otherwise the trough's larger hit area swallows catches near it.
    const pickup = catchBugAt(host.game.state, world.x, world.y);
    if (pickup) {
      host.renderer.spawnParticle(world.x, world.y, 'sparkle');
      play('sparkle');
      switch (pickup.kind) {
        case 'feather':
          host.toast(`${pickup.source ?? 'A duck'}'s feather · +${pickup.coins} coins`, 'echo');
          break;
        case 'duckweed':
          host.toast(`+${pickup.feed} feed`, 'echo');
          break;
        case 'firefly':
          host.toast(`Firefly · +${pickup.coins} coin`, 'echo');
          break;
        case 'henEgg':
          host.toast(`${pickup.source ?? 'A hen'}'s egg · basket ${host.game.state.inventory.eggs}`, 'echo');
          break;
        default:
          host.toast(`+${pickup.coins} coins`, 'echo');
      }
      return;
    }

    // Clicking the trough tops it up from the feed inventory. Hit area
    // matches the drawn trough (plus a small margin), not a big circle.
    if (
      (host.game.state.upgrades.feedingTrough ?? 0) > 0 &&
      Math.abs(world.x - FEEDER_POS.x) < 52 &&
      world.y > FEEDER_POS.y - 22 &&
      world.y < FEEDER_POS.y + 28
    ) {
      const moved = fillFeeder(host.game.state);
      if (moved > 0) host.toast(`Poured ${moved} feed`, 'echo');
      else if (host.game.state.inventory.feed <= 0)
        host.toast('No feed to pour — visit the shop!');
      else host.toast('The trough is already full');
      return;
    }

    if (feedMode !== 'none' && feedMode !== 'brush') {
      const ok = dropFood(host.game.state, world, feedMode);
      if (ok) play('plop');
      if (!ok) {
        host.toast(`Out of ${FOODS[feedMode].name.toLowerCase()} — visit the shop!`);
        host.toggleFeedMode(feedMode);
      }
      return;
    }

    const id = host.renderer.pickDuck(world.x, world.y);
    // No duck under the cursor: a decoration there gets picked up to move.
    if (!id && feedMode === 'none') {
      const idx = host.game.state.decorations.findIndex(
        (d) => Math.hypot(d.pos.x - world.x, d.pos.y - world.y) < DECOR_PICK_RADIUS,
      );
      if (idx >= 0) {
        host.startMovingDecor(idx, world);
        return;
      }
    }
    // Eggs are tended by tapping: a cracked egg hatches, otherwise it gets
    // tucked back into the warm straw.
    const egg = duckById(host.game.state, id);
    if (egg && egg.stage === 'egg') {
      if (claimHatch(host.game.state, host.game.rng, egg.id)) {
        for (let i = 0; i < 5; i += 1) host.renderer.spawnParticle(egg.pos.x, egg.pos.y - 10, 'heart');
        host.game.selectedDuckId = egg.id;
        host.openPanel('duck');
        return;
      }
      if (tuckEgg(host.game.state, egg.id)) {
        host.renderer.spawnParticle(egg.pos.x, egg.pos.y - 14, 'heart');
        host.toast('Tucked in', 'echo');
      }
    }
    // With the Breeding panel open, clicking an adult on the pond drops it
    // straight into a mate slot — no detour through the duck cards.
    if (id && host.modalKindNow() === 'breeding' && pickMateFromPond(host.game.state, id)) {
      const picked = duckById(host.game.state, id);
      if (picked) host.renderer.spawnParticle(picked.pos.x, picked.pos.y - 20, 'heart');
      host.refreshPanel();
      return;
    }
    if (id && (me.ctrlKey || me.metaKey)) {
      host.selectDuck(id, true);
      return;
    }
    if (id) host.selectDuck(id);
    else {
      host.game.selectedDuckId = null;
      if (host.duckCardIsOpen()) host.closeDuckCard();
    }
  });
}
