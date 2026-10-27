import { randomBytes, randomUUID } from 'node:crypto';
import {
  archiveCreation as applyArchive,
  assertCreationPublishReady,
  createCommunityState,
  createCreationDraft,
  createCreationVersion,
  createOwnerScopedSlug,
  createProfile,
  cloneCreation as buildRemix,
  publishCreation as applyPublish,
  replaceCreation,
  restoreCreationVersion as applyRestoreVersion,
  unpublishCreation as applyUnpublish,
  updateCreationMetadata as applyMetadataUpdate,
} from '../src/community.js';
import { validateVersionInput } from './version-validation.mjs';
import { cleanBio, cleanDisplayName, cleanProfileUrl } from './profile-fields.mjs';

// Per-account ceilings. Sign-up has no email verification, so these keep one
// account from filling the shared database.
export const USER_CREATION_LIMIT = 200;
export const CREATION_VERSION_LIMIT = 500;
// 10 MB holds about 65 versions of the OTCA metapixel (150 KB each), 20 of a
// 1000×1000 random soup (0.47 MB), or 5 of the largest board the database
// accepts, a 2048×2048 soup (about 2 MB, importable from a guest project).
export const USER_STORAGE_BYTES_LIMIT = 10_000_000;

function limitReached(message) {
  return Object.assign(new Error(message), { status: 422, code: 'LIMIT_REACHED' });
}

// Every path that checks a per-account cap holds this lock for the rest of its
// transaction, so concurrent requests cannot each pass the check. Take it
// after any creation/import row locks to keep one lock order.
export function lockAccount(client, userId) {
  return client.query('select pg_advisory_xact_lock(hashtext($1))', [userId]);
}

export async function assertCreationAllowance(client, userId) {
  const result = await client.query('select count(*)::int as count from public.creations where owner_id = $1', [userId]);
  if (Number(result.rows[0]?.count || 0) >= USER_CREATION_LIMIT) {
    throw limitReached(`Accounts can keep up to ${USER_CREATION_LIMIT} projects. Delete one to save another.`);
  }
}

// Counts saved versions plus unfinished guest-import uploads.
export async function assertStorageAllowance(client, userId, addedBytes) {
  const result = await client.query(`select
      coalesce((select sum(octet_length(v.rle)) from public.creation_versions v
        join public.creations c on c.id = v.creation_id where c.owner_id = $1), 0)
    + coalesce((select sum(iv.total_bytes) from public.creation_import_versions iv
        join public.creation_imports i on i.id = iv.import_id
        where i.owner_id = $1 and i.status = 'uploading'), 0) as bytes`, [userId]);
  if (Number(result.rows[0]?.bytes || 0) + Number(addedBytes || 0) > USER_STORAGE_BYTES_LIMIT) {
    throw limitReached(`This account has reached its ${USER_STORAGE_BYTES_LIMIT / 1_000_000} MB storage limit. Delete old projects to save more.`);
  }
}

const rleBytes = (rle) => Buffer.byteLength(String(rle || ''), 'utf8');

