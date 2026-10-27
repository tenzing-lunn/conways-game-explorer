import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';

function assets(html = '<script id="life-runtime-config" type="application/json">{"backend":"local"}</script>') {
  return {
    fetch() {
      return Promise.resolve(new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }));
    },
  };
}

test('Worker injects only safe local runtime config into static HTML without database bindings', async () => {
  const response = await worker.fetch(new Request('https://life.example/'), { ASSETS: assets() });

  assert.equal(response.status, 200);
  assert.match(await response.text(), /{"backend":"local"}/);
});

test('Worker-first asset routing includes the homepage runtime config', async () => {
  const config = JSON.parse(await readFile(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
  assert.ok(config.assets.run_worker_first.includes('/'));
  assert.ok(config.assets.run_worker_first.includes('/api/*'));
});

test('Worker community routes require configured PostgreSQL and Better Auth services', async () => {
  const response = await worker.fetch(
    new Request('https://life.example/api/community/state'),
    { ASSETS: assets() },
  );

  assert.equal(response.status, 503);
  assert.match(await response.text(), /not configured/);
});

test('Worker maps canonical public reloads to the app shell', async () => {
  let requestedPath = '';
  const response = await worker.fetch(new Request('https://life.example/c/public-glider'), {
    ASSETS: { fetch(request) {
      requestedPath = new URL(request.url).pathname;
      if (requestedPath === '/index.html') return Promise.resolve(new Response(null, { status: 307, headers: { location: '/' } }));
      return Promise.resolve(new Response('<html><head><title>Life</title></head><body></body></html>', { headers: { 'content-type': 'text/html', etag: 'original' } }));
    } },
  }, { waitUntil() {} });
  assert.equal(requestedPath, '/');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('etag'), null);
});

test('Worker redirects trailing-slash app routes and serves a styled 404 for unknown paths', async () => {
  const env = { ASSETS: { fetch: async (request) => (new URL(request.url).pathname === '/'
    ? new Response('<html><head><title>Life</title><script>theme()</script></head></html>', { headers: { 'content-type': 'text/html' } })
    : new Response(null, { status: 404 })) } };

  const redirect = await worker.fetch(new Request('https://life.example/community/?utm_source=linkedin'), env, {});
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), 'https://life.example/community?utm_source=linkedin');

  const missing = await worker.fetch(new Request('https://life.example/does-not-exist'), env, {});
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /text\/html/);
  assert.match(await missing.text(), /<a href="\/">Go to Life Lab<\/a>/);

  const malformed = await worker.fetch(new Request('https://life.example/c/%E0%A4%A'), env, {});
  assert.equal(malformed.status, 404);
});

test('Worker responses carry security headers and a CSP that hashes the inline script', async () => {
  const html = '<html><head><title>Life</title><script>theme()</script></head></html>';
  const response = await worker.fetch(new Request('https://life.example/studio'), { ASSETS: assets(html) }, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.match(response.headers.get('content-security-policy'), /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);

  const api = await worker.fetch(new Request('https://life.example/api/community/state'), { ASSETS: assets() }, {});
  assert.equal(api.headers.get('x-frame-options'), 'DENY');
});

test('Worker serves the plain app shell for public pages when the database is down', async (t) => {
  t.mock.method(Pool.prototype, 'query', async () => { throw new Error('connection attempt failed'); });
  t.mock.method(Pool.prototype, 'end', async () => {});
  t.mock.method(console, 'error', () => {});
  const html = '<html><head><title>Life</title><meta property="og:title" content="Life Lab" /></head></html>';
  const response = await worker.fetch(new Request('https://life.example/c/some-slug'), {
    ASSETS: assets(html),
    DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
    BETTER_AUTH_SECRET: 'test-only-secret-at-least-thirty-two-characters',
  }, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<title>Life<\/title>/);
});

test('Worker rate limits auth attempts and community writes per client IP', async () => {
  const keys = [];
  const blocked = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  const env = { ASSETS: assets(), AUTH_RATE_LIMITER: blocked, WRITE_RATE_LIMITER: blocked };
  const post = (path) => new Request(`https://life.example${path}`, {
    method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.7', 'content-type': 'application/json' }, body: '{}',
  });

  for (const path of ['/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/community/creations']) {
    const response = await worker.fetch(post(path), env, { waitUntil() {} });
    assert.equal(response.status, 429, path);
    assert.equal((await response.json()).code, 'RATE_LIMITED');
  }
  assert.deepEqual(keys, ['203.0.113.7', '203.0.113.7', '203.0.113.7']);

  const read = await worker.fetch(new Request('https://life.example/api/community/feed'), env, { waitUntil() {} });
  assert.notEqual(read.status, 429, 'reads use their own limiter');
  const readBlocked = await worker.fetch(new Request('https://life.example/api/community/feed?limit=48'),
    { ...env, READ_RATE_LIMITER: blocked }, { waitUntil() {} });
  assert.equal(readBlocked.status, 429);
  const page = await worker.fetch(new Request('https://life.example/'), { ...env, READ_RATE_LIMITER: blocked }, { waitUntil() {} });
  assert.equal(page.status, 200, 'the app shell is never rate limited');
});

test('Worker fails open but logs when a rate-limit binding throws', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const failing = { limit: async () => { throw new Error('limiter down'); } };
  const allowed = await worker.fetch(new Request('https://life.example/api/community/creations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }), { ASSETS: assets(), WRITE_RATE_LIMITER: failing }, { waitUntil() {} });
  assert.equal(allowed.status, 503, 'a failing limiter must not block the request');
  assert.ok(logged.some((line) => /Rate limiter failed.*limiter down/.test(line)), logged.join('\n'));
});

test('Worker waits for asynchronous auth queries before ending its pool', async (t) => {
  let ended = false;
  let queried = false;
  t.mock.method(Pool.prototype, 'connect', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ended, false, 'auth must acquire its connection before cleanup');
    return { query: async () => { queried = true; return { rows: [] }; }, release() {} };
  });
  t.mock.method(Pool.prototype, 'end', async () => { ended = true; });
  const cleanup = [];
  const response = await worker.fetch(new Request('https://life.example/api/auth/sign-in/email', {
    method: 'POST', headers: { origin: 'https://life.example', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'missing@example.test', password: 'a-long-test-password' }),
  }), {
    DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
    BETTER_AUTH_SECRET: 'test-only-secret-at-least-thirty-two-characters',
  }, { waitUntil(promise) { cleanup.push(promise); } });
  assert.equal(response.status, 401);
  assert.equal(queried, true);
  await Promise.all(cleanup);
  assert.equal(ended, true);
});

