import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '../events';

vi.mock('./syncClient', () => ({
  pushSave: vi.fn(),
  pullSave: vi.fn(),
  pullMeta: vi.fn(),
  claimSave: vi.fn(),
}));

import { claimSave, pullMeta, pullSave, pushSave } from './syncClient';
import { attachCloudSync, detachCloudSync, handoffCloudSync, prepareCloudBoot } from './sync';
import { SYNC_META_KEY } from './syncMeta';
import { SAVE_KEY, SAVE_VERSION } from '../save/save';
import { installFakeStorage, realBlob, uninstallFakeStorage } from '../testFixtures';
import type { Game } from '../game';

// The pieces of Game the attachment touches, plus a spy on loadState so a
// reclaim can be seen adopting the phone's play.
function fakeGame(map: Map<string, string>): Game & { loaded: number[] } {
  const g = {
    stale: false,
    speed: 1,
    loaded: [] as number[],
    save() {
      map.set(SAVE_KEY, realBlob(7));
      events.emit('saved');
    },
    loadState(state: { money: number }) {
      g.loaded.push(state.money);
    },
  };
  return g as unknown as Game & { loaded: number[] };
}

describe('handoff and reclaim', () => {
  let map: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    map = installFakeStorage();
    map.set(SYNC_META_KEY, JSON.stringify({ syncId: 's', secret: 'x', deviceId: 'phone', lastSyncedSeq: 1, dirty: false }));
    map.set(SAVE_KEY, realBlob(1));
  });
  afterEach(() => {
    detachCloudSync();
    vi.useRealTimers();
    uninstallFakeStorage();
    vi.restoreAllMocks();
  });

  it('handoff saves, pushes with release, and then stops pushing', async () => {
    vi.mocked(pushSave).mockResolvedValue({ kind: 'accepted', seq: 2 });
    const game = fakeGame(map);
    attachCloudSync(game);
    const ok = await handoffCloudSync();
    expect(ok).toBe(true);
    // One push, carrying the freshly saved blob and the release flag.
    expect(vi.mocked(pushSave)).toHaveBeenCalledTimes(1);
    const [, blob, opts] = vi.mocked(pushSave).mock.calls[0];
    expect(JSON.parse(blob).state.money).toBe(7);
    expect(opts).toMatchObject({ release: true });
    // A late autosave after the handoff must not take the pond back.
    events.emit('saved');
    await vi.advanceTimersByTimeAsync(50);
    expect(vi.mocked(pushSave)).toHaveBeenCalledTimes(1);
  });

  it('a failed handoff keeps the device dirty and retries the release on the next poll', async () => {
    vi.mocked(pushSave).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ kind: 'accepted', seq: 2 });
    vi.mocked(pullMeta).mockResolvedValue({ exists: true, seq: 1, owner: 'phone', savedAt: 0 });
    const game = fakeGame(map);
    attachCloudSync(game);
    expect(await handoffCloudSync()).toBe(false);
    expect(JSON.parse(map.get(SYNC_META_KEY)!).dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(vi.mocked(pushSave)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(pushSave).mock.calls[1][2]).toMatchObject({ release: true });
    expect(JSON.parse(map.get(SYNC_META_KEY)!).dirty).toBe(false);
  });

  it('an unload handoff aborts an in-flight push instead of waiting on a timer', async () => {
    // Push #1 hangs until its signal aborts (a real fetch on a closing page);
    // the release must not wait behind it — the page's timers never fire.
    vi.mocked(pushSave)
      .mockImplementationOnce(
        (_m, _b, opts) =>
          new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
      )
      .mockResolvedValue({ kind: 'accepted', seq: 2 });
    const game = fakeGame(map);
    attachCloudSync(game);
    events.emit('saved'); // push #1, in flight
    await Promise.resolve();
    expect(vi.mocked(pushSave)).toHaveBeenCalledTimes(1);
    const ok = await handoffCloudSync(true); // no timers advanced
    expect(ok).toBe(true);
    expect(vi.mocked(pushSave)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(pushSave).mock.calls[0][2]?.signal?.aborted).toBe(true);
    expect(vi.mocked(pushSave).mock.calls[1][2]).toMatchObject({ release: true, keepalive: true });
    expect(JSON.parse(map.get(SYNC_META_KEY)!)).toMatchObject({ lastSyncedSeq: 2, dirty: false });
  });

  it('a push still in flight when the device relinks cannot write the old link back', async () => {
    let resolveFirst!: (v: { kind: 'accepted'; seq: number }) => void;
    vi.mocked(pushSave)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ kind: 'accepted', seq: 2 });
    const game = fakeGame(map);
    attachCloudSync(game);
    events.emit('saved'); // push #1 (old link), in flight
    await Promise.resolve();
    // Unlink, relink to a different sync, attach again.
    const fresh = { syncId: 'new', secret: 'y', deviceId: 'phone', lastSyncedSeq: 5, dirty: false };
    detachCloudSync();
    map.set(SYNC_META_KEY, JSON.stringify(fresh));
    attachCloudSync(game);
    resolveFirst({ kind: 'accepted', seq: 9 }); // the old push's response lands late
    await vi.advanceTimersByTimeAsync(10);
    expect(JSON.parse(map.get(SYNC_META_KEY)!)).toEqual(fresh);
  });

  it('a cloud save from a newer build is neither adopted nor pushed over', async () => {
    map.set(SYNC_META_KEY, JSON.stringify({ syncId: 's', secret: 'x', deviceId: 'phone', lastSyncedSeq: 1, dirty: true }));
    const local = map.get(SAVE_KEY)!;
    const newer = JSON.stringify({ version: SAVE_VERSION + 1, savedAt: 5, state: { ducks: [], clock: { totalTicks: 0 } } });
    vi.mocked(pullSave).mockResolvedValue({ exists: true, seq: 4, owner: null, savedAt: 5, blob: newer });
    const statuses: unknown[] = [];
    const off = events.on('sync-status', (st) => statuses.push(st));
    await prepareCloudBoot();
    expect(map.get(SAVE_KEY)).toBe(local); // not adopted
    expect(vi.mocked(claimSave)).not.toHaveBeenCalled();
    expect(JSON.parse(map.get(SYNC_META_KEY)!)).toMatchObject({ lastSyncedSeq: 1, dirty: true }); // meta untouched
    attachCloudSync(fakeGame(map));
    events.emit('saved');
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.mocked(pushSave)).not.toHaveBeenCalled();
    expect(statuses).toContain('stale');
    off();
  });

  it('a device that lost the pond takes it back on its own once released', async () => {
    map.set(SYNC_META_KEY, JSON.stringify({ syncId: 's', secret: 'x', deviceId: 'desktop', lastSyncedSeq: 1, dirty: false }));
    const game = fakeGame(map);
    const takeovers: unknown[] = [];
    const resumed: unknown[] = [];
    const offT = events.on('takeover', (p) => takeovers.push(p));
    const offR = events.on('resumed', (p) => resumed.push(p));
    // Poll 1: the phone holds the pond. Poll 2: it let go.
    vi.mocked(pullMeta)
      .mockResolvedValueOnce({ exists: true, seq: 2, owner: 'phone', savedAt: 0 })
      .mockResolvedValueOnce({ exists: true, seq: 3, owner: null, savedAt: 0 });
    vi.mocked(claimSave).mockResolvedValue({ exists: true, seq: 3, owner: 'desktop', savedAt: 0, blob: realBlob(42) });
    attachCloudSync(game);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(game.stale).toBe(true);
    expect(game.speed).toBe(0);
    expect(takeovers).toEqual([{ remote: true }]);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(game.stale).toBe(false);
    expect(game.loaded).toEqual([42]); // the phone's play was adopted
    expect(resumed).toHaveLength(1);
    expect(JSON.parse(map.get(SYNC_META_KEY)!)).toMatchObject({ lastSyncedSeq: 3, dirty: false });
    offT();
    offR();
  });
});
