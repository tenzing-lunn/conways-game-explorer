import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMUNITY_STORAGE_KEY } from './community.js';
import * as communityRepositories from './community-repository.js';
import { runCommunityRepositoryContract } from './community-repository.contract.js';
import { injectCommunityConfig, renderCommunityConfigScript } from '../server.mjs';

const FIXED_NOW = () => '2026-06-29T12:00:00.000Z';
const { createLocalCommunityRepository, createCommunityRepository } = communityRepositories;

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

// The local repository must satisfy the backend-agnostic contract.
runCommunityRepositoryContract('local', () =>
  createLocalCommunityRepository({ storage: createMemoryStorage(), now: FIXED_NOW }),
);

// Local-backend specifics: persistence and the selection factory.
test('saveProfile persists to the underlying storage', async () => {
  const storage = createMemoryStorage();
  const repo = createLocalCommunityRepository({ storage, now: FIXED_NOW });

  await repo.saveProfile({ email: 'ada@example.com', displayName: 'Ada Lovelace' });

  const persisted = JSON.parse(storage.getItem(COMMUNITY_STORAGE_KEY));
  assert.equal(persisted.profile.email, 'ada@example.com');
});

test('a new repository instance reloads state persisted by a previous one', async () => {
  const storage = createMemoryStorage();
  const first = createLocalCommunityRepository({ storage, now: FIXED_NOW });
  await first.saveProfile({ email: 'user@example.com', displayName: 'User' });
  await first.saveCreation({ title: 'Build', rle: 'x = 1, y = 1, rule = B3/S23\no!' });

  const second = createLocalCommunityRepository({ storage });
  const reloaded = await second.loadCommunityState();

  assert.equal(reloaded.profile.email, 'user@example.com');
  assert.equal(reloaded.creations.length, 1);
});

test('an import from one tab cannot delete a newer edit saved by another tab', async () => {
  const storage = createMemoryStorage();
  const first = createLocalCommunityRepository({ storage, now: FIXED_NOW });
  const created = await first.saveCreation({ title: 'Build', rle: 'x = 1, y = 1, rule = B3/S23\no!', width: 1, height: 1, population: 1 });
  const captured = await first.captureImportSnapshot(created.id);
  const second = createLocalCommunityRepository({ storage, now: FIXED_NOW });
  const edited = await second.saveVersion(created.id, { rle: 'x = 2, y = 1, rule = B3/S23\n2o!', width: 2, height: 1, population: 2 });

  assert.notEqual(edited.importKey, captured.importKey);
  const committed = await first.commitImportedSnapshot(created.id, captured, { cloudProjectId: 'cloud-1' });
  assert.equal(committed.removed, false);

  const reloaded = createLocalCommunityRepository({ storage, now: FIXED_NOW });
  assert.equal(reloaded.findCreation(created.id).currentVersion.rle, 'x = 2, y = 1, rule = B3/S23\n2o!');
});

// Transaction aborts and concurrent-tab writes are exercised with real
// IndexedDB in tests/browser/r2-regressions.spec.js, not an IndexedDB stub.

test('createCommunityRepository selects the local backend by default', () => {
  const repo = createCommunityRepository({ storage: createMemoryStorage() });
  assert.equal(repo.backend, 'local');
  assert.equal(repo.requiresAuth, false);
  assert.equal(typeof repo.saveCreation, 'function');
});

test('local repository exposes auth-shaped no-op helpers', async () => {
  const repo = createLocalCommunityRepository({ storage: createMemoryStorage(), now: FIXED_NOW });

  assert.equal(await repo.getAuthSession(), null);
  assert.equal(await repo.getAuthUser(), null);
  assert.equal(await repo.signOut(), null);
  await assert.rejects(
    () => repo.sendMagicLink('ada@example.com'),
    /Supabase backend is not configured/,
  );

  const subscription = repo.onAuthStateChange(() => {});
  assert.equal(typeof subscription.unsubscribe, 'function');
  assert.equal(typeof subscription.data.subscription.unsubscribe, 'function');
});

