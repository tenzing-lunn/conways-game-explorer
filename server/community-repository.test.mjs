import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CREATION_VERSION_LIMIT,
  USER_CREATION_LIMIT,
  createPostgresCommunityRepository,
} from './community-repository.mjs';

test('PostgreSQL repository requires an authenticated pool and user', () => {
  assert.throws(
    () => createPostgresCommunityRepository(),
    /requires a pg Pool/,
  );

  assert.throws(
    () => createPostgresCommunityRepository({ pool: { connect() {} } }),
    /authenticated user id/,
  );
});

test('saveProfile uses parameterized SQL and the Better Auth user id', async () => {
  const pool = createRecordingPool();
  const repo = createPostgresCommunityRepository({ pool, userId: 'user-1' });

  const profile = await repo.saveProfile({ displayName: 'Ada Lovelace' });

  assert.equal(profile.id, 'user-1');
  assert.equal(profile.username, 'ada-lovelace');
  const authLookup = pool.queries[0];
  const profileWrite = pool.queries.find((query) => /insert into public\.profiles/.test(query.text));
  assert.match(authLookup.text, /where id = \$1/);
  assert.deepEqual(authLookup.values, ['user-1']);
  assert.match(profileWrite.text, /on conflict \(id\) do update/);
  assert.deepEqual(profileWrite.values.slice(0, 3), ['user-1', 'ada-lovelace', 'Ada Lovelace']);
  assert.doesNotMatch(profileWrite.text, /user-1|Ada Lovelace/);
});

test('saveProfile bounds display names, bios and profile URLs', async () => {
  const pool = createRecordingPool();
  const repo = createPostgresCommunityRepository({ pool, userId: 'user-1' });

  const profile = await repo.saveProfile({
    displayName: `Ada ${'x'.repeat(5000)}`,
    username: 'ada',
    bio: 'b'.repeat(5000),
    githubUrl: 'https://github.com/ada',
    linkedinUrl: 'javascript:alert(1)',
    avatarUrl: `https://example.com/${'a'.repeat(400)}`,
  });

  assert.equal(profile.displayName.length, 60);
  assert.equal(profile.bio.length, 500);
  assert.equal(profile.githubUrl, 'https://github.com/ada');
  assert.equal(profile.linkedinUrl, '');
  assert.equal(profile.avatarUrl, '');
});

test('saveProfile derives a free username when the display name is taken', async () => {
  const pool = createRecordingPool({ takenUsernames: ['ada-lovelace'] });
  const repo = createPostgresCommunityRepository({ pool, userId: 'user-1' });

  const profile = await repo.saveProfile({ displayName: 'Ada Lovelace' });

  assert.match(profile.username, /^ada-lovelace-[a-f0-9]{6}$/);
});

test('createCreation enforces the per-account project limit before writing', async () => {
  const pool = createTransactionPool({ creationCount: USER_CREATION_LIMIT });
  const repo = createPostgresCommunityRepository({ pool, userId: 'user-1' });

  await assert.rejects(
    repo.createCreation({ title: 'One too many', rle: 'x = 40, y = 40, rule = B3/S23\no!', width: 40, height: 40 }),
    (error) => error.status === 422 && error.code === 'LIMIT_REACHED',
  );
  assert.equal(pool.queries.some((query) => /insert into public\.creations/.test(query.text)), false);
  assert.ok(pool.queries.some((query) => query.text === 'rollback'));
});

test('createCreation ignores client lineage and does not scan every slug', async () => {
  const pool = createTransactionPool({ creationCount: 0 });
  const repo = createPostgresCommunityRepository({ pool, userId: 'user-1' });

  await repo.createCreation({
    title: 'Glider',
    rle: 'x = 40, y = 40, rule = B3/S23\no!',
    width: 40,
    height: 40,
    parentCreation: { id: 'victim-id', rootCreationId: 'victim-root' },
    remixedFromId: 'victim-id',
    rootCreationId: 'victim-root',
  });

  const insert = pool.queries.find((query) => /insert into public\.creations/.test(query.text));
  assert.equal(insert.values[11], null, 'remixed_from_id');
  assert.notEqual(insert.values[12], 'victim-root', 'root_creation_id');
  assert.equal(pool.queries.some((query) => /select slug from public\.creations/.test(query.text)), false);
});

test('saveVersion enforces the per-project version limit', async () => {
  const pool = createTransactionPool({ creationCount: 1, versionCount: CREATION_VERSION_LIMIT });
  const repo = createPostgresCommunityRepository({ pool, userId: 'user-1' });

  await assert.rejects(
    repo.saveVersion('creation-1', {
      rle: 'x = 40, y = 40, rule = B3/S23\no!', width: 40, height: 40, settings: { gridPreset: 'custom', width: 40, height: 40 },
    }),
    (error) => error.status === 422 && error.code === 'LIMIT_REACHED',
  );
  assert.equal(pool.queries.some((query) => /insert into public\.creation_versions/.test(query.text)), false);
});

function createTransactionPool({ creationCount = 0, versionCount = 0 } = {}) {
  const queries = [];
  const creationRow = {
    id: 'creation-1', owner_id: 'user-1', title: 'Glider', slug: 'glider-creation-1', visibility: 'private',
    version_id: 'version-1', version_number: 1, rle: 'x = 40, y = 40, rule = B3/S23\no!', width: 40, height: 40,
    generation: 0, population: 1, rule: 'B3/S23', settings: {},
  };
  const query = async (text, values = []) => {
    queries.push({ text, values });
    if (/from public\.profiles p join public\.auth_users/.test(text)) {
      return { rows: [{ id: 'user-1', username: 'ada', display_name: 'Ada', email: 'ada@example.com' }] };
    }
    if (/count\(\*\)::int as count from public\.creations/.test(text)) return { rows: [{ count: creationCount }] };
    if (/count\(\*\)::int as count, coalesce/.test(text)) return { rows: [{ count: versionCount, next_number: versionCount + 1 }] };
    if (/as bytes/.test(text)) return { rows: [{ bytes: 0 }] };
    if (/select c\.\*/.test(text)) return { rows: [{ ...creationRow, id: values[0] }], rowCount: 1 };
    if (/for update/.test(text)) return { rows: [{ id: values[0] }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { queries, query, async connect() { return { query, release() {} }; } };
}

function createRecordingPool({ takenUsernames = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(text, values = []) {
      queries.push({ text, values });
      if (/select 1 from public\.profiles where lower\(username\)/.test(text)) {
        const taken = takenUsernames.includes(values[0]);
        return { rows: taken ? [{}] : [], rowCount: taken ? 1 : 0 };
      }
      if (/from public\.auth_users/.test(text)) {
        return { rows: [{ id: 'user-1', email: 'ada@example.com', name: 'Ada Lovelace', image: null }] };
      }
      if (/insert into public\.profiles/.test(text)) {
        return { rows: [{
          id: values[0],
          username: values[1],
          display_name: values[2],
          avatar_url: values[3],
          bio: values[4],
          github_url: values[5],
          linkedin_url: values[6],
          created_at: '2026-07-11T00:00:00.000Z',
        }] };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      throw new Error('This test does not need a transaction.');
    },
  };
}
