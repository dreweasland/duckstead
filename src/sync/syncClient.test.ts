import { describe, expect, it } from 'vitest';
import { claimSave, pairClaim, pairStart, pullMeta, pullSave, pushSave, rotateSecret } from './syncClient';
import type { SyncMeta } from './syncMeta';

// Mirrors the private constant in syncClient.ts: a push over this many bytes
// must not be sent with keepalive (browsers reject it before it leaves).
const KEEPALIVE_BODY_LIMIT = 60_000;

const META: SyncMeta = { syncId: 'sync-1', secret: 'sekrit', deviceId: 'dev-9', lastSyncedSeq: 4, dirty: false };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

// A fetch that records every call and answers each with the queued response.
function fakeFetch(...responses: Array<{ status: number; body?: unknown }>): { fn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const r = responses.length > 1 ? responses.shift()! : responses[0];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  return { fn, calls };
}

const headersOf = (call: Call): Record<string, string> => (call.init?.headers ?? {}) as Record<string, string>;
const bodyOf = (call: Call): Record<string, unknown> => JSON.parse(call.init?.body as string) as Record<string, unknown>;

describe('pairStart', () => {
  it('a bare start posts an empty body with no auth', async () => {
    const reply = { code: 'ABCD', syncId: 's', secret: 'x', expiresAt: 99 };
    const { fn, calls } = fakeFetch({ status: 200, body: reply });
    const res = await pairStart(null, fn);
    expect(res).toEqual(reply);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/pair/start');
    expect(calls[0].init?.method).toBe('POST');
    expect(headersOf(calls[0])['content-type']).toBe('application/json');
    expect(headersOf(calls[0]).authorization).toBeUndefined();
    expect(bodyOf(calls[0])).toEqual({});
  });

  it('a re-issue for an existing save carries the bearer secret and the syncId', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: { code: 'WXYZ', syncId: 'old', secret: 'x', expiresAt: 1 } });
    await pairStart({ syncId: 'old', secret: 'oldsecret' }, fn);
    expect(headersOf(calls[0]).authorization).toBe('Bearer oldsecret');
    expect(bodyOf(calls[0])).toEqual({ syncId: 'old' });
  });

  it('throws on a non-ok status', async () => {
    const { fn } = fakeFetch({ status: 500 });
    await expect(pairStart(null, fn)).rejects.toThrow(/pair\/start failed: 500/);
  });
});

describe('pairClaim', () => {
  it('posts the code and returns the credentials', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: { syncId: 's', secret: 'x' } });
    const res = await pairClaim('ABCD', fn);
    expect(res).toEqual({ syncId: 's', secret: 'x' });
    expect(calls[0].url).toBe('/api/pair/claim');
    expect(calls[0].init?.method).toBe('POST');
    expect(bodyOf(calls[0])).toEqual({ code: 'ABCD' });
    expect(headersOf(calls[0]).authorization).toBeUndefined();
  });

  it('an unknown or expired code (404) is null, not an error', async () => {
    const { fn } = fakeFetch({ status: 404, body: { error: 'no such code' } });
    await expect(pairClaim('NOPE', fn)).resolves.toBeNull();
  });

  it('any other failure throws', async () => {
    const { fn } = fakeFetch({ status: 503 });
    await expect(pairClaim('ABCD', fn)).rejects.toThrow(/pair\/claim failed: 503/);
  });
});

describe('pullSave / pullMeta / claimSave', () => {
  const cloud = { exists: true, seq: 7, owner: 'dev-1', savedAt: 123, blob: 'blob' };

  it('pullSave GETs the save with the bearer secret', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: cloud });
    const res = await pullSave(META, fn);
    expect(res).toEqual(cloud);
    expect(calls[0].url).toBe('/api/save/sync-1');
    expect(calls[0].init?.method).toBeUndefined();
    expect(calls[0].init?.body).toBeUndefined();
    expect(headersOf(calls[0])).toEqual({ authorization: 'Bearer sekrit' });
  });

  it('pullSave throws on a non-ok status', async () => {
    const { fn } = fakeFetch({ status: 401 });
    await expect(pullSave(META, fn)).rejects.toThrow(/pull failed: 401/);
  });

  it('pullMeta GETs the /meta route with the bearer secret', async () => {
    const { blob: _blob, ...meta } = cloud;
    const { fn, calls } = fakeFetch({ status: 200, body: meta });
    const res = await pullMeta(META, fn);
    expect(res).toEqual(meta);
    expect(calls[0].url).toBe('/api/save/sync-1/meta');
    expect(calls[0].init?.body).toBeUndefined();
    expect(headersOf(calls[0])).toEqual({ authorization: 'Bearer sekrit' });
  });

  it('pullMeta throws on a non-ok status', async () => {
    const { fn } = fakeFetch({ status: 500 });
    await expect(pullMeta(META, fn)).rejects.toThrow(/meta failed: 500/);
  });

  it('claimSave POSTs this device id to /claim with auth and a JSON content type', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: cloud });
    const res = await claimSave(META, fn);
    expect(res).toEqual(cloud);
    expect(calls[0].url).toBe('/api/save/sync-1/claim');
    expect(calls[0].init?.method).toBe('POST');
    expect(headersOf(calls[0])).toEqual({ 'content-type': 'application/json', authorization: 'Bearer sekrit' });
    expect(bodyOf(calls[0])).toEqual({ deviceId: 'dev-9' });
  });

  it('claimSave throws on a non-ok status', async () => {
    const { fn } = fakeFetch({ status: 409 });
    await expect(claimSave(META, fn)).rejects.toThrow(/claim failed: 409/);
  });
});

