// Settings: sound, motion, text size — and the keyboard sheet. Preferences
// live outside the save (see settings.ts).
import type { PanelCtx } from './ui';
import { el, panelHeader } from './dom';
import { play } from '../audio/audio';
import { bindableKey, DEFAULT_KEYS, KEY_ACTIONS, keyLabel, rebindKey, resetKeys, settings, updateSettings, type KeyAction, type Settings } from './settings';

// Which action is waiting for a key press, if any. Module state: the panel
// rebuilds twice a second and must keep showing "press a key…".
let capturing: KeyAction | null = null;
let captureListener: ((e: KeyboardEvent) => void) | null = null;

export function keyCaptureActive(): boolean {
  return capturing !== null;
}

function stopCapture(): void {
  if (captureListener) window.removeEventListener('keydown', captureListener, true);
  captureListener = null;
  capturing = null;
}

function startCapture(action: KeyAction, done: (msg: string | null) => void): void {
  stopCapture();
  capturing = action;
  captureListener = (e: KeyboardEvent) => {
    // The game's own handler must not see this press.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      stopCapture();
      done(null);
      return;
    }
    if (!bindableKey(e.key)) return; // a modifier alone: keep waiting
    stopCapture();
    const displaced = rebindKey(action, e.key);
    const label = KEY_ACTIONS.find((a) => a.id === action)!.label;
    done(displaced ? `${label} is now ${keyLabel(e.key)} — ${KEY_ACTIONS.find((a) => a.id === displaced)!.label} is unbound.` : `${label} is now ${keyLabel(e.key)}.`);
  };
  window.addEventListener('keydown', captureListener, true);
}

export function renderSettingsPanel(ctx: PanelCtx): HTMLElement {
  const s = settings();
  const panel = el('aside', { class: 'panel wide settings' });
  panel.append(panelHeader('star', 'Settings', ctx.close));

  const row = (label: string, control: HTMLElement, hint?: string) =>
    el('div', { class: 'settings-row' }, el('label', { class: 'settings-label' }, label), control, hint ? el('div', { class: 'muted small settings-hint' }, hint) : null);

  const set = (patch: Partial<Settings>) => {
    updateSettings(patch);
    ctx.ui.refreshPanel();
  };

  const volume = el('input', { type: 'range', min: 0, max: 100, value: Math.round(s.volume * 100), class: 'settings-range', 'aria-label': 'Volume' }) as HTMLInputElement;
  volume.addEventListener('input', () => updateSettings({ volume: Number(volume.value) / 100 }));
  volume.addEventListener('change', () => {
    play('quack');
    ctx.ui.refreshPanel();
  });
  const mute = el(
    'button',
    { class: `roster-chip${s.muted ? ' active' : ''}`, 'aria-pressed': String(s.muted), onclick: () => set({ muted: !s.muted }) },
    s.muted ? 'Muted' : 'Sound on',
  );
  panel.append(
    el('div', { class: 'section' }, el('strong', {}, 'Sound'), row('Volume', el('div', { class: 'settings-inline' }, volume, mute), 'Quacks, splashes, chimes, and the pond\'s ambience — all synthesised, nothing downloaded.')),
  );

  const choice = <K extends keyof Settings>(key: K, options: Array<[Settings[K], string]>) => {
    const group = el('div', { class: 'settings-inline' });
    for (const [value, label] of options) {
      group.append(el('button', { class: `roster-chip${s[key] === value ? ' active' : ''}`, 'aria-pressed': String(s[key] === value), onclick: () => set({ [key]: value } as Partial<Settings>) }, label));
    }
    return group;
  };
  panel.append(
    el(
      'div',
      { class: 'section' },
      el('strong', {}, 'Display'),
      row('Motion', choice('motion', [['system', 'Follow system'], ['reduced', 'Reduced'], ['full', 'Full']]), 'Reduced motion stills the panel slides, banners, and pulses. The pond itself always moves.'),
      row('Text size', choice('textSize', [['normal', 'Normal'], ['large', 'Large']])),
    ),
  );

  // Keyboard: every action with its key and a Change button; a capture in
  // progress shows in place. Esc and Ctrl/Cmd-click are fixed.
  const keys = el('div', { class: 'shortcut-list' });
  const finish = (msg: string | null) => {
    if (msg) ctx.ui.toast(msg);
    ctx.ui.refreshPanel();
  };
  for (const { id, label } of KEY_ACTIONS) {
    const bound = s.keys[id];
    const isDefault = bound === DEFAULT_KEYS[id];
    keys.append(
      el(
        'div',
        { class: `shortcut-row${capturing === id ? ' capturing' : ''}` },
        capturing === id
          ? el('kbd', { class: 'waiting' }, 'press a key…')
          : el('kbd', { class: bound ? '' : 'unbound' }, keyLabel(bound)),
        el('span', {}, label, isDefault ? null : el('span', { class: 'muted small' }, ` (default ${keyLabel(DEFAULT_KEYS[id])})`)),
        capturing === id
          ? el('button', { class: 'roster-chip', onclick: () => { stopCapture(); finish(null); } }, 'Cancel')
          : el('button', { class: 'roster-chip', title: 'Press the new key; Esc cancels', onclick: () => { startCapture(id, finish); ctx.ui.refreshPanel(); } }, 'Change'),
      ),
    );
  }
  keys.append(
    el('div', { class: 'shortcut-row fixed' }, el('kbd', {}, 'Esc'), el('span', {}, 'Close the open window, cancel placing a decoration'), el('span', { class: 'muted small' }, 'fixed')),
    el('div', { class: 'shortcut-row fixed' }, el('kbd', {}, 'Ctrl/Cmd-click'), el('span', {}, 'Pin a duck\'s card to compare'), el('span', { class: 'muted small' }, 'fixed')),
  );
  const allDefault = KEY_ACTIONS.every(({ id }) => s.keys[id] === DEFAULT_KEYS[id]);
  panel.append(
    el(
      'div',
      { class: 'section' },
      el('div', { class: 'pedigree-head' }, el('strong', {}, 'Keyboard'), el('button', { class: 'roster-chip', disabled: allDefault, onclick: () => { resetKeys(); ctx.ui.refreshPanel(); } }, 'Reset to defaults')),
      el('div', { class: 'muted small' }, 'Click Change and press the key you want. A key already in use moves over; the old action is left unbound until you give it a new one.'),
      keys,
    ),
  );
  panel.append(
    el(
      'div',
      { class: 'section muted small' },
      'Settings are kept in this browser, not in the save. The genetics guide is under Book → Guide.',
    ),
  );
  return panel;
}
