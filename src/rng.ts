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

let idCounter = 0;

// Unique-enough id for ducks; embeds a counter so ids created in the same
// millisecond stay distinct.
// Ids come from the game RNG so a seeded game is fully reproducible (ids
// seed personality, favourite treat, and animation phase): two 32-bit draws
// make collisions within one pond vanishingly unlikely. Without an RNG,
// fall back to a clock + counter.
export function makeId(rng?: Rng): string {
  if (rng) {
    const a = Math.floor(rng.next() * 0xffffffff).toString(36);
    const b = Math.floor(rng.next() * 0xffffffff).toString(36);
    return `d${a}${b}`;
  }
  idCounter += 1;
  return `d${Date.now().toString(36)}${idCounter.toString(36)}`;
}
