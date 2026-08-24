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
  attempts: number; // failed claim attempts against this code
}

// Pairing codes: 8 symbols from an unambiguous alphabet (no 0/O/1/I/L),
// ~39 bits — infeasible to guess inside the 10-minute window even before
// the attempt limit.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const PAIR_TTL_MS = 10 * 60_000;
export const MAX_PAIR_ATTEMPTS = 20;

export function generateCode(randomBytes: Uint8Array): string {
  if (randomBytes.length < CODE_LENGTH) throw new Error('need more entropy');
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomBytes[i] % CODE_ALPHABET.length];
  }
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
  if (now > record.expiresAt) return false;
  if (record.attempts >= MAX_PAIR_ATTEMPTS) return false;
  return true;
}

export type WriteDecision =
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
