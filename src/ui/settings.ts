// Player settings — sound, motion, text size. Preferences, not game state:
// they live in localStorage under their own key, outside the save file, and
// apply as body classes (motion, text) and audio settings.
import { setAudioSettings } from '../audio/audio';

export interface Settings {
  volume: number; // 0..1
  muted: boolean;
  motion: 'system' | 'reduced' | 'full';
  textSize: 'normal' | 'large';
}

export const SETTINGS_KEY = 'ducksim:ui:settings';

const DEFAULTS: Settings = { volume: 0.6, muted: false, motion: 'system', textSize: 'normal' };

let current: Settings = { ...DEFAULTS };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      current = {
        volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULTS.volume,
        muted: Boolean(parsed.muted),
        motion: parsed.motion === 'reduced' || parsed.motion === 'full' ? parsed.motion : 'system',
        textSize: parsed.textSize === 'large' ? 'large' : 'normal',
      };
    }
  } catch {
    current = { ...DEFAULTS };
  }
  applySettings();
  return { ...current };
}

export function settings(): Settings {
  return { ...current };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
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
  const body = document.body;
  if (!body) return;
  body.classList.toggle('reduce-motion', reducedMotion());
  body.classList.toggle('text-large', current.textSize === 'large');
  setAudioSettings({ volume: current.volume, muted: current.muted });
}
