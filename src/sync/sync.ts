// Cloud sync orchestration: boot-time save selection, steady-state pushes,
// ownership polling, and cross-device takeover. Attached only when the
// player has linked a device — otherwise none of this code runs and the
// game is exactly the offline localStorage game it always was.
import { events } from '../events';
import { el } from '../ui/dom';
import type { Game } from '../game';
import { deserialize, SAVE_KEY } from '../save/save';
import { claimSave, pullSave, pullMeta, pushSave } from './syncClient';
import { isSyncConfigured, loadSyncMeta, saveSyncMeta } from './syncMeta';
import { planBoot, planPoll, planPush } from './syncPlan';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'stale';

// Polls double as offline-reconnect probes, so one cadence covers both.
const POLL_MS = 15_000;

function setStatus(status: SyncStatus): void {
  events.emit('sync-status', status);
}

// A cloud blob must prove readable before it may replace the local save — a
// truncated or foreign-version response would otherwise destroy local
// progress and trip the corrupt-save path on the next load.
export function isReadableSave(blob: string): boolean {
  try {
    deserialize(blob);
    return true;
  } catch {
    return false;
  }
}

// Write a validated cloud blob into localStorage. Returns false (writing
// nothing) when the blob is missing or unreadable.
function adoptBlob(blob: string | null): boolean {
  if (!blob || !isReadableSave(blob)) return false;
  localStorage.setItem(SAVE_KEY, blob);
  return true;
}

// ---- boot ------------------------------------------------------------------

// Decide which save to play before the Game constructor reads localStorage.
// May overwrite the local save with the cloud blob; may ask the player when
// both sides have progress. Resolves once the save in localStorage is the
// one to load. Network failure resolves silently — offline play is fine.
export async function prepareCloudBoot(): Promise<void> {
  const meta = loadSyncMeta();
  if (!meta) return;
  let cloud: Awaited<ReturnType<typeof pullSave>> | 'offline';
  try {
    cloud = await pullSave(meta);
  } catch {
    cloud = 'offline'; // play local; attachCloudSync keeps retrying
  }
  const localBlob = localStorage.getItem(SAVE_KEY);
  let localSavedAt = 0;
  try {
    localSavedAt = localBlob ? (JSON.parse(localBlob) as { savedAt?: number }).savedAt ?? 0 : 0;
  } catch {
    localSavedAt = 0;
  }
  const decision = planBoot(cloud, {
    lastSyncedSeq: meta.lastSyncedSeq,
    dirty: meta.dirty,
    hasLocalSave: localBlob !== null,
    deviceId: meta.deviceId,
    localSavedAt,
  });
  // 'offline' now flows through planBoot's documented contract; the check on
  // `cloud` narrows the union for everything below.
  if (decision === 'offline' || cloud === 'offline') return;
  const adoptCloud = (): void => {
    if (adoptBlob(cloud.blob)) {
      meta.lastSyncedSeq = cloud.seq;
      meta.dirty = false;
    } else {
      // Unreadable (or empty) cloud blob: keep playing local, adopt the
      // cloud head as our CAS base, and mark dirty so the next push replaces
      // the bad blob with a good one (the DO keeps an undo copy).
      meta.lastSyncedSeq = cloud.seq;
      meta.dirty = true;
    }
  };
  if (decision === 'use-cloud') {
    adoptCloud();
  } else if (decision === 'use-local') {
    if (cloud.exists) {
      // Keeping local play: the cloud head becomes our CAS base so the next
      // push lands (the DO keeps the replaced blob in its undo slot).
      meta.lastSyncedSeq = cloud.seq;
      if (localSavedAt > cloud.savedAt || meta.dirty) meta.dirty = true;
    }
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
    // Built with el() so every string lands as a text node — this was the
    // codebase's only innerHTML sink.
    const pickBtn = (label: string, keepCloud: boolean): HTMLElement =>
      el('button', { class: 'action-btn', onclick: () => { overlay.remove(); resolve(keepCloud); } }, label);
    const overlay = el(
      'div',
      { class: 'sync-conflict-overlay' },
      el(
        'div',
        { class: 'sync-conflict-card' },
        el('h2', {}, 'Two ponds diverged'),
        el('p', {}, `The cloud save is newer (last played ${when}), but this device also has progress that never synced. Which one should the pond keep?`),
        el('div', { class: 'sync-conflict-actions' }, pickBtn('Load the cloud save', true), pickBtn("Keep this device's save", false)),
        el('p', { class: 'muted small' }, "The other copy is kept in the cloud's undo slot either way."),
      ),
    );
    document.body.append(overlay);
  });
}

