import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalAppPath, contentSecurityPolicy, inlineScriptHashes, isAppRoute, securityHeaders } from './http-policy.mjs';

test('CSP allows exactly the inline theme script that index.html ships', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const inline = [...index.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(inline.length, 1, 'index.html should have one executable inline script');
  const expected = createHash('sha256').update(inline[0]).digest('base64');

  assert.deepEqual(inlineScriptHashes(index), [expected]);
  const csp = contentSecurityPolicy(index);
  assert.match(csp, new RegExp(`script-src 'self' 'sha256-${expected.replace(/[+/]/g, '\\$&')}'`));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
});

test('JSON data blocks and external scripts are not hashed', () => {
  const html = '<script id="c" type="application/json">{"a":1}</script><script type="module" src="/src/app.js"></script>';
  assert.deepEqual(inlineScriptHashes(html), []);
});

test('security headers include HSTS only when asked', () => {
  assert.equal(securityHeaders()['strict-transport-security'], undefined);
  assert.equal(securityHeaders({ hsts: true })['strict-transport-security'], 'max-age=31536000');
  assert.equal(securityHeaders()['x-frame-options'], 'DENY');
  assert.equal(securityHeaders()['x-content-type-options'], 'nosniff');
});

test('trailing-slash app routes have a canonical path; other paths do not', () => {
  assert.equal(canonicalAppPath('/studio/'), '/studio');
  assert.equal(canonicalAppPath('/community/'), '/community');
  assert.equal(canonicalAppPath('/community/favorites/'), '/community/favorites');
  assert.equal(canonicalAppPath('/c/glider-gun/'), '/c/glider-gun');
  assert.equal(canonicalAppPath('/'), null);
  assert.equal(canonicalAppPath('/studio'), null);
  assert.equal(canonicalAppPath('/nope/'), null);
  assert.equal(canonicalAppPath('//evil.example/'), null);
  assert.equal(isAppRoute('/u/ada'), true);
  assert.equal(isAppRoute('/Studio'), false);
});
