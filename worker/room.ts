// DuckSyncDO — one Durable Object instance per pairing code or per save.
// Instance names: `pair:<code>` hold a short-lived pairing record;
// `save:<syncId>` hold the save blob, its sequence counter, and ownership.
// The DO is the serialization point: every read-modify-write below runs
// single-threaded, which is the whole reason this is a DO and not KV.
import { DurableObject } from 'cloudflare:workers';
import { json, secretsMatch } from './http';
import {
  codeValid,
  decideClaim,
  decideRelease,
  decideWrite,
  PAIR_TTL_MS,
  type PairRecord,
  type SaveMeta,
} from './protocol';

export interface Env {
  SYNC: DurableObjectNamespace<DuckSyncDO>;
  ASSETS: Fetcher;
  // Per-client throttle on the unauthenticated pairing routes (wrangler
  // `ratelimits`). Optional so a dev setup without the binding still runs.
  PAIR_LIMITER?: RateLimit;
}

// A save that was initialised for a pairing code but never received a
// push (the code expired unclaimed, or the founding device never saved) is
// deleted after this long; saves with a blob are kept indefinitely.
export const ORPHAN_SAVE_TTL_MS = 24 * 60 * 60_000;

interface SaveRow extends Record<string, number | string | null> {
  seq: number;
  owner: string | null;
  savedAt: number;
  blob: string | null; // null only in rows left by older builds' empty claims
}

