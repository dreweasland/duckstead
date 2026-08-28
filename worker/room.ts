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
  decideWrite,
  PAIR_TTL_MS,
  type PairRecord,
  type SaveMeta,
} from './protocol';

export interface Env {
  SYNC: DurableObjectNamespace<DuckSyncDO>;
  ASSETS: Fetcher;
}

interface SaveRow extends Record<string, number | string | null> {
  seq: number;
  owner: string | null;
  savedAt: number;
  blob: string;
}

export class DuckSyncDO extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Slot 0 is the current save, slot 1 the previous accepted write — cheap
    // one-step insurance against a bad handoff.
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS saves (slot INTEGER PRIMARY KEY, seq INTEGER, owner TEXT, savedAt INTEGER, blob TEXT)',
    );
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
      attempts: 0,
    };
    await this.ctx.storage.put('pair', record);
    return json({ ok: true, expiresAt: record.expiresAt });
  }

  private async pairClaim(): Promise<Response> {
    const record = await this.ctx.storage.get<PairRecord>('pair');
    if (!codeValid(record ?? null, Date.now())) {
      // Count the miss so a brute-forcer burns the code out quickly.
      if (record) {
        record.attempts += 1;
        await this.ctx.storage.put('pair', record);
      }
      return json({ error: 'unknown-code' }, 404);
    }
    // Single use: the code is gone the moment it succeeds.
    await this.ctx.storage.delete('pair');
    return json({ syncId: record!.syncId, secret: record!.secret });
  }

  // ---- save:<syncId> instances ---------------------------------------------

  private async saveInit(secret: string): Promise<Response> {
    const existing = await this.ctx.storage.get<string>('secret');
    if (existing === undefined) await this.ctx.storage.put('secret', secret);
    return json({ ok: true });
  }

  private async saveOp(op: string, body: Record<string, unknown>): Promise<Response> {
    const secret = await this.ctx.storage.get<string>('secret');
    if (secret === undefined || !(await secretsMatch(body.secret, secret))) {
      return json({ error: 'unauthorized' }, 401);
    }
    const row = this.currentRow();
    const meta: SaveMeta = row
      ? { seq: row.seq, owner: row.owner, savedAt: row.savedAt }
      : { seq: 0, owner: null, savedAt: 0 };
    switch (op) {
      case 'meta':
        return json({ exists: row !== null, ...meta });
      case 'pull':
        return json({ exists: row !== null, ...meta, blob: row?.blob ?? null });
      case 'claim': {
        const claimed = decideClaim(meta, body.deviceId as string);
        this.writeMeta(claimed, row?.blob ?? null);
        return json({ exists: row !== null, ...claimed, blob: row?.blob ?? null });
      }
      case 'put': {
        const decision = decideWrite(meta, {
          deviceId: body.deviceId as string,
          baseSeq: body.baseSeq as number,
        });
        if (!decision.ok) {
          return json({ error: decision.reason, seq: meta.seq, owner: meta.owner }, 409);
        }
        const next: SaveMeta = {
          seq: meta.seq + 1,
          owner: body.deviceId as string,
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