export function createPostgresCommunityRepository({
  pool,
  userId,
  now = () => new Date().toISOString(),
  createId = randomUUID,
} = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('PostgreSQL community repository requires a pg Pool.');
  }
  if (!userId) throw new Error('PostgreSQL community repository requires an authenticated user id.');

  let state = createCommunityState();
  const find = (creationId) => state.creations.find((creation) => creation.id === creationId) || null;

  const loadCreation = async (client, creationId, { includeVersions = false, publicOnly = false } = {}) => {
    const visibilityClause = publicOnly
      ? 'and c.visibility = \'public\' and c.archived_at is null and c.moderation_status = \'visible\''
      : 'and (c.owner_id = $2 or (c.visibility = \'public\' and c.archived_at is null))';
    const params = [creationId, userId];
    const result = await client.query(`
      select c.*, p.display_name as owner_name, p.username as owner_username,
             exists(select 1 from public.stars s where s.creation_id=c.id and s.profile_id=$2) as viewer_starred,
             v.id as version_id, v.version_number, v.rle, v.width, v.height,
             v.generation, v.population, v.rule, v.settings, v.parent_version_id,
             v.created_at as version_created_at
        from public.creations c
        left join public.profiles p on p.id = c.owner_id
        left join public.creation_versions v on v.id = ${publicOnly ? 'c.published_version_id' : 'c.current_version_id'}
       where c.id = $1 ${visibilityClause}
    `, params);
    if (!result.rows[0]) return null;

    const row = result.rows[0];
    const versions = includeVersions
      ? (await client.query(`
          select * from public.creation_versions
           where creation_id = $1
           order by version_number asc
        `, [creationId])).rows.map(fromVersionRow)
      : null;
    return fromCreationRow(row, { versions, publicOnly, userId });
  };

  const loadOwnedCreation = (client, creationId, options = {}) => loadCreation(client, creationId, {
    ...options,
    publicOnly: false,
  }).then((creation) => creation && creation.ownerId === userId ? creation : null);

  const withTransaction = async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await callback(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  };

  // A username derived from a display name must not collide with another
  // member's, or the second "Ada Lovelace" could never finish account setup.
  const availableUsername = async (base) => {
    const clean = String(base || '').slice(0, 40).replace(/-+$/, '') || 'member';
    const taken = await pool.query('select 1 from public.profiles where lower(username) = $1 and id <> $2', [clean, userId]);
    if (!taken.rowCount && clean.length >= 3) return clean;
    return `${clean.slice(0, 33).replace(/-+$/, '')}-${randomBytes(3).toString('hex')}`;
  };

  const remember = (creation) => {
    if (!creation) return null;
    state = {
      ...state,
      creations: replaceCreation(state.creations, creation),
      activeCreationId: creation.id,
    };
    return creation;
  };

  const createCreation = async (input, { publish = false } = {}) => {
    if (!state.profile) {
      const profile = await pool.query(
        'select p.*, u.email from public.profiles p join public.auth_users u on u.id = p.id where p.id = $1',
        [userId],
      );
      if (!profile.rows[0]) throw new Error('Saving requires a profile. Sign in again to finish account setup.');
      state = { ...state, profile: fromProfileRow(profile.rows[0]) };
    }
    if (publish) {
      assertCreationPublishReady({ ...input, currentVersion: { rle: input?.rle } });
    }
    const id = createId();
    // Lineage is only recorded by the remix and import routes, never taken
    // from a create body.
    const { parentCreation, remixedFromId, rootCreationId, ...fields } = input || {};
    // The UUID suffix already makes the slug unique.
    const slug = `${createOwnerScopedSlug(fields.title, []).slice(0, 95)}-${id}`;
    const draft = createCreationDraft({ ...fields, id, slug, profile: state.profile, now });
    const creation = publish ? applyPublish(draft, { now }) : draft;
    const version = validateVersionInput({ ...creation.currentVersion, id: createId() }, { publication: publish });

    return remember(await withTransaction(async (client) => {
      await lockAccount(client, userId);
      if (fields.importKey) {
        const imported = await client.query('select id from public.creations where owner_id = $1 and import_key = $2',
          [userId, String(fields.importKey).slice(0, 200)]);
        if (imported.rows[0]) return loadOwnedCreation(client, imported.rows[0].id, { includeVersions: true });
      }
      await assertCreationAllowance(client, userId);
      await assertStorageAllowance(client, userId, rleBytes(version.rle));
      await client.query(`
        insert into public.creations (
          id, owner_id, slug, title, description, tags, attribution,
          tutorial_reference, preview_config, publish_readiness, visibility,
          remixed_from_id, root_creation_id, published_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `, [
        id, userId, creation.slug, creation.title, creation.description,
        creation.tags, creation.attribution, creation.tutorialReference,
        creation.previewConfig, {}, 'private', creation.remixedFromId,
        creation.rootCreationId, null,
      ]);
      await client.query(`
        insert into public.creation_versions (
          id, creation_id, version_number, rle, width, height, generation,
          population, rule, settings
        ) values ($1,$2,1,$3,$4,$5,$6,$7,$8,$9)
      `, [version.id, id, version.rle, version.width, version.height,
        version.generation, version.population, version.rule, version.settings]);
      await client.query(`
        update public.creations
           set current_version_id = $1, visibility = $2, published_at = $3,
               publish_readiness = $4, published_version_id = $7, published_metadata = $8
         where id = $5 and owner_id = $6
      `, [version.id, creation.visibility, creation.publishedAt,
        creation.publishReadiness, id, userId,
        publish ? version.id : null,
        publish ? publicationMetadata(creation) : null]);
      if (fields.importKey) await client.query('update public.creations set import_key = $1 where id = $2',
        [String(fields.importKey).slice(0, 200), id]);
      return loadOwnedCreation(client, id, { includeVersions: true });
    }));
  };

  return {
    backend: 'postgres',
    requiresAuth: true,

    getState() {
      return state;
    },

    async loadCommunityState() {
      const client = await pool.connect();
      try {
        const profileResult = await client.query(
          'select p.*, u.email from public.profiles p join public.auth_users u on u.id = p.id where p.id = $1',
          [userId],
        );
        const profile = profileResult.rows[0] ? fromProfileRow(profileResult.rows[0]) : null;
        if (!profile) {
          state = createCommunityState();
          return state;
        }

        const creationsResult = await client.query(
          'select id from public.creations where owner_id = $1 order by updated_at desc',
          [userId],
        );
        const creations = [];
        for (const row of creationsResult.rows) {
          const creation = await loadOwnedCreation(client, row.id, { includeVersions: true });
          if (creation) creations.push(creation);
        }
        state = createCommunityState({ profile, creations, activeCreationId: creations[0]?.id || null });
        return state;
      } finally {
        client.release();
      }
    },

    async saveProfile(input) {
      const userResult = await pool.query(
        `select id,email,name,image,
          (select username from public.profiles where profiles.id=auth_users.id) as username
          from public.auth_users where id = $1`,
        [userId],
      );
      if (!userResult.rows[0]) throw new Error('Authenticated Better Auth user was not found.');
      const user = userResult.rows[0];
      const draft = createProfile({
        email: input?.email || user.email,
        displayName: cleanDisplayName(input?.displayName) || cleanDisplayName(user.name),
        avatarUrl: cleanProfileUrl(input?.avatarUrl || user.image),
        bio: cleanBio(input?.bio),
        githubUrl: cleanProfileUrl(input?.githubUrl),
        linkedinUrl: cleanProfileUrl(input?.linkedinUrl),
        now,
      });
      const requestedUsername = String(input?.username || user.username || await availableUsername(draft.username))
        .trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedUsername) || requestedUsername.length < 3 || requestedUsername.length > 40) {
        throw Object.assign(new Error('Username must use 3 to 40 lowercase letters, numbers, or single hyphens.'), {
          status: 422, code: 'INVALID_USERNAME',
        });
      }
      const profile = { ...draft, id: userId, username: requestedUsername };
      const result = await pool.query(`
        insert into public.profiles (
          id, username, display_name, avatar_url, bio, github_url, linkedin_url
        ) values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (id) do update set
          username = excluded.username,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          bio = excluded.bio,
          github_url = excluded.github_url,
          linkedin_url = excluded.linkedin_url
        returning *
      `, [profile.id, profile.username, profile.displayName, profile.avatarUrl,
        profile.bio, profile.githubUrl, profile.linkedinUrl]);
      state = { ...state, profile: fromProfileRow({ ...result.rows[0], email: user.email }) };
      return state.profile;
    },

    createCreation,
    saveCreation: createCreation,

    async saveVersion(creationId, input) {
      return remember(await withTransaction(async (client) => {
        await client.query('select id from public.creations where id=$1 and owner_id=$2 for update', [creationId, userId]);
        const existing = await loadOwnedCreation(client, creationId, { includeVersions: true });
        if (!existing || existing.archivedAt) return null;
        if (input?.expectedCurrentVersionId && input.expectedCurrentVersionId !== existing.currentVersion?.id) {
          throw Object.assign(new Error('This project changed in another session. Reload before saving.'), {
            status: 409, code: 'STALE_VERSION',
          });
        }
        const version = normalizeVersionForDatabase(createCreationVersion(existing, input, {
          id: createId(),
          now,
        }));
        return appendVersionRows(client, existing, version, userId);
      }));
    },

    async updateCreationMetadata(creationId, patch) {
      return remember(await withTransaction(async (client) => {
        const existing = await loadOwnedCreation(client, creationId, { includeVersions: true });
        if (!existing) return null;
        const next = applyMetadataUpdate(existing, patch, { now });
        await client.query(`
          update public.creations set title = $1, description = $2, tags = $3,
            attribution = $4, tutorial_reference = $5, preview_config = $6,
            publish_readiness = $7, updated_at = $8
           where id = $9 and owner_id = $10
        `, [next.title, next.description, next.tags, next.attribution,
          next.tutorialReference, next.previewConfig, next.publishReadiness,
          next.updatedAt, creationId, userId]);
        return loadOwnedCreation(client, creationId, { includeVersions: true });
      }));
    },

    async listVersions(creationId) {
      const result = await pool.query(`
        select v.* from public.creation_versions v
        join public.creations c on c.id = v.creation_id
        where v.creation_id = $1 and c.owner_id = $2
        order by v.version_number desc
      `, [creationId, userId]);
      return result.rows.map(fromVersionRow);
    },

    async loadVersion(creationId, versionId) {
      const result = await pool.query(`
        select v.* from public.creation_versions v
        join public.creations c on c.id = v.creation_id
        where v.creation_id = $1 and v.id = $2
          and (c.owner_id = $3 or (c.visibility = 'public' and c.archived_at is null
            and c.moderation_status='visible' and c.published_version_id=v.id))
      `, [creationId, versionId, userId]);
      return result.rows[0] ? fromVersionRow(result.rows[0]) : null;
    },

    async restoreVersion(creationId, versionId) {
      return remember(await withTransaction(async (client) => {
        await client.query('select id from public.creations where id=$1 and owner_id=$2 for update', [creationId, userId]);
        const existing = await loadOwnedCreation(client, creationId, { includeVersions: true });
        if (!existing || existing.archivedAt) return null;
        const restored = applyRestoreVersion(existing, versionId, { id: createId(), now });
        if (!restored) return null;
        const version = normalizeVersionForDatabase(restored.currentVersion);
        return appendVersionRows(client, existing, version, userId);
      }));
    },

    async publishCreation(creationId) {
      return remember(await withTransaction(async (client) => {
        await client.query('select id from public.creations where id=$1 and owner_id=$2 for update', [creationId, userId]);
        const existing = await loadOwnedCreation(client, creationId, { includeVersions: true });
        if (!existing || existing.archivedAt) return null;
        validateVersionInput(existing.currentVersion, { publication: true });
        const next = applyPublish(existing, { now });
        const metadata = publicationMetadata(next);
        await client.query(`update public.creations set visibility='public', published_at=$1,
          published_version_id=current_version_id, published_metadata=$2, preview_config=$3,
          publish_readiness=$4 where id=$5 and owner_id=$6`,
        [next.publishedAt, metadata, next.previewConfig, next.publishReadiness, creationId, userId]);
        return loadOwnedCreation(client, creationId, { includeVersions: true });
      }));
    },

    async unpublishCreation(creationId) {
      return remember(await updateLifecycle(
        creationId,
        (creation) => applyUnpublish(creation, { now }),
        { rejectArchived: true },
      ));
    },

    async archiveCreation(creationId) {
      return remember(await updateLifecycle(creationId, (creation) => applyArchive(creation, { now })));
    },

    async deleteCreation(creationId) {
      const result = await pool.query(
        'delete from public.creations where id = $1 and owner_id = $2 returning id',
        [creationId, userId],
      );
      if (!result.rowCount) return false;
      state = {
        ...state,
        creations: state.creations.filter((creation) => creation.id !== creationId),
        activeCreationId: state.activeCreationId === creationId ? null : state.activeCreationId,
      };
      return true;
    },

    async toggleStar(creationId) {
      return remember(await withTransaction(async (client) => {
        const target = await loadCreation(client, creationId, { publicOnly: true });
        if (!target) return null;
        const existing = await client.query(
          'select 1 from public.stars where profile_id = $1 and creation_id = $2',
          [userId, creationId],
        );
        if (existing.rowCount) {
          await client.query('delete from public.stars where profile_id = $1 and creation_id = $2', [userId, creationId]);
        } else {
          await client.query('insert into public.stars(profile_id, creation_id) values ($1,$2)', [userId, creationId]);
        }
        const updated = await loadCreation(client, creationId, { publicOnly: true });
        return {
          ...updated,
          starredBy: existing.rowCount ? [] : [userId],
        };
      }));
    },

    async cloneCreation(creationId) {
      if (!state.profile) await this.loadCommunityState();
      if (!state.profile) return null;
      const cloned = await withTransaction(async (client) => {
        const source = await loadCreation(client, creationId, { publicOnly: true });
        if (!source) return null;
        await lockAccount(client, userId);
        await assertCreationAllowance(client, userId);
        await assertStorageAllowance(client, userId, rleBytes(source.currentVersion?.rle));
        const remixId = createId();
        const draft = buildRemix(source, { id: remixId, profile: state.profile, now });
        draft.slug = `${createOwnerScopedSlug(draft.title, []).slice(0, 95)}-${remixId}`;
        const version = normalizeVersionForDatabase({ ...draft.currentVersion, id: createId() });
        await client.query(`
          insert into public.creations (
            id, owner_id, slug, title, description, tags, attribution,
            tutorial_reference, preview_config, publish_readiness,
            visibility, remixed_from_id, root_creation_id
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'private',$11,$12)
        `, [remixId, userId, draft.slug, draft.title, draft.description, draft.tags,
          draft.attribution, draft.tutorialReference, draft.previewConfig,
          draft.publishReadiness, source.id, source.rootCreationId || source.id]);
        await client.query(`
          insert into public.creation_versions (
            id, creation_id, version_number, rle, width, height, generation,
            population, rule, settings, parent_version_id
          ) values ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10)
        `, [version.id, remixId, version.rle, version.width, version.height,
          version.generation, version.population, version.rule, version.settings,
          null]);
        await client.query('update public.creations set current_version_id = $1 where id = $2', [version.id, remixId]);
        await client.query('insert into public.remixes(source_creation_id, remix_creation_id) values ($1,$2)', [source.id, remixId]);
        return {
          remix: await loadOwnedCreation(client, remixId, { includeVersions: true }),
          source: await loadCreation(client, source.id, { publicOnly: true }),
        };
      });
      if (!cloned) return null;
      if (cloned.source) {
        state = {
          ...state,
          creations: replaceCreation(state.creations, cloned.source),
        };
      }
      return remember(cloned.remix);
    },

    async listTrendingCreations({ limit = 20 } = {}) {
      const result = await pool.query(
        'select id from public.trending_creations limit $1',
        [Math.max(1, Math.min(100, Number(limit) || 20))],
      );
      const client = await pool.connect();
      try {
        const creations = [];
        for (const row of result.rows) {
          const creation = await loadCreation(client, row.id, { publicOnly: true });
          if (creation) creations.push(creation);
        }
        state = {
          ...state,
          creations: creations.reduce((all, creation) => replaceCreation(all, creation), state.creations),
        };
        return creations;
      } finally {
        client.release();
      }
    },

    findCreation: find,
    setActiveCreation(creationId) {
      state = { ...state, activeCreationId: creationId };
      return state;
    },
  };

  async function updateLifecycle(creationId, transform, { rejectArchived = false } = {}) {
    return withTransaction(async (client) => {
      const existing = await loadOwnedCreation(client, creationId, { includeVersions: true });
      if (!existing || (rejectArchived && existing.archivedAt)) return null;
      const next = transform(existing);
      await client.query(`
        update public.creations set visibility = $1, published_at = $2,
          archived_at = $3, updated_at = $4, publish_readiness = $5,
          preview_config = $6
         where id = $7 and owner_id = $8
      `, [next.visibility, next.publishedAt, next.archivedAt, next.updatedAt,
        next.publishReadiness, next.previewConfig, creationId, userId]);
      return loadOwnedCreation(client, creationId, { includeVersions: true });
    });
  }
}

