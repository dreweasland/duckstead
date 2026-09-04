// The floating duck card and its pinned comparison copies: where the main
// card sits, dragging by the header, and the extra floating windows kept
// open (and live) while you open other ducks to compare.
import type { UI } from './ui';
import { el } from './dom';
import { renderDuckPanel } from './duckPanel';

interface FloatWindowsHost {
  ui: UI;
  root: HTMLElement;
  floatHost: HTMLElement;
  modalHost: HTMLElement;
  modalOpen(): boolean;
  // Never rebuild the panel mid-press (see the UI's pointerdown wiring).
  pointerDownInPanel(): void;
}

export class FloatWindows {
  private floatHost: HTMLElement;
  // Where the floating duck card sits; remembered across opens this session.
  private floatPos: { x: number; y: number } | null = null;
  // Pinned duck cards: extra floating copies kept open for comparison.
  private pinned: Array<{ id: string; host: HTMLElement; pos: { x: number; y: number }; dispose: () => void }> = [];

  constructor(private host: FloatWindowsHost) {
    this.floatHost = host.floatHost;
  }

  // Drag the floating duck card by its header. Delegated so it survives the
  // panel's periodic rebuilds.
  bindFloatDrag(): void {
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

  applyFloatPos(): void {
    if (!this.floatPos) {
      // Default: centered horizontally, upper third of the screen — unless a
      // modal is open, in which case the card steps aside so both stay
      // readable (a drag still puts it anywhere).
      if (this.host.modalOpen() || document.querySelector('.race-overlay')) {
        const modal = (this.host.modalHost.firstElementChild ?? document.querySelector('.race-overlay .race-card')) as HTMLElement | null;
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
    this.host.root.append(host);
    const entry = { id, host, pos, dispose: () => {} };
    this.pinned.push(entry);
    entry.dispose = this.bindDrag(host, (p) => { entry.pos = p; });
    host.addEventListener('pointerdown', () => { this.host.pointerDownInPanel(); });
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

  // Whether a node (the focused element) sits inside one of the pinned
  // windows — the panel refresh holds off while someone types in one.
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
      panel.classList.add('floating', 'no-anim');
      const old = entry.host.firstElementChild as HTMLElement | null;
      const scroll = old?.scrollTop ?? 0;
      entry.host.replaceChildren(panel);
      panel.scrollTop = scroll;
    }
  }
}
