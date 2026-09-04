// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notices } from './notices';
import { el } from './dom';
import type { Game } from '../game';

function build() {
  const root = el('div');
  const toastHost = el('div', { class: 'toast-host' });
  const bannerHost = el('div', { class: 'banner-host' });
  root.append(toastHost, bannerHost);
  document.body.append(root);
  const notices = new Notices({
    game: {} as Game,
    root,
    bannerHost,
    toastHost,
    openPanel: () => {},
    refreshPanel: () => {},
    closePanel: () => {},
  });
  return { root, toastHost, notices };
}

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('keeps at most three in the stack, evicting the oldest', () => {
    const { toastHost, notices } = build();
    for (const m of ['one', 'two', 'three', 'four']) notices.toast(m);
    vi.advanceTimersByTime(500); // the evicted one finishes its fade-out
    const texts = [...toastHost.querySelectorAll('.toast')].map((n) => n.textContent);
    expect(texts).toEqual(['two', 'three', 'four']);
  });

  it('collapses a repeated message into one with a count and a fresh life', () => {
    const { toastHost, notices } = build();
    notices.toast('Olive got sick!', 'alert');
    vi.advanceTimersByTime(5000);
    notices.toast('Olive got sick!', 'alert');
    expect(toastHost.querySelectorAll('.toast')).toHaveLength(1);
    expect(toastHost.querySelector('.toast-count')?.textContent).toBe('×2');
    vi.advanceTimersByTime(3000); // 8s after the first: still up, the repeat renewed it
    expect(toastHost.querySelector('.toast.show')).not.toBeNull();
    vi.advanceTimersByTime(4000);
    expect(toastHost.querySelector('.toast')).toBeNull();
  });

  it('alerts outlive plain toasts and carry the alert class', () => {
    const { toastHost, notices } = build();
    notices.toast('plain');
    notices.toast('loud', 'alert');
    expect(toastHost.querySelector('.toast.alert')?.textContent).toBe('loud');
    vi.advanceTimersByTime(4500);
    expect([...toastHost.querySelectorAll('.toast')].map((n) => n.textContent)).toEqual(['loud']);
  });

  it('echoes appear beside the last click, not in the stack', () => {
    const { root, toastHost, notices } = build();
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, clientY: 200 }));
    notices.toast('+2 feed', 'echo');
    expect(toastHost.children).toHaveLength(0);
    const echo = root.querySelector('.echo-host .echo') as HTMLElement;
    expect(echo.textContent).toBe('+2 feed');
    expect(echo.style.left).toBe('300px');
    expect(echo.style.top).toBe('172px');
    vi.advanceTimersByTime(2000);
    expect(root.querySelector('.echo')).toBeNull();
  });
});
