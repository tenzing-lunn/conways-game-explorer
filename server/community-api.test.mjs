import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCommunityRequest } from './community-api.mjs';

test('community API declines non-community paths', async () => {
  const handled = await handleCommunityRequest({
    request: { url: '/index.html', method: 'GET', headers: {} },
    response: createResponse(),
  });

  assert.equal(handled, false);
});

test('community API requires its PostgreSQL and Better Auth dependencies', async () => {
  const response = createResponse();
  const handled = await handleCommunityRequest({
    request: { url: '/api/community/state', method: 'GET', headers: {} },
    response,
  });

  assert.equal(handled, true);
  assert.equal(response.status, 503);
  assert.match(response.body, /not configured/);
});

test('community API requires a Better Auth session', async () => {
  const response = createResponse();
  const handled = await handleCommunityRequest({
    request: { url: '/api/community/state', method: 'GET', headers: {} },
    response,
    pool: { connect() {} },
    auth: { api: { async getSession() { return null; } } },
  });

  assert.equal(handled, true);
  assert.equal(response.status, 401);
  assert.match(response.body, /Sign in/);
});

test('community API reports invalid JSON as a client error', async () => {
  const response = createResponse();
  const handled = await handleCommunityRequest({
    request: requestWithBody('/api/community/profile', '{', { 'content-type': 'application/json' }),
    response,
    pool: { connect() {}, async query() { return { rows: [{ hits: 1 }] }; } },
    auth: { api: { async getSession() { return { user: { id: 'user-1' } }; } } },
  });

  assert.equal(handled, true);
  assert.equal(response.status, 400);
  assert.match(response.body, /valid JSON/);
});

test('Node adapter compares mutations with the forwarded public origin', async () => {
  const response = createResponse();
  await handleCommunityRequest({
    request: requestWithBody('/api/community/profile', '{}', {
      host: 'internal:5173', 'x-forwarded-host': 'life.example', 'x-forwarded-proto': 'https',
      origin: 'https://life.example', 'content-type': 'application/json',
    }),
    response,
    pool: { connect() {} },
    auth: { api: { async getSession() { return null; } } },
  });
  assert.equal(response.status, 401);
  assert.equal(JSON.parse(response.body).code, 'AUTH_REQUIRED');
});

test('community API applies one write bucket per account across resources', async () => {
  const buckets = [];
  const pool = { connect() {}, async query(text, values) { buckets.push(values[0]); return { rows: [{ hits: 121 }] }; } };
  const auth = { api: { async getSession() { return { user: { id: 'user-1' } }; } } };
  for (const path of ['/api/community/profile', '/api/community/comments', '/api/community/creations']) {
    const response = createResponse();
    await handleCommunityRequest({ request: requestWithBody(path, '{}'), response, pool, auth });
    assert.equal(response.status, 429, path);
  }
  assert.deepEqual(buckets, ['user-1:writes', 'user-1:writes', 'user-1:writes']);
});

function createResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
}

function requestWithBody(url, body, headers = {}) {
  return {
    url,
    method: 'POST',
    headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    },
  };
}
