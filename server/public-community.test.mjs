import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicCommunity } from './public-community.mjs';

const row = {
  id: '00000000-0000-4000-8000-000000000001', owner_id: 'user-1', owner_name: 'Ada', owner_username: 'ada',
  title: 'Glider', slug: 'glider-1', visibility: 'public', published_at: '2026-10-27T00:00:00.000Z',
  published_metadata: { title: 'Glider', description: 'A small spaceship.', tags: ['glider'], previewConfig: { version: 1, cells: [[1, 0]] } },
  version_id: 'v1', version_number: 1, width: 40, height: 40, generation: 0, population: 5, rule: 'B3/S23', settings: {},
};

function recordingPool() {
  const queries = [];
  return {
    queries,
    async query(text, values) {
      queries.push(text);
      const withRle = /v\.rle/.test(text);
      return { rows: values?.[1] === 'missing' ? [] : [{ ...row, ...(withRle ? { rle: 'x = 3, y = 3\nbo$2bo$3o!' } : {}) }] };
    },
  };
}

test('feed and profile rows carry the preview but not the published RLE', async () => {
  const pool = recordingPool();
  const feed = await createPublicCommunity({ pool }).list({ limit: 48 });

  assert.equal(feed.creations.length, 1);
  assert.equal(feed.creations[0].currentVersion.rle, undefined);
  assert.equal(feed.creations[0].currentVersion.population, 5);
  assert.deepEqual(feed.creations[0].previewConfig.cells, [[1, 0]]);
  assert.doesNotMatch(JSON.stringify(feed), /bo\$2bo/);
  assert.doesNotMatch(pool.queries[0], /v\.rle/);
});

test('the detail lookup returns the published RLE; its remix cards do not', async () => {
  const pool = recordingPool();
  const creation = await createPublicCommunity({ pool }).get('glider-1');

  assert.equal(creation.currentVersion.rle, 'x = 3, y = 3\nbo$2bo$3o!');
  assert.match(pool.queries[0], /v\.rle/);
  assert.equal(creation.remixes[0].currentVersion.rle, undefined);
});
