import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { injectPublicPageMetadata, matchPublicPage } from './public-page.mjs';

test('matches only canonical public creation and profile routes', () => {
  assert.deepEqual(matchPublicPage('/c/glider-clock'), { kind: 'creation', identifier: 'glider-clock' });
  assert.deepEqual(matchPublicPage('/u/ada'), { kind: 'profile', identifier: 'ada' });
  assert.equal(matchPublicPage('/studio'), null);
});

test('social metadata is escaped and replaces only the public page title', () => {
  const html = injectPublicPageMetadata('<html><head><title>Life</title></head></html>', { title: '<Draft>', description: 'Safe & public', url: 'https://test/c/a' });
  assert.match(html, /&lt;Draft&gt;/);
  assert.match(html, /Safe &amp; public/);
  assert.match(html, /property="og:title"/);
});

test('malformed percent escapes are not public pages', () => {
  assert.equal(matchPublicPage('/c/%E0%A4%A'), null);
  assert.equal(matchPublicPage('/u/%'), null);
  assert.deepEqual(matchPublicPage('/c/glider%20gun'), { kind: 'creation', identifier: 'glider gun' });
});

test('replacement patterns in user text are inserted literally', () => {
  const shell = '<html><head><title>Life</title><script>theme()</script></head><body></body></html>';
  const html = injectPublicPageMetadata(shell, { title: "Glider $' gun $& $`", description: "desc $' x", url: 'https://test/c/a' });
  assert.equal(html.match(/<script>/g).length, 1);
  assert.ok(html.includes("<title>Glider $' gun $&amp; $`</title>"));
  assert.ok(html.includes(`content="desc $' x"`));
});

test('public pages replace the static homepage social tags instead of duplicating them', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const html = injectPublicPageMetadata(index, {
    title: 'Snark by Ada · Life Lab', description: 'A stable reflector.', url: 'https://test/c/snark', image: 'https://test/src/og-image.png',
  });
  for (const tag of ['name="description"', 'property="og:title"', 'property="og:url"', 'property="og:image"', 'name="twitter:card"']) {
    assert.equal(html.split(tag).length - 1, 1, tag);
  }
  assert.ok(html.includes('property="og:url" content="https://test/c/snark"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(html.includes('<title>Snark by Ada · Life Lab</title>'));
  assert.ok(html.includes('id="life-runtime-config"'));
});
