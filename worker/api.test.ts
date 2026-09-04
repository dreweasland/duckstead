// End-to-end tests for the sync API: the Worker's routing and validation
// (index.ts) driving the Durable Object (room.ts) against an in-memory
// stand-in for the DO runtime. The stand-in implements exactly the storage
// and SQL surface room.ts uses, so a new statement there fails loudly here.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown,
    ) {}
  },
}));

import worker, { DuckSyncDO } from './index';
import { ORPHAN_SAVE_TTL_MS, type Env } from './room';
import { PAIR_TTL_MS } from './protocol';

type Row = { slot: number; seq: number; owner: string | null; savedAt: number; blob: string | null };

// One Durable Object's storage: a KV map, an alarm, and the `saves` table.
class FakeStorage {
  kv = new Map<string, unknown>();
  rows = new Map<number, Row>();
  tableCreated = false;
  alarmAt: number | null = null;
  writes = 0;

  sql = {
    exec: <T>(query: string, ...params: unknown[]) => {
      if (query.startsWith('CREATE TABLE')) {
        this.tableCreated = true;
        this.writes += 1;
        return { toArray: () => [] as T[] };
      }
      if (query.startsWith('SELECT')) {
        if (!this.tableCreated) throw new Error('no such table: saves');
        const row = this.rows.get(0);
        return { toArray: () => (row ? [row as unknown as T] : []) };
      }
      const m = query.match(/VALUES \((\d), \?, \?, \?, \?\)/);
      if (!m) throw new Error(`unexpected SQL: ${query}`);
      if (!this.tableCreated) throw new Error('no such table: saves');
      const [seq, owner, savedAt, blob] = params as [number, string | null, number, string | null];
      this.rows.set(Number(m[1]), { slot: Number(m[1]), seq, owner, savedAt, blob });
      this.writes += 1;
      return { toArray: () => [] as T[] };
    },
  };

  get = async <T>(key: string): Promise<T | undefined> => this.kv.get(key) as T | undefined;
  put = async (key: string, value: unknown): Promise<void> => {
    this.kv.set(key, value);
    this.writes += 1;
  };
  delete = async (key: string): Promise<boolean> => this.kv.delete(key);
  deleteAll = async (): Promise<void> => {
    this.kv.clear();
    this.rows.clear();
    this.tableCreated = false;
    this.alarmAt = null;
  };
  setAlarm = async (at: number): Promise<void> => {
    this.alarmAt = at;
  };
  deleteAlarm = async (): Promise<void> => {
    this.alarmAt = null;
  };
}

// The namespace: one DO instance per name, created on first use, with a
// stub whose fetch calls straight into it.
function fakeEnv(opts: { limited?: boolean } = {}): Env & { objects: Map<string, { storage: FakeStorage; obj: DuckSyncDO }> } {
  const objects = new Map<string, { storage: FakeStorage; obj: DuckSyncDO }>();
  const env = {
    objects,
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } as unknown as Fetcher,
    PAIR_LIMITER: opts.limited === undefined ? undefined : { limit: async () => ({ success: !opts.limited }) },
    SYNC: {
      idFromName: (name: string) => ({ name }),
      get: (id: { name: string }) => ({
        fetch: async (url: string, init?: RequestInit) => {
          let entry = objects.get(id.name);
          if (!entry) {
            const storage = new FakeStorage();
            const ctx = { storage } as unknown as DurableObjectState;
            entry = { storage, obj: new DuckSyncDO(ctx, env as unknown as Env) };
            objects.set(id.name, entry);
          }
          return entry.obj.fetch(new Request(url, init));
        },
      }),
    },
  };
  return env as unknown as Env & { objects: typeof objects };
}

const DEVICE_A = 'aaaaaaaaaaaaaaaa';
const DEVICE_B = 'bbbbbbbbbbbbbbbb';

// Requests as a browser sends them: string bodies always carry a length.
function call(
  env: Env,
  method: string,
  path: string,
  opts: { body?: unknown; secret?: string; noLength?: boolean } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
    if (!opts.noLength) headers['content-length'] = String(new TextEncoder().encode(body).length);
  }
  if (opts.secret) headers.authorization = `Bearer ${opts.secret}`;
  return worker.fetch(new Request(`https://duckstead.test${path}`, { method, headers, body }), env);
}

async function pair(env: Env): Promise<{ code: string; syncId: string; secret: string }> {
  const res = await call(env, 'POST', '/api/pair/start', { body: {} });
  expect(res.status).toBe(200);
  return (await res.json()) as { code: string; syncId: string; secret: string };
}

