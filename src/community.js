import {
  createDesignSettings,
  serializeDesignSettings,
} from './design-settings.js';
import { getPatternBounds, parseRle } from './patterns.js';

export const COMMUNITY_STORAGE_KEY = 'life-logic-community-v1';
export const PUBLISH_LIMITS = Object.freeze({
  titleMax: 120,
  descriptionMin: 20,
  descriptionMax: 2000,
  tagMax: 8,
  tagLengthMax: 32,
  rleBytesMax: 200_000,
  dimensionMax: 2048,
});

export function createCommunityState(overrides = {}) {
  return {
    profile: null,
    creations: [],
    activeCreationId: null,
    ...overrides,
  };
}

export function createProfile({
  email,
  displayName,
  avatarUrl = '',
  bio = '',
  githubUrl = '',
  linkedinUrl = '',
  now = () => new Date().toISOString(),
} = {}) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(displayName || cleanEmail.split('@')[0] || 'Life Builder').trim();
  const username = slugify(cleanName) || `builder-${hashString(cleanEmail).slice(0, 6)}`;

  return {
    id: `profile-${hashString(cleanEmail || username)}`,
    email: cleanEmail,
    username,
    displayName: cleanName,
    avatarUrl: String(avatarUrl || '').trim(),
    bio: String(bio || '').trim(),
    githubUrl: String(githubUrl || '').trim(),
    linkedinUrl: String(linkedinUrl || '').trim(),
    createdAt: now(),
  };
}

export function createCreationDraft({
  id,
  slug,
  profile,
  title,
  description = '',
  tags = [],
  rle,
  width,
  height,
  generation = 0,
  population = 0,
  thumbnail = '',
  parentCreation = null,
  settings = null,
  attribution = '',
  tutorialReference = '',
  previewConfig = {},
  publishReadiness = {},
  comments = [],
  now = () => new Date().toISOString(),
} = {}) {
  const createdAt = now();
  const creationId = id || `creation-${hashString(`${profile?.id || 'local'}:${title}:${rle}:${createdAt}`)}`;
  const cleanTitle = String(title || 'Untitled Life build').trim();
  const designInput = {
    ...(settings || {}),
  };

  if (!designInput.gridPreset && (designInput.width || designInput.height || width || height)) {
    designInput.gridPreset = 'custom';
  }
  if (designInput.width === undefined && width !== undefined) designInput.width = width;
  if (designInput.height === undefined && height !== undefined) designInput.height = height;

  const versionSettings = serializeDesignSettings(createDesignSettings(designInput));
  const normalizedComments = normalizeComments(comments);

  const currentVersion = {
    id: `version-${getIdSuffix(creationId)}`,
    versionNumber: 1,
    rle: String(rle || 'x = 0, y = 0, rule = B3/S23\n!'),
    width: Number(width || 0),
    height: Number(height || 0),
    generation: Number(generation || 0),
    population: Number(population || 0),
    rule: 'B3/S23',
    settings: versionSettings,
    parentVersionId: null,
    createdAt,
  };

  return {
    id: creationId,
    title: cleanTitle,
    slug: slug || `${slugify(cleanTitle) || 'life-build'}-${getIdSuffix(creationId)}`,
    description: String(description || '').trim(),
    attribution: String(attribution || '').trim(),
    tutorialReference: String(tutorialReference || '').trim(),
    previewConfig: normalizeObject(previewConfig),
    publishReadiness: normalizeObject(publishReadiness),
    visibility: 'private',
    ownerId: profile?.id || 'profile-local',
    ownerName: profile?.displayName || 'Local Builder',
    thumbnail,
    tags: normalizeTags(tags),
    starCount: 0,
    cloneCount: 0,
    viewCount: 0,
    commentCount: normalizedComments.length,
    comments: normalizedComments,
    starredBy: [],
    remixedFromId: parentCreation?.id || null,
    rootCreationId: parentCreation?.rootCreationId || parentCreation?.id || creationId,
    currentVersion,
    versions: [currentVersion],
    createdAt,
    updatedAt: createdAt,
    publishedAt: null,
    archivedAt: null,
  };
}

