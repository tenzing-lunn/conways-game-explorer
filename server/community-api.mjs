import { fromNodeHeaders } from 'better-auth/node';
import { Readable } from 'node:stream';
import { createPostgresCommunityRepository } from './community-repository.mjs';
import { createPublicCommunity } from './public-community.mjs';
import { createRecoveryKey, recoverAccount, limitAction } from './account-security.mjs';
import { createCreationImports } from './creation-imports.mjs';

const MAX_BODY_BYTES = 1_000_000;
export const USER_WRITES_PER_MINUTE = 120;

// The application has a local Node server and a Cloudflare Worker deployment.
// Keep the business route logic on standard Web Request/Response objects so
// both runtimes enforce exactly the same authentication and ownership checks.
export async function handleCommunityFetchRequest({ request, auth, pool } = {}) {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/community' && !url.pathname.startsWith('/api/community/')) {
    return null;
  }

  if (!auth || !pool) {
    return errorResponse(503, 'PostgreSQL community backend is not configured.', 'UNAVAILABLE');
  }

  try {
    const segments = url.pathname.split('/').filter(Boolean).slice(2);
    const [resource, id, action, childId] = segments;
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return errorResponse(403, 'This action must come from Life Lab.', 'ORIGIN_MISMATCH');
    }
    if (resource === 'recover' && request.method === 'POST') {
      const ip = request.headers.get('cf-connecting-ip') || 'local';
      await limitAction(pool, `recover:${ip}`, 5);
      return jsonResponse(200, await recoverAccount(pool, await readJson(request)));
    }
    const session = await auth.api.getSession({ headers: request.headers });
    const publicRepo = createPublicCommunity({ pool, userId: session?.user?.id || null });
    if (request.method === 'GET') {
      if (resource === 'feed') {
        if (url.searchParams.get('favorites') === 'true' && !session?.user?.id) return errorResponse(401, 'Sign in to see your favorites.', 'AUTH_REQUIRED');
        return jsonResponse(200, await publicRepo.list({
        search: url.searchParams.get('q') || '', tag: url.searchParams.get('tag') || '',
        favorites: url.searchParams.get('favorites') === 'true', cursor: url.searchParams.get('cursor') || '',
        limit: url.searchParams.get('limit'),
      }));
      }
      if (resource === 'trending') return jsonResponse(200, (await publicRepo.list({ limit: url.searchParams.get('limit') })).creations);
      if (resource === 'public' && id) {
        const result = action === 'comments'
          ? await publicRepo.comments(id, { cursor: url.searchParams.get('cursor') || '' })
          : await publicRepo.get(id);
        return result ? jsonResponse(200, result) : errorResponse(404, 'This creation is not available.', 'NOT_FOUND');
      }
      if (resource === 'profiles' && id) {
        const result = await publicRepo.profile(id, { cursor: url.searchParams.get('cursor') || '' });
        return result ? jsonResponse(200, result) : errorResponse(404, 'This profile is not available.', 'NOT_FOUND');
      }
    }
    if (!session?.user?.id) {
      return errorResponse(401, 'Sign in before using the community backend.', 'AUTH_REQUIRED');
    }

    const repo = createPostgresCommunityRepository({ pool, userId: session.user.id });
    const imports = createCreationImports({ pool, userId: session.user.id });
    // One bucket per account for every write, so spreading requests across
    // resources does not multiply the allowance.
    if (!['GET', 'HEAD'].includes(request.method)) {
      await limitAction(pool, `${session.user.id}:writes`, USER_WRITES_PER_MINUTE);
    }

    if (resource === 'recovery-key' && request.method === 'POST') {
      return jsonResponse(200, await createRecoveryKey(pool, session.user.id, (await readJson(request)).password));
    }
    if (resource === 'imports' && request.method === 'POST' && !id) {
      const result = await imports.start(await readJson(request));
      return jsonResponse(result.existing ? 200 : 201, result);
    }
    if (resource === 'imports' && id && action === 'manifest' && childId && request.method === 'PUT') {
      return jsonResponse(200, await imports.putManifest(id, childId, await readJson(request)));
    }
    if (resource === 'imports' && id && action === 'versions' && childId && request.method === 'PUT') {
      return jsonResponse(200, await imports.putVersion(id, decodeURIComponent(childId), await readJson(request)));
    }
    if (resource === 'imports' && id && action === 'complete' && request.method === 'POST') {
      const result = await imports.complete(id);
      const state = await repo.loadCommunityState();
      return jsonResponse(result.existing ? 200 : 201, {
        ...result,
        creation: state.creations.find((creation) => creation.id === result.creationId) || null,
      });
    }
    if (resource === 'favorites' && request.method === 'GET') {
      const result = await pool.query('select pattern_id from public.pattern_favorites where user_id=$1', [session.user.id]);
      return jsonResponse(200, result.rows.map((row) => row.pattern_id));
    }
    if (resource === 'favorites' && request.method === 'POST') {
      const body = await readJson(request);
      if (!/^[a-z0-9-]{1,120}$/.test(body.patternId || '')) return jsonResponse(422, { error: 'Invalid pattern.' });
      if (body.saved) await pool.query(`insert into public.pattern_favorites(user_id,pattern_id) values($1,$2) on conflict do nothing`, [session.user.id, body.patternId]);
      else await pool.query('delete from public.pattern_favorites where user_id=$1 and pattern_id=$2', [session.user.id, body.patternId]);
      return jsonResponse(200, { saved: Boolean(body.saved) });
    }
    if (resource === 'comments' && request.method === 'POST' && !id) {
      const body = await readJson(request);
      const creation = await publicRepo.get(String(body.creationId || ''));
      if (!creation) return jsonResponse(404, { error: 'This creation is not available.' });
      const text = String(body.body || '').trim();
      if (!text || text.length > 2000) return jsonResponse(422, { error: 'Comments must contain 1 to 2000 characters.' });
      const result = await pool.query(`insert into public.comments(creation_id,author_id,body) values($1,$2,$3)
        returning id,creation_id,author_id,body,created_at,updated_at`, [creation.id, session.user.id, text]);
      return jsonResponse(201, normalizeComment(result.rows[0], session.user));
    }
    if (resource === 'comments' && id && ['PATCH', 'DELETE'].includes(request.method)) {
      const text = request.method === 'PATCH' ? String((await readJson(request)).body || '').trim() : null;
      if (text !== null && (!text || text.length > 2000)) return jsonResponse(422, { error: 'Comments must contain 1 to 2000 characters.' });
      const result = await pool.query(request.method === 'PATCH'
        ? 'update public.comments set body=$3,updated_at=now() where id::text=$1 and author_id=$2 and deleted_at is null returning id,creation_id,author_id,body,created_at,updated_at'
        : 'update public.comments set deleted_at=now(),updated_at=now() where id::text=$1 and author_id=$2 and deleted_at is null returning id,creation_id,author_id,body,created_at,updated_at,deleted_at',
      text === null ? [id, session.user.id] : [id, session.user.id, text]);
      return result.rowCount ? jsonResponse(200, normalizeComment(result.rows[0], session.user))
        : errorResponse(404, 'Comment was not found.', 'NOT_FOUND');
    }
    if (resource === 'reports' && request.method === 'POST') {
      const body = await readJson(request);
      const creation = await publicRepo.get(String(body.creationId || ''));
      const reason = String(body.reason || '').trim();
      if (!creation) return jsonResponse(404, { error: 'This creation is not available.' });
      if (reason.length < 5 || reason.length > 2000) return jsonResponse(422, { error: 'Describe the issue in 5 to 2000 characters.' });
      await pool.query('insert into public.content_reports(reporter_id,creation_id,reason) values($1,$2,$3)', [session.user.id, creation.id, reason]);
      return jsonResponse(201, { reported: true });
    }

    if (request.method === 'GET' && resource === 'state') {
      return jsonResponse(200, await repo.loadCommunityState());
    }
    if (request.method === 'GET' && resource === 'trending') {
      return jsonResponse(200, await repo.listTrendingCreations({ limit: url.searchParams.get('limit') }));
    }
    if (request.method === 'POST' && resource === 'profile') {
      return jsonResponse(200, await repo.saveProfile(await readJson(request)));
    }
    if (request.method === 'POST' && resource === 'creations' && !id) {
      const body = await readJson(request);
      return jsonResponse(201, await repo.createCreation(body, { publish: body.publish === true }));
    }
    if (request.method === 'POST' && resource === 'creations' && id && action === 'versions') {
      return jsonResponse(201, await repo.saveVersion(id, await readJson(request)));
    }
    if (request.method === 'POST' && resource === 'creations' && id && action === 'restore') {
      const body = await readJson(request);
      return jsonResponse(200, await repo.restoreVersion(id, body.versionId));
    }
    if (request.method === 'PATCH' && resource === 'creations' && id) {
      return jsonResponse(200, await repo.updateCreationMetadata(id, await readJson(request)));
    }
    if (request.method === 'POST' && resource === 'creations' && id && action === 'publish') {
      return jsonResponse(200, await repo.publishCreation(id));
    }
    if (request.method === 'POST' && resource === 'creations' && id && action === 'unpublish') {
      return jsonResponse(200, await repo.unpublishCreation(id));
    }
    if (request.method === 'POST' && resource === 'creations' && id && action === 'archive') {
      return jsonResponse(200, await repo.archiveCreation(id));
    }
    if (request.method === 'POST' && resource === 'creations' && id && action === 'star') {
      return jsonResponse(200, await repo.toggleStar(id));
    }
    if (request.method === 'POST' && resource === 'creations' && id && action === 'remix') {
      const remix = await repo.cloneCreation(id);
      return jsonResponse(201, remix ? { remix, source: repo.findCreation(id) } : null);
    }
    if (request.method === 'DELETE' && resource === 'creations' && id) {
      return jsonResponse(200, { deleted: await repo.deleteCreation(id) });
    }

    return errorResponse(404, 'Community route not found.', 'NOT_FOUND');
  } catch (error) {
    const status = error.status || (error.code === '23505' ? 409 : error.code === 'PUBLISH_VALIDATION_FAILED'
      ? 422
      : /not found|requires|archived|authentication|sign in|not available/i.test(error.message)
      ? 400
      : 500);
    return jsonResponse(status, {
      error: status === 500 ? 'Community request failed.'
        : error.code === '23505' ? 'That username or project URL is already taken.' : error.message,
      code: status === 500 ? 'INTERNAL_ERROR' : (error.code === '23505' ? 'CONFLICT' : (error.code || defaultErrorCode(status))),
      ...(error.issues ? { issues: error.issues } : {}),
      ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
    });
  }
}

