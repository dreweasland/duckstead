// Thin fetch wrapper over the /api/ sync routes. Same origin everywhere, so
// no base URL and no CORS. `fetch` is injectable for tests.
import type { SyncMeta } from './syncMeta';

export interface CloudSave {
  exists: boolean;
  seq: number;
  owner: string | null;
  savedAt: number;
  blob: string | null;
}

export interface PairStart {
  code: string;
  syncId: string;
  secret: string;
  expiresAt: number;
}

type Fetch = typeof fetch;

const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });

export async function pairStart(
  existing: { syncId: string; secret: string } | null,
  fetchFn: Fetch = fetch,
): Promise<PairStart> {
  const res = await fetchFn('/api/pair/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(existing ? auth(existing.secret) : {}),
    },
    body: JSON.stringify(existing ? { syncId: existing.syncId } : {}),
  });
  if (!res.ok) throw new Error(`pair/start failed: ${res.status}`);
  return (await res.json()) as PairStart;
}

export async function pairClaim(
  code: string,
  fetchFn: Fetch = fetch,
): Promise<{ syncId: string; secret: string } | null> {
  const res = await fetchFn('/api/pair/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pair/claim failed: ${res.status}`);
  return (await res.json()) as { syncId: string; secret: string };
}

export async function pullSave(meta: SyncMeta, fetchFn: Fetch = fetch): Promise<CloudSave> {
  const res = await fetchFn(`/api/save/${meta.syncId}`, { headers: auth(meta.secret) });
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  return (await res.json()) as CloudSave;
}

export async function pullMeta(
  meta: SyncMeta,
  fetchFn: Fetch = fetch,
): Promise<Omit<CloudSave, 'blob'>> {
  const res = await fetchFn(`/api/save/${meta.syncId}/meta`, { headers: auth(meta.secret) });
  if (!res.ok) throw new Error(`meta failed: ${res.status}`);
  return (await res.json()) as Omit<CloudSave, 'blob'>;
}

export async function claimSave(meta: SyncMeta, fetchFn: Fetch = fetch): Promise<CloudSave> {
  const res = await fetchFn(`/api/save/${meta.syncId}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth(meta.secret) },
    body: JSON.stringify({ deviceId: meta.deviceId }),
  });
  if (!res.ok) throw new Error(`claim failed: ${res.status}`);
  return (await res.json()) as CloudSave;
}

export type PushOutcome =
  | { kind: 'accepted'; seq: number }
  | { kind: 'rejected'; reason: 'not-owner' | 'stale-seq'; seq: number };

export async function pushSave(
  meta: SyncMeta,
  blob: string,
  opts: { keepalive?: boolean } = {},
  fetchFn: Fetch = fetch,
): Promise<PushOutcome> {
  const res = await fetchFn(`/api/save/${meta.syncId}`, {
    method: 'PUT',
    keepalive: opts.keepalive,
    headers: { 'content-type': 'application/json', ...auth(meta.secret) },
    body: JSON.stringify({ deviceId: meta.deviceId, baseSeq: meta.lastSyncedSeq, blob }),
  });
  if (res.status === 409) {
    const body = (await res.json()) as { error: 'not-owner' | 'stale-seq'; seq: number };
    return { kind: 'rejected', reason: body.error, seq: body.seq };
  }
  if (!res.ok) throw new Error(`push failed: ${res.status}`);
  const body = (await res.json()) as { seq: number };
  return { kind: 'accepted', seq: body.seq };
}