// ---- steady state ----------------------------------------------------------

// The live attachment's teardown. Re-attaching (unlink then relink in one
// session) must first kill the old closures — they hold the old syncId and
// secret, and would keep pushing to the previous sync and write its stale
// credentials back over the new ones.
let detachCurrent: (() => void) | null = null;

export function detachCloudSync(): void {
  detachCurrent?.();
  detachCurrent = null;
}

export function attachCloudSync(game: Game): void {
  detachCloudSync();
  const meta = loadSyncMeta();
  if (!meta) return;

  let pushing = false;
  let pendingPush = false;

  const markStale = (): void => {
    if (game.stale) return;
    game.stale = true;
    game.speed = 0;
    setStatus('stale');
    events.emit('takeover', { remote: true });
  };

  const pushOnce = async (keepalive: boolean): Promise<void> => {
    const blob = localStorage.getItem(SAVE_KEY);
    if (!blob) return;
    setStatus('syncing');
    let result;
    try {
      result = await pushSave(meta, blob, { keepalive });
    } catch {
      result = null;
    }
    if (game.stale || !isSyncConfigured()) return; // unlinked or superseded mid-flight
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

  const push = async (keepalive = false): Promise<void> => {
    if (game.stale) return;
    if (pushing) {
      // A save landed while a push was in flight: the blob being sent is
      // already stale. Chase it with a follow-up once this push settles —
      // dropping it left the HUD "synced" while the cloud was behind.
      pendingPush = true;
      return;
    }
    pushing = true;
    await pushOnce(keepalive);
    pushing = false;
    if (pendingPush) {
      pendingPush = false;
      // Only chase the newer blob when the last push landed; a failed push
      // already marked dirty and the poll retries it.
      if (!game.stale && isSyncConfigured() && !meta.dirty) void push();
    }
  };

  // Every local save (30s autosave, purchase, hatch, sleep) becomes a push.
  const offSaved = events.on('saved', () => void push());

  // Poll ownership: another device claiming shows up here within ~15s even
  // between autosaves. Doubles as the offline-recovery probe.
  const poll = async (): Promise<void> => {
    if (game.stale || !isSyncConfigured()) return;
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
  const pollId = setInterval(() => void poll(), POLL_MS);

  // Best effort on the way out; keepalive bodies cap at ~64KB so this is a
  // bonus, not a guarantee — the 30s cadence bounds what could be lost.
  const onPagehide = (): void => {
    game.save();
    void push(true);
  };
  window.addEventListener('pagehide', onPagehide);

  detachCurrent = () => {
    offSaved();
    clearInterval(pollId);
    window.removeEventListener('pagehide', onPagehide);
  };

  setStatus(meta.dirty ? 'offline' : 'synced');
  if (meta.dirty) void push();
}

// The takeover overlay's "Play here instead": grab ownership, adopt the
// newest cloud state, and reboot into the normal flow.
export async function claimAndReload(): Promise<void> {
  const meta = loadSyncMeta();
  if (!meta) return;
  const cloud = await claimSave(meta);
  // Same rule as boot: an unreadable cloud blob never replaces the local
  // save — we keep local, stay dirty, and push a good blob over it.
  meta.dirty = !adoptBlob(cloud.blob);
  meta.lastSyncedSeq = cloud.seq;
  saveSyncMeta(meta);
  location.reload();
}
