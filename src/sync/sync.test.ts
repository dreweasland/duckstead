import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '../events';

vi.mock('./syncClient', () => ({
  pushSave: vi.fn(),
  pullSave: vi.fn(),
  pullMeta: vi.fn(),
  claimSave: vi.fn(),
}));

import { pushSave } from './syncClient';
import { attachCloudSync, detachCloudSync } from './sync';
import { SYNC_META_KEY } from './syncMeta';
import { SAVE_KEY } from '../save/save';
import { installFakeStorage, realBlob, uninstallFakeStorage } from '../testFixtures';
import type { Game } from '../game';

// Fake timers: the attachment's poll and handoff waits are timer-based, so
// a real setTimeout here would be a flake waiting to happen.
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('push re-queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    detachCloudSync();
    vi.useRealTimers();
    uninstallFakeStorage();
    vi.restoreAllMocks();
  });

  it('a save landing during an in-flight push triggers a follow-up push', async () => {
    const map = installFakeStorage();
    map.set(SYNC_META_KEY, JSON.stringify({ syncId: 's', secret: 'x', deviceId: 'd', lastSyncedSeq: 1, dirty: false }));
    const blob1 = realBlob(1);
    const blob2 = realBlob(2);
    map.set(SAVE_KEY, blob1);

    let resolveFirst!: (v: { kind: 'accepted'; seq: number }) => void;
    vi.mocked(pushSave)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ kind: 'accepted', seq: 3 });

    attachCloudSync({ stale: false, save: () => {}, speed: 1 } as unknown as Game);
    events.emit('saved'); // starts push #1 (in flight)
    await flush();
    map.set(SAVE_KEY, blob2);
    events.emit('saved'); // lands mid-flight: must be chased, not dropped
    await flush();
    expect(vi.mocked(pushSave)).toHaveBeenCalledTimes(1);

    resolveFirst({ kind: 'accepted', seq: 2 });
    await flush();
    await flush();
    // The follow-up push carried the newer blob.
    expect(vi.mocked(pushSave)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(pushSave).mock.calls[1][1]).toBe(blob2);
  });
});
