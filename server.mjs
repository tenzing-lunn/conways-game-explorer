import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { toNodeHandler } from 'better-auth/node';
import { createBetterAuth, createPostgresPool } from './server/auth.mjs';
import { getCommunityConfig, injectCommunityConfig, renderCommunityConfigScript } from './server/community-config.mjs';
import { handleCommunityRequest } from './server/community-api.mjs';
import { getPublicPageMetadata, injectPublicPageMetadata, matchPublicPage } from './server/public-page.mjs';
import {
  NOT_FOUND_HTML,
  canonicalAppPath,
  contentSecurityPolicy,
  isAppRoute,
  securityHeaders,
} from './server/http-policy.mjs';

const defaultHost = '127.0.0.1';
const defaultPort = Number(process.env.PORT || 5173);
const defaultRoot = process.cwd();

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export { getCommunityConfig, injectCommunityConfig, renderCommunityConfigScript } from './server/community-config.mjs';

export function createRequestHandler({
  root = defaultRoot,
  env = process.env,
  host = defaultHost,
  port = defaultPort,
  databasePool = createPostgresPool({ env }),
  auth = createBetterAuth({ env, database: databasePool }),
  authHandler = auth ? toNodeHandler(auth) : null,
  communityHandler = ({ request, response }) => handleCommunityRequest({
    request,
    response,
    auth,
    pool: databasePool,
  }),
} = {}) {
  return async (request, response) => {
    for (const [name, value] of Object.entries(securityHeaders())) response.setHeader(name, value);
    try {
      const url = new URL(request.url || '/', `http://${host}:${port}`);

      if (await communityHandler({ request, response })) return;

      if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
        if (!authHandler) {
          response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({
            error: 'Better Auth is not configured. Set DATABASE_URL and BETTER_AUTH_SECRET.',
          }));
          return;
        }

        await authHandler(request, response);
        return;
      }

      if (
        url.pathname === '/life-runtime.js'
        || url.pathname === '/life-config.js'
        || url.pathname === '/community-config.js'
      ) {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': types['.js'],
        });
        response.end(renderCommunityConfigScript(env));
        return;
      }

      const canonicalPath = canonicalAppPath(url.pathname);
      if (canonicalPath) {
        response.writeHead(301, { location: `${canonicalPath}${url.search}` });
        response.end();
        return;
      }

      const publicRoute = matchPublicPage(url.pathname);
      const appRoute = isAppRoute(url.pathname);
      const cleanPath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      // Serve only the shell and the browser sources, never .env, .git or server code.
      if (!(cleanPath === '/' || appRoute || cleanPath.startsWith('/src/'))) throw new Error('Not a public file.');
      const filePath = join(root, cleanPath === '/' || appRoute ? 'index.html' : cleanPath);
      const file = await readFile(filePath);
      const isIndexHtml = filePath.endsWith('index.html');
      let body = isIndexHtml
        ? injectCommunityConfig(file.toString('utf8'), env)
        : file;
      if (publicRoute) {
        let metadata = null;
        try {
          metadata = await getPublicPageMetadata({ pathname: url.pathname, pool: databasePool, origin: url.origin });
        } catch (error) {
          console.error('Public page metadata failed:', error?.message || error);
        }
        body = injectPublicPageMetadata(body, metadata);
      }

      response.writeHead(200, {
        'content-type': types[extname(filePath)] || 'application/octet-stream',
        ...(isIndexHtml ? { 'content-security-policy': contentSecurityPolicy(body) } : {}),
      });
      response.end(body);
    } catch {
      response.writeHead(404, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': contentSecurityPolicy(NOT_FOUND_HTML),
      });
      response.end(NOT_FOUND_HTML);
    }
  };
}

export function startServer({
  root = defaultRoot,
  env = process.env,
  host = defaultHost,
  port = defaultPort,
} = {}) {
  return createServer(createRequestHandler({ root, env, host, port })).listen(port, host, () => {
    console.log(`Conway explorer running at http://${host}:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