export function createCreationVersion(creation, input = {}, {
  id,
  parentVersionId = creation?.currentVersion?.id || null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!creation?.id) throw new Error('A creation is required to save a version.');
  const createdAt = now();
  const existingVersions = getCreationVersions(creation);
  const versionNumber = existingVersions.reduce(
    (highest, version) => Math.max(highest, Number(version.versionNumber || 0)),
    0,
  ) + 1;
  const settings = serializeDesignSettings(createDesignSettings({
    ...(creation.currentVersion?.settings || {}),
    ...(input.settings || {}),
    width: input.width ?? input.settings?.width ?? creation.currentVersion?.width,
    height: input.height ?? input.settings?.height ?? creation.currentVersion?.height,
  }));

  return {
    id: id || `version-${hashString(`${creation.id}:${versionNumber}:${input.rle}:${createdAt}`)}`,
    versionNumber,
    rle: String(input.rle || creation.currentVersion?.rle || 'x = 0, y = 0, rule = B3/S23\n!'),
    width: Number(input.width ?? settings.width),
    height: Number(input.height ?? settings.height),
    generation: Number(input.generation ?? 0),
    population: Number(input.population ?? 0),
    rule: String(input.rule || settings.rule || 'B3/S23'),
    settings,
    parentVersionId,
    createdAt,
  };
}

export function appendCreationVersion(creation, input, options = {}) {
  const version = createCreationVersion(creation, input, options);
  return {
    ...creation,
    currentVersion: version,
    versions: [...getCreationVersions(creation), version],
    updatedAt: version.createdAt,
  };
}

export function updateCreationMetadata(creation, patch = {}, { now = () => new Date().toISOString() } = {}) {
  return {
    ...creation,
    ...(patch.title === undefined ? {} : { title: String(patch.title || '').trim() }),
    ...(patch.description === undefined ? {} : { description: String(patch.description || '').trim() }),
    ...(patch.tags === undefined ? {} : { tags: normalizeTags(patch.tags) }),
    ...(patch.attribution === undefined ? {} : { attribution: String(patch.attribution || '').trim() }),
    ...(patch.tutorialReference === undefined ? {} : { tutorialReference: String(patch.tutorialReference || '').trim() }),
    ...(patch.previewConfig === undefined ? {} : { previewConfig: normalizeObject(patch.previewConfig) }),
    ...(patch.publishReadiness === undefined ? {} : { publishReadiness: normalizeObject(patch.publishReadiness) }),
    updatedAt: now(),
  };
}

export function restoreCreationVersion(creation, versionId, options = {}) {
  const source = getCreationVersions(creation).find((version) => version.id === versionId);
  if (!source) return null;
  return appendCreationVersion(creation, source, {
    ...options,
    parentVersionId: source.id,
  });
}

export function archiveCreation(creation, { now = () => new Date().toISOString() } = {}) {
  const archivedAt = now();
  return {
    ...creation,
    visibility: 'private',
    canonicalUrl: null,
    publishedAt: null,
    archivedAt,
    updatedAt: archivedAt,
  };
}

export function getCreationVersions(creation) {
  const versions = Array.isArray(creation?.versions) ? creation.versions : [];
  const withCurrent = creation?.currentVersion
    && !versions.some((version) => version.id === creation.currentVersion.id)
    ? [...versions, creation.currentVersion]
    : versions;
  return withCurrent
    .map((version, index) => ({
      ...version,
      versionNumber: Number(version.versionNumber || index + 1),
      parentVersionId: version.parentVersionId || null,
    }))
    .sort((left, right) => left.versionNumber - right.versionNumber);
}