async function appendVersionRows(client, existing, version, userId) {
  const locked = await client.query(
    'select id from public.creations where id = $1 and owner_id = $2 and archived_at is null for update',
    [existing.id, userId],
  );
  if (!locked.rowCount) return null;
  await lockAccount(client, userId);
  const latest = await client.query(
    `select count(*)::int as count, coalesce(max(version_number), 0) + 1 as next_number
       from public.creation_versions where creation_id = $1`,
    [existing.id],
  );
  if (Number(latest.rows[0].count || 0) >= CREATION_VERSION_LIMIT) {
    throw limitReached(`A project can keep up to ${CREATION_VERSION_LIMIT} saved versions. Start a new project to keep saving.`);
  }
  await assertStorageAllowance(client, userId, rleBytes(version.rle));
  const versionNumber = Number(latest.rows[0].next_number);
  await client.query(`
    insert into public.creation_versions (
      id, creation_id, version_number, rle, width, height, generation,
      population, rule, settings, parent_version_id
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `, [version.id, existing.id, versionNumber, version.rle, version.width,
    version.height, version.generation, version.population, version.rule,
    version.settings, version.parentVersionId]);
  await client.query(
    'update public.creations set current_version_id = $1, updated_at = $2 where id = $3',
    [version.id, version.createdAt, existing.id],
  );
  const result = await client.query('select * from public.creations where id = $1', [existing.id]);
  const creation = await loadCreationForOwner(client, result.rows[0], userId);
  return creation;
}