test('Worker health check reports database reachability and storage pressure', async (t) => {
  t.mock.method(Pool.prototype, 'end', async () => {});
  t.mock.method(console, 'error', () => {});
  const env = {
    ASSETS: assets(),
    DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
    BETTER_AUTH_SECRET: 'test-only-secret-at-least-thirty-two-characters',
    DATABASE_STORAGE_LIMIT_BYTES: '1000',
  };
  const check = async () => {
    const response = await worker.fetch(new Request('https://life.example/api/health'), env, { waitUntil() {} });
    return { status: response.status, body: await response.json() };
  };

  const unconfigured = await worker.fetch(new Request('https://life.example/api/health'), { ASSETS: assets() }, { waitUntil() {} });
  assert.equal(unconfigured.status, 503);

  let bytes = '500';
  const query = t.mock.method(Pool.prototype, 'query', async () => ({ rows: [{ bytes }] }));
  assert.deepEqual(await check(), { status: 200, body: { ok: true, database: 'reachable', storage: 'ok', storageUsedPercent: 50 } });

  bytes = '700';
  assert.deepEqual(await check(), { status: 503, body: { ok: false, database: 'reachable', storage: 'high', storageUsedPercent: 70 } });

  query.mock.mockImplementation(async () => { throw new Error('connection attempt failed'); });
  assert.deepEqual(await check(), { status: 503, body: { ok: false, database: 'unreachable' } });
});

test('Worker caps sign-in attempts per IP in a shared PostgreSQL bucket', async (t) => {
  t.mock.method(Pool.prototype, 'end', async () => {});
  const buckets = new Map();
  t.mock.method(Pool.prototype, 'query', async (sql, params) => {
    if (/insert into public\.action_limits/.test(sql)) {
      const hits = (buckets.get(params[0]) || 0) + 1;
      buckets.set(params[0], hits);
      return { rows: [{ hits }] };
    }
    return { rows: [], rowCount: 0 };
  });
  const env = {
    ASSETS: assets(),
    DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
    BETTER_AUTH_SECRET: 'test-only-secret-at-least-thirty-two-characters',
  };
  const signIn = (ip) => worker.fetch(new Request('https://life.example/api/auth/sign-in/email', {
    method: 'POST',
    headers: { origin: 'https://life.example', 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ email: 'nobody@example.test', password: 'a-long-test-password' }),
  }), env, { waitUntil() {} });

  for (let attempt = 1; attempt <= 10; attempt += 1) assert.notEqual((await signIn('203.0.113.9')).status, 429, `attempt ${attempt}`);
  assert.equal((await signIn('203.0.113.9')).status, 429);
  assert.notEqual((await signIn('198.51.100.4')).status, 429, 'other visitors are unaffected');
  assert.equal(buckets.get('auth:203.0.113.9'), 11);
});
