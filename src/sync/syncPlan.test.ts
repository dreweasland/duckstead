import { describe, expect, it } from 'vitest';
import { planBoot, planPoll, planPush, type CloudMeta } from './syncPlan';

const cloud = (over: Partial<CloudMeta> = {}): CloudMeta => ({
  exists: true,
  seq: 10,
  owner: 'phone',
  ...over,
});

describe('planBoot', () => {
  const local = (over = {}) => ({ lastSyncedSeq: 10, dirty: false, hasLocalSave: true, ...over });

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
