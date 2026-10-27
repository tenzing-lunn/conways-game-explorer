import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestHandler } from './server.mjs';

test('auth routes explain missing PostgreSQL configuration without exposing secrets', async () => {
  const writes = [];
  const response = {
    setHeader() {},
    writeHead(status, headers) {
      writes.push({ type: 'head', status, headers });
    },
    end(body) {
      writes.push({ type: 'body', body });
    },
  };
  const handler = createRequestHandler({
    env: {},
    auth: null,
    databasePool: null,
    authHandler: null,
  });

  await handler({ url: '/api/auth/get-session' }, response);

  assert.equal(writes[0].status, 503);
  assert.match(writes[1].body, /DATABASE_URL/);
  assert.doesNotMatch(writes[1].body, /postgres:\/\//);
});

test('community routes explain missing PostgreSQL configuration', async () => {
  const writes = [];
  const response = {
    setHeader() {},
    writeHead(status, headers) {
      writes.push({ type: 'head', status, headers });
    },
    end(body) {
      writes.push({ type: 'body', body });
    },
  };
  const handler = createRequestHandler({
    env: {},
    auth: null,
    databasePool: null,
    authHandler: null,
  });

  await handler({ url: '/api/community/state', method: 'GET', headers: {} }, response);

  assert.equal(writes[0].status, 503);
  assert.match(writes[1].body, /PostgreSQL community backend/);
});

test('PostgreSQL runtime config exposes only same-origin API paths', async () => {
  const handler = createRequestHandler({
    env: {
      DATABASE_URL: 'postgres://user:secret@example.test/life',
      BETTER_AUTH_SECRET: 'do-not-expose-this',
    },
    auth: null,
    databasePool: null,
    authHandler: null,
  });
  const writes = [];
  const response = {
    setHeader() {},
    writeHead(status, headers) { writes.push({ status, headers }); },
    end(body) { writes.push({ body }); },
  };

  await handler({ url: '/community-config.js', method: 'GET', headers: {} }, response);

  assert.match(writes[1].body, /"backend":"postgres"/);
  assert.doesNotMatch(writes[1].body, /postgres:\/\//);
  assert.doesNotMatch(writes[1].body, /do-not-expose-this/);
});

test('Hyperdrive runtime config exposes only same-origin API paths', async () => {
  const handler = createRequestHandler({
    env: {
      HYPERDRIVE: { connectionString: 'postgres://user:secret@example.test/life' },
      BETTER_AUTH_SECRET: 'do-not-expose-this',
    },
    auth: null,
    databasePool: null,
    authHandler: null,
  });
  const writes = [];
  const response = {
    setHeader() {},
    writeHead(status, headers) { writes.push({ status, headers }); },
    end(body) { writes.push({ body }); },
  };

  await handler({ url: '/community-config.js', method: 'GET', headers: {} }, response);

  assert.match(writes[1].body, /"backend":"postgres"/);
  assert.doesNotMatch(writes[1].body, /postgres:\/\//);
  assert.doesNotMatch(writes[1].body, /do-not-expose-this/);
});

test('Node server redirects trailing slashes, hides repo files and serves a styled 404', async () => {
  const handler = createRequestHandler({ env: {}, auth: null, databasePool: null, authHandler: null });
  const request = async (url) => {
    const writes = [];
    const headers = {};
    await handler({ url, method: 'GET', headers: {} }, {
      setHeader(name, value) { headers[name] = value; },
      writeHead(status, extra = {}) { writes.push({ status, headers: { ...headers, ...extra } }); },
      end(body) { writes.push({ body }); },
    });
    return { status: writes[0].status, headers: writes[0].headers, body: String(writes[1].body ?? '') };
  };

  const redirect = await request('/studio/?from=post');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, '/studio?from=post');

  for (const url of ['/.env', '/package.json', '/server/auth.mjs', '/.git/config', '/nope']) {
    const missing = await request(url);
    assert.equal(missing.status, 404, url);
    assert.match(missing.body, /Go to Life Lab/, url);
  }

  const shell = await request('/');
  assert.equal(shell.status, 200);
  assert.equal(shell.headers['x-frame-options'], 'DENY');
  assert.match(shell.headers['content-security-policy'], /script-src 'self' 'sha256-/);
  assert.equal(shell.headers['strict-transport-security'], undefined);
});

test('canonical app and public routes return the SPA shell on direct request', async () => {
  const handler = createRequestHandler({ env: {}, auth: null, databasePool: null, authHandler: null });
  for (const url of ['/studio', '/community/favorites', '/c/famous-glider', '/u/ada']) {
    const writes = [];
    await handler({ url, method: 'GET', headers: {} }, {
      setHeader() {},
      writeHead(status, headers) { writes.push({ status, headers }); },
      end(body) { writes.push({ body }); },
    });
    assert.equal(writes[0].status, 200, url);
    assert.match(String(writes[1].body), /id="community-panel"/, url);
  }
});
