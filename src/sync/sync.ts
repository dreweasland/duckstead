// Cloud sync orchestration: boot-time save selection, steady-state pushes,
// ownership polling, and cross-device takeover. Attached only when the
// player has linked a device — otherwise none of this code runs and the
// game is exactly the offline localStorage game it always was.
import { events } from '../events';
import type { Game } from '../game';
import { SAVE_KEY } from '../save/save';
import { claimSave, pullSave, pullMeta, pushSave } from './syncClient';
import { loadSyncMeta, saveSyncMeta } from './syncMeta';
import { planBoot, planPoll, planPush } from './syncPlan';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'stale';

// Polls double as offline-reconnect probes, so one cadence covers both.
const POLL_MS = 15_000;

function setStatus(status: SyncStatus): void {
  events.emit('sync-status', status);
}

// ---- boot ------------------------------------------------------------------

// Decide which save to play before the Game constructor reads localStorage.
// May overwrite the local save with the cloud blob; may ask the player when
// both sides have progress. Resolves once the save in localStorage is the
// one to load. Network failure resolves silently — offline play is fine.
export async function prepareCloudBoot(): Promise<void> {
  const meta = loadSyncMeta();
  if (!meta) return;
  let cloud;
  try {
    cloud = await pullSave(meta);
  } catch {
    return; // offline: play local, attachCloudSync keeps retrying
  }
  const hasLocalSave = localStorage.getItem(SAVE_KEY) !== null;
  const decision = planBoot(cloud, {
    lastSyncedSeq: meta.lastSyncedSeq,
    dirty: meta.dirty,
    hasLocalSave,
  });
  const adoptCloud = (): void => {
    if (cloud.blob) localStorage.setItem(SAVE_KEY, cloud.blob);
    meta.lastSyncedSeq = cloud.seq;
    meta.dirty = false;
  };
  if (decision === 'use-cloud') {
    adoptCloud();
  } else if (decision === 'conflict') {
    const keepCloud = await askConflict(cloud.savedAt);
    if (keepCloud) {
      adoptCloud();
    } else {
      // Keep this device's save: adopt the cloud head as our CAS base so the
      // first push overwrites it (the DO keeps the previous blob in slot 1).
      meta.lastSyncedSeq = cloud.seq;
      meta.dirty = true;
    }
  }
  try {
    await claimSave(meta);
  } catch {
    // Claim failing after a successful pull is rare; the poll will sort it.
  }
  saveSyncMeta(meta);
}

// Blocking pre-boot question — plain DOM because the game UI doesn't exist
// yet. Losing either side silently is the one unforgivable outcome.
function askConflict(cloudSavedAt: number): Promise<boolean> {
  return new Promise((resolve) => {
    const when = new Date(cloudSavedAt).toLocaleString([], {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
    const overlay = document.createElement('div');
    overlay.className = 'sync-conflict-overlay';
    overlay.innerHTML = `
      <div class="sync-conflict-card">
        <h2>Two ponds diverged</h2>
        <p>The cloud save is newer (last played ${when}), but this device also
        has progress that never synced. Which one should the pond keep?</p>
        <div class="sync-conflict-actions">
          <button class="action-btn" data-pick="cloud">Load the cloud save</button>
          <button class="action-btn" data-pick="local">Keep this device's save</button>
        </div>
        <p class="muted small">The other copy is kept in the cloud's undo slot either way.</p>
      </div>`;
    overlay.addEventListener('click', (e) => {
      const pick = (e.target as HTMLElement).dataset?.pick;
      if (!pick) return;
      overlay.remove();
      resolve(pick === 'cloud');
    });
    document.body.append(overlay);
  });
}

// ---- steady state ----------------------------------------------------------

let attached = false;

export function attachCloudSync(game: Game): void {
  if (attached) return;
  const meta = loadSyncMeta();
  if (!meta) return;
  attached = true;

  let pushing = false;

  const markStale = (): void => {
    if (game.stale) return;
    game.stale = true;
    game.speed = 0;
    setStatus('stale');
    events.emit('takeover', { remote: true });
  };

  const push = async (keepalive = false): Promise<void> => {
    if (game.stale || pushing) return;
    const blob = localStorage.getItem(SAVE_KEY);
    if (!blob) return;
    pushing = true;
    setStatus('syncing');
    let result;
    try {
      result = await pushSave(meta, blob, { keepalive });
    } catch {
      result = null;
    }
    pushing = false;
    if (result === null) {
      meta.dirty = true;
      saveSyncMeta(meta);
      setStatus('offline');
      return;
    }
    switch (planPush(result)) {
      case 'synced':
        meta.lastSyncedSeq = (result as { seq: number }).seq;
        meta.dirty = false;
        saveSyncMeta(meta);
        setStatus('synced');
        break;
      case 'stale':
        meta.dirty = true;
        saveSyncMeta(meta);
        markStale();
        break;
      case 'retry-offline':
        break;
    }
  };

  // Every local save (30s autosave, purchase, hatch, sleep) becomes a push.
  events.on('saved', () => void push());

  // Poll ownership: another device claiming shows up here within ~15s even
  // between autosaves. Doubles as the offline-recovery probe.
  const poll = async (): Promise<void> => {
    if (game.stale) return;
    try {
      const cloud = await pullMeta(meta);
      if (planPoll(cloud, meta.deviceId) === 'lost-ownership') {
        markStale();
        return;
      }
      if (meta.dirty) void push(); // reconnected with unsynced local play
      else setStatus('synced');
    } catch {
      setStatus('offline');
    }
  };
  setInterval(() => void poll(), POLL_MS);

  // Best effort on the way out; keepalive bodies cap at ~64KB so this is a
  // bonus, not a guarantee — the 30s cadence bounds what could be lost.
  window.addEventListener('pagehide', () => {
    game.save();
    void push(true);
  });

  setStatus(meta.dirty ? 'offline' : 'synced');
  if (meta.dirty) void push();
}

// The takeover overlay's "Play here instead": grab ownership, adopt the
// newest cloud state, and reboot into the normal flow.
export async function claimAndReload(): Promise<void> {
  const meta = loadSyncMeta();
  if (!meta) return;
  const cloud = await claimSave(meta);
  if (cloud.blob) localStorage.setItem(SAVE_KEY, cloud.blob);
  meta.lastSyncedSeq = cloud.seq;
  meta.dirty = false;
  saveSyncMeta(meta);
  location.reload();
}