describe('pushSave', () => {
  it('PUTs deviceId, baseSeq, the blob, and an explicit release flag', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: { seq: 5 } });
    const res = await pushSave(META, 'the-blob', {}, fn);
    expect(res).toEqual({ kind: 'accepted', seq: 5 });
    expect(calls[0].url).toBe('/api/save/sync-1');
    expect(calls[0].init?.method).toBe('PUT');
    expect(headersOf(calls[0])).toEqual({ 'content-type': 'application/json', authorization: 'Bearer sekrit' });
    expect(bodyOf(calls[0])).toEqual({ deviceId: 'dev-9', baseSeq: 4, blob: 'the-blob', release: false });
    expect(calls[0].init?.keepalive).toBeFalsy();
    expect(calls[0].init?.signal).toBeUndefined();
  });

  it('release: true rides along in the same write', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: { seq: 5 } });
    await pushSave(META, 'b', { release: true }, fn);
    expect(bodyOf(calls[0]).release).toBe(true);
  });

  it('a 409 is a rejection carrying the server reason and seq', async () => {
    const { fn } = fakeFetch({ status: 409, body: { error: 'stale-seq', seq: 9 } });
    await expect(pushSave(META, 'b', {}, fn)).resolves.toEqual({ kind: 'rejected', reason: 'stale-seq', seq: 9 });
    const other = fakeFetch({ status: 409, body: { error: 'not-owner', seq: 2 } });
    await expect(pushSave(META, 'b', {}, other.fn)).resolves.toEqual({ kind: 'rejected', reason: 'not-owner', seq: 2 });
  });

  it('any other failure status throws', async () => {
    const { fn } = fakeFetch({ status: 500 });
    await expect(pushSave(META, 'b', {}, fn)).rejects.toThrow(/push failed: 500/);
    const unauth = fakeFetch({ status: 401 });
    await expect(pushSave(META, 'b', {}, unauth.fn)).rejects.toThrow(/push failed: 401/);
  });

  it('keepalive is set only when asked for and the payload fits under the browser cap', async () => {
    // Size the blob against the whole JSON payload, not the blob alone.
    const overhead = JSON.stringify({ deviceId: META.deviceId, baseSeq: META.lastSyncedSeq, blob: '', release: false }).length;
    const fits = 'x'.repeat(KEEPALIVE_BODY_LIMIT - overhead);
    const tooBig = 'x'.repeat(KEEPALIVE_BODY_LIMIT - overhead + 1);

    const small = fakeFetch({ status: 200, body: { seq: 1 } });
    await pushSave(META, fits, { keepalive: true }, small.fn);
    expect((small.calls[0].init?.body as string).length).toBe(KEEPALIVE_BODY_LIMIT);
    expect(small.calls[0].init?.keepalive).toBe(true);

    const big = fakeFetch({ status: 200, body: { seq: 1 } });
    await pushSave(META, tooBig, { keepalive: true }, big.fn);
    expect((big.calls[0].init?.body as string).length).toBe(KEEPALIVE_BODY_LIMIT + 1);
    expect(big.calls[0].init?.keepalive).toBe(false);

    const unasked = fakeFetch({ status: 200, body: { seq: 1 } });
    await pushSave(META, fits, {}, unasked.fn);
    expect(unasked.calls[0].init?.keepalive).toBeFalsy();
  });

  it('passes the abort signal through to fetch', async () => {
    const controller = new AbortController();
    const { fn, calls } = fakeFetch({ status: 200, body: { seq: 1 } });
    await pushSave(META, 'b', { signal: controller.signal }, fn);
    expect(calls[0].init?.signal).toBe(controller.signal);
  });
});

describe('rotateSecret', () => {
  it('POSTs /rotate under the old secret and returns the new one', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: { secret: 'fresh' } });
    await expect(rotateSecret(META, fn)).resolves.toBe('fresh');
    expect(calls[0].url).toBe('/api/save/sync-1/rotate');
    expect(calls[0].init?.method).toBe('POST');
    expect(headersOf(calls[0])).toEqual({ authorization: 'Bearer sekrit' });
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('throws on a non-ok status', async () => {
    const { fn } = fakeFetch({ status: 403 });
    await expect(rotateSecret(META, fn)).rejects.toThrow(/rotate failed: 403/);
  });
});