export function publishCreation(creation, { now = () => new Date().toISOString() } = {}) {
  const readiness = assertCreationPublishReady(creation);
  const publishedAt = creation.publishedAt || now();

  return {
    ...creation,
    previewConfig: createCreationPreviewConfig(creation),
    publishReadiness: readiness.checks,
    visibility: 'public',
    canonicalUrl: `/c/${creation.slug}`,
    publishedAt,
    updatedAt: publishedAt,
  };
}

export function getCreationPublishReadiness(creation) {
  const issues = [];
  const title = String(creation?.title || '').trim();
  const description = String(creation?.description || '').trim();
  const tags = normalizeTags(creation?.tags, { limit: false });
  const version = creation?.currentVersion;
  const rle = String(version?.rle || '');
  let previewReady = false;

  if (!title) issues.push({ field: 'title', code: 'required', message: 'Add a title.' });
  if (title.length > PUBLISH_LIMITS.titleMax) {
    issues.push({ field: 'title', code: 'too_long', message: `Keep the title under ${PUBLISH_LIMITS.titleMax} characters.` });
  }
  if (description.length < PUBLISH_LIMITS.descriptionMin) {
    issues.push({
      field: 'description',
      code: 'too_short',
      message: `Describe what the build does in at least ${PUBLISH_LIMITS.descriptionMin} characters.`,
    });
  }
  if (description.length > PUBLISH_LIMITS.descriptionMax) {
    issues.push({ field: 'description', code: 'too_long', message: `Keep the description under ${PUBLISH_LIMITS.descriptionMax} characters.` });
  }
  if (!tags.length) issues.push({ field: 'tags', code: 'required', message: 'Add at least one tag.' });
  if (tags.length > PUBLISH_LIMITS.tagMax) {
    issues.push({ field: 'tags', code: 'too_many', message: `Use no more than ${PUBLISH_LIMITS.tagMax} tags.` });
  }
  if (tags.some((tag) => tag.length > PUBLISH_LIMITS.tagLengthMax || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag))) {
    issues.push({
      field: 'tags',
      code: 'invalid',
      message: 'Tags may contain lowercase letters, numbers, and single hyphens.',
    });
  }

  const rleBytes = new TextEncoder().encode(rle).byteLength;
  if (!rle || rleBytes > PUBLISH_LIMITS.rleBytesMax) {
    issues.push({ field: 'board', code: 'invalid_size', message: 'The board snapshot is missing or too large.' });
  } else {
    try {
      const parsed = parseRle(rle);
      const coordinatesFitHeader = parsed.coordinates.every(([x, y]) => (
        x >= 0 && y >= 0 && x < parsed.width && y < parsed.height
      ));
      if (!rle.trim().endsWith('!') || !coordinatesFitHeader) {
        issues.push({ field: 'board', code: 'invalid_rle', message: 'The board snapshot is not valid RLE.' });
      } else if (!parsed.coordinates.length) {
        issues.push({ field: 'board', code: 'empty', message: 'Add at least one live cell before publishing.' });
      } else if (parsed.width < 1 || parsed.height < 1
        || parsed.width > PUBLISH_LIMITS.dimensionMax
        || parsed.height > PUBLISH_LIMITS.dimensionMax) {
        issues.push({
          field: 'board',
          code: 'invalid_dimensions',
          message: `Published patterns must fit within ${PUBLISH_LIMITS.dimensionMax} × ${PUBLISH_LIMITS.dimensionMax}.`,
        });
      } else {
        previewReady = createCreationPreviewConfig(creation).cells.length > 0;
      }
    } catch {
      issues.push({ field: 'board', code: 'invalid_rle', message: 'The board snapshot is not valid RLE.' });
    }
  }

  if (!issues.some((issue) => issue.field === 'board') && !previewReady) {
    issues.push({
      field: 'preview',
      code: 'invalid',
      message: 'Choose a preview frame that includes at least one live cell.',
    });
  }

  return {
    ready: issues.length === 0,
    issues,
    checks: {
      metadata: !issues.some((issue) => ['title', 'description', 'tags'].includes(issue.field)),
      board: !issues.some((issue) => issue.field === 'board'),
      preview: previewReady && !issues.some((issue) => issue.field === 'preview'),
    },
  };
}

