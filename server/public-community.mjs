import { fromCreationRow } from './community-repository.mjs';

// List rows (feed, profile, remix and source cards) carry the preview only;
// the published RLE (up to 200 KB) is returned by get() for the detail page.
const select = ({ rle = false } = {}) => `select c.*, p.display_name as owner_name, p.username as owner_username,
  v.id as version_id, v.version_number, ${rle ? 'v.rle, ' : ''}v.width, v.height, v.generation,
  v.population, v.rule, v.settings, v.created_at as version_created_at,
  exists(select 1 from public.stars s where s.creation_id=c.id and s.profile_id=$1) as viewer_starred,
  (select count(*) from public.comments cm where cm.creation_id=c.id and cm.deleted_at is null) as comment_count
  from public.creations c join public.profiles p on p.id=c.owner_id
  join public.creation_versions v on v.id=c.published_version_id
  where c.visibility='public' and c.archived_at is null and c.moderation_status='visible'`;
const selection = select();
const fullSelection = select({ rle: true });

export function createPublicCommunity({ pool, userId = null }) {
  const map = (row) => ({ ...fromCreationRow(row, { publicOnly: true, userId }), commentCount: Number(row.comment_count || 0) });
  return {
    async list({ search = '', tag = '', username = '', favorites = false, limit = 24, cursor = '' } = {}) {
      let cursorDate = null;
      let cursorId = null;
      if (cursor) {
        [cursorDate, cursorId] = cursor.split('|');
        if (!Number.isFinite(Date.parse(cursorDate)) || !/^[a-f0-9-]{36}$/.test(cursorId || '')) {
          throw Object.assign(new Error('Invalid page cursor.'), { status: 400 });
        }
      }
      const size = Math.min(48, Math.max(1, Number(limit) || 24));
      const result = await pool.query(`${selection}
        and ($2='' or c.published_metadata->>'title' ilike '%' || $2 || '%'
          or c.published_metadata->>'description' ilike '%' || $2 || '%'
          or p.display_name ilike '%' || $2 || '%')
        and ($3='' or c.published_metadata->'tags' ? $3)
        and ($4='' or p.username=$4)
        and (not $5 or exists(select 1 from public.stars s where s.creation_id=c.id and s.profile_id=$1))
        and ($6::timestamptz is null or (c.published_at,c.id) < ($6::timestamptz,$7::uuid))
        order by c.published_at desc,c.id desc limit $8`,
      [userId, String(search).slice(0, 200), tag, username, Boolean(favorites), cursorDate, cursorId, size + 1]);
      const rows = result.rows.slice(0, size);
      const last = rows.at(-1);
      return { creations: rows.map(map), cursor: result.rows.length > size
        ? `${new Date(last.published_at).toISOString()}|${last.id}` : null };
    },
    async get(identifier) {
      const result = await pool.query(`${fullSelection} and (c.slug=$2 or c.id::text=$2)`, [userId, identifier]);
      if (!result.rows[0]) return null;
      const creation = map(result.rows[0]);
      const source = creation.remixedFromId
        ? await pool.query(`${selection} and c.id::text=$2`, [userId, creation.remixedFromId]) : { rows: [] };
      const remixes = await pool.query(`${selection} and c.remixed_from_id::text=$2 order by c.published_at desc limit 12`, [userId, creation.id]);
      return { ...creation, source: source.rows[0] ? map(source.rows[0]) : null, remixes: remixes.rows.map(map) };
    },
    async profile(username, { cursor = '' } = {}) {
      const result = await pool.query(`select id,username,display_name,bio,created_at from public.profiles
        where username=$1 and is_public=true`, [username]);
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      return { id: row.id, username: row.username, displayName: row.display_name, bio: row.bio,
        ...(await this.list({ username, cursor })) };
    },
    async comments(creationId, { cursor = '' } = {}) {
      const creation = await this.get(creationId);
      if (!creation) return null;
      let cursorDate = null; let cursorId = null;
      if (cursor) {
        [cursorDate, cursorId] = cursor.split('|');
        if (!Number.isFinite(Date.parse(cursorDate)) || !/^[a-f0-9-]{36}$/.test(cursorId || '')) {
          throw Object.assign(new Error('Invalid comment cursor.'), { status: 400, code: 'INVALID_CURSOR' });
        }
      }
      const result = await pool.query(`select cm.id,cm.body,cm.author_id,cm.created_at,cm.updated_at,
        p.display_name,p.username from public.comments cm left join public.profiles p on p.id=cm.author_id
        where cm.creation_id=$1 and cm.deleted_at is null
          and ($2::timestamptz is null or (cm.created_at,cm.id) < ($2::timestamptz,$3::uuid))
        order by cm.created_at desc,cm.id desc limit 51`, [creation.id, cursorDate, cursorId]);
      const rows = result.rows.slice(0, 50); const last = rows.at(-1);
      return { comments: rows.map((row) => ({ id: row.id, creationId: creation.id, body: row.body, authorId: row.author_id,
        authorName: row.display_name || 'Deleted account', username: row.username,
        createdAt: row.created_at, updatedAt: row.updated_at })),
      cursor: result.rows.length > 50 ? `${new Date(last.created_at).toISOString()}|${last.id}` : null };
    },
  };
}
