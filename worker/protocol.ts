// Pure sync-protocol logic shared by the Durable Object and its tests.
// No Cloudflare types here — everything is plain data in, decisions out.

export interface SaveMeta {
  seq: number; // monotonic, bumped only by accepted writes
  owner: string | null; // deviceId of the current player
  savedAt: number; // ms epoch of the last accepted write
}

export interface PairRecord {
  syncId: string;
  secret: string;
  expiresAt: number; // ms epoch
}

// Pairing codes: 8 symbols from an unambiguous alphabet (no 0/O/1/I/L),
// ~39 bits — infeasible to guess inside the 10-minute window. Guessing is
// throttled at the edge (a rate limit per client on /api/pair/*), not per
// code: a wrong guess lands on a different pair:<code> object, so no
// per-record counter could ever see it.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const PAIR_TTL_MS = 10 * 60_000;
// Bytes to draw per code: rejection sampling below discards a few, and
// running out is a hard error, so ask for plenty.
export const CODE_RANDOM_BYTES = CODE_LENGTH * 4;

// Rejection sampling keeps every symbol equally likely: 256 % 31 = 8, so a
// plain modulo would favour the first eight symbols.
export function generateCode(randomBytes: Uint8Array): string {
  const n = CODE_ALPHABET.length;
  const cutoff = 256 - (256 % n);
  let code = '';
  for (let i = 0; i < randomBytes.length && code.length < CODE_LENGTH; i += 1) {
    const b = randomBytes[i];
    if (b < cutoff) code += CODE_ALPHABET[b % n];
  }
  if (code.length < CODE_LENGTH) throw new Error('need more entropy');
  return code;
}

// Codes are typed by humans: uppercase and drop spaces/dashes. Glyphs the
// alphabet omits (0/O/1/I/L) can't appear in a real code, so a typo simply
// fails the claim like any other wrong code.
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').slice(0, CODE_LENGTH);
}

export function codeValid(record: PairRecord | null, now: number): boolean {
  if (!record) return false;
  return now <= record.expiresAt;
}

type WriteDecision =
  | { ok: true }
  | { ok: false; reason: 'not-owner' | 'stale-seq' };

// Compare-and-swap: a write lands only if the writer still owns the save and
// based it on the latest accepted sequence number.
export function decideWrite(
  meta: SaveMeta,
  req: { deviceId: string; baseSeq: number },
): WriteDecision {
  if (meta.owner !== null && meta.owner !== req.deviceId) {
    return { ok: false, reason: 'not-owner' };
  }
  if (req.baseSeq !== meta.seq) return { ok: false, reason: 'stale-seq' };
  return { ok: true };
}

// Claiming is unconditional: the last device to open the game owns the save,
// exactly like the last browser tab does today. It never touches seq.
export function decideClaim(meta: SaveMeta, deviceId: string): SaveMeta {
  return { ...meta, owner: deviceId };
}

type ReleaseDecision = { ok: true; meta: SaveMeta } | { ok: false; reason: 'not-owner' };

// Releasing hands the pond back: the owner steps aside (owner null) so the
// device that lost the save can pick it up again without a human clicking.
// Only the current owner may release — a stale device letting go of a save it
// no longer holds would kick out whoever took it. seq is untouched.
export function decideRelease(meta: SaveMeta, deviceId: string): ReleaseDecision {
  if (meta.owner !== null && meta.owner !== deviceId) return { ok: false, reason: 'not-owner' };
  return { ok: true, meta: { ...meta, owner: null } };
}
