// Shared HTTP helpers for the worker entry and the Durable Object.

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Everything the API returns is per-user and Bearer-authenticated —
      // an intermediary or future cache rule must never serve one player's
      // save to another.
      'cache-control': 'no-store',
      vary: 'authorization',
    },
  });
}

// Constant-time-ish secret comparison: compare SHA-256 digests so timing
// leaks nothing about how many leading characters matched. This is the sole
// authentication check in the system, so it gets the careful version.
export async function secretsMatch(candidate: unknown, actual: string): Promise<boolean> {
  if (typeof candidate !== 'string') return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(candidate)),
    crypto.subtle.digest('SHA-256', enc.encode(actual)),
  ]);
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i += 1) diff |= va[i] ^ vb[i];
  return diff === 0;
}