export class DuckSyncDO extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;
  private tableReady = false;

  // Slot 0 is the current save, slot 1 the previous accepted write — cheap
  // one-step insurance against a bad handoff. Created lazily, after the
  // secret check: DDL in the constructor persisted a SQLite database for
  // every save:<id> an unauthenticated probe could name.
  private ensureTable(): void {
    if (this.tableReady) return;
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS saves (slot INTEGER PRIMARY KEY, seq INTEGER, owner TEXT, savedAt INTEGER, blob TEXT)',
    );
    this.tableReady = true;
  }

  // Retention. pair:<code> records vanish at expiry; save:<id> objects that
  // never got a blob are dropped after ORPHAN_SAVE_TTL_MS.
  override async alarm(): Promise<void> {
    const pair = await this.ctx.storage.get<PairRecord>('pair');
    if (pair) {
      if (!codeValid(pair, Date.now())) await this.ctx.storage.deleteAll();
      return;
    }
    const secret = await this.ctx.storage.get<string>('secret');
    if (secret === undefined) return;
    this.ensureTable();
    const row = this.currentRow();
    if (row === null || row.blob === null) await this.ctx.storage.deleteAll();
  }

  // Internal API: the Worker fetch handler POSTs {op, ...} JSON. This is not
  // reachable from the public internet except through worker/index.ts, which
  // enforces the route shapes.
  override async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as Record<string, unknown>;
    const op = body.op as string;
    switch (op) {
      case 'pair-create':
        return this.pairCreate(body.syncId as string, body.secret as string);
      case 'pair-claim':
        return this.pairClaim();
      case 'save-init':
        return this.saveInit(body.secret as string);
      default:
        return this.saveOp(op, body);
    }
  }

  // ---- pair:<code> instances ------------------------------------------------

  private async pairCreate(syncId: string, secret: string): Promise<Response> {
    const existing = await this.ctx.storage.get<PairRecord>('pair');
    if (existing && codeValid(existing, Date.now())) {
      return json({ error: 'code-in-use' }, 409);
    }
    const record: PairRecord = {
      syncId,
      secret,
      expiresAt: Date.now() + PAIR_TTL_MS,
    };
    await this.ctx.storage.put('pair', record);
    await this.ctx.storage.setAlarm(record.expiresAt + 1000);
    return json({ ok: true, expiresAt: record.expiresAt });
  }

  private async pairClaim(): Promise<Response> {
    const record = await this.ctx.storage.get<PairRecord>('pair');
    if (!codeValid(record ?? null, Date.now())) return json({ error: 'unknown-code' }, 404);
    // Single use: the code is gone the moment it succeeds.
    await this.ctx.storage.deleteAll();
    return json({ syncId: record!.syncId, secret: record!.secret });
  }

  // ---- save:<syncId> instances ---------------------------------------------

  private async saveInit(secret: string): Promise<Response> {
    const existing = await this.ctx.storage.get<string>('secret');
    if (existing === undefined) {
      await this.ctx.storage.put('secret', secret);
      await this.ctx.storage.setAlarm(Date.now() + ORPHAN_SAVE_TTL_MS);
    }
    return json({ ok: true });
  }

  private async saveOp(op: string, body: Record<string, unknown>): Promise<Response> {
    const secret = await this.ctx.storage.get<string>('secret');
    if (secret === undefined || !(await secretsMatch(body.secret, secret))) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (op === 'rotate') {
      // Every other paired device holds the old secret and is cut off; the
      // caller stores the new one. The save itself is untouched.
      const fresh = body.newSecret as string;
      await this.ctx.storage.put('secret', fresh);
      return json({ ok: true });
    }
    this.ensureTable();
    const row = this.currentRow();
    const meta: SaveMeta = row
      ? { seq: row.seq, owner: row.owner, savedAt: row.savedAt }
      : { seq: 0, owner: null, savedAt: 0 };
    // A row with no blob (a claim recorded before the first push ever
    // landed) is not a save the client can load.
    const exists = row !== null && row.blob !== null;
    switch (op) {
      case 'meta':
        return json({ exists, ...meta });
      case 'pull':
        return json({ exists, ...meta, blob: row?.blob ?? null });
      case 'claim': {
        const claimed = decideClaim(meta, body.deviceId as string);
        // Nothing to own yet: the first push sets the owner. Persisting the
        // claim here would leave a blob-less row behind.
        if (row) this.writeMeta(claimed, row.blob);
        return json({ exists, ...claimed, blob: row?.blob ?? null });
      }
      case 'release': {
        const decision = decideRelease(meta, body.deviceId as string);
        if (!decision.ok) return json({ error: decision.reason, seq: meta.seq, owner: meta.owner }, 409);
        if (row) this.writeMeta(decision.meta, row.blob);
        return json({ exists, ...decision.meta });
      }
      case 'put': {
        const decision = decideWrite(meta, {
          deviceId: body.deviceId as string,
          baseSeq: body.baseSeq as number,
        });
        if (!decision.ok) {
          return json({ error: decision.reason, seq: meta.seq, owner: meta.owner }, 409);
        }
        // A write may hand the pond back in the same breath (release: true)
        // — the companion putting the phone down. Doing both in one DO call
        // means the other device can never reclaim between the push and the
        // release and strand this write behind a not-owner rejection.
        const next: SaveMeta = {
          seq: meta.seq + 1,
          owner: body.release === true ? null : (body.deviceId as string),
          savedAt: Date.now(),
        };
        // Keep the previous accepted write in slot 1 before overwriting slot 0.
        if (row) {
          this.sql.exec(
            'INSERT OR REPLACE INTO saves (slot, seq, owner, savedAt, blob) VALUES (1, ?, ?, ?, ?)',
            row.seq,
            row.owner,
            row.savedAt,
            row.blob,
          );
        }
        this.sql.exec(
          'INSERT OR REPLACE INTO saves (slot, seq, owner, savedAt, blob) VALUES (0, ?, ?, ?, ?)',
          next.seq,
          next.owner,
          next.savedAt,
          body.blob as string,
        );
        // A real save now: cancel the orphan-retention alarm set at init.
        if (!exists) await this.ctx.storage.deleteAlarm();
        return json({ seq: next.seq });
      }
      default:
        return json({ error: 'unknown-op' }, 400);
    }
  }

  private currentRow(): SaveRow | null {
    const rows = this.sql
      .exec<SaveRow>('SELECT seq, owner, savedAt, blob FROM saves WHERE slot = 0')
      .toArray();
    return rows[0] ?? null;
  }

  private writeMeta(meta: SaveMeta, blob: string | null): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO saves (slot, seq, owner, savedAt, blob) VALUES (0, ?, ?, ?, ?)',
      meta.seq,
      meta.owner,
      meta.savedAt,
      blob,
    );
  }
}
