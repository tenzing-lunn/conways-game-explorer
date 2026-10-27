// Repository seam for community data.
//
// The UI talks only to this async interface, never to the storage backend. The
// first implementation below is local-first (localStorage); a Supabase-backed
// implementation can satisfy the same contract later without UI changes. The
// methods are async on purpose: localStorage resolves immediately, but Supabase
// will not, and keeping the shape async now means the swap needs no `await`
// churn through the app.
import {
  COMMUNITY_STORAGE_KEY,
  assertCreationPublishReady,
  createCommunityState,
  createCreationDraft,
  createOwnerScopedSlug,
  createCreationVersion,
  createProfile,
  getTrendingCreations,
  incrementCloneCount,
  appendCreationVersion,
  archiveCreation as applyArchive,
  getCreationVersions,
  replaceCreation,
  restoreCreationVersion as applyRestoreVersion,
  loadCommunityState as readStoredState,
  normalizeCommunityState,
  saveCommunityState as writeStoredState,
  publishCreation as applyPublish,
  unpublishCreation as applyUnpublish,
  updateCreationMetadata as applyMetadataUpdate,
  toggleStar as applyStarToggle,
  cloneCreation as buildRemix,
} from './community.js';
import { migrateGuestProjects } from './guest-import.js';
import { LOCAL_DATABASE_UNAVAILABLE, localTransaction, safeIndexedDB, safeStorage } from './local-database.js';

// Backend selection (plan 2.5). Default is local; `supabase` is reserved for the
// Phase 2 implementation and throws a clear error until it exists and is
// configured, rather than silently falling back.
export function createCommunityRepository({ backend = 'local', ...options } = {}) {
  if (backend === 'local') return createLocalCommunityRepository(options);

  if (backend === 'postgres') {
    return createPostgresCommunityRepository(options);
  }

  if (backend === 'supabase') {
    return createSupabaseCommunityRepository(options);
  }

  throw new Error(`Unknown community backend "${backend}".`);
}

