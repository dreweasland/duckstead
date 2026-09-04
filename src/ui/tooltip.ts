// One tooltip for the whole app. Elements keep writing `title="…"`; on first
// hover or focus the title moves to `data-tip` (so the browser's own delayed
// tooltip never shows) and a styled bubble appears at once — on touch, a tap
// shows it for a moment. Nothing else in the UI has to change.
import { el } from './dom';

let bubble: HTMLElement | null = null;
let shownFor: Element | null = null;
let hideTimer = 0;

function tipOf(target: EventTarget | null): { node: HTMLElement; text: string } | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest<HTMLElement>('[title], [data-tip]');
  if (!node) return null;
  const title = node.getAttribute('title');
  if (title !== null) {
    node.setAttribute('data-tip', title);
    node.removeAttribute('title');
  }
  const text = node.getAttribute('data-tip') ?? '';
  return text.trim() ? { node, text } : null;
}

function show(node: HTMLElement, text: string): void {
  if (!bubble) {
    bubble = el('div', { class: 'tooltip', role: 'tooltip' });
    document.body.append(bubble);
  }
  window.clearTimeout(hideTimer);
  shownFor = node;
  bubble.textContent = text;
  bubble.classList.add('show');
  const r = node.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  let x = r.left + r.width / 2 - b.width / 2;
  x = Math.max(6, Math.min(window.innerWidth - b.width - 6, x));
  let y = r.top - b.height - 8;
  if (y < 6) y = r.bottom + 8;
  bubble.style.left = `${x}px`;
  bubble.style.top = `${y}px`;
}

function hideTooltip(): void {
  shownFor = null;
  bubble?.classList.remove('show');
}

export function installTooltips(): void {
  document.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    const tip = tipOf(e.target);
    if (!tip) {
      if (shownFor && !(e.target instanceof Element && shownFor.contains(e.target))) hideTooltip();
      return;
    }
    if (tip.node !== shownFor) show(tip.node, tip.text);
  });
  document.addEventListener('pointerout', (e) => {
    const tip = tipOf(e.target);
    if (tip && tip.node === shownFor) hideTooltip();
  });
  document.addEventListener('focusin', (e) => {
    const tip = tipOf(e.target);
    if (tip) show(tip.node, tip.text);
  });
  document.addEventListener('focusout', () => hideTooltip());
  // Touch: a tap on a tipped control shows it briefly (the click still lands).
  document.addEventListener('pointerdown', (e) => {
    if ((e as PointerEvent).pointerType !== 'touch') {
      hideTooltip();
      return;
    }
    const tip = tipOf(e.target);
    if (!tip) return hideTooltip();
    show(tip.node, tip.text);
    hideTimer = window.setTimeout(hideTooltip, 1800);
  });
  window.addEventListener('scroll', hideTooltip, true);
}