export async function handleCommunityRequest({ request, response, auth, pool } = {}) {
  let webRequest;
  try {
    webRequest = toWebRequest(request);
  } catch (error) {
    const result = errorResponse(error.status || 400, error.message || 'Request URL is invalid.', error.code || 'BAD_REQUEST');
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(await result.text());
    return true;
  }
  const result = await handleCommunityFetchRequest({ request: webRequest, auth, pool });
  if (!result) return false;

  response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
  response.end(await result.text());
  return true;
}

export async function readJson(request) {
  const contentLength = Number(request.headers?.get?.('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) throw createHttpError(413, 'Request body is too large.');

  let body = '';
  try {
    body = await request.text();
  } catch {
    throw createHttpError(400, 'Request body must be valid JSON.');
  }
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    throw createHttpError(413, 'Request body is too large.');
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw createHttpError(400, 'Request body must be valid JSON.');
  }
}

function toWebRequest(request) {
  const headers = new Headers(fromNodeHeaders(request.headers || {}));
  const forwardedProto = firstHeader(headers.get('x-forwarded-proto'));
  const protocol = forwardedProto === 'https' ? 'https' : 'http';
  const host = firstHeader(headers.get('x-forwarded-host')) || headers.get('host') || '127.0.0.1';
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) throw createHttpError(400, 'Request host is invalid.', 'INVALID_HOST');
  const url = new URL(request.url || '/', `${protocol}://${host}`);
  const init = { method: request.method || 'GET', headers };
  if (!['GET', 'HEAD'].includes(init.method)) {
    init.body = Readable.toWeb(Readable.from(request));
    init.duplex = 'half';
  }
  return new Request(url, init);
}

function createHttpError(status, message, code = defaultErrorCode(status)) {
  return Object.assign(new Error(message), { status, code });
}

function errorResponse(status, error, code) { return jsonResponse(status, { error, code }); }
function defaultErrorCode(status) { return ({ 400: 'BAD_REQUEST', 401: 'AUTH_REQUIRED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'VALIDATION_FAILED', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' })[status] || 'INTERNAL_ERROR'; }
function firstHeader(value) { return String(value || '').split(',')[0].trim(); }
function normalizeComment(row, user = {}) { return { id: row.id, creationId: row.creation_id, authorId: row.author_id,
  body: row.body, authorName: user.name || 'Community Builder', username: user.username || null,
  createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at || null }; }

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}
