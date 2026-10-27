import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBetterAuth,
  createBetterAuthHandler,
  createPostgresPool,
  getDatabaseConnectionString,
} from './auth.mjs';

test('PostgreSQL auth is opt-in when DATABASE_URL is absent', () => {
  const env = { NODE_ENV: 'test' };

  assert.equal(createPostgresPool({ env }), null);
  assert.equal(createBetterAuth({ env }), null);
  assert.equal(createBetterAuthHandler({ env }), null);
});

test('Better Auth fails clearly when a database is configured without a secret', () => {
  const env = {
    DATABASE_URL: 'postgres://example.invalid/life',
    NODE_ENV: 'test',
  };

  assert.throws(
    () => createBetterAuth({ env, database: { query() {} } }),
    /BETTER_AUTH_SECRET is missing/,
  );
});

test('PostgreSQL pool uses standard connection options for hosted Postgres', async () => {
  const pool = createPostgresPool({
    env: { DATABASE_URL: 'postgres://example.invalid/life' },
  });

  assert.equal(pool.options.options, undefined);
  await pool.end();
});

test('PostgreSQL pool accepts the Cloudflare Hyperdrive connection binding', async () => {
  const env = {
    HYPERDRIVE: { connectionString: 'postgres://example.invalid/life' },
  };
  const pool = createPostgresPool({ env });

  assert.equal(getDatabaseConnectionString(env), 'postgres://example.invalid/life');
  assert.equal(pool.options.connectionString, 'postgres://example.invalid/life');
  await pool.end();
});

test('Better Auth enables password accounts without an email delivery provider', () => {
  const env = {
    DATABASE_URL: 'postgres://example.invalid/life',
    BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-to-meet-minimum-length',
    BETTER_AUTH_URL: 'http://127.0.0.1:5173',
    NODE_ENV: 'test',
  };
  const database = {
    async connect() {
      return {
        async query() {
          return { rows: [] };
        },
        release() {},
      };
    },
    async query() {
      return { rows: [] };
    },
  };
  const auth = createBetterAuth({
    env,
    database,
  });

  assert.equal(typeof auth.handler, 'function');
  assert.equal(typeof auth.api.getSession, 'function');
  assert.deepEqual(auth.options.emailAndPassword, {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  });
  assert.equal(auth.options.user.deleteUser.enabled, true);
  assert.equal(auth.options.plugins.some((plugin) => plugin.id === 'magic-link'), false);
});

test('Better Auth rate limits sign-in attempts regardless of NODE_ENV', async () => {
  const fakeClient = { async query() { return { rows: [] }; }, release() {} };
  const auth = createBetterAuth({
    env: {
      DATABASE_URL: 'postgres://example.invalid/life',
      BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-to-meet-minimum-length',
      BETTER_AUTH_URL: 'http://127.0.0.1:5173',
    },
    database: { async connect() { return fakeClient; }, async query() { return { rows: [] }; } },
  });
  assert.equal(auth.options.rateLimit.enabled, true);
  const statuses = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const response = await auth.handler(new Request('http://127.0.0.1:5173/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173', 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ email: 'nobody@example.test', password: 'a-long-wrong-password' }),
    }));
    statuses.push(response.status);
  }
  assert.ok(statuses.slice(0, 10).every((status) => status !== 429), statuses.join(','));
  assert.equal(statuses[10], 429);
});
