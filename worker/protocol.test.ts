import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  codeValid,
  decideClaim,
  decideRelease,
  decideWrite,
  generateCode,
  MAX_PAIR_ATTEMPTS,
  normalizeCode,
  PAIR_TTL_MS,
  type PairRecord,
  type SaveMeta,
} from './protocol';

const record = (over: Partial<PairRecord> = {}): PairRecord => ({
  syncId: 'id',
  secret: 's',
  expiresAt: 1000 + PAIR_TTL_MS,
  attempts: 0,
  ...over,
});

describe('pairing codes', () => {
  it('generates codes from the unambiguous alphabet only', () => {
    const bytes = new Uint8Array(CODE_LENGTH).map((_, i) => i * 37);
    const code = generateCode(bytes);
    expect(code).toHaveLength(CODE_LENGTH);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    expect(code).not.toMatch(/[0O1IL]/);
  });

  it('normalizes human input', () => {
    expect(normalizeCode(' ab-cd ef23 ')).toBe('ABCDEF23');
  });

  it('validates expiry and attempt limits', () => {
    expect(codeValid(record(), 1000)).toBe(true);
    expect(codeValid(record(), 1001 + PAIR_TTL_MS)).toBe(false);
    expect(codeValid(record({ attempts: MAX_PAIR_ATTEMPTS }), 1000)).toBe(false);
    expect(codeValid(null, 1000)).toBe(false);
  });
});

describe('write CAS', () => {
  const meta = (over: Partial<SaveMeta> = {}): SaveMeta => ({
    seq: 5,
    owner: 'phone',
    savedAt: 0,
    ...over,
  });

  it('accepts the owner writing on the latest seq', () => {
    expect(decideWrite(meta(), { deviceId: 'phone', baseSeq: 5 })).toEqual({ ok: true });
  });

  it('rejects a non-owner even with the right seq', () => {
    expect(decideWrite(meta(), { deviceId: 'desktop', baseSeq: 5 })).toEqual({
      ok: false,
      reason: 'not-owner',
    });
  });

  it('rejects the owner writing on a stale seq', () => {
    expect(decideWrite(meta(), { deviceId: 'phone', baseSeq: 4 })).toEqual({
      ok: false,
      reason: 'stale-seq',
    });
  });

  it('lets anyone write a brand-new save (owner null, seq 0)', () => {
    expect(decideWrite(meta({ seq: 0, owner: null }), { deviceId: 'desktop', baseSeq: 0 })).toEqual(
      { ok: true },
    );
  });

  it('claim transfers ownership without touching seq; old owner then loses CAS', () => {
    const claimed = decideClaim(meta(), 'desktop');
    expect(claimed.seq).toBe(5);
    expect(claimed.owner).toBe('desktop');
    // The old owner's autosave, based on the same seq, is refused.
    expect(decideWrite(claimed, { deviceId: 'phone', baseSeq: 5 })).toEqual({
      ok: false,
      reason: 'not-owner',
    });
    // The new owner writes fine.
    expect(decideWrite(claimed, { deviceId: 'desktop', baseSeq: 5 })).toEqual({ ok: true });
  });

  it('release hands the pond back only from the owner; the next writer takes it', () => {
    expect(decideRelease(meta(), 'desktop')).toEqual({ ok: false, reason: 'not-owner' });
    const released = decideRelease(meta(), 'phone');
    expect(released).toEqual({ ok: true, meta: { seq: 5, owner: null, savedAt: 0 } });
    if (!released.ok) return;
    // Releasing an unowned save is a harmless no-op.
    expect(decideRelease(released.meta, 'anyone')).toEqual({ ok: true, meta: released.meta });
    // With nobody holding it, the desktop's next autosave lands on the same seq.
    expect(decideWrite(released.meta, { deviceId: 'desktop', baseSeq: 5 })).toEqual({ ok: true });
  });
});