// Browser-side proxy for the Better Auth + PostgreSQL server API. It never
// receives a database credential: cookies authenticate same-origin requests and
// the Node server owns all PostgreSQL access.
export function createPostgresCommunityRepository({
  fetch: fetchImpl = globalThis.fetch,
  apiBase = '/api/community',
  authBase = '/api/auth',
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('PostgreSQL community backend requires fetch.');
  }

  let state = createCommunityState();
  const find = (creationId) => state.creations.find((creation) => creation.id === creationId) || null;
  const remember = (creation, { active = true } = {}) => {
    if (!creation) return null;
    state = {
      ...state,
      creations: replaceCreation(state.creations, creation),
      ...(active ? { activeCreationId: creation.id } : {}),
    };
    return creation;
  };
  const request = (base, path, options = {}) => requestJson(fetchImpl, `${stripTrailingSlash(base)}${path}`, options);
  const communityRequest = (path, options) => request(apiBase, path, options);
  const authRequest = (path, options) => request(authBase, path, options);
  const createCreation = async (input, { publish = false } = {}) => {
    if (publish) {
      assertCreationPublishReady({ ...input, currentVersion: { rle: input?.rle } });
    }
    const creation = await communityRequest('/creations', {
      method: 'POST',
      body: { ...input, publish },
    });
    return remember(creation);
  };

  return {
    backend: 'postgres',
    requiresAuth: true,

    getState() {
      return state;
    },

    async getAuthSession() {
      const data = await authRequest('/get-session');
      if (!data?.session || !data?.user) return null;
      return { ...data.session, user: data.user };
    },

    async getAuthUser() {
      return (await this.getAuthSession())?.user || null;
    },

    async signUpWithEmail({ name, email, password }) {
      return authRequest('/sign-up/email', {
        method: 'POST',
        body: {
          name,
          email,
          password,
        },
      });
    },

    async signInWithEmail({ email, password }) {
      return authRequest('/sign-in/email', {
        method: 'POST',
        body: { email, password, rememberMe: true },
      });
    },

    async signOut() {
      await authRequest('/sign-out', { method: 'POST', body: {} });
      state = createCommunityState();
      return null;
    },

    async deleteAccount(password) {
      await authRequest('/delete-user', { method: 'POST', body: { password } });
      state = createCommunityState();
      return true;
    },

    onAuthStateChange() {
      // Better Auth is cookie-based here. The client refreshes /get-session
      // immediately after an auth action and again on the next page load.
      return createNoopAuthSubscription();
    },

    async loadCommunityState() {
      state = await communityRequest('/state');
      return state;
    },

    async saveProfile(input) {
      const profile = await communityRequest('/profile', { method: 'POST', body: input });
      state = { ...state, profile };
      return profile;
    },

    startImport(input) {
      return communityRequest('/imports', { method: 'POST', body: input });
    },

    putImportManifest(importId, batch, input) {
      return communityRequest(`/imports/${encodeURIComponent(importId)}/manifest/${encodeURIComponent(batch)}`, {
        method: 'PUT', body: input,
      });
    },

    putImportVersion(importId, localVersionId, input) {
      return communityRequest(`/imports/${encodeURIComponent(importId)}/versions/${encodeURIComponent(localVersionId)}`, {
        method: 'PUT', body: input,
      });
    },

    async completeImport(importId) {
      const result = await communityRequest(`/imports/${encodeURIComponent(importId)}/complete`, {
        method: 'POST', body: {},
      });
      if (result?.creation) remember(result.creation);
      return result;
    },

    listPublicCreations(query = {}) {
      return communityRequest(`/feed?${new URLSearchParams(query)}`);
    },

    getPublicCreation(identifier) {
      return communityRequest(`/public/${encodeURIComponent(identifier)}`);
    },

    listPublicComments(identifier, cursor = '') {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      return communityRequest(`/public/${encodeURIComponent(identifier)}/comments${query}`);
    },

    getPublicProfile(username, cursor = '') {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      return communityRequest(`/profiles/${encodeURIComponent(username)}${query}`);
    },

    getPatternFavorites() { return communityRequest('/favorites'); },
    setPatternFavorite(patternId, saved) {
      return communityRequest('/favorites', { method: 'POST', body: { patternId, saved } });
    },
    createComment(creationId, body) {
      return communityRequest('/comments', { method: 'POST', body: { creationId, body } });
    },
    updateComment(commentId, body) {
      return communityRequest(`/comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', body: { body } });
    },
    deleteComment(commentId) {
      return communityRequest(`/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
    },
    reportCreation(creationId, reason) {
      return communityRequest('/reports', { method: 'POST', body: { creationId, reason } });
    },
    createRecoveryKey(password) {
      return communityRequest('/recovery-key', { method: 'POST', body: { password } });
    },
    recoverAccount(input) {
      return communityRequest('/recover', { method: 'POST', body: input });
    },

    createCreation,
    saveCreation: createCreation,

    async saveVersion(creationId, input) {
      return remember(await communityRequest(`/creations/${encodeURIComponent(creationId)}/versions`, {
        method: 'POST', body: input,
      }));
    },

    async updateCreationMetadata(creationId, patch) {
      return remember(await communityRequest(`/creations/${encodeURIComponent(creationId)}`, {
        method: 'PATCH', body: patch,
      }), { active: false });
    },

    async listVersions(creationId) {
      const creation = find(creationId);
      return creation?.versions?.slice().sort((left, right) => right.versionNumber - left.versionNumber) || [];
    },

    async loadVersion(creationId, versionId) {
      return (await this.listVersions(creationId)).find((version) => version.id === versionId) || null;
    },

    async restoreVersion(creationId, versionId) {
      return remember(await communityRequest(`/creations/${encodeURIComponent(creationId)}/restore`, {
        method: 'POST', body: { versionId },
      }));
    },

    async publishCreation(creationId) {
      return remember(await communityRequest(`/creations/${encodeURIComponent(creationId)}/publish`, {
        method: 'POST', body: {},
      }));
    },

    async unpublishCreation(creationId) {
      return remember(await communityRequest(`/creations/${encodeURIComponent(creationId)}/unpublish`, {
        method: 'POST', body: {},
      }), { active: false });
    },

    async archiveCreation(creationId) {
      const creation = await communityRequest(`/creations/${encodeURIComponent(creationId)}/archive`, {
        method: 'POST', body: {},
      });
      if (creation) {
        state = {
          ...state,
          creations: replaceCreation(state.creations, creation),
          activeCreationId: state.activeCreationId === creation.id ? null : state.activeCreationId,
        };
      }
      return creation;
    },

    async deleteCreation(creationId) {
      const result = await communityRequest(`/creations/${encodeURIComponent(creationId)}`, {
        method: 'DELETE',
      });
      if (!result?.deleted) return false;
      state = {
        ...state,
        creations: state.creations.filter((creation) => creation.id !== creationId),
        activeCreationId: state.activeCreationId === creationId ? null : state.activeCreationId,
      };
      return true;
    },

    async toggleStar(creationId) {
      return remember(await communityRequest(`/creations/${encodeURIComponent(creationId)}/star`, {
        method: 'POST', body: {},
      }), { active: false });
    },

    async cloneCreation(creationId) {
      const data = await communityRequest(`/creations/${encodeURIComponent(creationId)}/remix`, {
        method: 'POST', body: {},
      });
      const remix = data?.remix || data;
      if (data?.source) remember(data.source, { active: false });
      return remember(remix);
    },

    async listTrendingCreations({ limit = 20 } = {}) {
      // Public rows are previews without the board, so they never replace
      // the member's own projects in repository state.
      return communityRequest(`/trending?limit=${encodeURIComponent(limit)}`);
    },

    findCreation: find,
    setActiveCreation(creationId) {
      state = { ...state, activeCreationId: creationId };
      return state;
    },
  };
}

export async function migrateLocalState(localRepo, cloudRepo, options = {}) {
  if (!localRepo || !cloudRepo) {
    throw new Error('Both local and cloud community repositories are required.');
  }

  const localState = await localRepo.loadCommunityState();

  if (typeof cloudRepo.startImport === 'function'
    && typeof localRepo.captureImportSnapshot === 'function'
    && typeof localRepo.commitImportedSnapshot === 'function') {
    const profile = localState.profile ? await cloudRepo.saveProfile(toProfileInput(localState.profile)) : null;
    const staged = await migrateGuestProjects(localRepo, cloudRepo, options);
    return {
      profile,
      creationMap: Object.fromEntries(staged.results.map((result) => [result.mapping?.localProjectId, result.mapping?.cloudProjectId])),
      versionMaps: Object.fromEntries(staged.results.map((result) => [result.mapping?.localProjectId, result.mapping?.versionIds || {}])),
      migratedCreations: staged.migratedCreations,
      cleared: staged.results.every((result) => result.localRemoved),
      results: staged.results,
    };
  }
  const creationMap = {};
  const migratedCreations = [];

  if (!localState.profile) {
    return {
      profile: null,
      creationMap,
      migratedCreations,
      cleared: false,
    };
  }

  const profile = await cloudRepo.saveProfile(toProfileInput(localState.profile));

  for (const creation of localState.creations) {
    const saved = await cloudRepo.saveCreation(toCreationInput(creation));
    let migrated = saved;

    if (creation.visibility === 'public') {
      const published = await cloudRepo.publishCreation(saved.id);
      migrated = { ...saved, ...published };
    }

    creationMap[creation.id] = migrated.id;
    migratedCreations.push(migrated);
  }

  const canClearLocalState = typeof localRepo.clearCommunityState === 'function';
  if (canClearLocalState) {
    await localRepo.clearCommunityState();
  }

  return {
    profile,
    creationMap,
    migratedCreations,
    cleared: canClearLocalState,
  };
}

export function createSupabaseCommunityRepository({
  client: providedClient,
  supabaseUrl,
  supabaseAnonKey,
  createClient,
  now = () => new Date().toISOString(),
  createId = createUuid,
} = {}) {
  const client = resolveSupabaseClient({
    client: providedClient,
    supabaseUrl,
    supabaseAnonKey,
    createClient,
  });

  let state = createCommunityState();

  const find = (creationId) =>
    state.creations.find((creation) => creation.id === creationId) || null;

  const loadVersionRow = async (versionId) => {
    if (!versionId) return null;

    const { data, error } = await client
      .from('creation_versions')
      .select()
      .eq('id', versionId)
      .maybeSingle();

    assertSupabaseOk(error);
    return data;
  };

  const hydrateCreation = async (row, {
    version = null,
    versions = null,
    ownerName = null,
    starredBy = null,
  } = {}) => {
    const cached = find(row.id);
    const versionRow = version || cached?.currentVersion || await loadVersionRow(row.current_version_id);
    const resolvedOwnerName = ownerName
      || cached?.ownerName
      || (state.profile?.id === row.owner_id ? state.profile.displayName : 'Community Builder');

    return fromCreationRow(row, {
      version: versionRow,
      ownerName: resolvedOwnerName,
      starredBy: starredBy || cached?.starredBy || [],
      versions: versions || cached?.versions || null,
    });
  };

  const selectRowsBy = async (table, column, value) => {
    const { data, error } = await client
      .from(table)
      .select()
      .eq(column, value);

    assertSupabaseOk(error);
    return data || [];
  };

  const loadCurrentUserStarIds = async (userId) => {
    const rows = await selectRowsBy('stars', 'profile_id', userId);
    return new Set(rows.map((row) => row.creation_id).filter(Boolean));
  };
  const createCreation = async (input, { publish = false } = {}) => {
    if (!state.profile) {
      throw new Error('Create a Supabase profile before saving creations.');
    }
    if (publish) {
      assertCreationPublishReady({ ...input, currentVersion: { rle: input?.rle } });
    }

    const slug = createOwnerScopedSlug(
      input?.title,
      state.creations
        .filter((creation) => creation.ownerId === state.profile.id)
        .map((creation) => creation.slug),
    );
    const draft = createCreationDraft({
      ...input,
      id: createId(),
      slug,
      profile: state.profile,
      now,
    });
    const creationInput = publish ? applyPublish(draft, { now }) : draft;
    const version = { ...creationInput.currentVersion, id: createId(), versionNumber: 1 };
    const { data, error } = await client.rpc(
      'create_creation',
      toCreateCreationRpcPayload(creationInput, version),
    );
    assertSupabaseOk(error);

    const creation = await hydrateCreation(data, {
      version,
      versions: [version],
      ownerName: state.profile.displayName,
    });
    state = {
      ...state,
      creations: replaceCreation(state.creations, creation),
      activeCreationId: creation.id,
    };
    return creation;
  };

  return {
    backend: 'supabase',
    requiresAuth: true,

    getState() {
      return state;
    },

    async getAuthSession() {
      const { data, error } = await client.auth.getSession();
      assertSupabaseOk(error);
      return data?.session || null;
    },

    async getAuthUser() {
      const { data, error } = await client.auth.getUser();
      assertSupabaseOk(error);
      return data?.user || null;
    },

    async sendMagicLink(email, { redirectTo } = {}) {
      const payload = { email };
      if (redirectTo) {
        payload.options = { emailRedirectTo: redirectTo };
      }

      const { data, error } = await client.auth.signInWithOtp(payload);
      assertSupabaseOk(error);
      return data || null;
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      assertSupabaseOk(error);
      return null;
    },

    onAuthStateChange(callback) {
      return client.auth.onAuthStateChange(callback);
    },

    async loadCommunityState() {
      const user = await getSupabaseUser(client);
      const { data: profileRow, error: profileError } = await client
        .from('profiles')
        .select()
        .eq('id', user.id)
        .maybeSingle();
      assertSupabaseOk(profileError);

      if (!profileRow) {
        state = createCommunityState();
        return state;
      }

      const profile = fromProfileRow(profileRow, user.email);
      const starredCreationIds = await loadCurrentUserStarIds(user.id);
      const creationRows = await selectRowsBy('creations', 'owner_id', user.id);
      const creations = await Promise.all(creationRows.map(async (row) => {
        const versionRows = await selectRowsBy('creation_versions', 'creation_id', row.id);
        const versions = versionRows.map(fromVersionRow).sort(
          (left, right) => left.versionNumber - right.versionNumber,
        );
        return hydrateCreation(row, {
          version: versions.find((version) => version.id === row.current_version_id),
          versions,
          ownerName: profile.displayName,
          starredBy: starredCreationIds.has(row.id) ? [user.id] : [],
        });
      }));

      state = createCommunityState({
        profile,
        creations,
        activeCreationId: creations[0]?.id || null,
      });
      return state;
    },

    async saveProfile(input) {
      const user = await getSupabaseUser(client);
      const draft = createProfile({
        ...input,
        email: input?.email || user.email,
        now,
      });
      const payload = toProfileRow({ ...draft, id: user.id });
      const { data, error } = await client
        .from('profiles')
        .upsert(payload)
        .select()
        .single();

      assertSupabaseOk(error);

      const profile = fromProfileRow(data, input?.email || user.email);
      state = { ...state, profile };
      return profile;
    },

    createCreation,
    saveCreation: createCreation,

    async saveVersion(creationId, input) {
      const existing = find(creationId);
      if (!existing || existing.archivedAt) return null;
      const version = createCreationVersion(existing, input, { id: createId(), now });
      const { data, error } = await client.rpc('save_creation_version', {
        target_creation_id: creationId,
        new_version_id: version.id,
        version_rle: version.rle,
        version_width: version.width,
        version_height: version.height,
        version_generation: version.generation,
        version_population: version.population,
        version_rule: version.rule,
        version_settings: version.settings,
        requested_parent_version_id: version.parentVersionId,
      });
      assertSupabaseOk(error);
      const creation = await hydrateCreation(data, {
        version,
        versions: [...getCreationVersions(existing), version],
      });
      state = {
        ...state,
        creations: replaceCreation(state.creations, creation),
        activeCreationId: creation.id,
      };
      return creation;
    },

    async updateCreationMetadata(creationId, patch) {
      const existing = find(creationId);
      if (!existing) return null;
      const next = applyMetadataUpdate(existing, patch, { now });
      const { data, error } = await client
        .from('creations')
        .update(toCreationMetadataRow(next))
        .eq('id', creationId)
        .select()
        .single();
      assertSupabaseOk(error);
      const creation = await hydrateCreation(data);
      state = { ...state, creations: replaceCreation(state.creations, creation) };
      return creation;
    },

    async listVersions(creationId) {
      const rows = await selectRowsBy('creation_versions', 'creation_id', creationId);
      return rows.map(fromVersionRow).sort((left, right) => right.versionNumber - left.versionNumber);
    },

    async loadVersion(creationId, versionId) {
      const { data, error } = await client
        .from('creation_versions')
        .select()
        .eq('id', versionId)
        .maybeSingle();
      assertSupabaseOk(error);
      if (!data || data.creation_id !== creationId) return null;
      return fromVersionRow(data);
    },

    async restoreVersion(creationId, versionId) {
      const existing = find(creationId);
      if (!existing || existing.archivedAt) return null;
      const newVersionId = createId();
      const { data, error } = await client.rpc('restore_creation_version', {
        target_creation_id: creationId,
        source_version_id: versionId,
        new_version_id: newVersionId,
      });
      assertSupabaseOk(error);
      const restoredRow = await loadVersionRow(newVersionId);
      const version = fromVersionRow(restoredRow);
      const creation = await hydrateCreation(data, {
        version,
        versions: [...getCreationVersions(existing), version],
      });
      state = {
        ...state,
        creations: replaceCreation(state.creations, creation),
        activeCreationId: creation.id,
      };
      return creation;
    },

    async publishCreation(creationId) {
      const existing = find(creationId);
      if (!existing) return null;

      const published = applyPublish(existing, { now });
      const { data, error } = await client
        .from('creations')
        .update({
          visibility: 'public',
          published_at: published.publishedAt,
          preview_config: published.previewConfig,
          publish_readiness: published.publishReadiness,
          updated_at: published.updatedAt,
        })
        .eq('id', creationId)
        .select()
        .single();
      assertSupabaseOk(error);

      const creation = fromCreationRow(data, {
        version: existing.currentVersion,
        ownerName: existing.ownerName,
        starredBy: existing.starredBy,
      });
      state = {
        ...state,
        creations: replaceCreation(state.creations, creation),
        activeCreationId: creation.id,
      };
      return creation;
    },

    async unpublishCreation(creationId) {
      const existing = find(creationId);
      if (!existing) return null;
      const updatedAt = now();
      const { data, error } = await client
        .from('creations')
        .update({ visibility: 'private', published_at: null, updated_at: updatedAt })
        .eq('id', creationId)
        .select()
        .single();
      assertSupabaseOk(error);
      const creation = await hydrateCreation(data);
      state = { ...state, creations: replaceCreation(state.creations, creation) };
      return creation;
    },

    async archiveCreation(creationId) {
      const existing = find(creationId);
      if (!existing) return null;
      const archivedAt = now();
      const { data, error } = await client
        .from('creations')
        .update({
          visibility: 'private',
          published_at: null,
          archived_at: archivedAt,
          updated_at: archivedAt,
        })
        .eq('id', creationId)
        .select()
        .single();
      assertSupabaseOk(error);
      const creation = await hydrateCreation(data);
      state = {
        ...state,
        creations: replaceCreation(state.creations, creation),
        activeCreationId: state.activeCreationId === creationId ? null : state.activeCreationId,
      };
      return creation;
    },

    async deleteCreation(creationId) {
      if (!find(creationId)) return false;
      const { error } = await client.from('creations').delete().eq('id', creationId);
      assertSupabaseOk(error);
      state = {
        ...state,
        creations: state.creations.filter((creation) => creation.id !== creationId),
        activeCreationId: state.activeCreationId === creationId ? null : state.activeCreationId,
      };
      return true;
    },

    async toggleStar(creationId) {
      const target = find(creationId);
      if (!target) return null;

      const user = await getSupabaseUser(client);
      const starredBy = new Set(target.starredBy || []);
      const wasStarred = starredBy.has(user.id);

      if (wasStarred) {
        const { error } = await client
          .from('stars')
          .delete()
          .match({ profile_id: user.id, creation_id: creationId });
        assertSupabaseOk(error);
        starredBy.delete(user.id);
      } else {
        const { error } = await client
          .from('stars')
          .insert({ profile_id: user.id, creation_id: creationId });
        assertSupabaseOk(error);
        starredBy.add(user.id);
      }

      const creation = {
        ...target,
        starredBy: [...starredBy].sort(),
        starCount: Math.max(0, Number(target.starCount || 0) + (wasStarred ? -1 : 1)),
      };
      state = { ...state, creations: replaceCreation(state.creations, creation) };
      return creation;
    },

    async cloneCreation(creationId, profile = state.profile) {
      const source = find(creationId);
      if (!source || !profile) return null;

      const draft = buildRemix(source, {
        id: createId(),
        profile,
        now,
      });
      const { data, error } = await client.rpc('clone_creation', {
        source_id: creationId,
        new_slug: draft.slug,
        new_title: draft.title,
      });
      assertSupabaseOk(error);

      const hydrated = await hydrateCreation(data, {
        ownerName: profile.displayName,
      });
      const remix = withVersionSettings(hydrated, draft.currentVersion.settings);
      const countedSource = incrementCloneCount(source);
      state = {
        ...state,
        creations: replaceCreation(replaceCreation(state.creations, countedSource), remix),
        activeCreationId: remix.id,
      };
      return remix;
    },

    async listTrendingCreations({ limit = 20 } = {}) {
      const user = await getSupabaseUser(client);
      const starredCreationIds = await loadCurrentUserStarIds(user.id);
      const { data, error } = await client
        .from('trending_creations')
        .select()
        .limit(limit);
      assertSupabaseOk(error);

      const creations = await Promise.all((data || []).map((row) => hydrateCreation(row, {
        starredBy: starredCreationIds.has(row.id) ? [user.id] : [],
      })));
      state = {
        ...state,
        creations: creations.reduce(
          (nextCreations, creation) => replaceCreation(nextCreations, creation),
          state.creations,
        ),
      };
      return creations;
    },

    findCreation(creationId) {
      return find(creationId);
    },

    setActiveCreation(creationId) {
      state = { ...state, activeCreationId: creationId };
      return state;
    },
  };
}

function resolveSupabaseClient({ client, supabaseUrl, supabaseAnonKey, createClient } = {}) {
  if (client) return client;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Supabase backend is not configured. Provide a client or both supabaseUrl and supabaseAnonKey.',
    );
  }

  if (typeof createClient !== 'function') {
    throw new Error(
      'Supabase backend is not configured. Provide createClient to construct the Supabase client.',
    );
  }

  const createdClient = createClient(supabaseUrl, supabaseAnonKey);
  if (!createdClient) {
    throw new Error('Supabase backend is not configured. createClient did not return a client.');
  }

  return createdClient;
}

