import { limitAction } from './server/account-security.mjs';
import { createBetterAuth, createPostgresPool } from './server/auth.mjs';
import { handleCommunityFetchRequest } from './server/community-api.mjs';
import {
  injectCommunityConfig,
  renderCommunityConfigScript,
} from './server/community-config.mjs';
import { getPublicPageMetadata, injectPublicPageMetadata, matchPublicPage } from './server/public-page.mjs';
import {
  NOT_FOUND_HTML,
  canonicalAppPath,
  contentSecurityPolicy,
  isAppRoute,
  securityHeaders,
} from './server/http-policy.mjs';

function getServices(env, origin) {
  const runtimeEnv = {
    ...env,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL || origin,
    NODE_ENV: 'production',
  };
  const pool = createPostgresPool({ env: runtimeEnv });
  const auth = createBetterAuth({ env: runtimeEnv, database: pool });
  return { env: runtimeEnv, pool, auth };
}

function serviceUnavailable() {
  return new Response(JSON.stringify({
    error: 'Better Auth is not configured. Set Hyperdrive, BETTER_AUTH_SECRET, and BETTER_AUTH_URL.',
  }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// Cloudflare Rate Limiting bindings (wrangler.jsonc `ratelimits`) count per
// client IP at the edge. Missing bindings (local dev, tests) or a failing
// limiter allow the request; Better Auth and action_limits still apply.
const AUTH_ATTEMPT_PATH = /^\/api\/auth\/(?:sign-in|sign-up)(?:\/|$)/;

function rateLimiterFor(request, url, env) {
  const community = url.pathname === '/api/community' || url.pathname.startsWith('/api/community/')
    || url.pathname === '/api/health';
  if (request.method === 'GET' || request.method === 'HEAD') return community ? env.READ_RATE_LIMITER : null;
  if (AUTH_ATTEMPT_PATH.test(url.pathname)) return env.AUTH_RATE_LIMITER;
  if (community) return env.WRITE_RATE_LIMITER;
  return null;
}

async function isRateLimited(request, url, env) {
  const limiter = rateLimiterFor(request, url, env);
  if (typeof limiter?.limit !== 'function') return false;
  try {
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    return !(await limiter.limit({ key })).success;
  } catch (error) {
    // Fail open so a misconfigured binding never locks people out, but say so.
    console.error('Rate limiter failed; allowing request:', error?.message || error);
    return false;
  }
}

// The edge limiter counts per Cloudflare machine and Better Auth's memory
// limiter lives in a per-request instance, so neither holds across a colo.
// This shared PostgreSQL bucket is the binding limit on sign-in/sign-up.
async function isAuthAttemptLimited(request, url, pool) {
  const ip = request.headers.get('cf-connecting-ip');
  if (request.method !== 'POST' || !AUTH_ATTEMPT_PATH.test(url.pathname) || !ip || !pool) return false;
  try {
    await limitAction(pool, `auth:${ip}`, 10);
    return false;
  } catch (error) {
    if (error?.status === 429) return true;
    console.error('Auth attempt limit failed; allowing request:', error?.message || error);
    return false;
  }
}

function tooManyRequests() {
  const message = 'Too many attempts. Please wait a minute and try again.';
  return new Response(JSON.stringify({ error: message, message, code: 'RATE_LIMITED', retryAfter: 60 }), {
    status: 429,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'retry-after': '60',
    },
  });
}

async function injectRuntimeConfig(response, env) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(injectCommunityConfig(await response.text(), env), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Polled by .github/workflows/health.yml: 503 when the database is
// unreachable or its storage passes 70% of the plan limit, so a failed
// scheduled run emails the owner before writes start failing. Default limit
// is Neon Free's 0.5 GB; set DATABASE_STORAGE_LIMIT_BYTES if the plan changes.
const STORAGE_ALERT_RATIO = 0.7;

async function health(pool, env) {
  const respond = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
  });
  if (!pool) return respond(503, { ok: false, database: 'unconfigured' });
  let bytes;
  try {
    const result = await pool.query('select pg_database_size(current_database())::bigint as bytes');
    bytes = Number(result.rows[0]?.bytes);
  } catch (error) {
    console.error('Health check query failed:', error?.message || error);
    return respond(503, { ok: false, database: 'unreachable' });
  }
  const limit = Number(env.DATABASE_STORAGE_LIMIT_BYTES) || 512 * 1024 * 1024;
  const storageUsedPercent = Math.round((bytes / limit) * 100);
  const ok = bytes < limit * STORAGE_ALERT_RATIO;
  return respond(ok ? 200 : 503, { ok, database: 'reachable', storage: ok ? 'ok' : 'high', storageUsedPercent });
}

function notFound() {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': contentSecurityPolicy(NOT_FOUND_HTML),
    },
  });
}

// Every Worker response gets the shared security headers; HTML responses
// already carry their own CSP.
function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders({ hsts: true }))) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const body = [204, 205, 304].includes(response.status) ? null : response.body;
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function route(request, env, url, services) {
  if (await isRateLimited(request, url, env)) return tooManyRequests();
  if (await isAuthAttemptLimited(request, url, services.pool)) return tooManyRequests();

  if (url.pathname === '/api/health') return health(services.pool, env);

  const communityResponse = await handleCommunityFetchRequest({
    request,
    auth: services.auth,
    pool: services.pool,
  });
  if (communityResponse) return communityResponse;

  if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
    // Keep request-owned connections alive until Better Auth finishes its
    // asynchronous database work; finally runs before an unawaited return.
    return services.auth ? await services.auth.handler(request) : serviceUnavailable();
  }

  if (url.pathname === '/life-runtime.js' || url.pathname === '/life-config.js' || url.pathname === '/community-config.js') {
    return new Response(renderCommunityConfigScript(services.env), {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/javascript; charset=utf-8',
      },
    });
  }

  const canonicalPath = canonicalAppPath(url.pathname);
  if (canonicalPath) {
    return new Response(null, { status: 301, headers: { location: new URL(`${canonicalPath}${url.search}`, url).href } });
  }

  const publicRoute = matchPublicPage(url.pathname);
  const appRoute = isAppRoute(url.pathname);
  // The asset service redirects /index.html to /. Fetch the canonical shell
  // internally so direct app links retain their URL and receive metadata.
  const assetRequest = appRoute ? new Request(new URL('/', url), { headers: request.headers }) : request;
  const asset = await env.ASSETS.fetch(assetRequest);
  if (asset.status === 404) return notFound();
  const contentType = asset.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return asset;
  let html = injectCommunityConfig(await asset.text(), services.env);
  if (publicRoute) {
    let metadata = null;
    try {
      metadata = await getPublicPageMetadata({ pathname: url.pathname, pool: services.pool, origin: url.origin });
    } catch (error) {
      // A database outage still serves the app shell; the client shows its
      // own unavailable state.
      console.error('Public page metadata failed:', error?.message || error);
    }
    html = injectPublicPageMetadata(html, metadata);
  }
  const headers = new Headers(asset.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('cache-control', 'no-store');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('content-security-policy', contentSecurityPolicy(html));
  return new Response(html, { status: asset.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const services = getServices(env, url.origin);

    try {
      return withSecurityHeaders(await route(request, env, url, services));
    } finally {
      if (services.pool) ctx.waitUntil(services.pool.end());
    }
  },
};
