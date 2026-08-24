// Local record of this browser's link to the cloud save. Lives beside the
// save itself in localStorage; absence means sync is not configured and the
// game behaves exactly as it always has.
export const SYNC_META_KEY = 'ducksim:sync:v1';

export interface SyncMeta {
  syncId: string;
  secret: string;
  deviceId: string;
  // The cloud seq this device last wrote or loaded. Pushes CAS against it.
  lastSyncedSeq: number;
  // True when a local save exists that the cloud hasn't accepted — the flag
  // that turns "cloud is newer" into an explicit conflict question.
  dirty: boolean;
}

export function loadSyncMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw) as SyncMeta;
    if (!meta.syncId || !meta.secret || !meta.deviceId) return null;
    return meta;
  } catch {
    return null;
  }
}

export function saveSyncMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // Quota errors: sync degrades, the game does not.
  }
}

export function isSyncConfigured(): boolean {
  return loadSyncMeta() !== null;
}

export function unlinkSync(): void {
  localStorage.removeItem(SYNC_META_KEY);
}

export function newDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