export function createCreationPreviewConfig(creation, { cameraMode, frame } = {}) {
  const pattern = parseRle(creation?.currentVersion?.rle || creation?.rle || '');
  const coordinates = pattern.coordinates;
  const bounds = getPatternBounds(coordinates);
  const existing = normalizeObject(creation?.previewConfig);
  const mode = cameraMode || existing.camera?.mode || 'fit-pattern';
  const requestedFrame = frame || existing.camera?.frame;
  const cameraFrame = mode === 'current-view'
    ? normalizePreviewFrame(requestedFrame, pattern, bounds)
    : getFittedPreviewFrame(pattern, bounds);
  const { columns, rows } = getPreviewGridSize(cameraFrame);
  const visibleCoordinates = coordinates.filter(([x, y]) => (
    x >= cameraFrame.x
    && y >= cameraFrame.y
    && x < cameraFrame.x + cameraFrame.width
    && y < cameraFrame.y + cameraFrame.height
  ));
  const cells = [...new Set(visibleCoordinates.map(([x, y]) => {
    const scaledX = cameraFrame.width <= 1
      ? 0
      : Math.round((x - cameraFrame.x) / (cameraFrame.width - 1) * (columns - 1));
    const scaledY = cameraFrame.height <= 1
      ? 0
      : Math.round((y - cameraFrame.y) / (cameraFrame.height - 1) * (rows - 1));
    return `${scaledX},${scaledY}`;
  }))]
    .map((cell) => cell.split(',').map(Number))
    .sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
  const title = String(creation?.title || 'Untitled Life build').trim() || 'Untitled Life build';
  const visibleCount = visibleCoordinates.length;
  const totalCount = coordinates.length;
  const countLabel = visibleCount === totalCount
    ? `${totalCount} live ${totalCount === 1 ? 'cell' : 'cells'}`
    : `${visibleCount} of ${totalCount} live cells`;
  const settings = creation?.currentVersion?.settings || creation?.settings || {};

  return {
    version: 1,
    camera: { mode, frame: cameraFrame },
    grid: { columns, rows },
    cells,
    colors: {
      background: normalizePreviewColor(settings.backgroundColor, '#07090f'),
      live: normalizePreviewColor(settings.liveCellColor, '#5eead4'),
    },
    altText: `Preview of ${title}: ${countLabel} in a ${cameraFrame.width} by ${cameraFrame.height} frame.`,
  };
}

function getFittedPreviewFrame(pattern, bounds) {
  const padding = 1;
  const x = Math.max(0, bounds.minX - padding);
  const y = Math.max(0, bounds.minY - padding);
  return {
    x,
    y,
    width: Math.max(1, Math.min(pattern.width - x, bounds.width + padding * 2)),
    height: Math.max(1, Math.min(pattern.height - y, bounds.height + padding * 2)),
  };
}

function normalizePreviewFrame(frame, pattern, bounds) {
  if (!frame || !Number.isFinite(Number(frame.x)) || !Number.isFinite(Number(frame.y))) {
    return getFittedPreviewFrame(pattern, bounds);
  }
  const x = Math.max(0, Math.min(pattern.width - 1, Math.floor(Number(frame.x))));
  const y = Math.max(0, Math.min(pattern.height - 1, Math.floor(Number(frame.y))));
  return {
    x,
    y,
    width: Math.max(1, Math.min(pattern.width - x, Math.floor(Number(frame.width)) || 1)),
    height: Math.max(1, Math.min(pattern.height - y, Math.floor(Number(frame.height)) || 1)),
  };
}