async function loadCreationForOwner(client, row, userId) {
  const result = await client.query(`
    select c.*, p.display_name as owner_name,
           v.id as version_id, v.version_number, v.rle, v.width, v.height,
           v.generation, v.population, v.rule, v.settings, v.parent_version_id,
           v.created_at as version_created_at
      from public.creations c
      left join public.profiles p on p.id = c.owner_id
      left join public.creation_versions v on v.id = c.current_version_id
     where c.id = $1 and c.owner_id = $2
  `, [row.id, userId]);
  if (!result.rows[0]) return null;
  const versions = await client.query(
    'select * from public.creation_versions where creation_id = $1 order by version_number asc',
    [row.id],
  );
  return fromCreationRow(result.rows[0], { versions: versions.rows.map(fromVersionRow) });
}

function normalizeVersionForDatabase(version) {
  return validateVersionInput(version);
}

export function fromProfileRow(row) {
  return {
    id: row.id,
    email: row.email || '',
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || '',
    bio: row.bio || '',
    githubUrl: row.github_url || '',
    linkedinUrl: row.linkedin_url || '',
    createdAt: row.created_at,
  };
}

export function fromVersionRow(row) {
  return {
    id: row.id,
    versionNumber: Number(row.version_number || 1),
    rle: row.rle,
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    generation: Number(row.generation || 0),
    population: Number(row.population || 0),
    rule: row.rule || 'B3/S23',
    settings: row.settings || {},
    parentVersionId: row.parent_version_id || null,
    createdAt: row.created_at,
  };
}

