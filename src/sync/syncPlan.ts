// Pure decisions for the sync client. No fetch, no storage — the testable
// core of "which save do we trust right now?".

export interface CloudMeta {
  exists: boolean;
  seq: number;
  owner: string | null;
  savedAt: number;
}

type BootDecision =
  // Nothing in the cloud yet (or we've never pushed): play local, push after.
  | 'use-local'
  // The cloud moved on and we have nothing unsynced: load the cloud blob.
  | 'use-cloud'
  // The cloud moved on AND this device has unsynced play: ask the human.
  | 'conflict'
  // Couldn't reach the cloud: play local, keep retrying in the background.
  | 'offline';

export function planBoot(
  cloud: CloudMeta | 'offline',
  local: {
    lastSyncedSeq: number;
    dirty: boolean;
    hasLocalSave: boolean;
    deviceId: string;
    localSavedAt: number;
  },
): BootDecision {
  if (cloud === 'offline') return 'offline';
  if (!cloud.exists) return 'use-local';
  if (!local.hasLocalSave) return 'use-cloud';
  if (cloud.seq > local.lastSyncedSeq) {
    if (!local.dirty) return 'use-cloud';
    // Cloud ahead AND local unsynced — but if the cloud's owner is still this
    // very device, those cloud writes were our own (e.g. a pagehide push that
    // landed after its response was lost). No second player involved, so
    // resolve by recency instead of alarming the human.
    if (cloud.owner === local.deviceId) {
      return local.localSavedAt >= cloud.savedAt ? 'use-local' : 'use-cloud';
    }
    return 'conflict';
  }
  // cloud.seq <= lastSyncedSeq: our local copy is as new or newer.
  return 'use-local';
}

type PollDecision = 'ok' | 'lost-ownership';

export function planPoll(cloud: CloudMeta, deviceId: string): PollDecision {
  if (cloud.exists && cloud.owner !== null && cloud.owner !== deviceId) return 'lost-ownership';
  return 'ok';
}

type ResumeDecision = 'reclaim' | 'wait';

// A device that lost the pond to another one keeps polling. Once nobody
// holds the save (the other device released it) — or it somehow came back
// to us — it may pick the pond up again on its own; while someone else still
// holds it, keep waiting.
export function planResume(cloud: CloudMeta, deviceId: string): ResumeDecision {
  if (!cloud.exists || cloud.owner === null || cloud.owner === deviceId) return 'reclaim';
  return 'wait';
}

type PushResult =
  | { kind: 'accepted'; seq: number }
  | { kind: 'rejected'; reason: 'not-owner' | 'stale-seq'; seq: number }
  | { kind: 'offline' };

type PushDecision = 'synced' | 'stale' | 'retry-offline';

export function planPush(result: PushResult): PushDecision {
  switch (result.kind) {
    case 'accepted':
      return 'synced';
    case 'rejected':
      // Either reason means another device owns (or advanced) the save; this
      // device must stop writing. stale-seq without a takeover cannot happen
      // in normal operation, so treat it identically rather than guess.
      return 'stale';
    case 'offline':
      return 'retry-offline';
  }
}
