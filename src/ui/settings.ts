// Player settings — sound, motion, text size. Preferences, not game state:
// they live in localStorage under their own key, outside the save file, and
// apply as body classes (motion, text) and audio settings.
import { setAudioSettings } from '../audio/audio';

export interface Settings {
  volume: number; // 0..1
  muted: boolean;
  motion: 'system' | 'reduced' | 'full';
  textSize: 'normal' | 'large';
  keys: Record<KeyAction, string>; // KeyboardEvent.key per action ('' = unbound)
}

// Every rebindable action. Esc (close) stays fixed so a player can always
// get out of whatever is open.
export type KeyAction =
  | 'breeding'
  | 'shop'
  | 'roster'
  | 'book'
  | 'race'
  | 'save'
  | 'cards'
  | 'pause'
  | 'faster'
  | 'slower'
  | 'settings'
  | 'paddle';

export const KEY_ACTIONS: Array<{ id: KeyAction; label: string }> = [
  { id: 'breeding', label: 'Open Breeding' },
  { id: 'shop', label: 'Open the Shop' },
  { id: 'roster', label: 'Open the Flock' },
  { id: 'book', label: 'Open the Book' },
  { id: 'race', label: 'Open the Race' },
  { id: 'save', label: 'Open Save' },
  { id: 'cards', label: 'Show / hide duck cards' },
  { id: 'pause', label: 'Pause / resume' },
  { id: 'faster', label: 'Faster' },
  { id: 'slower', label: 'Slower' },
  { id: 'settings', label: 'Settings' },
  { id: 'paddle', label: 'Paddle (race or drill)' },
];

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  breeding: '1',
  shop: '2',
  roster: '3',
  book: '4',
  race: '5',
  save: '6',
  cards: 'c',
  pause: 'p',
  faster: '+',
  slower: '-',
  settings: '?',
  paddle: ' ',
};

// Normalise a KeyboardEvent.key for storage and comparison: letters fold to
// lower case; '=' counts as '+' and '_' as '-' so the unshifted key works.
export function normalizeKey(key: string): string {
  if (key === '=') return '+';
  if (key === '_') return '-';
  return key.length === 1 ? key.toLowerCase() : key;
}

// A readable name for a stored key.
export function keyLabel(key: string): string {
  if (!key) return 'unbound';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key.replace(/^Arrow/, '');
}

export function keyFor(action: KeyAction): string {
  return current.keys[action] ?? DEFAULT_KEYS[action];
}

export function matchesKey(e: KeyboardEvent, action: KeyAction): boolean {
  const bound = keyFor(action);
  return bound !== '' && normalizeKey(e.key) === bound;
}

// The action a key is bound to, if any.
export function actionForKey(key: string): KeyAction | null {
  const k = normalizeKey(key);
  for (const { id } of KEY_ACTIONS) if (current.keys[id] === k) return id;
  return null;
}

// Rebind one action; a key already used elsewhere is taken from that
// action (it becomes unbound). Returns the action that lost the key, if any.
export function rebindKey(action: KeyAction, key: string): KeyAction | null {
  const k = normalizeKey(key);
  const keys = { ...current.keys };
  let displaced: KeyAction | null = null;
  for (const { id } of KEY_ACTIONS) {
    if (id !== action && keys[id] === k) {
      keys[id] = '';
      displaced = id;
    }
  }
  keys[action] = k;
  updateSettings({ keys });
  return displaced;
}

export function resetKeys(): void {
  updateSettings({ keys: { ...DEFAULT_KEYS } });
}

// Keys the game never lets a player bind: modifiers on their own, and Esc.
export function bindableKey(key: string): boolean {
  return !['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab', 'CapsLock', 'Dead', 'Unidentified'].includes(key);
}

export const SETTINGS_KEY = 'ducksim:ui:settings';

const DEFAULTS: Settings = { volume: 0.6, muted: false, motion: 'system', textSize: 'normal', keys: { ...DEFAULT_KEYS } };

let current: Settings = { ...DEFAULTS };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const keys = { ...DEFAULT_KEYS };
      if (parsed.keys && typeof parsed.keys === 'object') {
        for (const { id } of KEY_ACTIONS) {
          const v = (parsed.keys as Partial<Record<KeyAction, unknown>>)[id];
          if (typeof v === 'string' && v.length <= 24) keys[id] = v;
        }
      }
      current = {
        volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULTS.volume,
        muted: Boolean(parsed.muted),
        motion: parsed.motion === 'reduced' || parsed.motion === 'full' ? parsed.motion : 'system',
        textSize: parsed.textSize === 'large' ? 'large' : 'normal',
        keys,
      };
    }
  } catch {
    current = { ...DEFAULTS };
  }
  applySettings();
  return { ...current };
}

export function settings(): Settings {
  return { ...current, keys: { ...current.keys } };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch, keys: { ...current.keys, ...(patch.keys ?? {}) } };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Private mode or a full store: the setting still applies for this session.
  }
  applySettings();
  return { ...current };
}

// Does the player want less motion? Honours the OS setting unless overridden.
export function reducedMotion(): boolean {
  if (current.motion === 'reduced') return true;
  if (current.motion === 'full') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function applySettings(): void {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (!body) return;
  body.classList.toggle('reduce-motion', reducedMotion());
  body.classList.toggle('text-large', current.textSize === 'large');
  setAudioSettings({ volume: current.volume, muted: current.muted });
}