async function getSupabaseUser(client) {
  const { data, error } = await client.auth.getUser();
  assertSupabaseOk(error);

  if (!data?.user?.id) {
    throw new Error('Sign in before using the Supabase community backend.');
  }

  return data.user;
}

function assertSupabaseOk(error) {
  if (error) {
    throw new Error(error.message || 'Supabase request failed.');
  }
}

function toProfileInput(profile) {
  return {
    email: profile.email,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl || '',
    bio: profile.bio || '',
    githubUrl: profile.githubUrl || '',
    linkedinUrl: profile.linkedinUrl || '',
  };
}

function toCreationInput(creation) {
  const version = creation.currentVersion || {};

  return {
    title: creation.title,
    description: creation.description || '',
    tags: creation.tags || [],
    attribution: creation.attribution || '',
    tutorialReference: creation.tutorialReference || '',
    previewConfig: creation.previewConfig || {},
    publishReadiness: creation.publishReadiness || {},
    rle: version.rle,
    width: version.width,
    height: version.height,
    generation: version.generation,
    population: version.population,
    thumbnail: creation.thumbnail || '',
    settings: version.settings || null,
  };
}

function toProfileRow(profile) {
  return {
    id: profile.id,
    username: profile.username,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    bio: profile.bio,
    github_url: profile.githubUrl,
    linkedin_url: profile.linkedinUrl,
    is_public: true,
  };
}

