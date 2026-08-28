// Settings: sound, motion, text size — and the keyboard sheet. Preferences
// live outside the save (see settings.ts).
import type { PanelCtx } from './ui';
import { el, panelHeader } from './dom';
import { play } from '../audio/audio';
import { settings, updateSettings, type Settings } from './settings';

export const SHORTCUTS: Array<[string, string]> = [
  ['Esc', 'Close the open window, cancel placing a decoration'],
  ['1 – 6', 'Breed · Shop · Flock · Book · Race · Save'],
  ['C', 'Show or hide the duck cards'],
  ['P', 'Pause / resume'],
  ['+ / −', 'Faster / slower'],
  ['Space', 'Paddle (in a race or drill)'],
  ['Ctrl/Cmd-click a duck', 'Pin its card to compare'],
  ['?', 'This sheet'],
];

export function renderSettingsPanel(ctx: PanelCtx): HTMLElement {
  const s = settings();
  const panel = el('aside', { class: 'panel settings' });
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

  const keys = el('div', { class: 'shortcut-list' });
  for (const [key, what] of SHORTCUTS) keys.append(el('div', { class: 'shortcut-row' }, el('kbd', {}, key), el('span', {}, what)));
  panel.append(el('div', { class: 'section' }, el('strong', {}, 'Keyboard'), keys));
  panel.append(
    el(
      'div',
      { class: 'section muted small' },
      'Settings are kept in this browser, not in the save. The genetics guide is under Book → Guide.',
    ),
  );
  return panel;
}
