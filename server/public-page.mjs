import { createPublicCommunity } from './public-community.mjs';

export const SOCIAL_IMAGE_PATH = '/src/og-image.png';

// A malformed escape such as /c/%E0%A4%A is treated as "not a public page".
function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function matchPublicPage(pathname) {
  const match = pathname.match(/^\/([cu])\/([^/]+)$/);
  if (!match) return null;
  const identifier = decodeSegment(match[2]);
  if (identifier === null) return null;
  return { kind: match[1] === 'c' ? 'creation' : 'profile', identifier };
}

export async function getPublicPageMetadata({ pathname, pool, origin }) {
  const route = matchPublicPage(pathname);
  if (!route || !pool) return null;
  const repo = createPublicCommunity({ pool });
  const record = route.kind === 'creation'
    ? await repo.get(route.identifier)
    : await repo.profile(route.identifier);
  const image = `${origin}${SOCIAL_IMAGE_PATH}`;
  if (!record) return { title: 'Unavailable creation · Life Lab', description: 'This public Life Lab page is unavailable.', url: `${origin}${pathname}`, image };
  return route.kind === 'creation'
    ? { title: `${record.title} by ${record.ownerName} · Life Lab`, description: record.description || `Play ${record.title} in Conway's Game of Life.`, url: `${origin}/c/${record.slug}`, image }
    : { title: `${record.displayName} · Life Lab`, description: record.bio || `See ${record.displayName}'s public Conway's Game of Life creations.`, url: `${origin}/u/${record.username}`, image };
}

// The shell ships static homepage tags; public pages replace them rather than
// adding a second, conflicting set.
const SOCIAL_TAG = /[ \t]*<meta\s+(?:name="(?:description|twitter:[^"]*)"|property="og:[^"]*")[^>]*>[ \t]*\r?\n?/gi;

export function injectPublicPageMetadata(html, metadata) {
  if (!metadata) return html;
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const url = escapeHtml(metadata.url);
  const image = metadata.image ? escapeHtml(metadata.image) : '';
  const tags = [
    `<meta name="description" content="${description}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Life Lab" />',
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    ...(image ? [
      `<meta property="og:image" content="${image}" />`,
      '<meta property="og:image:width" content="1200" />',
      '<meta property="og:image:height" content="627" />',
    ] : []),
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
  ];
  // Function replacers: user text must never be read as `$'`, `$&`, etc.
  return String(html)
    .replace(SOCIAL_TAG, '')
    .replace(/<title>[^<]*<\/title>/i, () => `<title>${title}</title>`)
    .replace('</head>', () => `  ${tags.join('\n    ')}\n  </head>`);
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
