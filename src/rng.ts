// Seedable RNG (mulberry32). The state is a single uint32 that lives in
// GameState so the whole simulation is deterministic and serializable.
export interface Rng {
  next(): number; // [0, 1)
  int(maxExclusive: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  range(lo: number, hi: number): number;
  getState(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    range: (lo, hi) => lo + next() * (hi - lo),
    getState: () => s,
  };
}

// Small deterministic string hashes for choices that must stay stable for a
// duck across sessions (personality jitter, favourite treat, animation
// phase, epitaph). Multiplier and seed are parameters on purpose: saves
// depend on the exact values — a favourite treat or a breed standard would
// silently change under a different hash — so each caller keeps its own.
export function hashString(s: string, mult = 31, seed = 0): number {
  let h = seed;
  for (let i = 0; i < s.length; i += 1) h = (h * mult + s.charCodeAt(i)) >>> 0;
  return h;
}

// 32-bit FNV-1a, for the callers that need better mixing.
export function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Ids come from the game RNG so a seeded game is fully reproducible (ids
// seed personality, favourite treat, and animation phase): two 32-bit draws
// make collisions within one pond vanishingly unlikely.
export function makeId(rng: Rng): string {
  const a = Math.floor(rng.next() * 0xffffffff).toString(36);
  const b = Math.floor(rng.next() * 0xffffffff).toString(36);
  return `d${a}${b}`;
}
