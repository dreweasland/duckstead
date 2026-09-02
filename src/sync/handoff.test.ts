import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '../events';

vi.mock('./syncClient', () => ({
  pushSave: vi.fn(),
  pullSave: vi.fn(),
  pullMeta: vi.fn(),
  claimSave: vi.fn(),
  releaseSave: vi.fn(),
}));

import { claimSave, pullMeta, pushSave } from './syncClient';
import { attachCloudSync, detachCloudSync, handoffCloudSync } from './sync';
import { SYNC_META_KEY } from './syncMeta';
import { SAVE_KEY, serialize } from '../save/save';
import { createNewGame } from '../state';
import type { Game } from '../game';

const realBlob = (money: number): string => {
  const { state } = createNewGame(1);
  state.money = money;
  return serialize(state);
};

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
    (globalThis as { window?: unknown }).window = { addEventListener: () => {}, removeEventListener: () => {} };
    map = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    map.set(SYNC_META_KEY, JSON.stringify({ syncId: 's', secret: 'x', deviceId: 'phone', lastSyncedSeq: 1, dirty: false }));
    map.set(SAVE_KEY, realBlob(1));
  });
  afterEach(() => {
    detachCloudSync();
    vi.useRealTimers();
    delete (globalThis as { localStorage?: unknown }).localStorage;
    delete (globalThis as { window?: unknown }).window;
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