function fromProfileRow(row, email = '') {
  return {
    id: row.id,
    email,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || '',
    bio: row.bio || '',
    githubUrl: row.github_url || '',
    linkedinUrl: row.linkedin_url || '',
    createdAt: row.created_at,
  };
}

function toCreateCreationRpcPayload(creation, version) {
  return {
    creation_id: creation.id,
    creation_slug: creation.slug,
    creation_title: creation.title,
    creation_description: creation.description,
    creation_tags: creation.tags,
    creation_attribution: creation.attribution || '',
    creation_tutorial_reference: creation.tutorialReference || '',
    creation_preview_config: creation.previewConfig || {},
    creation_publish_readiness: creation.publishReadiness || {},
    creation_visibility: creation.visibility,
    creation_published_at: creation.publishedAt,
    version_id: version.id,
    version_rle: version.rle,
    version_width: version.width,
    version_height: version.height,
    version_generation: version.generation,
    version_population: version.population,
    version_rule: version.rule,
    version_settings: version.settings,
  };
}

function toCreationMetadataRow(creation) {
  return {
    title: creation.title,
    description: creation.description,
    tags: creation.tags,
    attribution: creation.attribution || '',
    tutorial_reference: creation.tutorialReference || '',
    preview_config: creation.previewConfig || {},
    publish_readiness: creation.publishReadiness || {},
    updated_at: creation.updatedAt,
  };
}

