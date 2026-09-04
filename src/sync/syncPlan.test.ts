import { describe, expect, it } from 'vitest';
import { planBoot, planPoll, planPush, planResume, type CloudMeta } from './syncPlan';

const cloud = (over: Partial<CloudMeta> = {}): CloudMeta => ({
  exists: true,
  seq: 10,
  owner: 'phone',
  savedAt: 5000,
  ...over,
});

describe('planBoot', () => {
  const local = (over = {}) => ({
    lastSyncedSeq: 10,
    dirty: false,
    hasLocalSave: true,
    deviceId: 'desktop',
    localSavedAt: 4000,
    ...over,
  });

  it('plays local when offline', () => {
    expect(planBoot('offline', local())).toBe('offline');
  });

  it('plays local when the cloud has no save yet', () => {
    expect(planBoot(cloud({ exists: false, seq: 0, owner: null }), local({ lastSyncedSeq: 0 }))).toBe('use-local');
  });

  it('loads the cloud on a fresh device', () => {
    expect(planBoot(cloud(), local({ hasLocalSave: false, lastSyncedSeq: 0 }))).toBe('use-cloud');
  });

  it('loads the cloud when it advanced and nothing local is unsynced', () => {
    expect(planBoot(cloud({ seq: 12 }), local())).toBe('use-cloud');
  });

  it('asks when the cloud advanced AND local play never synced', () => {
    expect(planBoot(cloud({ seq: 12 }), local({ dirty: true }))).toBe('conflict');
  });

  it('self-resolves by recency when the cloud writes were our own', () => {
    // A pagehide push landed but its response died: cloud ahead, dirty local,
    // same owner. Newest copy wins with no dialog.
    const mine = cloud({ seq: 12, owner: 'desktop', savedAt: 5000 });
    expect(planBoot(mine, local({ dirty: true, localSavedAt: 6000 }))).toBe('use-local');
    expect(planBoot(mine, local({ dirty: true, localSavedAt: 4000 }))).toBe('use-cloud');
  });

  it('plays local when nothing changed remotely', () => {
    expect(planBoot(cloud(), local())).toBe('use-local');
    expect(planBoot(cloud(), local({ dirty: true }))).toBe('use-local');
  });
});

describe('planPoll', () => {
  it('flags lost ownership when another device owns the save', () => {
    expect(planPoll(cloud({ owner: 'phone' }), 'desktop')).toBe('lost-ownership');
    expect(planPoll(cloud({ owner: 'desktop' }), 'desktop')).toBe('ok');
    expect(planPoll(cloud({ exists: false, owner: null }), 'desktop')).toBe('ok');
  });
});

describe('planPush', () => {
  it('maps outcomes to actions', () => {
    expect(planPush({ kind: 'accepted', seq: 11 })).toBe('synced');
    expect(planPush({ kind: 'rejected', reason: 'not-owner', seq: 11 })).toBe('stale');
    expect(planPush({ kind: 'rejected', reason: 'stale-seq', seq: 11 })).toBe('stale');
    expect(planPush({ kind: 'offline' })).toBe('retry-offline');
  });
});

// Cloud blobs must prove readable before they may replace the local save.
import { isReadableSave } from './sync';
import { createNewGame } from '../newGame';
import { serialize } from '../save/save';

describe('cloud blob validation', () => {
  it('accepts a genuine save blob and rejects garbage', () => {
    const { state } = createNewGame(21);
    expect(isReadableSave(serialize(state))).toBe(true);
    expect(isReadableSave('{"version":1,"state":{"broken":true}}')).toBe(false);
    expect(isReadableSave('not json at all')).toBe(false);
    expect(isReadableSave('{"version":99,"state":{}}')).toBe(false);
  });
});

describe('planResume', () => {
  it('waits while another device holds the pond', () => {
    expect(planResume(cloud({ owner: 'phone' }), 'desktop')).toBe('wait');
  });

  it('reclaims once the pond is released, returned, or gone', () => {
    expect(planResume(cloud({ owner: null }), 'desktop')).toBe('reclaim');
    expect(planResume(cloud({ owner: 'desktop' }), 'desktop')).toBe('reclaim');
    expect(planResume(cloud({ exists: false, owner: 'phone' }), 'desktop')).toBe('reclaim');
  });
});
