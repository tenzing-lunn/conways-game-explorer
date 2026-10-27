import { createHash, randomUUID } from 'node:crypto';
import { createOwnerScopedSlug } from '../src/community.js';
import { validateVersionInput } from './version-validation.mjs';
import { CREATION_VERSION_LIMIT, assertCreationAllowance, assertStorageAllowance } from './community-repository.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const digestImportValue = (value) => sha256(stableJson(value));
const digestPattern = /^[a-f0-9]{64}$/;

export function createCreationImports({ pool, userId, createId = randomUUID } = {}) {
  const ownedImport = async (client, id, lock = false) => (await client.query(
    `select * from public.creation_imports where id=$1 and owner_id=$2${lock ? ' for update' : ''}`,
    [id, userId],
  )).rows[0] || null;

  return {
    async start(input) {
      const value = normalizeStart(input);
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(`delete from public.creation_imports
          where status='uploading' and updated_at < now() - interval '7 days'`);
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [`import:${userId}:${value.importKey}`]);
        const existing = (await client.query(
          'select * from public.creation_imports where owner_id=$1 and import_key=$2', [userId, value.importKey],
        )).rows[0];
        if (existing) {
          if (existing.manifest_digest !== value.manifestDigest
            || existing.captured_revision !== value.capturedRevision
            || existing.local_project_id !== value.localProjectId
            || stableJson(existing.project) !== stableJson(value.project)) conflict('Import key was already used different content.');
          await client.query('commit');
          return existing.status === 'complete'
            ? completedResult(client, existing, true)
            : importStatus(client, existing);
        }
        const result = await client.query(`insert into public.creation_imports
          (owner_id,import_key,local_project_id,captured_revision,project,current_local_version_id,total_version_count,manifest_digest)
          values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [userId, value.importKey, value.localProjectId, value.capturedRevision, value.project,
          value.currentLocalVersionId, value.totalVersionCount, value.manifestDigest]);
        await client.query('commit');
        return importStatus(client, result.rows[0], false);
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    },

    async putManifest(importId, batchNumber, input) {
      const batch = Number(batchNumber);
      const entries = normalizeManifest(input?.entries);
      const digest = String(input?.digest || '').toLowerCase();
      if (!Number.isInteger(batch) || batch < 0 || !digestPattern.test(digest) || digestImportValue(entries) !== digest) {
        invalid('Manifest batch or digest is invalid.');
      }
      const client = await pool.connect();
      try {
        await client.query('begin');
        const item = await ownedImport(client, importId, true);
        if (!item) missing();
        if (item.status === 'complete') { await client.query('commit'); return importStatus(client, item); }
        const prior = (await client.query('select * from public.creation_import_manifest where import_id=$1 and batch_number=$2', [importId, batch])).rows[0];
        if (prior && (prior.digest !== digest || stableJson(prior.entries) !== stableJson(entries))) conflict('Manifest batch conflicts with the prior upload.');
        if (!prior) await client.query('insert into public.creation_import_manifest(import_id,batch_number,entries,digest) values($1,$2,$3::jsonb,$4)', [importId, batch, JSON.stringify(entries), digest]);
        await client.query('update public.creation_imports set updated_at=now() where id=$1', [importId]);
        await client.query('commit');
        return { importId, batch, accepted: true };
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    },

    async putVersion(importId, localVersionId, input) {
      const offset = Number(input?.offset);
      const totalBytes = Number(input?.totalBytes);
      const digest = String(input?.digest || '').toLowerCase();
      const data = String(input?.data ?? '');
      const chunk = Buffer.from(data, 'utf8');
      if (!localVersionId || localVersionId.length > 200 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(totalBytes)
        || totalBytes < 1 || totalBytes > 5_000_000 || !digestPattern.test(digest) || !chunk.length) invalid('Version chunk is invalid.');
      const client = await pool.connect();
      try {
        await client.query('begin');
        const item = await ownedImport(client, importId, true);
        if (!item) missing();
        if (item.status === 'complete') { await client.query('commit'); return importStatus(client, item); }
        let row = (await client.query('select * from public.creation_import_versions where import_id=$1 and local_version_id=$2 for update', [importId, localVersionId])).rows[0];
        if (!row) {
          if (offset !== 0) conflict('Resume offset does not match the uploaded version.');
          await assertStorageAllowance(client, userId, totalBytes);
          row = (await client.query(`insert into public.creation_import_versions
            (import_id,local_version_id,total_bytes,content_digest,metadata)
            values($1,$2,$3,$4,$5) returning *`, [importId, localVersionId, totalBytes, digest, input?.metadata || {}])).rows[0];
        }
        if (row.total_bytes !== totalBytes || row.content_digest !== digest) conflict('Version upload metadata conflicts with the prior upload.');
        const prior = Buffer.from(row.content);
        if (offset < row.received_bytes) {
          if (offset + chunk.length > row.received_bytes || !prior.subarray(offset, offset + chunk.length).equals(chunk)) conflict('Version chunk conflicts with uploaded bytes.');
        } else {
          if (offset !== row.received_bytes || offset + chunk.length > totalBytes) conflict('Resume offset does not match the uploaded version.');
          const content = Buffer.concat([prior, chunk]);
          const complete = content.length === totalBytes;
          if (complete && sha256(content) !== digest) conflict('Completed version digest does not match.');
          row = (await client.query(`update public.creation_import_versions set content=$1,received_bytes=$2,
            complete=$3,updated_at=now() where import_id=$4 and local_version_id=$5 returning *`,
          [content, content.length, complete, importId, localVersionId])).rows[0];
        }
        await client.query('update public.creation_imports set updated_at=now() where id=$1', [importId]);
        await client.query('commit');
        return { importId, localVersionId, complete: row.complete,
          receivedBytes: Number(row.received_bytes), receivedRanges: [[0, Number(row.received_bytes)]] };
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    },

    async complete(importId) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const item = await ownedImport(client, importId, true);
        if (!item) missing();
        if (item.status === 'complete') { await client.query('commit'); return completedResult(client, item, true); }
        const batches = (await client.query('select * from public.creation_import_manifest where import_id=$1 order by batch_number', [importId])).rows;
        const entries = batches.flatMap((batch) => batch.entries);
        if (entries.length !== item.total_version_count || digestImportValue(entries) !== item.manifest_digest) conflict('The uploaded manifest is incomplete or has the wrong digest.');
        const ids = new Set(entries.map((entry) => entry.localVersionId));
        if (ids.size !== entries.length || !ids.has(item.current_local_version_id)) conflict('Manifest version identifiers are incomplete or duplicated.');
        for (const entry of entries) if (entry.parentLocalVersionId && !ids.has(entry.parentLocalVersionId)) conflict('Manifest contains an unknown parent version.');
        const uploads = (await client.query('select * from public.creation_import_versions where import_id=$1', [importId])).rows;
        const uploadsById = new Map(uploads.map((row) => [row.local_version_id, row]));
        if (uploads.length !== entries.length || uploads.some((row) => !row.complete)) conflict('Not every version has finished uploading.');
        const validated = entries.map((entry) => {
          const upload = uploadsById.get(entry.localVersionId);
          if (!upload || upload.content_digest !== entry.digest || Number(upload.total_bytes) !== entry.byteLength) conflict('Uploaded version does not match its manifest.');
          return validateVersionInput({ ...entry, ...upload.metadata, rle: Buffer.from(upload.content).toString('utf8') });
        });
        // Serialize all revisions of one owner's local project, including retries
        // whose completion response or local mapping was lost.
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [`import-project:${userId}:${item.local_project_id}`]);
        const prior = (await client.query(`select * from public.creation_imports
          where owner_id=$1 and local_project_id=$2 and status='complete'
          order by completed_at desc limit 1`, [userId, item.local_project_id])).rows[0];
        let existingCreation = null;
        const mapping = { ...(prior?.version_mapping || {}) };
        if (prior) {
          existingCreation = (await client.query('select * from public.creations where id=$1 and owner_id=$2 for update',
            [prior.creation_id, userId])).rows[0];
          if (!existingCreation || existingCreation.archived_at) conflict('The imported project is no longer available.');
          if (existingCreation.current_version_id !== mapping[prior.current_local_version_id]) {
            conflict('The cloud project has newer edits. Keep the local draft and reconcile before retrying.');
          }
          const oldEntries = (await client.query('select entries from public.creation_import_manifest where import_id=$1 order by batch_number', [prior.id])).rows.flatMap((row) => row.entries);
          for (const old of oldEntries) {
            const entry = entries.find((candidate) => candidate.localVersionId === old.localVersionId);
            if (!entry || stableJson(entry) !== stableJson(old)) conflict('Imported history cannot be removed or changed.');
          }
        }
        if (!existingCreation) await assertCreationAllowance(client, userId);
        const creationId = existingCreation?.id || createId();
        // The UUID suffix already makes the slug unique.
        const slug = `${createOwnerScopedSlug(item.project.title, []).slice(0, 95)}-${creationId}`;
        const sourceId = item.project.remixedFromId && (await client.query(`select id from public.creations
          where id::text=$1 and visibility='public' and archived_at is null and moderation_status='visible'`, [item.project.remixedFromId])).rows[0]?.id;
        if (!existingCreation) await client.query(`insert into public.creations(id,owner_id,slug,title,description,tags,attribution,
          tutorial_reference,preview_config,publish_readiness,visibility,remixed_from_id,root_creation_id,import_key)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}','private',$10,$11,$12)`, [creationId, userId, slug,
          String(item.project.title || 'Untitled build').slice(0, 120), String(item.project.description || '').slice(0, 2000),
          Array.isArray(item.project.tags) ? item.project.tags.slice(0, 8) : [], String(item.project.attribution || '').slice(0, 500),
          String(item.project.tutorialReference || '').slice(0, 500), item.project.previewConfig || {}, sourceId || null,
          sourceId || null, item.import_key]);
        const knownIds = new Set(Object.keys(mapping));
        let versionNumber = Number((await client.query('select coalesce(max(version_number),0) as number from public.creation_versions where creation_id=$1', [creationId])).rows[0].number);
        const newVersions = entries.filter((entry) => !knownIds.has(entry.localVersionId)).length;
        if (versionNumber + newVersions > CREATION_VERSION_LIMIT) {
          throw Object.assign(new Error(`A project can keep up to ${CREATION_VERSION_LIMIT} saved versions.`), { status: 422, code: 'LIMIT_REACHED' });
        }
        for (const entry of entries) if (!mapping[entry.localVersionId]) mapping[entry.localVersionId] = createId();
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index]; const version = validated[index];
          if (knownIds.has(entry.localVersionId)) continue;
          await client.query(`insert into public.creation_versions(id,creation_id,version_number,rle,width,height,
            generation,population,rule,settings,parent_version_id,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [mapping[entry.localVersionId], creationId, ++versionNumber, version.rle, version.width, version.height,
            version.generation, version.population, version.rule, version.settings,
            entry.parentLocalVersionId ? mapping[entry.parentLocalVersionId] : null, entry.createdAt || new Date()]);
        }
        await client.query('update public.creations set current_version_id=$1 where id=$2', [mapping[item.current_local_version_id], creationId]);
        if (existingCreation) await client.query(`update public.creations set title=$1,description=$2,tags=$3,
          attribution=$4,tutorial_reference=$5,preview_config=$6,updated_at=now() where id=$7 and owner_id=$8`,
        [item.project.title, item.project.description || '', item.project.tags || [], item.project.attribution || '',
          item.project.tutorialReference || '', item.project.previewConfig || {}, creationId, userId]);
        if (sourceId && !existingCreation) await client.query('insert into public.remixes(source_creation_id,remix_creation_id) values($1,$2)', [sourceId, creationId]);
        // The project lock is held until COMMIT. Allocate a strictly increasing
        // completion timestamp here, independent of BEGIN order or clock rollback.
        // Keep microsecond precision in PostgreSQL rather than JS Date values.
        await client.query(`update public.creation_imports set status='complete',creation_id=$1,version_mapping=$2,
          completed_at=greatest(clock_timestamp(), (
            select max(completed_at) + interval '1 microsecond' from public.creation_imports
            where owner_id=$4 and local_project_id=$5 and status='complete'
          )),updated_at=clock_timestamp() where id=$3`,
        [creationId, mapping, importId, userId, item.local_project_id]);
        await client.query('commit');
        return completedResult(client, { ...item, creation_id: creationId }, false, mapping);
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
    },
  };
}

async function importStatus(client, item, existing = true) {
  const versions = await client.query('select local_version_id,received_bytes,total_bytes,complete from public.creation_import_versions where import_id=$1', [item.id]);
  return { importId: item.id, status: item.status, existing, versions: versions.rows.map((row) => ({
    localVersionId: row.local_version_id, receivedBytes: Number(row.received_bytes), totalBytes: Number(row.total_bytes), complete: row.complete,
  })) };
}

async function completedResult(client, item, existing, mapping = null) {
  if (!mapping) mapping = item.version_mapping || {};
  return { imported: true, existing, creationId: item.creation_id,
    mapping: { localProjectId: item.local_project_id, cloudProjectId: item.creation_id, versionIds: mapping } };
}

function normalizeStart(input) {
  const value = { importKey: String(input?.importKey || ''), localProjectId: String(input?.localProjectId || ''),
    capturedRevision: String(input?.capturedRevision || ''), project: input?.project,
    currentLocalVersionId: String(input?.currentLocalVersionId || ''), totalVersionCount: Number(input?.totalVersionCount),
    manifestDigest: String(input?.manifestDigest || '').toLowerCase() };
  if (!value.importKey || value.importKey.length > 200 || !value.localProjectId || !value.capturedRevision
    || !value.project || typeof value.project !== 'object' || !value.currentLocalVersionId
    || !Number.isInteger(value.totalVersionCount) || value.totalVersionCount < 1 || value.totalVersionCount > CREATION_VERSION_LIMIT
    || !digestPattern.test(value.manifestDigest)) invalid('Import request is invalid.');
  const title = String(value.project.title || '').trim();
  const tags = Array.isArray(value.project.tags) ? value.project.tags : [];
  if (!title || title.length > 120 || String(value.project.description || '').length > 2000
    || String(value.project.attribution || '').length > 500
    || String(value.project.tutorialReference || '').length > 500 || tags.length > 8
    || tags.some((tag) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(tag)) || String(tag).length > 32)
    || (value.project.previewConfig !== undefined
      && (!value.project.previewConfig || typeof value.project.previewConfig !== 'object' || Array.isArray(value.project.previewConfig)))) {
    invalid('Imported project metadata is invalid.');
  }
  return value;
}
function normalizeManifest(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 40) invalid('Manifest batches contain 1 to 40 versions.');
  const normalized = entries.map((entry) => {
    const value = { ...entry, localVersionId: String(entry?.localVersionId || ''),
      parentLocalVersionId: entry?.parentLocalVersionId ? String(entry.parentLocalVersionId) : null,
      byteLength: Number(entry?.byteLength), digest: String(entry?.digest || '').toLowerCase() };
    if (!value.localVersionId || value.localVersionId.length > 200 || !Number.isInteger(value.byteLength)
      || value.byteLength < 1 || value.byteLength > 5_000_000 || !digestPattern.test(value.digest)) invalid('Manifest entry is invalid.');
    return value;
  });
  if (normalized.reduce((sum, entry) => sum + entry.byteLength, 0) > 20_000_000) {
    invalid('A manifest batch may describe at most 20 MB of versions.');
  }
  return normalized;
}
function invalid(message) { throw Object.assign(new Error(message), { status: 422, code: 'IMPORT_INVALID' }); }
function conflict(message) { throw Object.assign(new Error(message), { status: 409, code: 'IMPORT_CONFLICT' }); }
function missing() { throw Object.assign(new Error('Import was not found.'), { status: 404, code: 'IMPORT_NOT_FOUND' }); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
