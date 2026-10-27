// Profile text shows up in the public feed, comments and page metadata, so
// every stored field is bounded here. Values are normalized rather than
// rejected: the client only sends a display name, and account setup must not
// fail because a legacy local profile carried an odd value.
export const DISPLAY_NAME_MAX = 60;
export const BIO_MAX = 500;
export const PROFILE_URL_MAX = 300;

const clip = (value, max) => Array.from(value).slice(0, max).join('');

export function cleanDisplayName(value) {
  return clip(String(value ?? '').replace(/\s+/g, ' ').trim(), DISPLAY_NAME_MAX).trim();
}

export function cleanBio(value) {
  return clip(String(value ?? '').trim(), BIO_MAX).trim();
}

export function cleanProfileUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > PROFILE_URL_MAX) return '';
  try {
    return new URL(text).protocol === 'https:' ? text : '';
  } catch {
    return '';
  }
}
