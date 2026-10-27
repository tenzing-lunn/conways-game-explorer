import { createHash } from 'node:crypto';
import { matchPublicPage } from './public-page.mjs';

// Shared by worker.mjs and server.mjs so both runtimes route and secure
// responses the same way.
const APP_ROUTES = new Set(['/studio', '/community', '/community/favorites']);

export function isAppRoute(pathname) {
  return APP_ROUTES.has(pathname) || Boolean(matchPublicPage(pathname));
}

// `/studio/` and friends redirect to the canonical path; anything else is null.
export function canonicalAppPath(pathname) {
  if (pathname.length < 2 || !pathname.endsWith('/')) return null;
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed && isAppRoute(trimmed) ? trimmed : null;
}

export function securityHeaders({ html = null, hsts = false } = {}) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
  };
  if (hsts) headers['strict-transport-security'] = 'max-age=31536000';
  if (html !== null) headers['content-security-policy'] = contentSecurityPolicy(html);
  return headers;
}

// Hashes are computed from the HTML being served, so editing the inline
// theme script in index.html never needs a matching CSP edit.
export function inlineScriptHashes(html) {
  const hashes = [];
  for (const [, attributes, body] of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.toLowerCase();
    if (type && type !== 'module' && type !== 'text/javascript') continue;
    hashes.push(createHash('sha256').update(body, 'utf8').digest('base64'));
  }
  return hashes;
}

export function contentSecurityPolicy(html) {
  const scripts = ["'self'", ...inlineScriptHashes(html).map((hash) => `'sha256-${hash}'`)];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const NOT_FOUND_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>Page not found · Life Lab</title>
    <link rel="icon" href="/src/favicon.svg" type="image/svg+xml" />
    <style>
      :root { color-scheme: light dark; --bg: #f4f3ee; --text: #161616; --muted: #6f6e68; --line: #dedbd2; --accent: #1d4ed8; }
      @media (prefers-color-scheme: dark) { :root { --bg: #141414; --text: #ececea; --muted: #9a9a94; --line: #2c2c2c; --accent: #7aa2ff; } }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box;
        background: var(--bg); color: var(--text); font: 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 420px; }
      svg { width: 32px; height: 32px; fill: currentColor; }
      h1 { font-size: 20px; font-weight: 600; margin: 16px 0 4px; }
      p { margin: 0 0 20px; color: var(--muted); }
      a { display: inline-block; padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px; color: var(--accent); text-decoration: none; }
      a:hover, a:focus-visible { border-color: var(--accent); }
    </style>
  </head>
  <body>
    <main>
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="6" y="1" width="4" height="4" rx="0.5"/><rect x="11" y="6" width="4" height="4" rx="0.5"/><rect x="1" y="11" width="4" height="4" rx="0.5"/><rect x="6" y="11" width="4" height="4" rx="0.5"/><rect x="11" y="11" width="4" height="4" rx="0.5"/></svg>
      <h1>Page not found</h1>
      <p>Nothing lives at this address. The pattern may have moved, or the link may be mistyped.</p>
      <a href="/">Go to Life Lab</a>
    </main>
  </body>
</html>
`;
