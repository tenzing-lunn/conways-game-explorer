import { expect, test } from '@playwright/test';

test.skip(process.env.T7_CLOUD_TEST !== '1', 'Requires the disposable PostgreSQL browser runner.');

const password = 'a-long-browser-test-password';
const seed = {
  title: 'T7 Signal Garden',
  description: 'A complete browser-to-database release verification fixture.',
  tags: ['test', 'logic'],
  rle: 'x = 40, y = 40, rule = B3/S23\nbob$2bo$3o!',
  width: 40,
  height: 40,
  population: 5,
  settings: { gridPreset: 'custom', width: 40, height: 40 },
  previewConfig: { mode: 'fit-pattern', fallbackText: 'Five-cell glider preview' },
};

async function json(response, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function createAccount(context, identity) {
  await json(await context.request.post('/api/auth/sign-up/email', {
    headers: { origin: new URL(context.pages()[0]?.url() || 'http://127.0.0.1').origin },
    data: { name: identity.name, email: identity.email, password },
  }));
  return json(await context.request.post('/api/community/profile', {
    data: { displayName: identity.name, username: identity.username, bio: identity.bio },
  }));
}

function sameOrigin(context, baseURL) {
  const origin = new URL(baseURL).origin;
  return {
    get: (path) => context.request.get(path),
    post: (path, options = {}) => context.request.post(path, {
      ...options, headers: { origin, ...options.headers },
    }),
  };
}

test('guest, two users, public snapshots, lineage, privacy, recovery and deletion complete', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = await browser.newContext({ baseURL, viewport: testInfo.project.name.startsWith('mobile')
    ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const second = await browser.newContext({ baseURL, viewport: testInfo.project.name.startsWith('mobile')
    ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const anonymous = await browser.newContext({ baseURL, viewport: testInfo.project.name.startsWith('mobile')
    ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  const errors = [];
  try {
    const pageA = await first.newPage();
    const pageB = await second.newPage();
    const publicPage = await anonymous.newPage();
    for (const page of [pageA, pageB, publicPage]) {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto('/');
    }
    const userA = await createAccount(first, { name: 'T7 Ada', email: `t7-a-${stamp}@example.test`,
      username: `t7-a-${stamp}`, bio: 'First release fixture user.' });
    const userB = await createAccount(second, { name: 'T7 Grace', email: `t7-b-${stamp}@example.test`,
      username: `t7-b-${stamp}`, bio: 'Second release fixture user.' });

    const firstApi = sameOrigin(first, baseURL);
    const secondApi = sameOrigin(second, baseURL);

    const creation = await json(await firstApi.post('/api/community/creations', { data: seed }), 201);
    const originalVersion = creation.currentVersion.id;
    const published = await json(await firstApi.post(`/api/community/creations/${creation.id}/publish`));
    expect(published.slug).toBe(creation.slug);

    await publicPage.goto(`/c/${published.slug}`);
    await expect(publicPage).toHaveTitle(/T7 Signal Garden by T7 Ada/);
    await expect(publicPage.locator('#community-detail')).toContainText('T7 Signal Garden');
    expect(await publicPage.locator('meta[property="og:url"]').getAttribute('content')).toBe(`${baseURL}/c/${published.slug}`);

    const privateEdit = await json(await firstApi.post(`/api/community/creations/${creation.id}/versions`, {
      data: { ...seed, rle: 'x = 40, y = 40, rule = B3/S23\n2o$2o!', population: 4,
        expectedCurrentVersionId: originalVersion },
    }), 201);
    const publicSnapshot = await json(await anonymous.request.get(`/api/community/public/${published.slug}`));
    expect(publicSnapshot.currentVersion.id).toBe(originalVersion);
    expect(publicSnapshot.currentVersion.population).toBe(5);
    expect((await secondApi.get(`/api/community/creations/${creation.id}/versions/${privateEdit.currentVersion.id}`)).status()).toBe(404);
    expect((await anonymous.request.get('/api/community/state')).status()).toBe(401);

    const starred = await json(await secondApi.post(`/api/community/creations/${creation.id}/star`));
    expect(starred.starredByViewer).toBe(true);
    const favorites = await json(await secondApi.get('/api/community/feed?favorites=true'));
    expect(favorites.creations.map((item) => item.id)).toContain(creation.id);
    const comment = await json(await secondApi.post('/api/community/comments', {
      data: { creationId: creation.id, body: 'Verified from the second account.' },
    }), 201);
    await json(await secondApi.post('/api/community/reports', {
      data: { creationId: creation.id, reason: 'T7 test report for moderation routing.' },
    }), 201);

    const cloned = await json(await secondApi.post(`/api/community/creations/${creation.id}/remix`), 201);
    expect(cloned.remix.remixedFromId).toBe(creation.id);
    const remix = await json(await secondApi.post(`/api/community/creations/${cloned.remix.id}/versions`, {
      data: { ...seed, title: cloned.remix.title, rle: 'x = 40, y = 40, rule = B3/S23\n3o!', population: 3,
        expectedCurrentVersionId: cloned.remix.currentVersion.id },
    }), 201);
    const publishedRemix = await json(await secondApi.post(`/api/community/creations/${remix.id}/publish`));
    const remixPublic = await json(await anonymous.request.get(`/api/community/public/${publishedRemix.slug}`));
    expect(remixPublic.source.id).toBe(creation.id);
    const sourcePublic = await json(await anonymous.request.get(`/api/community/public/${published.slug}`));
    expect(sourcePublic.remixes.map((item) => item.id)).toContain(remix.id);

    const profileA = await json(await anonymous.request.get(`/api/community/profiles/${userA.username}`));
    const profileB = await json(await anonymous.request.get(`/api/community/profiles/${userB.username}`));
    expect(profileA.creations.map((item) => item.id)).toContain(creation.id);
    expect(profileB.creations.map((item) => item.id)).toContain(remix.id);
    const comments = await json(await anonymous.request.get(`/api/community/public/${creation.id}/comments`));
    expect(comments.comments.map((item) => item.id)).toContain(comment.id);

    await json(await firstApi.post(`/api/community/creations/${creation.id}/unpublish`));
    expect((await anonymous.request.get(`/api/community/public/${published.slug}`)).status()).toBe(404);
    const republished = await json(await firstApi.post(`/api/community/creations/${creation.id}/publish`));
    expect(republished.slug).toBe(published.slug);
    expect(republished.currentVersion.id).toBe(privateEdit.currentVersion.id);

    const recovery = await json(await secondApi.post('/api/community/recovery-key', { data: { password } }));
    expect(recovery.recoveryKey || recovery.key).toBeTruthy();
    await json(await secondApi.post('/api/auth/delete-user', { data: { password } }));
    expect((await anonymous.request.get(`/api/community/public/${publishedRemix.slug}`)).status()).toBe(404);
    const retainedComments = await json(await anonymous.request.get(`/api/community/public/${creation.id}/comments`));
    expect(retainedComments.comments.find((item) => item.id === comment.id)?.authorName).toBe('Deleted account');

    await publicPage.goto(`/u/${userA.username}`);
    await expect(publicPage).toHaveTitle(/T7 Ada/);
    await expect(publicPage.locator('#community-grid')).toContainText('T7 Ada');
    await expect(publicPage.locator('#community-grid')).toContainText('T7 Signal Garden');
    await publicPage.screenshot({ path: `/private/tmp/life-${process.env.T8_LIVE_TEST === '1' ? 't8-live' : 't7'}-${testInfo.project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
    if (process.env.T8_LIVE_TEST === '1') {
      await json(await firstApi.post('/api/auth/delete-user', { data: { password } }));
      expect((await anonymous.request.get(`/api/community/public/${published.slug}`)).status()).toBe(404);
    }
  } finally {
    if (process.env.T8_LIVE_TEST === '1') {
      const origin = new URL(baseURL).origin;
      await Promise.allSettled([first, second].map((context) => context.request.post('/api/auth/delete-user', {
        headers: { origin }, data: { password },
      })));
    }
    await Promise.all([first.close(), second.close(), anonymous.close()]);
  }
});
