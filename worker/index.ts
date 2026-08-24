// Worker entry: routes /api/* to the sync Durable Object; everything else
// falls through to the static assets (the game itself).
import { CODE_LENGTH, generateCode, normalizeCode } from './protocol';
import { DuckSyncDO, type Env } from './room';

export { DuckSyncDO };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function saveStub(env: Env, syncId: string, body: Record<string, unknown>): Promise<Response> {
  const stub = env.SYNC.get(env.SYNC.idFromName(`save:${syncId}`));
  return stub.fetch('https://do/', { method: 'POST', body: JSON.stringify(body) });
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  // POST /api/pair/start — mint a pairing code. With a Bearer secret + syncId
  // it re-issues a code for an existing sync (adding another device); bare, it
  // creates a brand-new sync identity.
  if (path === '/api/pair/start' && request.method === 'POST') {
    const reqBody = (await request.json().catch(() => ({}))) as { syncId?: string };
    let syncId: string;
    let secret: string;
    const auth = bearer(request);
    if (auth && reqBody.syncId) {
      // Verify the caller really holds this sync before minting a code for it.
      const check = await saveStub(env, reqBody.syncId, { op: 'meta', secret: auth });
      if (check.status !== 200) return json({ error: 'unauthorized' }, 401);
      syncId = reqBody.syncId;
      secret = auth;
    } else {
      syncId = crypto.randomUUID();
      secret = hex(crypto.getRandomValues(new Uint8Array(16)));
      await saveStub(env, syncId, { op: 'save-init', secret });
    }
    // Retry on the (astronomically unlikely) collision with a live code.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = generateCode(crypto.getRandomValues(new Uint8Array(CODE_LENGTH)));
      const stub = env.SYNC.get(env.SYNC.idFromName(`pair:${code}`));
      const res = await stub.fetch('https://do/', {
        method: 'POST',
        body: JSON.stringify({ op: 'pair-create', syncId, secret }),
      });
      if (res.status === 200) {
        const { expiresAt } = (await res.json()) as { expiresAt: number };
        return json({ code, syncId, secret, expiresAt });
      }
    }
    return json({ error: 'try-again' }, 503);
  }

  // POST /api/pair/claim {code} — trade a code for the sync credentials.
  if (path === '/api/pair/claim' && request.method === 'POST') {
    const { code } = (await request.json().catch(() => ({}))) as { code?: string };
    const normalized = normalizeCode(code ?? '');
    if (normalized.length !== CODE_LENGTH) return json({ error: 'unknown-code' }, 404);
    const stub = env.SYNC.get(env.SYNC.idFromName(`pair:${normalized}`));
    return stub.fetch('https://do/', {
      method: 'POST',
      body: JSON.stringify({ op: 'pair-claim' }),
    });
  }

  // /api/save/:syncId[/meta|/claim]
  const match = path.match(/^\/api\/save\/([0-9a-f-]{36})(?:\/(meta|claim))?$/);
  if (match) {
    const secret = bearer(request);
    if (!secret) return json({ error: 'unauthorized' }, 401);
    const [, syncId, sub] = match;
    if (request.method === 'GET' && sub === undefined) {
      return saveStub(env, syncId, { op: 'pull', secret });
    }
    if (request.method === 'GET' && sub === 'meta') {
      return saveStub(env, syncId, { op: 'meta', secret });
    }
    if (request.method === 'POST' && sub === 'claim') {
      const { deviceId } = (await request.json().catch(() => ({}))) as { deviceId?: string };
      if (!deviceId) return json({ error: 'bad-request' }, 400);
      return saveStub(env, syncId, { op: 'claim', secret, deviceId });
    }
    if (request.method === 'PUT' && sub === undefined) {
      const body = (await request.json().catch(() => null)) as {
        deviceId?: string;
        baseSeq?: number;
        blob?: string;
      } | null;
      if (!body?.deviceId || typeof body.baseSeq !== 'number' || typeof body.blob !== 'string') {
        return json({ error: 'bad-request' }, 400);
      }
      if (body.blob.length > 1_500_000) return json({ error: 'too-large' }, 413);
      return saveStub(env, syncId, {
        op: 'put',
        secret,
        deviceId: body.deviceId,
        baseSeq: body.baseSeq,
        blob: body.blob,
      });
    }
  }

  return json({ error: 'not-found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url.pathname);
      } catch (err) {
        console.error('api error', err);
        return json({ error: 'internal' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