export function fromCreationRow(row, { versions = null, publicOnly = false, userId = null } = {}) {
  const currentVersion = row.version_id
    ? fromVersionRow({
      id: row.version_id,
      version_number: row.version_number,
      rle: row.rle,
      width: row.width,
      height: row.height,
      generation: row.generation,
      population: row.population,
      rule: row.rule,
      settings: row.settings,
      parent_version_id: row.parent_version_id,
      created_at: row.version_created_at,
    })
    : null;
  const creation = {
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
    moderationStatus: row.moderation_status || 'visible',
    ownerId: row.owner_id,
    ownerName: row.owner_name || 'Community Builder',
    ownerUsername: row.owner_username || '',
    publishedVersionId: row.published_version_id || null,
    thumbnail: '',
    tags: row.tags || [],
    starCount: Number(row.star_count || 0),
    cloneCount: Number(row.clone_count || 0),
    viewCount: Number(row.view_count || 0),
    starredByViewer: Boolean(row.viewer_starred && userId),
    ...(publicOnly ? {} : { starredBy: row.viewer_starred && userId ? [userId] : [] }),
    remixedFromId: row.remixed_from_id || null,
    rootCreationId: row.root_creation_id || row.id,
    currentVersion,
    versions: versions || (currentVersion ? [currentVersion] : []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
  };
  if (publicOnly && row.published_metadata) {
    for (const key of ['title', 'description', 'tags', 'attribution', 'tutorialReference', 'previewConfig', 'publishReadiness']) {
      if (row.published_metadata[key] !== undefined) creation[key] = row.published_metadata[key];
    }
  }
  return creation;
}

function publicationMetadata(creation) {
  return Object.fromEntries(['title', 'description', 'tags', 'attribution', 'tutorialReference',
    'previewConfig', 'publishReadiness'].map((key) => [key, creation[key]]));
}
