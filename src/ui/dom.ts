type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
type Child = Node | string | null | undefined;

export function statBar(pct: number, color: string, thin = false): HTMLElement {
  const fill = el('div', { class: 'bar-fill' });
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  fill.style.background = color;
  return el('div', { class: thin ? 'bar thin' : 'bar' }, fill);
}

export function needColor(value: number): string {
  return value > 60 ? '#69b356' : value > 30 ? '#e0a93a' : '#d4544a';
}

export function el(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'disabled') {
      if (value) node.setAttribute('disabled', '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}