function fromCreationRow(row, {
  version = null,
  versions = null,
  ownerName = 'Community Builder',
  starredBy = [],
} = {}) {
  const currentVersion = fromVersionRow(version);
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    canonicalUrl: row.visibility === 'public' ? `/c/${row.slug}` : null,
    description: row.description || '',
    attribution: row.attribution || '',
    tutorialReference: row.tutorial_reference || '',
    previewConfig: row.preview_config || {},
    publishReadiness: row.publish_readiness || {},
    visibility: row.visibility,
    ownerId: row.owner_id,
    ownerName,
    thumbnail: '',
    tags: row.tags || [],
    starCount: Number(row.star_count || 0),
    cloneCount: Number(row.clone_count || 0),
    viewCount: Number(row.view_count || 0),
    starredBy,
    remixedFromId: row.remixed_from_id || null,
    rootCreationId: row.root_creation_id || row.id,
    currentVersion,
    versions: versions || (currentVersion.id ? [currentVersion] : []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || null,
    archivedAt: row.archived_at || null,
  };
}

function fromVersionRow(row) {
  return {
    id: row?.id || null,
    creationId: row?.creation_id || row?.creationId || null,
    versionNumber: Number(row?.version_number || row?.versionNumber || 1),
    rle: row?.rle || 'x = 0, y = 0, rule = B3/S23\n!',
    width: Number(row?.width || 0),
    height: Number(row?.height || 0),
    generation: Number(row?.generation || 0),
    population: Number(row?.population || 0),
    rule: row?.rule || 'B3/S23',
    settings: row?.settings || null,
    parentVersionId: row?.parent_version_id || row?.parentVersionId || null,
    createdAt: row?.created_at || row?.createdAt,
  };
}