describe('pairing', () => {
  let env: ReturnType<typeof fakeEnv>;
  beforeEach(() => {
    env = fakeEnv();
  });

  it('mints a code that trades once for the credentials', async () => {
    const { code, syncId, secret } = await pair(env);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const claim = await call(env, 'POST', '/api/pair/claim', { body: { code: code.toLowerCase() } });
    expect(claim.status).toBe(200);
    expect(await claim.json()).toEqual({ syncId, secret });
    // Single use.
    const again = await call(env, 'POST', '/api/pair/claim', { body: { code } });
    expect(again.status).toBe(404);
  });

  it('re-issues a code for an existing sync only to a caller holding its secret', async () => {
    const { syncId, secret } = await pair(env);
    const ok = await call(env, 'POST', '/api/pair/start', { body: { syncId }, secret });
    expect(((await ok.json()) as { syncId: string }).syncId).toBe(syncId);
    const bad = await call(env, 'POST', '/api/pair/start', { body: { syncId }, secret: 'nope' });
    expect(bad.status).toBe(401);
  });

  it('rejects malformed codes before touching the namespace', async () => {
    const res = await call(env, 'POST', '/api/pair/claim', { body: { code: 'O0O0-I1I1' } });
    expect(res.status).toBe(404);
    expect(env.objects.size).toBe(0);
  });

  it('is throttled per client when the limiter binding says so', async () => {
    const limited = fakeEnv({ limited: true });
    expect((await call(limited, 'POST', '/api/pair/start', { body: {} })).status).toBe(429);
    expect((await call(limited, 'POST', '/api/pair/claim', { body: { code: 'ABCDEFGH' } })).status).toBe(429);
    expect(limited.objects.size).toBe(0);
  });

  it('expired pair records are removed by the alarm', async () => {
    vi.useFakeTimers();
    try {
      const { code } = await pair(env);
      const entry = env.objects.get(`pair:${code}`)!;
      expect(entry.storage.alarmAt).toBeGreaterThan(Date.now());
      vi.advanceTimersByTime(PAIR_TTL_MS + 5000);
      await entry.obj.alarm();
      expect(entry.storage.kv.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('save ownership and writes', () => {
  let env: ReturnType<typeof fakeEnv>;
  let syncId: string;
  let secret: string;
  beforeEach(async () => {
    env = fakeEnv();
    ({ syncId, secret } = await pair(env));
  });

  const put = (deviceId: string, baseSeq: number, blob: string, extra: Record<string, unknown> = {}, sec = secret) =>
    call(env, 'PUT', `/api/save/${syncId}`, { body: { deviceId, baseSeq, blob, ...extra }, secret: sec });
  const claim = (deviceId: string) => call(env, 'POST', `/api/save/${syncId}/claim`, { body: { deviceId }, secret });
  const meta = async () => (await call(env, 'GET', `/api/save/${syncId}/meta`, { secret })).json() as Promise<Record<string, unknown>>;

  it('a fresh sync reports no save, and a claim on it persists nothing', async () => {
    expect(await meta()).toEqual({ exists: false, seq: 0, owner: null, savedAt: 0 });
    expect((await claim(DEVICE_A)).status).toBe(200);
    expect(env.objects.get(`save:${syncId}`)!.storage.rows.size).toBe(0);
    expect(await meta()).toMatchObject({ exists: false });
  });

  it('writes are compare-and-swap on seq and gated on ownership', async () => {
    expect(await (await put(DEVICE_A, 0, 'v1')).json()).toEqual({ seq: 1 });
    expect(await meta()).toMatchObject({ exists: true, seq: 1, owner: DEVICE_A });

    const stale = await put(DEVICE_A, 0, 'v1-again');
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'stale-seq', seq: 1 });

    const intruder = await put(DEVICE_B, 1, 'hijack');
    expect(intruder.status).toBe(409);
    expect(await intruder.json()).toMatchObject({ error: 'not-owner', owner: DEVICE_A });

    // The pull returns the accepted blob; the previous write sits in slot 1.
    expect(await (await put(DEVICE_A, 1, 'v2')).json()).toEqual({ seq: 2 });
    const pull = (await (await call(env, 'GET', `/api/save/${syncId}`, { secret })).json()) as { blob: string };
    expect(pull.blob).toBe('v2');
    expect(env.objects.get(`save:${syncId}`)!.storage.rows.get(1)?.blob).toBe('v1');
  });

  it('a write with release hands the pond to the next writer', async () => {
    await put(DEVICE_A, 0, 'v1');
    expect(await (await put(DEVICE_A, 1, 'v2', { release: true })).json()).toEqual({ seq: 2 });
    expect(await meta()).toMatchObject({ seq: 2, owner: null });
    expect(await (await put(DEVICE_B, 2, 'v3')).json()).toEqual({ seq: 3 });
    expect(await meta()).toMatchObject({ owner: DEVICE_B });
  });

  it('only the owner may release; a claim is unconditional', async () => {
    await put(DEVICE_A, 0, 'v1');
    const notOwner = await call(env, 'POST', `/api/save/${syncId}/release`, { body: { deviceId: DEVICE_B }, secret });
    expect(notOwner.status).toBe(409);
    expect((await claim(DEVICE_B)).status).toBe(200);
    expect(await meta()).toMatchObject({ owner: DEVICE_B, seq: 1 });
  });

  it('rotating the secret cuts off every other holder', async () => {
    await put(DEVICE_A, 0, 'v1');
    const res = await call(env, 'POST', `/api/save/${syncId}/rotate`, { secret });
    const { secret: fresh } = (await res.json()) as { secret: string };
    expect(fresh).toMatch(/^[0-9a-f]{32}$/);
    expect(fresh).not.toBe(secret);
    expect((await call(env, 'GET', `/api/save/${syncId}/meta`, { secret })).status).toBe(401);
    expect((await call(env, 'GET', `/api/save/${syncId}/meta`, { secret: fresh })).status).toBe(200);
    // The save itself is untouched.
    expect(await (await put(DEVICE_A, 1, 'v2', {}, fresh)).json()).toEqual({ seq: 2 });
  });

  it('an orphaned save is dropped by the alarm; one with a blob is kept', async () => {
    const entry = env.objects.get(`save:${syncId}`)!;
    expect(entry.storage.alarmAt).toBeGreaterThan(Date.now() + ORPHAN_SAVE_TTL_MS - 60_000);
    await entry.obj.alarm();
    expect(entry.storage.kv.has('secret')).toBe(false);

    const { syncId: kept, secret: keptSecret } = await pair(env);
    await call(env, 'PUT', `/api/save/${kept}`, { body: { deviceId: DEVICE_A, baseSeq: 0, blob: 'v1' }, secret: keptSecret });
    const keptEntry = env.objects.get(`save:${kept}`)!;
    expect(keptEntry.storage.alarmAt).toBeNull(); // cancelled by the first accepted write
    await keptEntry.obj.alarm();
    expect(keptEntry.storage.kv.has('secret')).toBe(true);
  });
});

describe('request validation', () => {
  let env: ReturnType<typeof fakeEnv>;
  let syncId: string;
  let secret: string;
  beforeEach(async () => {
    env = fakeEnv();
    ({ syncId, secret } = await pair(env));
  });

  it('an unauthenticated probe of a save persists nothing in the object', async () => {
    const other = crypto.randomUUID();
    const res = await call(env, 'GET', `/api/save/${other}`, { secret: 'guess' });
    expect(res.status).toBe(401);
    expect(env.objects.get(`save:${other}`)!.storage.writes).toBe(0);
    // A wrong secret against a real save is the same 401.
    expect((await call(env, 'GET', `/api/save/${syncId}`, { secret: 'guess' })).status).toBe(401);
  });

  it('only v4 UUIDs reach the namespace', async () => {
    const dashes = '-'.repeat(36);
    expect((await call(env, 'GET', `/api/save/${dashes}`, { secret })).status).toBe(404);
    expect(env.objects.has(`save:${dashes}`)).toBe(false);
  });

  it('bodies must declare their length and stay under the cap', async () => {
    const body = { deviceId: DEVICE_A, baseSeq: 0, blob: 'v1' };
    expect((await call(env, 'PUT', `/api/save/${syncId}`, { body, secret, noLength: true })).status).toBe(411);
    const huge = new Request(`https://duckstead.test/api/save/${syncId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${secret}`, 'content-length': '3000000' },
      body: '{}',
    });
    expect((await worker.fetch(huge, env)).status).toBe(413);
    const bigBlob = { ...body, blob: 'x'.repeat(1_500_001) };
    expect((await call(env, 'PUT', `/api/save/${syncId}`, { body: bigBlob, secret })).status).toBe(413);
  });

  it('rejects malformed device ids and non-boolean release flags', async () => {
    const bad = (body: Record<string, unknown>) => call(env, 'PUT', `/api/save/${syncId}`, { body, secret });
    expect((await bad({ deviceId: 'phone', baseSeq: 0, blob: 'v1' })).status).toBe(400);
    expect((await bad({ deviceId: DEVICE_A, baseSeq: '0', blob: 'v1' })).status).toBe(400);
    expect((await bad({ deviceId: DEVICE_A, baseSeq: 0, blob: 'v1', release: 'yes' })).status).toBe(400);
    expect((await call(env, 'POST', `/api/save/${syncId}/claim`, { body: { deviceId: 'x' }, secret })).status).toBe(400);
  });

  it('API responses are never cacheable and never sniffed', async () => {
    const res = await call(env, 'GET', `/api/save/${syncId}/meta`, { secret });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('everything outside /api/ goes to the static assets', async () => {
    const res = await worker.fetch(new Request('https://duckstead.test/companion'), env);
    expect(await res.text()).toBe('asset');
  });
});
