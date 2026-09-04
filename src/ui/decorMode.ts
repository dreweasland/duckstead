// Placing and moving decorations on the grass: the ghost that follows the
// pointer, the click that sets one down, and why a spot won't do.
import type { Game } from '../game';
import type { Renderer } from '../render/renderer';
import { FEEDER_POS, isInPond, nestPos } from '../sim/pond';
import { GROUND_TOP, WORLD_H, WORLD_W } from '../state';
import { DECOR_ITEMS, placeDecoration } from '../sim/economy';

const WORLD_H_SAFE = WORLD_H - 15;

export class DecorMode {
  private placingDecor: import('../sim/economy').DecorDef | null = null;
  private movingDecor: number | null = null; // index into state.decorations

  constructor(
    private game: Game,
    private renderer: Renderer,
    private toast: (msg: string) => void,
  ) {}

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
    const placed = placeDecoration(this.game.state, def.kind, world);
    this.toast(placed.ok ? `${def.name} placed!` : placed.reason);
    this.endDecorMode();
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
}
