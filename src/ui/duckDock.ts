// The duck dock: the selected duck's card, anchored to the right edge like
// an animal panel in a zoo game, with pinned comparison cards stacked
// beneath it. One scrolling column; nothing to drag. The main slot is
// swapped by the UI's panel refresh; the pins are re-rendered here.
import type { UI } from './ui';
import { el } from './dom';
import { renderDuckPanel } from './duckPanel';

interface DuckDockHost {
  ui: UI;
  dock: HTMLElement;
  // Never rebuild the panel mid-press (see the UI's pointerdown wiring).
  pointerDownInPanel(): void;
  toast(msg: string): void;
}

// Enough to compare a pair against a candidate; more and the column scrolls
// past what anyone reads.
export const MAX_PINS = 3;

export class DuckDock {
  readonly mainSlot: HTMLElement;
  // Pinned duck cards: extra live copies kept open while you open other ducks.
  private pinned: Array<{ id: string; host: HTMLElement }> = [];

  constructor(private host: DuckDockHost) {
    this.mainSlot = el('div', { class: 'dock-slot main' });
    host.dock.append(this.mainSlot);
    host.dock.addEventListener('pointerdown', () => host.pointerDownInPanel());
  }

  pinDuck(id: string): void {
    if (this.pinned.some((p) => p.id === id)) return;
    if (this.pinned.length >= MAX_PINS) {
      this.host.toast(`Up to ${MAX_PINS} pinned cards — unpin one first`);
      return;
    }
    const host = el('div', { class: 'dock-slot pinned', 'data-id': id });
    this.host.dock.append(host);
    this.host.dock.classList.add('has-cards');
    this.pinned.push({ id, host });
    this.refreshPinned();
  }

  unpinDuck(id: string): void {
    const i = this.pinned.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.pinned[i].host.remove();
    this.pinned.splice(i, 1);
    if (this.pinned.length === 0 && !this.mainSlot.firstElementChild) this.host.dock.classList.remove('has-cards');
  }

  isPinned(id: string): boolean {
    return this.pinned.some((p) => p.id === id);
  }

  hasPins(): boolean {
    return this.pinned.length > 0;
  }

  // Whether a node (the focused element) sits inside one of the pinned
  // cards — the panel refresh holds off while someone types in one.
  pinnedContains(node: Element): boolean {
    return this.pinned.some((p) => p.host.contains(node));
  }

  refreshPinned(): void {
    for (const entry of [...this.pinned]) {
      if (!this.host.ui.game.state.ducks.some((d) => d.id === entry.id)) {
        this.unpinDuck(entry.id);
        continue;
      }
      const panel = renderDuckPanel({
        game: this.host.ui.game,
        ui: this.host.ui,
        duckId: entry.id,
        pinned: true,
        close: () => this.unpinDuck(entry.id),
      });
      if (!panel) {
        this.unpinDuck(entry.id);
        continue;
      }
      panel.classList.add('docked', 'no-anim');
      const old = entry.host.firstElementChild as HTMLElement | null;
      const scroll = old?.scrollTop ?? 0;
      entry.host.replaceChildren(panel);
      panel.scrollTop = scroll;
    }
  }
}
