// Cloud sync orchestration: boot-time save selection, steady-state pushes,
// ownership polling, and cross-device takeover. Attached only when the
// player has linked a device — otherwise none of this code runs and the
// game is exactly the offline localStorage game it always was.
import { events } from '../events';
import { el } from '../ui/dom';
import type { Game } from '../game';
import { deserialize, SAVE_KEY } from '../save/save';
import { claimSave, pullSave, pullMeta, pushSave, type CloudSave } from './syncClient';
import { isSyncConfigured, loadSyncMeta, saveSyncMeta } from './syncMeta';
import { planBoot, planPoll, planPush, planResume } from './syncPlan';

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

// Adopt a cloud blob into a running game: localStorage and the live state
// both move to it. Returns false (touching nothing) when the blob is bad.
function adoptIntoGame(game: Game, blob: string | null): boolean {
  if (!adoptBlob(blob)) return false;
  game.loadState(deserialize(blob!));
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
let handoffCurrent: ((keepalive: boolean) => Promise<boolean>) | null = null;

export function detachCloudSync(): void {
  detachCurrent?.();
  detachCurrent = null;
  handoffCurrent = null;
}

// Push whatever is local and hand the pond back in the same write, then
// detach. This is how a device "puts the pond down": the other device's poll
// sees nobody holding the save and picks it up without a human clicking.
// Resolves true when the cloud accepted the handoff. A failed push leaves the
// device dirty and still (nominally) the owner — releasing anyway would let
// the other side reclaim and strand this device's unsynced play.
export function handoffCloudSync(keepalive = false): Promise<boolean> {
  if (!handoffCurrent) return Promise.resolve(false);
  const run = handoffCurrent;
  return run(keepalive);
}

export function attachCloudSync(game: Game): void {
  detachCloudSync();
  const meta = loadSyncMeta();
  if (!meta) return;

  let pushing = false;
  let pendingPush = false;
  // True after another *device* took the pond (as opposed to another tab in
  // this browser, which is settled by reload). Only this flavour of stale can
  // resolve itself: the poll keeps running and reclaims once the other device
  // lets go.
  let remoteStale = false;
  // releasing: a handoff was asked for and hasn't landed yet — every push
  // until it does carries the release flag. handedOff: it landed; this
  // attachment is finished (a late autosave must not take the pond back).
  let releasing = false;
  let handedOff = false;
  let quiet = false; // suppress the 'saved' listener during handoff's own save

  const markStale = (): void => {
    if (game.stale) return;
    game.stale = true;
    game.speed = 0;
    remoteStale = true;
    setStatus('stale');
    events.emit('takeover', { remote: true });
  };

  const pushOnce = async (opts: { keepalive: boolean; release: boolean }): Promise<boolean> => {
    const blob = localStorage.getItem(SAVE_KEY);
    if (!blob) return false;
    // Never push a blob the other device could not load — it would replace
    // a good cloud copy with one that trips the corrupt-save path over there.
    if (!isReadableSave(blob)) return false;
    setStatus('syncing');
    let result;
    try {
      result = await pushSave(meta, blob, opts);
    } catch {
      result = null;
    }
    if (game.stale || !isSyncConfigured()) return false; // unlinked or superseded mid-flight
    if (result === null) {
      meta.dirty = true;
      saveSyncMeta(meta);
      setStatus('offline');
      return false;
    }
    switch (planPush(result)) {
      case 'synced':
        meta.lastSyncedSeq = (result as { seq: number }).seq;
        meta.dirty = false;
        saveSyncMeta(meta);
        setStatus('synced');
        if (opts.release) handedOff = true;
        return true;
      case 'stale':
        meta.dirty = true;
        saveSyncMeta(meta);
        markStale();
        return false;
      case 'retry-offline':
        return false;
    }
  };

  const push = async (keepalive = false): Promise<void> => {
    if (game.stale || handedOff) return;
    if (pushing) {
      // A save landed while a push was in flight: the blob being sent is
      // already stale. Chase it with a follow-up once this push settles —
      // dropping it left the HUD "synced" while the cloud was behind.
      pendingPush = true;
      return;
    }
    pushing = true;
    await pushOnce({ keepalive, release: releasing });
    pushing = false;
    if (pendingPush) {
      pendingPush = false;
      // Only chase the newer blob when the last push landed; a failed push
      // already marked dirty and the poll retries it.
      if (!game.stale && isSyncConfigured() && !meta.dirty) void push();
    }
  };

  // Every local save (30s autosave, purchase, hatch, sleep) becomes a push.
  const offSaved = events.on('saved', () => {
    if (!quiet) void push();
  });

  // The other device let go: take the pond back, adopt what it did, and
  // carry on. The UI hears 'resumed' and drops its takeover overlay.
  const reclaim = async (): Promise<void> => {
    const cloud = await claimSave(meta);
    const adopted = adoptIntoGame(game, cloud.blob);
    meta.lastSyncedSeq = cloud.seq;
    meta.dirty = !adopted;
    saveSyncMeta(meta);
    game.stale = false;
    remoteStale = false;
    setStatus(adopted ? 'synced' : 'offline');
    events.emit('resumed', { remote: true, savedAt: cloud.savedAt });
    if (!adopted) void push();
  };

  // Poll ownership: another device claiming shows up here within ~15s even
  // between autosaves. Doubles as the offline-recovery probe, and — once the
  // pond has been taken — as the watch for it being handed back.
  const poll = async (): Promise<void> => {
    if (!isSyncConfigured() || handedOff) return;
    if (game.stale && !remoteStale) return; // another tab in this browser: reload settles it
    try {
      const cloud = await pullMeta(meta);
      if (remoteStale) {
        if (planResume(cloud, meta.deviceId) === 'reclaim') await reclaim();
        return;
      }
      if (planPoll(cloud, meta.deviceId) === 'lost-ownership') {
        markStale();
        return;
      }
      if (meta.dirty || releasing) void push(); // reconnected with unsynced play, or a release still owed
      else setStatus('synced');
    } catch {
      if (!remoteStale) setStatus('offline');
    }
  };
  const pollId = setInterval(() => void poll(), POLL_MS);

  const handoff = async (keepalive: boolean): Promise<boolean> => {
    if (game.stale || handedOff) return false;
    releasing = true;
    quiet = true;
    game.save();
    quiet = false;
    // Wait out an in-flight push: its blob is older than the one just saved
    // and its response would otherwise land after ours and rewind the seq.
    while (pushing) await new Promise((r) => setTimeout(r, 25));
    pushing = true;
    const ok = await pushOnce({ keepalive, release: true });
    pushing = false;
    // On failure the device stays dirty and still owns the pond; the poll's
    // retry pushes carry the release until one lands.
    return ok;
  };
  handoffCurrent = handoff;

  // On the way out, push and hand the pond back so a companion (or this
  // device tomorrow) finds it free. keepalive bodies are capped (see
  // pushSave), so this is best effort — the 30s cadence bounds the loss.
  // If the page comes back from the bfcache, the next autosave simply takes
  // the pond again (a released save accepts the first writer).
  const onPagehide = (): void => {
    void handoff(true);
  };
  const onPageshow = (e: PageTransitionEvent): void => {
    if (e.persisted && (handedOff || releasing)) {
      handedOff = false;
      releasing = false;
      void push();
    }
  };
  window.addEventListener('pagehide', onPagehide);
  window.addEventListener('pageshow', onPageshow);

  detachCurrent = () => {
    offSaved();
    clearInterval(pollId);
    window.removeEventListener('pagehide', onPagehide);
    window.removeEventListener('pageshow', onPageshow);
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

// ---- peeking (companion) ---------------------------------------------------

export interface Peek {
  seq: number;
  owner: string | null;
  savedAt: number;
  // True when this call adopted a newer blob (into localStorage, and into
  // `game` when given).
  changed: boolean;
}

// Look at the pond without touching it: pull the cloud head and adopt it if
// it moved on, claiming nothing — whoever is playing keeps playing. The
// companion's resting state. Throws when the cloud is unreachable.
export async function peekCloud(game: Game | null): Promise<Peek> {
  const meta = loadSyncMeta();
  if (!meta) throw new Error('sync not configured');
  const head = await pullMeta(meta);
  let changed = false;
  if (head.exists && head.seq !== meta.lastSyncedSeq) {
    const cloud: CloudSave = await pullSave(meta);
    changed = game ? adoptIntoGame(game, cloud.blob) : adoptBlob(cloud.blob);
    if (changed) {
      meta.lastSyncedSeq = cloud.seq;
      meta.dirty = false;
      saveSyncMeta(meta);
    }
    return { seq: cloud.seq, owner: cloud.owner, savedAt: cloud.savedAt, changed };
  }
  return { seq: head.seq, owner: head.owner, savedAt: head.savedAt, changed };
}

// Take the pond: claim it, adopt whatever the cloud holds, and start the
// live attachment so this device's play is pushed. Resolves with the cloud
// head's savedAt (how fresh the copy we took over is).
export async function takeCloud(game: Game): Promise<number> {
  const meta = loadSyncMeta();
  if (!meta) throw new Error('sync not configured');
  const cloud = await claimSave(meta);
  if (cloud.seq !== meta.lastSyncedSeq) {
    if (adoptIntoGame(game, cloud.blob)) {
      meta.lastSyncedSeq = cloud.seq;
      meta.dirty = false;
    } else {
      meta.lastSyncedSeq = cloud.seq;
      meta.dirty = true;
    }
  }
  saveSyncMeta(meta);
  game.stale = false;
  attachCloudSync(game);
  return cloud.savedAt;
}