function getPreviewGridSize(frame) {
  // Downsample large boards, but never pull neighboring cells apart by
  // upscaling a small pattern into a larger, mostly empty grid.
  const scale = Math.min(1, 24 / frame.width, 16 / frame.height);
  return { columns: Math.max(1, Math.round(frame.width * scale)),
    rows: Math.max(1, Math.round(frame.height * scale)) };
}

function normalizePreviewColor(value, fallback) {
  const color = String(value || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

export function assertCreationPublishReady(creation) {
  const readiness = getCreationPublishReadiness(creation);
  if (readiness.ready) return readiness;
  const error = new Error(readiness.issues[0]?.message || 'Creation is not ready to publish.');
  error.name = 'PublishValidationError';
  error.code = 'PUBLISH_VALIDATION_FAILED';
  error.issues = readiness.issues;
  throw error;
}

export function createOwnerScopedSlug(title, existingSlugs = []) {
  const base = slugify(title) || 'life-build';
  const used = new Set(existingSlugs.map((slug) => String(slug || '').toLowerCase()));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function unpublishCreation(creation, { now = () => new Date().toISOString() } = {}) {
  return {
    ...creation,
    visibility: 'private',
    canonicalUrl: null,
    publishedAt: null,
    updatedAt: now(),
  };
}

export function toggleStar(creation, profileId) {
  if (!profileId) return creation;

  const starredBy = new Set(creation.starredBy || []);

  if (starredBy.has(profileId)) {
    starredBy.delete(profileId);
  } else {
    starredBy.add(profileId);
  }

  return {
    ...creation,
    starredBy: [...starredBy].sort(),
    starCount: starredBy.size,
  };
}

export function cloneCreation(source, {
  id,
  profile,
  now = () => new Date().toISOString(),
} = {}) {
  return createCreationDraft({
    id,
    profile,
    title: createRemixTitle({ sourceTitle: source.title, profile }),
    description: source.description,
    tags: source.tags,
    attribution: source.attribution,
    tutorialReference: source.tutorialReference,
    previewConfig: source.previewConfig,
    publishReadiness: source.publishReadiness,
    rle: source.currentVersion?.rle,
    width: source.currentVersion?.width,
    height: source.currentVersion?.height,
    generation: source.currentVersion?.generation,
    population: source.currentVersion?.population,
    thumbnail: source.thumbnail,
    settings: source.currentVersion?.settings,
    parentCreation: source,
    now,
  });
}

export function createRemixTitle({ sourceTitle, profile } = {}) {
  const owner = String(profile?.displayName || profile?.username || 'My').trim() || 'My';
  const suffix = owner.toLowerCase().endsWith('s') ? "'" : "'s";
  return `${owner}${suffix} version of ${String(sourceTitle || 'Untitled design').trim() || 'Untitled design'}`;
}

export function addCreationComment(creation, {
  profileId = 'profile-local',
  authorName = 'Life Builder',
  body,
  now = () => new Date().toISOString(),
} = {}) {
  const cleanBody = String(body || '').trim();
  if (!cleanBody) return creation;

  const createdAt = now();
  const comment = {
    id: `comment-${hashString(`${creation.id}:${profileId}:${cleanBody}:${createdAt}`)}`,
    profileId,
    authorName: String(authorName || 'Life Builder').trim(),
    body: cleanBody,
    createdAt,
  };
  const comments = [...normalizeComments(creation.comments), comment];

  return {
    ...creation,
    comments,
    commentCount: comments.length,
    updatedAt: createdAt,
  };
}

export function getTrendingCreations(creations, { now = () => new Date() } = {}) {
  const nowDate = now();
  const timestamp = nowDate instanceof Date ? nowDate.getTime() : new Date(nowDate).getTime();

  return creations
    .filter((creation) => creation.visibility === 'public')
    .map((creation) => ({
      creation,
      score: getTrendingScore(creation, timestamp),
    }))
    .sort((left, right) => right.score - left.score || right.creation.updatedAt.localeCompare(left.creation.updatedAt))
    .map(({ creation }) => creation);
}

export function loadCommunityState(storage = window.localStorage, key = COMMUNITY_STORAGE_KEY) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return createCommunityState();

    return normalizeCommunityState(JSON.parse(raw));
  } catch {
    return createCommunityState();
  }
}

// Stored state (localStorage or IndexedDB) is untrusted: anything that is not
// the expected shape is dropped rather than left to throw while rendering.
export function normalizeCommunityState(value) {
  const stored = normalizeObject(value);
  return createCommunityState({
    profile: isPlainObject(stored.profile) ? stored.profile : null,
    creations: Array.isArray(stored.creations) ? stored.creations.filter(isPlainObject).map(normalizeCreation) : [],
    activeCreationId: typeof stored.activeCreationId === 'string' ? stored.activeCreationId : null,
  });
}

export function saveCommunityState(state, storage = window.localStorage, key = COMMUNITY_STORAGE_KEY) {
  storage.setItem(key, JSON.stringify(createCommunityState(state)));
}

export function replaceCreation(creations, nextCreation) {
  const index = creations.findIndex((creation) => creation.id === nextCreation.id);

  if (index === -1) return [nextCreation, ...creations];

  return creations.map((creation) => (creation.id === nextCreation.id ? nextCreation : creation));
}

export function incrementCloneCount(creation) {
  return {
    ...creation,
    cloneCount: Number(creation.cloneCount || 0) + 1,
  };
}

function getTrendingScore(creation, nowTimestamp) {
  const publishedTimestamp = new Date(creation.publishedAt || creation.updatedAt || 0).getTime();
  const ageDays = Math.max(0, (nowTimestamp - publishedTimestamp) / 86_400_000);
  const freshness = Math.max(0, 14 - ageDays);

  return (
    Number(creation.starCount || 0) * 8
    + Number(creation.cloneCount || 0) * 13
    + Number(creation.viewCount || 0) * 0.5
    + freshness
  );
}

function normalizeTags(tags, { limit = true } = {}) {
  const source = Array.isArray(tags) ? tags : String(tags || '').split(',');
  const seen = new Set();

  for (const tag of source) {
    const normalized = slugify(tag);
    if (normalized) seen.add(normalized);
    if (limit && seen.size >= PUBLISH_LIMITS.tagMax) break;
  }

  return [...seen];
}

function normalizeComments(comments) {
  if (!Array.isArray(comments)) return [];

  return comments
    .map((comment) => ({
      id: String(comment.id || `comment-${hashString(comment.body || '')}`),
      profileId: String(comment.profileId || 'profile-local'),
      authorName: String(comment.authorName || 'Life Builder').trim(),
      body: String(comment.body || '').trim(),
      createdAt: String(comment.createdAt || new Date().toISOString()),
    }))
    .filter((comment) => comment.body);
}

function normalizeCreation(creation) {
  const versions = getCreationVersions({
    versions: Array.isArray(creation.versions) ? creation.versions.filter(isPlainObject) : [],
    currentVersion: isPlainObject(creation.currentVersion) ? creation.currentVersion : null,
  });
  const currentVersion = versions.find((version) => version.id === creation.currentVersion?.id)
    || versions.at(-1)
    || null;
  return {
    attribution: '',
    tutorialReference: '',
    previewConfig: {},
    publishReadiness: {},
    archivedAt: null,
    ...creation,
    currentVersion,
    versions,
  };
}

function normalizeObject(value) {
  return isPlainObject(value) ? { ...value } : {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getIdSuffix(id) {
  return String(id || '').split('-').filter(Boolean).at(-1) || hashString(String(id)).slice(0, 4);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hashString(value) {
  let hash = 2166136261;

  for (const char of String(value || 'life')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) ^ 0x8f7b2c22).toString(16).padStart(8, '0');
}