test('createCommunityRepository requires complete Supabase config for the supabase backend', () => {
  assert.throws(
    () => createCommunityRepository({ backend: 'supabase' }),
    /Supabase backend is not configured/,
  );
  assert.throws(
    () => createCommunityRepository({
      backend: 'supabase',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key',
    }),
    /createClient/,
  );
});

test('createCommunityRepository rejects an unknown backend', () => {
  assert.throws(() => createCommunityRepository({ backend: 'nope' }), /Unknown community backend/);
});

test('renderCommunityConfigScript exposes only safe browser community config', () => {
  const script = renderCommunityConfigScript({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'do-not-leak',
  });

  assert.match(script, /window\.LIFE_LOGIC_COMMUNITY = /);
  assert.match(script, /"backend":"supabase"/);
  assert.match(script, /"supabaseUrl":"https:\/\/example\.supabase\.co"/);
  assert.match(script, /"supabaseAnonKey":"anon-key"/);
  assert.doesNotMatch(script, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(script, /do-not-leak/);
});

test('renderCommunityConfigScript selects the server-mediated PostgreSQL backend without credentials', () => {
  const script = renderCommunityConfigScript({
    DATABASE_URL: 'postgres://user:secret@example.test/life',
    BETTER_AUTH_SECRET: 'do-not-expose-this',
  });

  assert.match(script, /"backend":"postgres"/);
  assert.match(script, /"apiBase":"\/api\/community"/);
  assert.doesNotMatch(script, /postgres:\/\//);
  assert.doesNotMatch(script, /do-not-expose-this/);
});

test('renderCommunityConfigScript falls back to local config when Supabase credentials are incomplete', () => {
  assert.match(
    renderCommunityConfigScript({ SUPABASE_URL: 'https://example.supabase.co' }),
    /"backend":"local"/,
  );
});

test('injectCommunityConfig replaces the inline runtime script', () => {
  const html = '<script id="life-runtime-config" type="application/json">{"backend":"local"}</script>';
  const injected = injectCommunityConfig(html, {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
  });

  assert.match(injected, /"backend":"supabase"/);
  assert.match(injected, /"supabaseAnonKey":"anon-key"/);
  assert.match(injected, /type="application\/json"/);
});

test('migrateLocalState copies local profile and creations to cloud before clearing local state', async () => {
  const storage = createMemoryStorage();
  const localRepo = createLocalCommunityRepository({ storage, now: FIXED_NOW });
  const cloudRepo = createRecordingCloudRepo();
  await localRepo.saveProfile({ email: 'ada@example.com', displayName: 'Ada Lovelace' });
  const draft = await localRepo.saveCreation({
    title: 'Private Oscillator',
    description: 'Kept as a draft',
    tags: 'oscillator, private',
    rle: 'x = 1, y = 1, rule = B3/S23\no!',
    width: 1,
    height: 1,
    generation: 5,
    population: 1,
  });
  const publicBuild = await localRepo.saveCreation({
    title: 'Public Glider',
    description: 'Shared with everyone',
    tags: 'glider, public',
    rle: 'x = 1, y = 1, rule = B3/S23\no!',
    width: 1,
    height: 1,
    generation: 8,
    population: 1,
  }, { publish: true });

  const result = await communityRepositories.migrateLocalState(localRepo, cloudRepo);

  assert.deepEqual(cloudRepo.operations.map((operation) => operation.action), [
    'saveProfile',
    'saveCreation',
    'publishCreation',
    'saveCreation',
  ]);
  assert.deepEqual(cloudRepo.operations[0].input, {
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    avatarUrl: '',
    bio: '',
    githubUrl: '',
    linkedinUrl: '',
  });
  assert.deepEqual(
    pickCreationMigrationFields(cloudRepo.operations[1].input),
    {
      title: 'Public Glider',
      description: 'Shared with everyone',
      tags: ['glider', 'public'],
      rle: 'x = 1, y = 1, rule = B3/S23\no!',
      width: 1,
      height: 1,
      generation: 8,
      population: 1,
      thumbnail: '',
    },
  );
  assert.equal(cloudRepo.operations[1].input.settings.rule, 'B3/S23');
  assert.equal(cloudRepo.operations[2].creationId, 'cloud-creation-1');
  assert.deepEqual(
    pickCreationMigrationFields(cloudRepo.operations[3].input),
    {
      title: 'Private Oscillator',
      description: 'Kept as a draft',
      tags: ['oscillator', 'private'],
      rle: 'x = 1, y = 1, rule = B3/S23\no!',
      width: 1,
      height: 1,
      generation: 5,
      population: 1,
      thumbnail: '',
    },
  );
  assert.deepEqual(result.creationMap, {
    [publicBuild.id]: 'cloud-creation-1',
    [draft.id]: 'cloud-creation-2',
  });
  assert.equal(result.migratedCreations.length, 2);
  assert.equal(localRepo.getState().profile, null);
  assert.equal(localRepo.getState().creations.length, 0);
  assert.equal(JSON.parse(storage.getItem(COMMUNITY_STORAGE_KEY)).creations.length, 0);
});

test('migrateLocalState preserves local data when a cloud write fails', async () => {
  const localRepo = createLocalCommunityRepository({ storage: createMemoryStorage(), now: FIXED_NOW });
  const cloudRepo = createRecordingCloudRepo({ failOnCreation: 2 });
  await localRepo.saveProfile({ email: 'ada@example.com', displayName: 'Ada Lovelace' });
  await localRepo.saveCreation({ title: 'First', rle: 'x = 1, y = 1, rule = B3/S23\no!' });
  await localRepo.saveCreation({ title: 'Second', rle: 'x = 1, y = 1, rule = B3/S23\no!' });

  await assert.rejects(
    () => communityRepositories.migrateLocalState(localRepo, cloudRepo),
    /Cloud write failed/,
  );

  assert.equal(localRepo.getState().profile.email, 'ada@example.com');
  assert.equal(localRepo.getState().creations.length, 2);
});

test('local import commit removes only the exact captured revision and retains its cloud mapping', async () => {
  const repo = createLocalCommunityRepository({ storage: createMemoryStorage(), now: FIXED_NOW });
  const creation = await repo.saveCreation({ title: 'Concurrent draft', rle: 'x = 1, y = 1, rule = B3/S23\no!' });
  const snapshot = await repo.captureImportSnapshot(creation.id);
  await repo.saveVersion(creation.id, { rle: 'x = 2, y = 1, rule = B3/S23\n2o!', width: 2, height: 1, population: 2 });
  const mapping = { localProjectId: creation.id, cloudProjectId: 'cloud-1', versionIds: {} };
  const committed = await repo.commitImportedSnapshot(creation.id, snapshot, mapping);
  assert.equal(committed.removed, false);
  assert.ok(repo.findCreation(creation.id));
  assert.deepEqual(repo.getState().importMappings[creation.id], mapping);
});

function createRecordingCloudRepo({ failOnCreation = null } = {}) {
  const operations = [];
  let creationCount = 0;

  return {
    operations,
    async saveProfile(input) {
      operations.push({ action: 'saveProfile', input });
      return {
        id: 'cloud-profile',
        username: 'ada-lovelace',
        createdAt: FIXED_NOW(),
        ...input,
      };
    },
    async saveCreation(input) {
      creationCount += 1;
      if (creationCount === failOnCreation) {
        throw new Error('Cloud write failed');
      }

      const creation = {
        id: `cloud-creation-${creationCount}`,
        ownerId: 'cloud-profile',
        ownerName: 'Ada Lovelace',
        slug: `cloud-creation-${creationCount}`,
        visibility: 'private',
        currentVersion: {
          id: `cloud-version-${creationCount}`,
          rle: input.rle,
          width: input.width,
          height: input.height,
          generation: input.generation,
          population: input.population,
          rule: 'B3/S23',
          createdAt: FIXED_NOW(),
        },
        starCount: 0,
        cloneCount: 0,
        viewCount: 0,
        starredBy: [],
        remixedFromId: null,
        rootCreationId: `cloud-creation-${creationCount}`,
        createdAt: FIXED_NOW(),
        updatedAt: FIXED_NOW(),
        publishedAt: null,
        ...input,
      };
      operations.push({ action: 'saveCreation', input, creation });
      return creation;
    },
    async publishCreation(creationId) {
      operations.push({ action: 'publishCreation', creationId });
      return { id: creationId, visibility: 'public', publishedAt: FIXED_NOW() };
    },
  };
}

function pickCreationMigrationFields(input) {
  return {
    title: input.title,
    description: input.description,
    tags: input.tags,
    rle: input.rle,
    width: input.width,
    height: input.height,
    generation: input.generation,
    population: input.population,
    thumbnail: input.thumbnail,
  };
}

// A minimal IndexedDB stand-in: one object store, writes kept until the
// transaction completes. `fail` makes open() fire onerror (blocked site data).
function createFakeIndexedDB(records = new Map(), { fail = false } = {}) {
  return {
    records,
    open() {
      const request = { error: new Error('blocked') };
      setTimeout(() => {
        if (fail) { request.onerror?.(); return; }
        const pending = new Map();
        const tx = {
          aborted: false,
          abort() { tx.aborted = true; setTimeout(() => tx.onabort?.()); },
          objectStore: () => ({
            get(key) {
              const read = {};
              setTimeout(() => {
                read.result = structuredClone(records.get(key));
                read.onsuccess?.();
                setTimeout(() => {
                  if (tx.aborted) return;
                  for (const [name, value] of pending) records.set(name, value);
                  tx.oncomplete?.();
                });
              });
              return read;
            },
            put(value, key) { pending.set(key, structuredClone(value)); },
            delete(key) { pending.set(key, undefined); },
          }),
        };
        request.result = { transaction: () => tx, close() {} };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test('projects stay usable in memory when IndexedDB cannot be opened', async () => {
  const indexedDB = createFakeIndexedDB(new Map(), { fail: true });
  const repo = createLocalCommunityRepository({ storage: createMemoryStorage(), indexedDB, now: FIXED_NOW });

  const state = await repo.loadCommunityState();
  assert.deepEqual(state.creations, []);
  const saved = await repo.saveCreation({ title: 'Blocked storage', rle: 'x = 1, y = 1, rule = B3/S23\no!' });
  assert.equal(repo.getState().creations[0].id, saved.id);
  assert.equal(repo.isMemoryOnly(), true);
});

test('an open() that throws also falls back to memory', async () => {
  const indexedDB = { open() { throw new Error('denied'); } };
  const repo = createLocalCommunityRepository({ storage: createMemoryStorage(), indexedDB, now: FIXED_NOW });

  await repo.saveCreation({ title: 'Denied', rle: 'x = 1, y = 1, rule = B3/S23\no!' });
  assert.equal(repo.getState().creations.length, 1);
});

test('the local repository starts when reading localStorage throws', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    const repo = createLocalCommunityRepository({ indexedDB: null, now: FIXED_NOW });
    await repo.saveCreation({ title: 'No storage', rle: 'x = 1, y = 1, rule = B3/S23\no!' });
    assert.equal(repo.getState().creations.length, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('corrupted IndexedDB state is normalised like the localStorage path', async () => {
  for (const stored of ['oops', { creations: 'abc' }, { creations: [null, 5] }]) {
    const records = new Map([['state', stored]]);
    const repo = createLocalCommunityRepository({ storage: createMemoryStorage(), indexedDB: createFakeIndexedDB(records), now: FIXED_NOW });

    const state = await repo.loadCommunityState();
    assert.deepEqual(state.creations, []);
    assert.deepEqual(records.get('state').creations, [], 'the cleaned state is written back');
  }
  const records = new Map([['state', { creations: [null, { id: 'c1', title: 'Kept', versions: [null] }] }]]);
  const repo = createLocalCommunityRepository({ storage: createMemoryStorage(), indexedDB: createFakeIndexedDB(records), now: FIXED_NOW });
  const state = await repo.loadCommunityState();
  assert.deepEqual(state.creations.map((creation) => creation.title), ['Kept']);
  assert.deepEqual(state.creations[0].versions, []);
});