function withVersionSettings(creation, settings) {
  if (!settings) return creation;

  return {
    ...creation,
    currentVersion: {
      ...creation.currentVersion,
      settings,
    },
  };
}

function createUuid() {
  return globalThis.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Date.now()}`;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

async function requestJson(fetchImpl, url, { method = 'GET', body } = {}) {
  // Reads give up after 15 s so a hung request ends in an error state instead
  // of "Loading…" forever; writes (large imports on slow links) are left alone.
  const signal = method === 'GET' && typeof AbortSignal?.timeout === 'function'
    ? AbortSignal.timeout(15000)
    : undefined;
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error('Community request timed out.');
    throw error;
  }
  const text = await response.text();
  const data = text ? parseJsonResponse(text) : null;
  if (!response.ok) {
    throw Object.assign(new Error(data?.error || `Community request failed (${response.status}).`), {
      status: response.status,
      code: data?.code || null,
      issues: data?.issues || null,
      retryAfter: data?.retryAfter || null,
    });
  }
  return data;
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Community server returned invalid JSON.');
  }
}

export function createLocalCommunityRepository({
  storage = safeStorage(),
  key = COMMUNITY_STORAGE_KEY,
  now = () => new Date().toISOString(),
  indexedDB = safeIndexedDB(),
} = {}) {
  if (indexedDB) return createIndexedCommunityRepository({ storage, key, now, indexedDB });
  let state = readStoredState(storage, key);

  const withRevision = (creation, previous = null) => ({
    ...creation,
    localRevision: Number(previous?.localRevision || creation?.localRevision || 0) + 1,
    // An import key identifies one immutable captured revision. Reusing it
    // after a local edit makes the server (correctly) reject changed content.
    importKey: previous ? createUuid() : creation?.importKey || createUuid(),
  });

  const persist = () => writeStoredState(state, storage, key);
  const find = (creationId) =>
    state.creations.find((creation) => creation.id === creationId) || null;
  const createCreation = async (input, { publish = false } = {}) => {
    if (publish) {
      assertCreationPublishReady({ ...input, currentVersion: { rle: input?.rle } });
    }
    const ownedSlugs = state.creations
      .filter((creation) => creation.ownerId === state.profile?.id)
      .map((creation) => creation.slug);
    const slug = createOwnerScopedSlug(input?.title, ownedSlugs);
    const draft = createCreationDraft({ ...input, slug, profile: state.profile, now });
    const creation = withRevision(publish ? applyPublish(draft, { now }) : draft);
    state = {
      ...state,
      creations: replaceCreation(state.creations, creation),
      activeCreationId: creation.id,
    };
    persist();
    return creation;
  };

  return {
    backend: 'local',
    requiresAuth: false,

    // Synchronous snapshot of the in-memory cache, for rendering.
    getState() {
      return state;
    },

    async getAuthSession() {
      return null;
    },

    async getAuthUser() {
      return null;
    },

    async sendMagicLink() {
      throw new Error('Supabase backend is not configured for community auth.');
    },

    async signOut() {
      return null;
    },

    onAuthStateChange() {
      return createNoopAuthSubscription();
    },

    // Re-read the backend and refresh the cache.
    async loadCommunityState() {
      state = readStoredState(storage, key);
      return state;
    },

    async saveProfile(input) {
      const profile = createProfile({ ...input, now });
      state = { ...state, profile };
      persist();
      return profile;
    },

    createCreation,
    saveCreation: createCreation,

    async saveVersion(creationId, input) {
      const target = find(creationId);
      if (!target || target.archivedAt) return null;
      const creation = withRevision(appendCreationVersion(target, input, { now }), target);
      state = {
        ...state,
        creations: replaceCreation(state.creations, creation),
        activeCreationId: creation.id,
      };
      persist();
      return creation;
    },

    async updateCreationMetadata(creationId, patch) {
      const target = find(creationId);
      if (!target) return null;
      const creation = withRevision(applyMetadataUpdate(target, patch, { now }), target);
      state = { ...state, creations: replaceCreation(state.creations, creation) };
      persist();
      return creation;
    },

    async listVersions(creationId) {
      const target = find(creationId);
      return target ? getCreationVersions(target).slice().reverse() : [];
    },

    async loadVersion(creationId, versionId) {
      const target = find(creationId);
      const versions = target ? getCreationVersions(target) : [];
      return versions.find((version) => version.id === versionId) || null;
    },

    async restoreVersion(creationId, versionId) {
      const target = find(creationId);
      if (!target || target.archivedAt) return null;
      const creation = withRevision(applyRestoreVersion(target, versionId, { now }), target);
      if (!creation) return null;
      state = {
        ...state,
        creations: replaceCreation(state.creations, creation),
        activeCreationId: creation.id,
      };
      persist();
      return creation;
    },

    async publishCreation(creationId) {
      const target = find(creationId);
      if (!target) return null;

      const published = withRevision(applyPublish(target, { now }), target);
      state = {
        ...state,
        creations: replaceCreation(state.creations, published),
        activeCreationId: published.id,
      };
      persist();
      return published;
    },

    async unpublishCreation(creationId) {
      const target = find(creationId);
      if (!target) return null;
      const creation = withRevision(applyUnpublish(target, { now }), target);
      state = { ...state, creations: replaceCreation(state.creations, creation) };
      persist();
      return creation;
    },

    async archiveCreation(creationId) {
      const target = find(creationId);
      if (!target) return null;
      const creation = withRevision(applyArchive(target, { now }), target);
      state = {
        ...state,
        creations: replaceCreation(state.creations, creation),
        activeCreationId: state.activeCreationId === creationId ? null : state.activeCreationId,
      };
      persist();
      return creation;
    },

    async deleteCreation(creationId) {
      const existed = Boolean(find(creationId));
      if (!existed) return false;
      state = {
        ...state,
        creations: state.creations.filter((creation) => creation.id !== creationId),
        activeCreationId: state.activeCreationId === creationId ? null : state.activeCreationId,
      };
      persist();
      return true;
    },

    async toggleStar(creationId, profileId) {
      const target = find(creationId);
      if (!target) return null;

      const next = applyStarToggle(target, profileId);
      state = { ...state, creations: replaceCreation(state.creations, next) };
      persist();
      return next;
    },

    async cloneCreation(creationId, profile) {
      const source = find(creationId);
      if (!source) return null;

      const remix = buildRemix(source, { profile, now });
      const countedSource = incrementCloneCount(source);
      state = {
        ...state,
        creations: replaceCreation(replaceCreation(state.creations, countedSource), remix),
        activeCreationId: remix.id,
      };
      persist();
      return remix;
    },

    async listTrendingCreations() {
      return getTrendingCreations(state.creations, { now: () => new Date(now()) });
    },

    // Local UI concerns: looking up and tracking the open creation. These stay
    // synchronous because they never touch remote data.
    findCreation(creationId) {
      return find(creationId);
    },

    setActiveCreation(creationId) {
      state = { ...state, activeCreationId: creationId };
      persist();
      return state;
    },

    async clearCommunityState() {
      state = createCommunityState();
      persist();
      return state;
    },

    async captureImportSnapshot(creationId) {
      const creation = find(creationId);
      if (!creation) throw Object.assign(new Error('Local project was not found.'), { code: 'LOCAL_NOT_FOUND' });
      const normalized = creation.localRevision && creation.importKey
        ? creation
        : { ...creation, localRevision: Number(creation.localRevision || 1), importKey: creation.importKey || createUuid() };
      if (normalized !== creation) {
        state = { ...state, creations: replaceCreation(state.creations, normalized) };
        persist();
      }
      return structuredClone({ creation: normalized, revision: normalized.localRevision, importKey: normalized.importKey });
    },

    async commitImportedSnapshot(creationId, snapshot, mapping, { retain = false } = {}) {
      // In-memory/storage adapter used by non-browser contract tests.
      // Browsers use createIndexedCommunityRepository's atomic implementation.
      const latest = readStoredState(storage, key);
      const current = latest.creations.find((creation) => creation.id === creationId) || null;
      const removed = Boolean(current
        && current.localRevision === snapshot.revision
        && current.importKey === snapshot.importKey);

      const deleteLocal = !retain && removed;
      state = {
        ...latest,
        creations: deleteLocal
          ? latest.creations.filter((creation) => creation.id !== creationId)
          : latest.creations,
        activeCreationId: deleteLocal && latest.activeCreationId === creationId ? null : latest.activeCreationId,
        importMappings: { ...(latest.importMappings || {}), [creationId]: mapping },
      };
      persist();
      return { removed: deleteLocal, mapping };
    },
  };
}

function createIndexedCommunityRepository({ storage, key, now, indexedDB }) {
  let cache = readStoredState(storage, key);
  let selectedId;
  // When the database cannot be opened at all (site data blocked, private
  // modes), projects live in memory for this visit instead of failing.
  let unavailable = false;
  const apply = (current, action) => {
    const change = action(current);
    return { ...change, result: Promise.resolve(change.result).then((result) => ({ result, state: change.value || current })) };
  };
  const inMemory = (action) => apply(cache, action).result;
  const transact = (action) => (unavailable ? inMemory(action) : localTransaction(`${key}-projects-v2`, 'state', (stored) => {
    const current = stored
      ? { ...normalizeCommunityState(stored), importMappings: normalizeMappings(stored.importMappings) }
      : readStoredState(storage, key);
    return apply(current, action);
  }, { indexedDB }).catch((error) => {
    if (error?.code !== LOCAL_DATABASE_UNAVAILABLE) throw error;
    unavailable = true;
    return inMemory(action);
  })).then(({ result, state }) => {
    cache = { ...state, activeCreationId: selectedId === undefined ? state.activeCreationId : selectedId };
    // The old storage is only a one-time migration source, never a live mirror;
    // keep it while nothing has been written to the database.
    if (!unavailable) { try { storage.removeItem?.(key); } catch {} }
    return result;
  });
  const command = (method, args) => transact((current) => {
    let serialized = JSON.stringify(current);
    const memory = { getItem: () => serialized, setItem: (_key, value) => { serialized = value; } };
    const repository = createLocalCommunityRepository({ storage: memory, key, now, indexedDB: null });
    const result = repository[method](...args);
    const value = { ...repository.getState(), importMappings: current.importMappings || {} };
    return { value, result };
  });
  const api = {
    backend: 'local', requiresAuth: false,
    getState: () => cache,
    // True once projects are only kept in memory, so the UI can say so.
    isMemoryOnly: () => unavailable,
    findCreation: (id) => cache.creations.find((creation) => creation.id === id) || null,
    setActiveCreation(id) {
      selectedId = id;
      cache = { ...cache, activeCreationId: id };
      transact((current) => ({ value: { ...current, activeCreationId: id } })).catch(() => {});
      return cache;
    },
    loadCommunityState: () => transact((current) => ({ value: current, result: current })),
    getAuthSession: async () => null,
    getAuthUser: async () => null,
    signOut: async () => null,
    sendMagicLink: async () => { throw new Error('Supabase backend is not configured for community auth.'); },
    onAuthStateChange: createNoopAuthSubscription,
    commitImportedSnapshot(id, snapshot, mapping, { retain = false } = {}) {
      return transact((current) => {
        const project = current.creations.find((creation) => creation.id === id);
        const removed = Boolean(!retain && project && project.localRevision === snapshot.revision
          && project.importKey === snapshot.importKey
          && JSON.stringify(project) === JSON.stringify(snapshot.creation));
        return {
          value: { ...current,
            creations: removed ? current.creations.filter((creation) => creation.id !== id) : current.creations,
            activeCreationId: removed && current.activeCreationId === id ? null : current.activeCreationId,
            importMappings: { ...current.importMappings, [id]: mapping },
          },
          result: { removed, mapping },
        };
      });
    },
  };
  for (const method of ['saveProfile', 'createCreation', 'saveCreation', 'saveVersion',
    'updateCreationMetadata', 'listVersions', 'loadVersion', 'restoreVersion',
    'publishCreation', 'unpublishCreation', 'archiveCreation', 'deleteCreation',
    'toggleStar', 'cloneCreation', 'listTrendingCreations', 'clearCommunityState', 'captureImportSnapshot']) {
    api[method] = (...args) => command(method, args);
  }
  return api;
}

function normalizeMappings(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function createNoopAuthSubscription() {
  const subscription = {
    unsubscribe() {},
  };

  return {
    unsubscribe: subscription.unsubscribe,
    data: { subscription },
  };
}
