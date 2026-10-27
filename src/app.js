import {
  cellIndex,
  clearBoard,
  createBoard,
  createRandomBoard,
  getCell,
  getPopulation,
  cloneBoard,
  placePattern,
  wrap,
} from './life.js';
import { boardFromRle, boardToRle, createBoardHistory, copySelection, pasteSelection, transformSelection } from './board-tools.js';
import { createSimulationClient } from './simulation-client.js';
import {
  CIRCUIT_MAX_GATES,
  buildCircuit,
  buildCircuitExperiment,
  circuitExperiments,
  circuitPresets,
  readCircuitOutputs,
  validateCircuit,
} from './circuits.js';
import {
  INPUT_NAMES,
  countSpecGates,
  describeSpec,
  getSpecInputs,
  growLeaf,
  isGateNode,
  isInputNode,
  normalizeCircuitSpec,
  removeGate,
  setInputValue,
  setLeafInput,
  treeToChain,
  wrapOutput,
} from './circuit-spec.js';
import { decodeMasterwork, getMasterwork, loadMasterwork as loadMasterworkCells, masterworks } from './masterworks.js';
import { createCommunityRepository, migrateLocalState } from './community-repository.js';
import {
  addCreationComment,
  createCreationPreviewConfig,
  createRemixTitle,
  getCreationPublishReadiness,
} from './community.js';
import { encodeShareLink, decodeShareLink } from './share.js';
import {
  encodeRle,
  getPatternBounds,
  getPresetGroup,
  parseRle,
  transformCoordinates,
} from './patterns.js';
import {
  getContextualGroup,
  getHapticPattern,
  getLiveToolAction,
  getPinchZoom,
  getToolAfterWorkspaceChange,
  getToolForKey,
  getWheelAction,
} from './interaction.js';
import {
  createDesignSettings,
  mergeDesignSettings,
  serializeDesignSettings,
} from './design-settings.js';
import {
  formatCellCount,
  formatStatus,
  getCircuitMarkers,
  getFitZoom,
  getInputCombinations,
  getLampLabel,
  getLampState,
  getModeForPath,
  getPathForMode,
  getPublishLabel,
  getSaveStateText,
} from './workspace.js';
import { presetGroups, presets } from './presets.js';
import { createPendingActionStore, validateAccountFields } from './account-flow.js';
import { readRecovery, writeRecovery, deleteRecovery, safeStorage } from './local-database.js';

const WORLD_WIDTH = 300;
const WORLD_HEIGHT = 200;
const LOCAL_RECOVERY_KEY = 'life-logic-dev-recovery-v1';
const THEME_KEY = 'life-theme';
const BASE_CELL_SIZE = 10;
// The manual zoom floor for ordinary boards; a board too big to fit at this
// floor lowers it (see getMinZoom) so Fit always succeeds.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.6;
// Below this on-screen cell size, cells are drawn through a downsampled bitmap
// where a pixel lights when any cell under it is alive.
const BITMAP_CELL_SIZE = 1.5;
const MAX_MAIN_THREAD_CATCH_UP_STEPS = 4;
const SPEED_STEPS = [1, 2, 5, 10, 20, 40];
const MOBILE_QUERY = window.matchMedia('(max-width: 899px)');
const DEFAULT_DESIGN_SETTINGS = createDesignSettings({
  gridPreset: 'medium',
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
});

const PATTERN_NOTES = {
  'random-soup': 'Fill the board at random',
  block: 'Four cells that never change',
  beehive: 'A six-cell still life',
  loaf: 'A seven-cell still life',
  boat: 'A five-cell still life',
  tub: 'A four-cell diamond that stays still',
  blinker: 'A two-step rhythm',
  toad: 'A period-2 oscillator',
  beacon: 'Two blocks blinking at the corners',
  glider: 'A five-cell traveler',
  lwss: 'A ship that flies sideways',
  pulsar: 'A three-step oscillator',
  pentadecathlon: 'A period-15 oscillator',
  'traffic-light': 'Becomes four blinkers',
  'small-exploder': 'Blooms, then leaves debris',
  'ten-cell-row': 'A row that breaks apart',
  'glider-pair': 'Two gliders on their way',
  'gosper-gun': 'A repeating glider source',
  'r-pentomino': 'Five cells, a thousand generations of chaos',
  diehard: 'Vanishes after 130 generations',
  acorn: 'Seven cells that grow for ages',
  'gun-battery': 'Three guns firing together',
  'spaceship-squadron': 'A fleet of eight ships',
  'pulsar-constellation': 'Eight pulsars breathing',
  'methuselah-garden': 'Long-lived seeds, spaced out',
  'glider-fleet': 'Nine gliders in formation',
  'blinker-wave': 'A wall of phased blinkers',
};

const GATE_CARDS = {
  and: { name: 'AND', note: 'Outputs a signal only if both inputs are present' },
  or: { name: 'OR', note: 'Outputs a signal if either input is present' },
  not: { name: 'NOT', note: 'Outputs a signal only when input A is absent' },
  'half-adder': { name: 'Half-adder', note: 'Adds two bits. Outputs Sum and Carry.' },
};

// Card notes for ready-made circuits, in terms of behaviour, not wiring.
const PRESET_NOTES = {
  xor: 'On when exactly one input is on.',
};

// The Library's last group: famous large patterns from masterworks.js.
const MASTERWORKS_GROUP = { id: 'masterworks', title: 'Masterworks' };

const PORT_ARROWS = { west: '→', south: '↑', north: '↓', east: '←' };

// Publish readiness in plain words, keyed by the shared validator's field:code.
const PUBLISH_ISSUE_COPY = {
  'title:required': 'Give the project a title.',
  'title:too_long': 'Keep the title under 120 characters.',
  'description:too_short': 'Add a description of at least 20 characters.',
  'description:too_long': 'Keep the description under 2,000 characters.',
  'tags:required': 'Add at least one tag.',
  'tags:too_many': 'Use no more than 8 tags.',
  'tags:invalid': 'Tags can use lowercase letters, numbers and single hyphens.',
  'board:invalid_size': 'The board is empty or too large to publish.',
  'board:invalid_dimensions': 'Boards must fit within 2,048 × 2,048 to publish.',
  'board:empty': 'Add at least one live cell before publishing.',
  'board:invalid_rle': 'The board snapshot is not valid RLE.',
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $('#world');
const ctx = canvas.getContext('2d', { alpha: false });

const elements = {
  body: document.body,
  canvasHost: $('#canvas-host'),
  modePlayground: $('#mode-playground'),
  modeStudio: $('#mode-studio'),
  modeCommunity: $('#mode-community'),
  topMenuToggle: $('#top-menu-toggle'),
  topMenu: $('#top-menu'),
  themeToggle: $('#theme-toggle'),
  accountEntry: $('#account-entry'),
  accountEntryLabel: $('#account-entry-label'),
  projectHeader: $('#project-header'),
  projectsBack: $('#projects-back'),
  projectTitle: $('#project-title'),
  saveState: $('#save-state'),
  inspectorToggle: $('#inspector-toggle'),
  saveProject: $('#save-project'),
  publishProject: $('#publish-project'),
  publishProjectMobile: $('#publish-project-mobile'),
  projectMenuToggle: $('#project-menu-toggle'),
  projectMenu: $('#project-menu'),
  unpublishProject: $('#unpublish-project'),
  archiveProject: $('#archive-project'),
  deleteProject: $('#delete-project'),
  editor: $('#editor'),
  rail: $('#rail'),
  railTitle: $('#rail-title'),
  railClose: $('#rail-close'),
  railKindTabs: $('#rail-kind-tabs'),
  patternPanel: $('#pattern-panel'),
  patternSearch: $('#pattern-search'),
  patternTabs: $('#pattern-tabs'),
  patternList: $('#pattern-list'),
  logicPanel: $('#logic-panel'),
  logicList: $('#logic-list'),
  sheetBackdrop: $('#sheet-backdrop'),
  toolStrip: $('#tool-strip'),
  toolButtons: $$('#tool-group [data-tool]'),
  selectionGroup: $('#selection-group'),
  stampGroup: $('#stamp-group'),
  stampName: $('#stamp-name'),
  stampRotateLeft: $('#stamp-rotate-left'),
  stampRotateRight: $('#stamp-rotate-right'),
  stampFlip: $('#stamp-flip'),
  stampDone: $('#stamp-done'),
  undo: $('#undo'),
  redo: $('#redo'),
  moreMenuToggle: $('#more-menu-toggle'),
  moreMenu: $('#more-menu'),
  clearBoard: $('#clear-board'),
  openInStudio: $('#open-in-studio'),
  importRle: $('#import-rle'),
  exportRle: $('#export-rle'),
  fitMobile: $('#fit-mobile'),
  shortcuts: $('#shortcuts'),
  howLifeWorksMobile: $('#how-life-works-mobile'),
  playToggle: $('#play-toggle'),
  playLabel: $('#play-label'),
  step: $('#step'),
  reset: $('#reset'),
  speedToggle: $('#speed-toggle'),
  speedLabel: $('#speed-label'),
  speedMenu: $('#speed-menu'),
  zoomOut: $('#zoom-out'),
  zoomIn: $('#zoom-in'),
  zoomLabel: $('#zoom-label'),
  fit: $('#fit'),
  patternsOpen: $('#patterns-open'),
  statusMobile: $('#status-mobile'),
  generation: $('#generation'),
  population: $('#population'),
  populationUnit: $('#population-unit'),
  howLifeWorks: $('#how-life-works'),
  rulesPopover: $('#rules-popover'),
  inspector: $('#inspector'),
  inspectorClose: $('#inspector-close'),
  gridSize: $('#grid-size'),
  gridCustom: $('#grid-custom'),
  gridWidth: $('#grid-width'),
  gridHeight: $('#grid-height'),
  gridApply: $('#grid-apply'),
  edges: $('#edges'),
  circuitSection: $('#circuit-section'),
  circuitName: $('#circuit-name'),
  formulaList: $('#formula-list'),
  chainNote: $('#chain-note'),
  inputsNote: $('#inputs-note'),
  chipMenu: $('#chip-menu'),
  inputsList: $('#inputs-list'),
  outputsList: $('#outputs-list'),
  runCircuit: $('#run-circuit'),
  circuitBar: $('#circuit-bar'),
  circuitBarLamps: $('#circuit-bar-lamps'),
  circuitBarProgress: $('#circuit-bar-progress'),
  runCircuitBar: $('#run-circuit-bar'),
  runProgress: $('#run-progress'),
  runProgressBar: $('#run-progress-bar'),
  runProgressText: $('#run-progress-text'),
  fillTruthTable: $('#fill-truth-table'),
  truthTable: $('#truth-table'),
  projectDescription: $('#project-description'),
  projectTags: $('#project-tags'),
  versionHistory: $('#version-history'),
  projectsPage: $('#projects-page'),
  newProject: $('#new-project'),
  projectsList: $('#projects-list'),
  communityPanel: $('#community-panel'),
  communityGallery: $('#community-gallery'),
  communitySearch: $('#community-search'),
  communityFilters: $('#community-filters'),
  communityStatus: $('#community-status'),
  communityGrid: $('#community-grid'),
  communityDetail: $('#community-detail'),
  accountDialog: $('#account-dialog'),
  accountContext: $('#account-context'),
  accountTabs: $('#account-tabs'),
  accountName: $('#account-name'),
  accountEmail: $('#account-email'),
  accountPassword: $('#account-password'),
  accountRecoveryKey: $('#account-recovery-key'),
  accountSubmit: $('#account-submit'),
  accountOutput: $('#account-output'),
  accountSecurity: $('#account-security'),
  accountCreateRecovery: $('#account-create-recovery'),
  accountSignOut: $('#account-sign-out'),
  accountRecoveryOutput: $('#account-recovery-output'),
  accountDeleteConfirmation: $('#account-delete-confirmation'),
  accountDelete: $('#account-delete'),
  rleDialog: $('#rle-dialog'),
  rleDialogTitle: $('#rle-dialog-title'),
  rleNote: $('#rle-note'),
  rleField: $('#rle-field'),
  rleError: $('#rle-error'),
  rleCopy: $('#rle-copy'),
  rleStamp: $('#rle-stamp'),
  shortcutsDialog: $('#shortcuts-dialog'),
  toast: $('#toast'),
};

// localStorage itself, or an in-memory stand-in when the browser blocks it.
const browserStorage = safeStorage();
const localCommunity = createCommunityRepository({ backend: 'local' });
const pendingActions = createPendingActionStore();
let community = localCommunity;
let communityState = community.getState();

const communityRuntimeConfig = getCommunityRuntimeConfig();
const communityAuth = {
  cloudRequested: ['supabase', 'postgres'].includes(communityRuntimeConfig.backend),
  cloudConfigured: isCloudCommunityConfigured(communityRuntimeConfig),
  cloudRepo: null,
  supabaseClient: null,
  session: null,
  user: null,
  initializing: false,
  submitting: false,
  migrating: false,
  migratedUserId: null,
  message: '',
  unsubscribe: null,
};
let feedbackTimer = null;
let recoveryTimer = null;
let palette = {};
const gateThumbnailCache = new Map();
const masterworkThumbnailCache = new Map();
// Downsampled bitmap of the visible cells, reused while nothing it shows changes.
const bitmap = { canvas: null, context: null, image: null, pixels: null, key: '' };

const state = {
  board: createBoard(DEFAULT_DESIGN_SETTINGS.width, DEFAULT_DESIGN_SETTINGS.height),
  authoredStart: null,
  history: withEdgeMemory(createBoardHistory()),
  clipboard: null,
  selection: null,
  circuit: null,
  // The normalized circuit spec the inspector edits; circuit is its build.
  circuitSpec: null,
  circuitOutputs: null,
  circuitRunning: false,
  circuitRate: 0,
  chipMenu: null,
  masterworkLoading: null,
  truthRows: null,
  // Bumped whenever cells change in place (drawing), so cached bitmaps refresh.
  boardRevision: 0,
  simulation: null,
  simulationLoad: null,
  selectedPreset: null,
  stampRotation: 0,
  stampFlipX: false,
  playing: false,
  speed: 10,
  zoom: 1,
  mode: 'playground',
  // Playground and Studio keep separate boards; the inactive one is stashed here.
  boardOwner: 'playground',
  workspaces: {},
  recoveryPending: false,
  viewWidth: 0,
  viewHeight: 0,
  studioView: 'project',
  railTab: 'patterns',
  session: null,
  designSettings: DEFAULT_DESIGN_SETTINGS,
  designDirty: false,
  saveStatus: 'saved',
  publishStatus: 'draft',
  previewConfig: {},
  recoveryFailed: false,
  simulationStepPending: false,
  stepQueued: false,
  panX: 0,
  panY: 0,
  viewInitialized: false,
  pendingFit: null,
  pendingCenter: false,
  tool: 'draw',
  activePresetGroup: presetGroups[0].id,
  patternQuery: '',
  selectedCommunityId: null,
  communityView: 'gallery',
  communitySearch: '',
  communityFilter: 'all',
  communityComments: {},
  publicCreations: [],
  publicProfile: null,
  patternFavorites: [],
  communityLoadStatus: 'idle',
  trendingCreations: [],
  accountMode: 'sign-in',
  pointer: {
    active: false,
    mode: 'draw',
    lastCell: null,
    lastX: 0,
    lastY: 0,
    rect: null,
    before: null,
    pointers: new Map(),
    pinch: null,
  },
  hoverCell: null,
  lastTick: 0,
  accumulator: 0,
};

/* ---------------------------------------------------------------------------
 * Runtime config and cloud community backend
 * ------------------------------------------------------------------------- */

function getCommunityRuntimeConfig() {
  const config = readInlineRuntimeConfig() || window.LIFE_LOGIC_COMMUNITY || {};
  const supabase = config.supabase || {};

  return {
    backend: config.backend || supabase.backend || 'local',
    supabaseUrl: config.supabaseUrl || config.url || config.SUPABASE_URL || supabase.url || supabase.supabaseUrl,
    supabaseAnonKey:
      config.supabaseAnonKey
      || config.anonKey
      || config.anon_key
      || config.key
      || config.SUPABASE_ANON_KEY
      || supabase.anonKey
      || supabase.anon_key
      || supabase.key,
    supabaseModuleUrl:
      config.supabaseModuleUrl
      || config.moduleUrl
      || supabase.moduleUrl
      || 'https://esm.sh/@supabase/supabase-js@2',
    apiBase: config.apiBase || '/api/community',
    authBase: config.authBase || '/api/auth',
    redirectTo: config.redirectTo || window.location.href.split('#')[0],
  };
}

function readInlineRuntimeConfig() {
  const script = document.querySelector('#life-runtime-config');
  const text = script?.textContent?.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isSupabaseCommunityConfigured(config) {
  return config.backend === 'supabase' && Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

function isCloudCommunityConfigured(config) {
  return config.backend === 'postgres' || isSupabaseCommunityConfigured(config);
}

async function initializeCommunityBackend() {
  renderCommunityAuth();

  if (communityAuth.cloudRequested && !communityAuth.cloudConfigured) {
    communityAuth.message = 'Cloud configuration is incomplete.';
    renderCommunityAuth();
    return;
  }

  if (!communityAuth.cloudConfigured) return;

  communityAuth.initializing = true;
  communityAuth.message = 'Connecting…';
  renderCommunityAuth();

  try {
    if (communityRuntimeConfig.backend === 'postgres') {
      const cloudRepo = createCommunityRepository({
        backend: 'postgres',
        apiBase: communityRuntimeConfig.apiBase,
        authBase: communityRuntimeConfig.authBase,
      });
      communityAuth.cloudRepo = cloudRepo;
      subscribeCommunityAuth(cloudRepo);

      const session = await readCommunityAuthSession(cloudRepo);
      if (session) {
        await handleCommunityAuthSession(session, { reason: 'initial session' });
        if (isCloudCommunityActive()) await resumePendingAccountAction();
      } else {
        communityAuth.message = 'Sign in to publish, star, or comment.';
        renderCommunityAuth();
      }
      return;
    }

    const client = await createSupabaseClientFromRuntime(communityRuntimeConfig);
    const cloudRepo = createCommunityRepository({ backend: 'supabase', client });
    communityAuth.supabaseClient = client;
    communityAuth.cloudRepo = cloudRepo;
    subscribeCommunityAuth(cloudRepo);

    const session = await readCommunityAuthSession(cloudRepo);
    if (session) {
      await handleCommunityAuthSession(session, { reason: 'initial session' });
      if (isCloudCommunityActive()) await resumePendingAccountAction();
    } else {
      communityAuth.message = 'Sign in to publish, star, or comment.';
      renderCommunityAuth();
    }
  } catch (error) {
    community = localCommunity;
    communityState = localCommunity.getState();
    communityAuth.message = `Cloud unavailable: ${getErrorMessage(error)}`;
    renderCommunity();
  } finally {
    communityAuth.initializing = false;
    renderCommunityAuth();
  }
}

async function createSupabaseClientFromRuntime(config) {
  const { createClient } = await import(config.supabaseModuleUrl);

  if (typeof createClient !== 'function') {
    throw new Error('Supabase client module did not export createClient.');
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
}

function subscribeCommunityAuth(repo) {
  if (typeof communityAuth.unsubscribe === 'function') {
    communityAuth.unsubscribe();
    communityAuth.unsubscribe = null;
  }

  const handleChange = (...args) => {
    const session = normalizeAuthSession(getSessionFromAuthCallback(args));
    handleCommunityAuthSession(session, { reason: 'auth change' }).catch((error) => {
      communityAuth.message = `Auth update failed: ${getErrorMessage(error)}`;
      renderCommunityAuth();
    });
  };

  let subscription = null;
  if (typeof repo.onAuthStateChange === 'function') {
    subscription = repo.onAuthStateChange(handleChange);
  } else if (communityAuth.supabaseClient?.auth?.onAuthStateChange) {
    subscription = communityAuth.supabaseClient.auth.onAuthStateChange((event, session) => {
      handleChange(event, session);
    });
  }

  communityAuth.unsubscribe = getUnsubscribe(subscription);
}

function getSessionFromAuthCallback(args) {
  const [eventOrSession, maybeSession] = args;

  if (maybeSession === null || maybeSession?.user || maybeSession?.access_token) return maybeSession;
  if (eventOrSession === null) return null;
  if (eventOrSession?.session !== undefined) return eventOrSession.session;
  if (eventOrSession?.user || eventOrSession?.access_token) return eventOrSession;

  return null;
}

function getUnsubscribe(subscription) {
  if (typeof subscription === 'function') return subscription;
  if (typeof subscription?.unsubscribe === 'function') return () => subscription.unsubscribe();
  if (typeof subscription?.data?.subscription?.unsubscribe === 'function') {
    return () => subscription.data.subscription.unsubscribe();
  }
  return null;
}

async function readCommunityAuthSession(repo) {
  if (typeof repo?.getAuthSession === 'function') {
    return normalizeAuthSession(await repo.getAuthSession());
  }

  if (communityAuth.supabaseClient?.auth?.getSession) {
    const { data, error } = await communityAuth.supabaseClient.auth.getSession();
    if (error) throw new Error(error.message || 'Could not read auth session.');
    return normalizeAuthSession(data?.session);
  }

  return null;
}

async function readCommunityAuthUser(repo, session) {
  if (typeof repo?.getAuthUser === 'function') {
    return normalizeAuthUser(await repo.getAuthUser());
  }

  if (session?.user) return session.user;

  if (communityAuth.supabaseClient?.auth?.getUser) {
    const { data, error } = await communityAuth.supabaseClient.auth.getUser();
    if (error) throw new Error(error.message || 'Could not read auth user.');
    return normalizeAuthUser(data?.user);
  }

  return null;
}

function normalizeAuthSession(value) {
  if (!value) return null;
  if (value.data?.session !== undefined) return value.data.session;
  if (value.session !== undefined) return value.session;
  return value;
}

function normalizeAuthUser(value) {
  if (!value) return null;
  if (value.data?.user !== undefined) return value.data.user;
  if (value.user !== undefined) return value.user;
  return value;
}

async function handleCommunityAuthSession(session, { reason = '' } = {}) {
  const normalizedSession = normalizeAuthSession(session);

  if (!normalizedSession?.user) {
    communityAuth.session = null;
    communityAuth.user = null;
    communityAuth.migratedUserId = null;
    community = localCommunity;
    communityState = localCommunity.getState();
    if (communityAuth.cloudConfigured && reason) {
      communityAuth.message = 'Signed out. Projects stay on this device.';
    }
    renderCommunity();
    return;
  }

  communityAuth.session = normalizedSession;
  communityAuth.user = normalizedSession.user;
  await activateCloudCommunity(normalizedSession);
}

async function activateCloudCommunity(session) {
  const repo = communityAuth.cloudRepo;
  if (!repo || communityAuth.migrating) return;

  const user = await readCommunityAuthUser(repo, session);
  communityAuth.user = user || session.user;

  if (communityAuth.migratedUserId === communityAuth.user?.id && community === repo) {
    renderCommunity();
    return;
  }

  communityAuth.migrating = true;
  communityAuth.message = hasLocalCommunityData()
    ? 'Moving local projects to your account…'
    : 'Syncing your account…';
  renderCommunityAuth();

  try {
    await saveCloudProfileFromLocal(repo, communityAuth.user);
    const migration = await migrateLocalState(localCommunity, repo, { deferCleanup: true });
    await repo.loadCommunityState();
    const mappings = localCommunity.getState().importMappings || {};
    remapActiveSession(
      { ...Object.fromEntries(Object.entries(mappings).map(([id, mapping]) => [id, mapping.cloudProjectId])), ...migration?.creationMap },
      { ...Object.fromEntries(Object.entries(mappings).map(([id, mapping]) => [id, mapping.versionIds])), ...migration?.versionMaps },
    );
    community = repo;
    communityState = community.getState();
    communityAuth.migratedUserId = communityAuth.user?.id || null;
    communityAuth.message = getMigrationMessage(migration);
    renderCommunity();
    // Activation is complete. Cleanup failures retain a safe local copy and
    // must never switch this cloud-ID editor back to a local repository.
    for (const result of migration.results || []) {
      try {
        await localCommunity.commitImportedSnapshot(result.snapshot.creation.id, result.snapshot, result.mapping);
      } catch {
        communityAuth.message = 'Account ready. A local backup was kept because cleanup could not finish.';
      }
    }
  } catch (error) {
    community = localCommunity;
    communityState = localCommunity.getState();
    communityAuth.message = `Sync paused: ${getErrorMessage(error)}`;
    showToast('Signed in. Projects stayed on this device.', { kind: 'info' });
    renderCommunity();
  } finally {
    communityAuth.migrating = false;
    renderCommunityAuth();
  }
}

function remapActiveSession(creationMap, versionMaps = {}) {
  const localId = state.session?.creationId;
  const cloudId = localId && creationMap?.[localId];
  if (!cloudId) return;

  state.session = { ...state.session, creationId: cloudId };
  if (state.session.currentVersionId && versionMaps?.[localId]?.[state.session.currentVersionId]) {
    state.session.currentVersionId = versionMaps[localId][state.session.currentVersionId];
  }
  if (state.designDirty) scheduleLocalRecovery();
}

async function saveCloudProfileFromLocal(repo, user) {
  const localProfile = localCommunity.getState().profile;
  const email = localProfile?.email || user?.email || '';
  // The local profile's default name is a placeholder; prefer the account's.
  const displayName = user?.name
    || getDisplayNameFromEmail(email)
    || localProfile?.displayName
    || 'Member';

  await repo.saveProfile({ email, displayName });
}

function getMigrationMessage(migration) {
  const migratedCount = migration?.migratedCreations?.length || 0;

  if (migratedCount > 0) {
    return `Moved ${migratedCount} local ${migratedCount === 1 ? 'project' : 'projects'} to your account.`;
  }

  return 'Account ready.';
}

function hasLocalCommunityData() {
  const localState = localCommunity.getState();
  return Boolean(localState.profile || localState.creations.length > 0);
}

function getDisplayNameFromEmail(email) {
  const [name] = String(email || '').split('@');
  return name ? name.replace(/[._-]+/g, ' ') : '';
}

function isCloudSignedIn() {
  return Boolean(communityAuth.session?.user || communityAuth.user);
}

function isCloudCommunityActive() {
  return communityAuth.cloudConfigured && community === communityAuth.cloudRepo && isCloudSignedIn();
}

function requiresCloudSignInForSharedAction() {
  return !isCloudCommunityActive();
}

function queueAccountAction(type, args = {}, context = '') {
  const pending = pendingActions.set({ type, args, returnRoute: window.location.pathname + window.location.search });
  openAccountDialog({ context: context || `Sign in to continue ${type.replaceAll('-', ' ')}.` });
  return pending;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

/* ---------------------------------------------------------------------------
 * Account dialog
 * ------------------------------------------------------------------------- */

function openAccountDialog({ mode = 'sign-in', context = '' } = {}) {
  if (!elements.accountDialog.open) state.accountDialogTrigger = document.activeElement;
  state.accountMode = mode;
  elements.accountContext.textContent = context || (isCloudSignedIn()
    ? 'Your account is active everywhere in Life Lab.'
    : communityAuth.cloudConfigured
      ? 'Sign in to publish, star, and comment.'
      : 'Accounts are not available in this local build. Projects stay on this device.');
  renderAccountDialog();
  if (!elements.accountDialog.open) elements.accountDialog.showModal();
}

function trapAccountDialogFocus(event) {
  if (event.key !== 'Tab' || !elements.accountDialog.open) return;
  const focusable = [...elements.accountDialog.querySelectorAll('button, input, select, textarea, [href], [tabindex]')]
    .filter((element) => !element.disabled && !element.hidden && element.tabIndex >= 0
      && element.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function renderAccountDialog() {
  const signedIn = isCloudSignedIn();
  const mode = state.accountMode;
  for (const tab of elements.accountTabs.querySelectorAll('[data-account-mode]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.accountMode === mode));
    tab.disabled = signedIn;
  }
  elements.accountTabs.hidden = signedIn;
  document.querySelector('[data-account-field="name"]').hidden = signedIn || mode !== 'sign-up';
  document.querySelector('[data-account-field="recovery"]').hidden = signedIn || mode !== 'recover';
  elements.accountEmail.parentElement.hidden = signedIn;
  elements.accountSubmit.textContent = mode === 'sign-up' ? 'Create account' : mode === 'recover' ? 'Recover account' : 'Sign in';
  elements.accountSubmit.hidden = signedIn;
  elements.accountSubmit.disabled = !communityAuth.cloudConfigured || communityAuth.submitting;
  elements.accountSecurity.hidden = !signedIn;
  if (signedIn) elements.accountContext.textContent = `Signed in as ${communityAuth.user?.email || communityAuth.session?.user?.email || communityAuth.user?.name || 'your account'}.`;
}

async function submitAccountDialog() {
  const mode = state.accountMode;
  const input = {
    mode,
    name: elements.accountName.value,
    email: elements.accountEmail.value,
    password: elements.accountPassword.value,
    recoveryKey: elements.accountRecoveryKey.value,
  };
  const validation = validateAccountFields(input);
  if (!validation.valid) {
    elements.accountOutput.className = 'account-output error';
    elements.accountOutput.textContent = Object.values(validation.issues)[0];
    return;
  }
  communityAuth.submitting = true;
  renderAccountDialog();
  elements.accountOutput.className = 'account-output';
  elements.accountOutput.textContent = mode === 'recover' ? 'Recovering account…' : mode === 'sign-up' ? 'Creating account…' : 'Signing in…';
  try {
    if (mode === 'recover') {
      const result = await communityAuth.cloudRepo.recoverAccount({ email: validation.email, recoveryKey: input.recoveryKey.trim(), password: input.password });
      elements.accountRecoveryOutput.hidden = false;
      elements.accountRecoveryOutput.textContent = result.recoveryKey || result.key || 'A new recovery key was created. Save the key returned by the service.';
      elements.accountOutput.textContent = 'Password changed. All previous sessions were revoked; sign in with the new password.';
      elements.accountOutput.className = 'account-output success';
      state.accountMode = 'sign-in';
      return;
    }
    if (mode === 'sign-up') await communityAuth.cloudRepo.signUpWithEmail({ name: input.name.trim(), email: validation.email, password: input.password });
    else await communityAuth.cloudRepo.signInWithEmail({ email: validation.email, password: input.password });
    elements.accountPassword.value = '';
    await refreshCommunitySession(mode === 'sign-up' ? 'account created' : 'signed in');
    elements.accountOutput.textContent = 'Account ready.';
    elements.accountOutput.className = 'account-output success';
    await resumePendingAccountAction();
  } catch (error) {
    elements.accountOutput.textContent = getErrorMessage(error);
    elements.accountOutput.className = 'account-output error';
  } finally {
    communityAuth.submitting = false;
    renderAccountDialog();
  }
}

async function resumePendingAccountAction() {
  const stored = pendingActions.get();
  if (!stored) return;
  const pending = pendingActions.markAttempted(stored.token);
  if (!pending) return;
  try {
    let result;
    if (pending.type === 'publish') result = await saveCurrentCreation({ publish: true, resumed: true });
    else if (pending.type === 'favorite-creation') result = await starCommunityCreation(pending.args.creationId, { resumed: true });
    else if (pending.type === 'favorite-pattern') result = await community.setPatternFavorite(pending.args.patternId, true);
    else if (pending.type === 'comment') result = await postCommunityComment({ body: pending.args.body, creationId: pending.args.creationId, resumed: true });
    if (!result) throw new Error('The requested action was not confirmed.');
    pendingActions.clear(pending.token);
    elements.accountDialog.close();
  } catch (error) {
    pendingActions.retry(pending.token);
    elements.accountOutput.textContent = `Signed in, but the action needs a retry: ${getErrorMessage(error)}`;
    elements.accountOutput.className = 'account-output error';
  }
}

async function generateRecoveryKey() {
  const password = elements.accountPassword.value;
  const validation = validateAccountFields({ mode: 'sign-in', email: communityAuth.user?.email || 'signed@in.test', password });
  if (!validation.valid) { elements.accountOutput.textContent = validation.issues.password; return; }
  try {
    const result = await communityAuth.cloudRepo.createRecoveryKey(password);
    elements.accountRecoveryOutput.hidden = false;
    elements.accountRecoveryOutput.textContent = result.recoveryKey || result.key;
    elements.accountOutput.textContent = 'Save this recovery key now. It will not be shown again.';
    elements.accountOutput.className = 'account-output success';
    elements.accountPassword.value = '';
  } catch (error) { elements.accountOutput.textContent = getErrorMessage(error); elements.accountOutput.className = 'account-output error'; }
}

async function deleteCurrentAccount() {
  const validation = validateAccountFields({ mode: 'delete', email: communityAuth.user?.email || 'signed@in.test', password: elements.accountPassword.value, confirmation: elements.accountDeleteConfirmation.value });
  if (!validation.valid) { elements.accountOutput.textContent = Object.values(validation.issues)[0]; elements.accountOutput.className = 'account-output error'; return; }
  try {
    await communityAuth.cloudRepo.deleteAccount(elements.accountPassword.value);
    await handleCommunityAuthSession(null, { reason: 'account deleted' });
    elements.accountDialog.close();
    showToast('Account deleted', { kind: 'success' });
  } catch (error) { elements.accountOutput.textContent = getErrorMessage(error); elements.accountOutput.className = 'account-output error'; }
}

async function refreshCommunitySession(reason) {
  const session = await readCommunityAuthSession(communityAuth.cloudRepo);
  if (!session) throw new Error('Account action did not create a session. Try signing in again.');
  await handleCommunityAuthSession(session, { reason });
}

async function signOutCommunity() {
  if (!communityAuth.cloudConfigured) return;

  try {
    if (typeof communityAuth.cloudRepo?.signOut === 'function') {
      await communityAuth.cloudRepo.signOut();
    } else if (communityAuth.supabaseClient?.auth?.signOut) {
      const { error } = await communityAuth.supabaseClient.auth.signOut();
      if (error) throw new Error(error.message || 'Could not sign out.');
    }
    communityAuth.message = 'Signed out. Projects stay on this device.';
  } catch (error) {
    communityAuth.message = `Could not sign out: ${getErrorMessage(error)}`;
  } finally {
    communityAuth.session = null;
    communityAuth.user = null;
    communityAuth.migratedUserId = null;
    community = localCommunity;
    communityState = localCommunity.getState();
    renderCommunity();
  }
}

function renderCommunityAuth() {
  const signedIn = isCloudSignedIn();
  const user = communityAuth.user || communityAuth.session?.user;
  elements.accountEntryLabel.textContent = signedIn
    ? (user?.name || getDisplayNameFromEmail(user?.email) || 'Account')
    : 'Sign in';
  // A local-only build has no accounts, so there is nothing to sign in to.
  elements.accountEntry.hidden = !signedIn && !communityAuth.cloudConfigured;
  renderAccountDialog();
}

// The local owner reads as "You"; a signed-in account shows its name.
function ownerLabel(ownerId, ownerName) {
  if (ownerId !== (communityState.profile?.id || 'profile-local')) return ownerName;
  const user = communityAuth.user || communityAuth.session?.user;
  return isCloudSignedIn() ? (user?.name || getDisplayNameFromEmail(user?.email) || ownerName) : 'You';
}

/* ---------------------------------------------------------------------------
 * Board core: snapshots, history, simulation loading
 * ------------------------------------------------------------------------- */

function replaceBoard(board, { center = false } = {}) {
  state.playing = false;
  state.board = board;
  state.selection = null;
  loadSimulation(board);
  if (center) centerWorld();
  updateStats();
  updatePlayButton();
  renderToolStrip();
}

function ownedSnapshot(board = state.board) {
  const snapshot = cloneBoard(board);
  snapshot.population = getPopulation(snapshot);
  if (board.wrapping !== undefined) snapshot.wrapping = board.wrapping;
  return snapshot;
}

// The board history keeps boards only. A masterwork load also switches the
// edges to bounded, so its boards carry a `wrapping` tag that this wrapper
// keeps in a parallel stack mirroring the history's push, pop and trim order
// (anchored on entryCount so trimming stays in step). Undo then restores the
// previous edge mode and Redo makes the board bounded again.
function withEdgeMemory(history) {
  const tags = { undo: [], redo: [] };
  let order = 0;
  function push(stack, board) {
    stack.push({ wrapping: board.wrapping, order: order += 1 });
    while (tags.undo.length + tags.redo.length > history.entryCount) {
      const oldest = !tags.redo.length || (tags.undo.length && tags.undo[0].order < tags.redo[0].order) ? tags.undo : tags.redo;
      oldest.shift();
    }
  }
  function tagged(board, entry) {
    if (entry?.wrapping !== undefined) board.wrapping = entry.wrapping;
    return board;
  }
  return {
    get canUndo() { return history.canUndo; },
    get canRedo() { return history.canRedo; },
    get entryCount() { return history.entryCount; },
    record(board) {
      history.record(board);
      tags.redo.length = 0;
      push(tags.undo, board);
    },
    undo(board) {
      const previous = history.undo(board);
      if (!previous) return null;
      const entry = tags.undo.pop();
      push(tags.redo, board);
      return tagged(previous, entry);
    },
    redo(board) {
      const next = history.redo(board);
      if (!next) return null;
      const entry = tags.redo.pop();
      push(tags.undo, board);
      return tagged(next, entry);
    },
    clear() {
      history.clear();
      tags.undo.length = 0;
      tags.redo.length = 0;
    },
  };
}

function loadSimulation(board = state.board, { wrapping = state.designSettings.wrapping } = {}) {
  if (!state.simulation) return Promise.resolve();
  const load = state.simulation.load(ownedSnapshot(board), { wrapping }).catch((error) => {
    if (error?.name !== 'AbortError') throw error;
  });
  state.simulationLoad = load;
  load.catch((error) => { showToast(`Simulation stopped: ${getErrorMessage(error)}`, { kind: 'error' }); });
  return load;
}

function beginAuthoringCommand({ rememberEdges = false } = {}) {
  if (state.playing) {
    state.playing = false;
    updatePlayButton();
  }
  state.simulation?.cancel();
  loadSimulation();
  const snapshot = ownedSnapshot();
  if (rememberEdges) snapshot.wrapping = state.designSettings.wrapping;
  state.history.record(snapshot);
}

function finishAuthoringCommand({ keepSelection = false } = {}) {
  state.board.generation = 0;
  state.authoredStart = ownedSnapshot();
  if (!keepSelection) state.selection = null;
  loadSimulation();
  markDesignDirty(true);
  updateHistoryControls();
  updateStats();
  renderToolStrip();
}

function selectionCommand(command) {
  if (command === 'copy') {
    if (!state.selection) return;
    state.clipboard = copySelection(state.board, state.selection);
    renderToolStrip();
    showToast('Selection copied', { kind: 'success' });
    return;
  }
  if (command === 'deselect') {
    state.selection = null;
    renderToolStrip();
    return;
  }
  if (command !== 'paste' && !state.selection) return;
  if (command === 'paste' && !state.clipboard) {
    showToast('Nothing to paste yet', { kind: 'info' });
    return;
  }
  let result;
  const rect = state.selection;
  if (command === 'paste') {
    // Below and right of the selection so the copy is visible; otherwise centred.
    const clip = state.clipboard;
    const centre = screenToCell(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const origin = rect
      ? { x: rect.x + clip.width, y: rect.y + clip.height }
      : { x: centre.x - Math.floor(clip.width / 2), y: centre.y - Math.floor(clip.height / 2) };
    const x = Math.max(0, Math.min(state.board.width - clip.width, origin.x));
    const y = Math.max(0, Math.min(state.board.height - clip.height, origin.y));
    result = pasteSelection(state.board, clip, x, y);
  } else if (command === 'rotate' || command === 'flip') {
    if (command === 'rotate' && (rect.x + rect.height > state.board.width || rect.y + rect.width > state.board.height)) {
      showToast('Move the selection away from the edge before rotating', { kind: 'error' });
      return;
    }
    result = transformSelection(state.board, rect, command === 'rotate' ? { rotation: 90 } : { flipX: true });
  } else if (command === 'delete') {
    const cleared = cloneBoard(state.board);
    for (let row = rect.y; row < rect.y + rect.height; row += 1) {
      cleared.cells.fill(0, row * cleared.width + rect.x, row * cleared.width + rect.x + rect.width);
    }
    result = { board: cleared, rect };
  } else {
    const delta = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[command];
    if (!delta) return;
    const x = rect.x + delta[0]; const y = rect.y + delta[1];
    if (x < 0 || y < 0 || x + rect.width > state.board.width || y + rect.height > state.board.height) return;
    const copied = copySelection(state.board, rect);
    const cleared = cloneBoard(state.board);
    for (let row = rect.y; row < rect.y + rect.height; row += 1) {
      cleared.cells.fill(0, row * cleared.width + rect.x, row * cleared.width + rect.x + rect.width);
    }
    result = pasteSelection(cleared, copied, x, y);
  }
  beginAuthoringCommand();
  state.board = result.board;
  state.selection = result.rect;
  finishAuthoringCommand({ keepSelection: true });
}

function updateSelection(localX, localY) {
  const start = state.pointer.selectionStart;
  const end = screenToCell(localX, localY);
  const x = Math.max(0, Math.min(state.board.width - 1, Math.min(start.x, end.x)));
  const y = Math.max(0, Math.min(state.board.height - 1, Math.min(start.y, end.y)));
  state.selection = {
    x,
    y,
    width: Math.max(1, Math.min(state.board.width - 1, Math.max(start.x, end.x)) - x + 1),
    height: Math.max(1, Math.min(state.board.height - 1, Math.max(start.y, end.y)) - y + 1),
  };
}

function updateHistoryControls() {
  elements.undo.disabled = !state.history.canUndo || state.playing;
  elements.redo.disabled = !state.history.canRedo || state.playing;
}

function undoBoard() {
  if (state.playing) return;
  const previous = state.history.undo(ownedSnapshot());
  if (!previous) return;
  restoreHistoryBoard(previous);
}

function redoBoard() {
  if (state.playing) return;
  const next = state.history.redo(ownedSnapshot());
  if (!next) return;
  restoreHistoryBoard(next);
}

// A history entry may have a different size (a masterwork grew the board, or
// the grid was resized); the settings and the view follow it.
function restoreHistoryBoard(board) {
  const resized = board.width !== state.board.width || board.height !== state.board.height;
  const edgesChanged = board.wrapping !== undefined && board.wrapping !== state.designSettings.wrapping;
  if (edgesChanged) state.designSettings = mergeDesignSettings(state.designSettings, { wrapping: board.wrapping });
  replaceBoard(board);
  state.authoredStart = ownedSnapshot(board);
  if (resized) {
    state.designSettings = mergeDesignSettings(state.designSettings, { gridPreset: 'custom', width: board.width, height: board.height });
    fitBoard();
  }
  if (resized || edgesChanged) syncDesignControls();
  markDesignDirty(true);
  updateHistoryControls();
}

function resetToStart() {
  if (!state.authoredStart) return;
  state.playing = false;
  replaceBoard(ownedSnapshot(state.authoredStart));
  loadSimulation();
  updatePlayButton();
  if (state.circuit) {
    state.circuitOutputs = null;
    renderInspector();
  }
}

/* ---------------------------------------------------------------------------
 * Save state, recovery, design settings
 * ------------------------------------------------------------------------- */

function markDesignDirty(dirty = true) {
  state.designDirty = dirty;
  setSaveStatus(dirty ? (navigator.onLine === false ? 'offline' : 'dirty') : (state.session?.creationId ? 'saved' : 'new'));
  if (dirty) scheduleLocalRecovery();
  else if (state.boardOwner === 'studio') window.clearTimeout(recoveryTimer);
  renderPublishButton();
}

function setSaveStatus(status) {
  state.saveStatus = status;
  elements.saveState.textContent = getSaveStateText(status, { cloud: isCloudCommunityActive() });
  elements.saveState.dataset.status = status;
}

function setPublishStatus(status) {
  state.publishStatus = status;
  renderPublishButton();
}

function renderPublishButton() {
  const status = state.publishStatus;
  const busy = status === 'validating' || status === 'publishing';
  for (const button of [elements.publishProject, elements.publishProjectMobile]) {
    button.textContent = getPublishLabel(status, { dirty: state.designDirty });
    button.disabled = busy || (status === 'published' && !state.designDirty);
    button.setAttribute('aria-busy', String(busy));
  }
}

function scheduleLocalRecovery() {
  if (state.boardOwner !== 'studio') return;
  window.clearTimeout(recoveryTimer);
  recoveryTimer = window.setTimeout(async () => {
    try {
      // The Playground may be on screen by now; snapshot the Studio workspace.
      const studio = state.boardOwner === 'studio' ? state : state.workspaces.studio;
      if (!studio) return;
      const authored = ownedSnapshot(studio.authoredStart || studio.board);
      if (!studio.session && authored.population === 0) return;
      const recovery = {
        format: 'life-board-binary-v1',
        creationId: studio.session?.creationId || null,
        title: studio.session?.title || elements.projectTitle.value || 'Untitled project',
        description: elements.projectDescription.value || '',
        tags: elements.projectTags.value || '',
        cells: new Uint8Array(authored.cells),
        width: authored.width,
        height: authored.height,
        generation: 0,
        population: authored.population,
        settings: getCurrentDesignSettings(studio),
        circuit: getCircuitSpec(studio.circuitSpec),
        savedAt: new Date().toISOString(),
      };
      await writeRecovery(LOCAL_RECOVERY_KEY, recovery);
      browserStorage.removeItem(LOCAL_RECOVERY_KEY);
      state.recoveryFailed = false;
    } catch {
      state.recoveryFailed = true;
      setSaveStatus('failed');
    }
  }, 500);
}

function clearLocalRecovery() {
  window.clearTimeout(recoveryTimer);
  recoveryTimer = null;
  try {
    browserStorage.removeItem(LOCAL_RECOVERY_KEY);
    deleteRecovery(LOCAL_RECOVERY_KEY).catch(() => {});
    state.recoveryFailed = false;
  } catch {
    // A completed repository save is still authoritative if local recovery cleanup fails.
  }
}

async function restoreLocalRecovery() {
  try {
    const raw = browserStorage.getItem(LOCAL_RECOVERY_KEY);
    const recovery = await readRecovery(LOCAL_RECOVERY_KEY) || (raw && JSON.parse(raw));
    if (!recovery) return false;
    if (!recovery.creationId && !(Number(recovery.population) > 0)) return false;
    swapWorkspace('studio');
    const settings = createDesignSettings(recovery.settings || {
      gridPreset: 'custom',
      width: recovery.width,
      height: recovery.height,
    });
    const board = recovery.format === 'life-board-binary-v1' && recovery.cells
      ? boardFromBinaryRecovery(recovery)
      : boardFromRle(recovery.rle, { generation: Number(recovery.generation || 0), width: recovery.width, height: recovery.height });
    state.designSettings = settings;
    replaceBoard(board, { center: true });
    state.authoredStart = ownedSnapshot(board);
    state.session = {
      creationId: recovery.creationId || null,
      title: recovery.title || 'Recovered project',
      sourceTitle: '',
      sourceOwnerName: '',
    };
    setProjectFields({ title: recovery.title, description: recovery.description, tags: recovery.tags });
    restoreCircuit(recovery.circuit);
    syncDesignControls();
    markDesignDirty(true);
    // Restored silently into the Studio workspace; say so when Studio is shown.
    state.recoveryPending = true;
    return true;
  } catch {
    return false;
  }
}

function boardFromBinaryRecovery(recovery) {
  const bytes = recovery.cells instanceof Uint8Array ? recovery.cells : atob(String(recovery.cells));
  const cells = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) cells[index] = typeof bytes === 'string' ? bytes.charCodeAt(index) : bytes[index];
  if (cells.length !== Number(recovery.width) * Number(recovery.height)) throw new Error('Recovered board dimensions do not match its binary snapshot.');
  const board = createBoard(Number(recovery.width), Number(recovery.height));
  board.cells = cells;
  board.generation = Number(recovery.generation || 0);
  return board;
}

function getCurrentDesignSettings(workspace = state) {
  return serializeDesignSettings({
    ...workspace.designSettings,
    width: workspace.board.width,
    height: workspace.board.height,
    speed: state.speed,
    zoom: workspace.zoom,
    camera: {
      x: Math.round(workspace.panX),
      y: Math.round(workspace.panY),
    },
  });
}

function resizeBoardKeepingCells(width, height) {
  const next = createBoard(width, height);
  const copyWidth = Math.min(width, state.board.width);
  const copyHeight = Math.min(height, state.board.height);
  for (let y = 0; y < copyHeight; y += 1) {
    next.cells.set(state.board.cells.subarray(y * state.board.width, y * state.board.width + copyWidth), y * width);
  }
  return next;
}

// The Grid size menu: three presets, the current size when it is none of
// them, and "Custom…", which opens width and height fields with Apply.
function applyGridSizeChoice(choice) {
  if (choice === 'custom') {
    elements.gridCustom.hidden = false;
    elements.gridWidth.value = String(state.board.width);
    elements.gridHeight.value = String(state.board.height);
    elements.gridWidth.focus({ preventScroll: true });
    return;
  }
  elements.gridCustom.hidden = true;
  if (choice === 'current') return;
  applyBoardSize(mergeDesignSettings(state.designSettings, { gridPreset: choice }));
}

function applyCustomGridSize() {
  const read = (input) => Math.round(Number(input.value));
  const width = read(elements.gridWidth);
  const height = read(elements.gridHeight);
  const valid = (value) => Number.isFinite(value) && value >= 40 && value <= 3000;
  if (!valid(width) || !valid(height)) {
    showToast('Width and height must each be between 40 and 3,000 cells.', { kind: 'error' });
    return;
  }
  elements.gridCustom.hidden = true;
  applyBoardSize({ ...mergeDesignSettings(state.designSettings, { gridPreset: 'custom', width, height }), width, height });
  syncDesignControls();
}

// Resize the board keeping its cells (an undoable command), then refit.
function applyBoardSize(next) {
  if (next.width === state.board.width && next.height === state.board.height) return;
  const gateBoard = state.circuit?.board;
  if (gateBoard && (next.width < gateBoard.width || next.height < gateBoard.height)) {
    syncDesignControls();
    showToast(`This gate needs a grid of at least ${gateBoard.width} × ${gateBoard.height}.`, { kind: 'error' });
    return;
  }
  const before = getPopulation(state.board);
  beginAuthoringCommand();
  state.designSettings = next;
  state.board = resizeBoardKeepingCells(next.width, next.height);
  finishAuthoringCommand();
  if (state.circuit) fitCircuit(); else fitBoard();
  syncDesignControls();
  const removed = before - getPopulation(state.board);
  showToast(removed > 0
    ? `Removed ${formatCellCount(removed)} outside the new grid. Undo to restore.`
    : `Grid is now ${next.width} × ${next.height}`, { kind: removed > 0 ? 'info' : 'success' });
}

function applyEdgesChoice(value) {
  const wrapping = value === 'wrapped';
  if (wrapping === state.designSettings.wrapping) return;
  state.designSettings = mergeDesignSettings(state.designSettings, { wrapping });
  delete state.board.wrapping; // the choice is the builder's now, not the masterwork's
  loadSimulation();
  markDesignDirty(true);
  syncDesignControls();
}

function syncDesignControls() {
  const settings = state.designSettings;
  const current = elements.gridSize.querySelector('option[value="current"]');
  const preset = ['small', 'medium', 'large'].find((id) => {
    const size = createDesignSettings({ gridPreset: id });
    return size.width === state.board.width && size.height === state.board.height;
  });
  current.hidden = Boolean(preset);
  current.textContent = `${state.board.width} × ${state.board.height}`;
  if (!elements.gridCustom.hidden) elements.gridSize.value = 'custom';
  else elements.gridSize.value = preset || 'current';
  elements.edges.value = settings.wrapping ? 'wrapped' : 'bounded';
}

/* ---------------------------------------------------------------------------
 * Stamp tool
 * ------------------------------------------------------------------------- */

function getTransformedPresetCoordinates() {
  if (!state.selectedPreset) return [];
  return transformCoordinates(state.selectedPreset.coordinates, {
    rotation: state.stampRotation,
    flipX: state.stampFlipX,
  });
}

function selectPreset(preset) {
  state.selectedPreset = preset;
  state.stampRotation = 0;
  state.stampFlipX = false;
  setTool('stamp');
  updatePresetSelection();
  triggerHaptic('stampToggle');
}

function exitStamp() {
  if (state.tool !== 'stamp') return;
  state.hoverCell = null;
  state.pointer.active = false;
  setTool('draw');
  triggerHaptic('stampToggle');
}

function rotateStamp(delta) {
  state.stampRotation = ((state.stampRotation + delta) % 360 + 360) % 360;
  renderToolStrip();
}

function flipStamp() {
  state.stampFlipX = !state.stampFlipX;
  renderToolStrip();
}

function stampPattern(cellX, cellY) {
  if (!state.selectedPreset) return;

  const coordinates = getTransformedPresetCoordinates();
  const bounds = getPatternBounds(coordinates);
  const originX = cellX - Math.floor(bounds.width / 2);
  const originY = cellY - Math.floor(bounds.height / 2);

  beginAuthoringCommand();
  state.board = placePatternForCurrentSettings(state.board, coordinates, originX, originY);
  triggerHaptic('stampPlace');
  finishAuthoringCommand();
}

function placePatternForCurrentSettings(board, coordinates, originX, originY) {
  if (state.designSettings.wrapping) {
    return placePattern(board, coordinates, originX, originY);
  }

  const next = {
    ...board,
    cells: new Uint8Array(board.cells),
  };

  for (const [patternX, patternY] of coordinates) {
    const x = originX + patternX;
    const y = originY + patternY;
    if (x < 0 || y < 0 || x >= board.width || y >= board.height) continue;
    next.cells[y * board.width + x] = 1;
  }

  return next;
}

/* ---------------------------------------------------------------------------
 * Projects (Studio sessions)
 * ------------------------------------------------------------------------- */

function setProjectFields({ title, description = '', tags = [] } = {}) {
  const cleanTitle = String(title || '').trim() || 'Untitled project';
  if (document.activeElement !== elements.projectTitle) elements.projectTitle.value = cleanTitle;
  if (state.session) state.session.title = cleanTitle;
  const tagText = Array.isArray(tags) ? tags.join(', ') : String(tags || '');
  if (document.activeElement !== elements.projectDescription) elements.projectDescription.value = description || '';
  if (document.activeElement !== elements.projectTags) elements.projectTags.value = tagText;
}

function startProject({ title = 'Untitled project', creationId = null, source = null, boardLoaded = false } = {}) {
  state.session = {
    creationId,
    title,
    sourceTitle: source?.title || '',
    sourceOwnerName: source?.ownerName || '',
  };
  state.previewConfig = {};
  exitCircuit();

  if (!boardLoaded) {
    state.designSettings = DEFAULT_DESIGN_SETTINGS;
    replaceBoard(createBoard(state.designSettings.width, state.designSettings.height), { center: true });
    state.authoredStart = ownedSnapshot();
    state.history.clear();
    updateHistoryControls();
    setZoom(1);
    centerWorld();
  }

  setProjectFields({ title, description: '', tags: [] });
  setPublishStatus('draft');
  markDesignDirty(false);
  state.studioView = 'project';
  syncDesignControls();
  renderStudio();
}

function openProject(creationId) {
  const creation = community.findCreation(creationId);
  if (!creation) return false;
  try {
    loadCreationOntoBoard(creation);
  } catch {
    showToast(`Could not open ${creation.title}`, { kind: 'error' });
    return false;
  }
  community.setActiveCreation(creation.id);
  communityState = community.getState();
  startProject({
    title: creation.title,
    creationId: creation.id,
    source: creation.remixedFromId ? findCommunityDesign(creation.remixedFromId) : null,
    boardLoaded: true,
  });
  setProjectFields(creation);
  restoreCircuit(creation.previewConfig?.circuit);
  setPublishStatus(creation.visibility === 'public' ? 'published' : 'draft');
  markDesignDirty(false);
  return true;
}

function getActiveCreation() {
  return state.session?.creationId ? community.findCreation(state.session.creationId) : null;
}

function getOwnCreations() {
  const profile = communityState.profile;
  return communityState.creations
    .filter((creation) => !creation.archivedAt && (!profile || creation.ownerId === profile.id))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function saveCurrentCreation({ publish = false, resumed = false } = {}) {
  if (publish && ['validating', 'publishing'].includes(state.publishStatus)) return null;
  if (!state.session) startProject({ title: elements.projectTitle.value || 'Untitled project', boardLoaded: true });

  if (!communityState.profile && isCloudCommunityActive()) {
    showToast('Your account is still syncing. Try again in a moment.', { kind: 'info' });
    return null;
  }

  const authored = ownedSnapshot(state.authoredStart || state.board);
  const activeCreationId = state.session?.creationId || null;
  const input = {
    title: elements.projectTitle.value.trim() || 'Untitled project',
    description: elements.projectDescription.value,
    tags: elements.projectTags.value,
    attribution: state.session?.sourceTitle ? `Remixed from ${state.session.sourceTitle} by ${state.session.sourceOwnerName}.` : '',
    tutorialReference: '',
    rle: boardToRle(authored),
    width: authored.width,
    height: authored.height,
    generation: 0,
    population: authored.population,
    previewConfig: getCurrentCreationPreviewConfig(),
    settings: getCurrentDesignSettings(),
  };
  if (publish) {
    const previousStatus = state.publishStatus;
    setPublishStatus('validating');
    const readiness = getCreationPublishReadiness({
      ...input,
      currentVersion: { rle: input.rle },
    });
    if (!readiness.ready) {
      const issue = readiness.issues[0];
      const message = PUBLISH_ISSUE_COPY[`${issue?.field}:${issue?.code}`] || 'Fill in the publish details first.';
      // Nothing was attempted, so the button keeps its label.
      setPublishStatus(previousStatus);
      // Open the sheet first: opening it dismisses any toast.
      if (MOBILE_QUERY.matches) openInspector(true);
      showToast(message, { kind: 'error' });
      const issueField = readiness.issues[0]?.field;
      if (issueField === 'description') elements.projectDescription.focus();
      else if (issueField === 'tags') elements.projectTags.focus();
      else if (issueField === 'title') elements.projectTitle.focus();
      return null;
    }
    // A hosted build publishes to the shared Community and needs an account.
    // A local-only build publishes on this device so the button is never a dead end.
    if (communityAuth.cloudConfigured && requiresCloudSignInForSharedAction()) {
      setPublishStatus('draft');
      if (!resumed) queueAccountAction('publish', {}, 'Sign in to publish this project. Your work stays exactly where it is.');
      return null;
    }
    setPublishStatus('publishing');
  }
  let creation;
  setSaveStatus('saving');
  try {
    if (activeCreationId) {
      creation = await community.updateCreationMetadata(activeCreationId, input);
      if (state.designDirty) creation = await community.saveVersion(activeCreationId, input);
      if (publish) creation = await community.publishCreation(activeCreationId);
    } else {
      creation = await community.createCreation(input, { publish });
    }
    // Publishing rebuilds the preview config, so put the circuit spec back.
    if (publish && creation && input.previewConfig.circuit) {
      creation = await community.updateCreationMetadata(creation.id, { previewConfig: { ...creation.previewConfig, circuit: input.previewConfig.circuit } });
    }
  } catch (error) {
    if (publish) setPublishStatus('failed');
    setSaveStatus(navigator.onLine === false ? 'offline' : 'failed');
    showToast(error.name === 'QuotaExceededError'
      ? 'Could not save: browser storage is full.'
      : `Could not save: ${getErrorMessage(error)}`, { kind: 'error' });
    return null;
  }

  if (!creation) {
    if (publish) setPublishStatus('failed');
    setSaveStatus('failed');
    return null;
  }

  state.session.creationId = creation.id;
  state.session.title = creation.title;
  setProjectFields(creation);
  setPublishStatus(creation.visibility === 'public' ? 'published' : 'draft');
  syncCommunity();
  markDesignDirty(false);
  clearLocalRecovery();
  triggerHaptic('save');
  if (!isCloudCommunityActive() && localCommunity.isMemoryOnly?.()) {
    showToast('Saved for this visit only. This browser is blocking site storage.', { kind: 'info' });
  } else {
    showToast(publish ? (isCloudCommunityActive() ? 'Published to Community' : 'Published on this device') : 'Saved', { kind: 'success' });
  }
  renderStudio();
  return creation;
}

async function unpublishActiveCreation() {
  const creationId = state.session?.creationId;
  if (!creationId) return;
  setSaveStatus('saving');
  try {
    const creation = await community.unpublishCreation(creationId);
    if (!creation) return;
    syncCommunity();
    setSaveStatus('saved');
    setPublishStatus('unpublished');
    showToast('Project is private again', { kind: 'success' });
    renderStudio();
  } catch (error) {
    setSaveStatus('failed');
    showToast(`Could not unpublish: ${getErrorMessage(error)}`, { kind: 'error' });
  }
}

async function archiveActiveCreation() {
  const creationId = state.session?.creationId;
  if (!creationId || !window.confirm('Archive this project? It becomes private and leaves your project list.')) return;
  try {
    const creation = await community.archiveCreation(creationId);
    if (!creation) return;
    state.session = null;
    clearLocalRecovery();
    syncCommunity();
    showProjectsList();
    showToast('Project archived', { kind: 'success' });
  } catch (error) {
    setSaveStatus('failed');
    showToast(`Could not archive: ${getErrorMessage(error)}`, { kind: 'error' });
  }
}

async function deleteActiveCreation() {
  const creationId = state.session?.creationId;
  if (!creationId || !window.confirm('Delete this project and every version? This cannot be undone.')) return;
  try {
    const deleted = await community.deleteCreation(creationId);
    if (!deleted) return;
    state.session = null;
    clearLocalRecovery();
    syncCommunity();
    showProjectsList();
    showToast('Project deleted', { kind: 'success' });
  } catch (error) {
    setSaveStatus('failed');
    showToast(`Could not delete: ${getErrorMessage(error)}`, { kind: 'error' });
  }
}

async function restoreActiveVersion(versionId) {
  const creationId = state.session?.creationId;
  if (!creationId) return;
  setSaveStatus('saving');
  try {
    const creation = await community.restoreVersion(creationId, versionId);
    if (!creation) return;
    loadCreationOntoBoard(creation);
    syncCommunity();
    setSaveStatus('saved');
    showToast(`Restored as version ${creation.currentVersion.versionNumber}`, { kind: 'success' });
    renderStudio();
  } catch (error) {
    setSaveStatus('failed');
    showToast(`Could not restore version: ${getErrorMessage(error)}`, { kind: 'error' });
  }
}

function loadCreationOntoBoard(creation) {
  const version = creation.currentVersion || {};
  const settings = version.settings
    ? createDesignSettings(version.settings)
    : createDesignSettings({
      gridPreset: 'custom',
      width: version.width || state.board.width,
      height: version.height || state.board.height,
    });
  const nextBoard = isFamous(creation)
    ? centredBoardFromRle(version.rle, version.width || settings.width, version.height || settings.height)
    : boardFromRle(version.rle, {
      generation: Number(version.generation || 0),
      width: version.width || settings.width,
      height: version.height || settings.height,
    });

  state.designSettings = settings;
  exitCircuit();
  replaceBoard(nextBoard);
  state.authoredStart = ownedSnapshot(nextBoard);
  state.history.clear();
  updateHistoryControls();
  setSpeed(settings.speed);
  fitLiveCells({ deferred: true });
  syncDesignControls();
  markDesignDirty(false);
  updateStats();
}

function showProjectsList() {
  state.studioView = 'projects';
  renderStudio();
}

function renderStudio() {
  const studio = state.mode === 'studio';
  elements.body.dataset.studioView = state.studioView;
  elements.projectHeader.hidden = !studio || state.studioView !== 'project';
  elements.projectsPage.hidden = !studio || state.studioView !== 'projects';
  elements.inspector.hidden = !studio;
  elements.railKindTabs.hidden = !studio;
  elements.railTitle.textContent = studio ? 'Components' : 'Patterns';
  if (!studio && state.railTab === 'logic') setRailTab('patterns');
  if (studio && state.studioView === 'projects') renderProjectsPage();
  if (studio && state.studioView === 'project') {
    const creation = getActiveCreation();
    // The ⋯ menu only appears once something in it can act.
    elements.projectMenuToggle.hidden = !creation;
    elements.unpublishProject.hidden = creation?.visibility !== 'public';
    elements.archiveProject.disabled = !creation;
    elements.deleteProject.disabled = !creation;
    renderInspector();
  }
}

function renderProjectsPage() {
  const creations = getOwnCreations();
  elements.projectsList.innerHTML = '';
  if (creations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'projects-empty';
    empty.textContent = 'No projects yet. Start one and it will be saved on this device.';
    elements.projectsList.append(empty);
    return;
  }
  for (const creation of creations) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'project-card';
    button.dataset.projectId = creation.id;
    button.setAttribute('role', 'listitem');
    const updated = formatDate(creation.updatedAt);
    button.innerHTML = `
      <strong>${escapeHtml(creation.title)}</strong>
      <span>${formatCellCount(creation.currentVersion?.population)} · ${wholeNumber(creation.currentVersion?.width)} × ${wholeNumber(creation.currentVersion?.height)}</span>
      <span>${creation.visibility === 'public' ? 'Published' : 'Private'} · updated ${escapeHtml(updated)}</span>
    `;
    elements.projectsList.append(button);
  }
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderVersionHistory(creation) {
  const versions = [...(creation?.versions || (creation?.currentVersion ? [creation.currentVersion] : []))]
    .sort((left, right) => Number(right.versionNumber || 0) - Number(left.versionNumber || 0));
  elements.versionHistory.innerHTML = '';
  if (versions.length === 0) {
    elements.versionHistory.innerHTML = '<p class="inspector-note">Save to create version 1.</p>';
    return;
  }
  for (const version of versions) {
    const row = document.createElement('div');
    const current = version.id === creation.currentVersion?.id;
    row.className = `version-row${current ? ' current' : ''}`;
    row.innerHTML = `
      <span><strong>Version ${wholeNumber(version.versionNumber) || 1}</strong><small>${current ? 'Current' : formatCellCount(version.population)}</small></span>
      ${current ? '' : `<button class="button button-small" type="button" data-restore-version-id="${escapeHtml(version.id)}">Restore</button>`}
    `;
    elements.versionHistory.append(row);
  }
}

/* ---------------------------------------------------------------------------
 * Circuits (Studio → Logic)
 * ------------------------------------------------------------------------- */

// A circuit is a spec from circuit-spec.js: a tree of AND/OR/NOT gates per
// output (a plain chain is the simplest tree), or the standalone half-adder.
// state.circuitSpec holds the normalized spec; state.circuit its build.

// The legacy gate list when the spec is a plain left-to-right chain, for the
// test snapshot and the rail cards; the half-adder reads as its own gate.
function circuitGates(spec = state.circuitSpec) {
  if (!spec) return [];
  if (spec.kind === 'half-adder') return ['half-adder'];
  if (spec.kind !== 'tree' || spec.outputs.length !== 1) return [];
  return treeToChain(spec.outputs[0].tree) || [];
}

// What Studio persists in previewConfig.circuit. Trees keep their normalized
// form; the half-adder keeps the gate-list form every reader accepts.
function getCircuitSpec(spec = state.circuitSpec) {
  if (!spec) return null;
  if (spec.kind === 'half-adder') return { gates: ['half-adder'], inputs: { ...spec.inputs } };
  return { outputs: spec.outputs.map((output) => ({ id: output.id, label: output.label, tree: output.tree })), inputs: { ...spec.inputs } };
}

// The contract form circuits.js reads: a normalized spec goes back to the
// gate-list form for the half-adder, { outputs, inputs } for a tree, and
// { preset, inputs } for a preset; anything else is already a contract form.
function contractSpec(spec) {
  if (spec?.kind === 'half-adder') return { gates: ['half-adder'], inputs: { ...spec.inputs } };
  if (spec?.kind === 'tree') return getCircuitSpec(spec);
  if (spec?.kind === 'preset') return { preset: spec.id, inputs: { ...spec.inputs } };
  return spec;
}

function validateSpec(spec) {
  try {
    return validateCircuit(contractSpec(spec));
  } catch (error) {
    return { ok: false, reason: getErrorMessage(error) };
  }
}

function buildSpec(spec) {
  return buildCircuit(contractSpec(spec));
}

// Presets persist as the tree they expand to, so a saved preset reopens as an
// editable circuit even if the preset list changes later. Their outputs take
// the short OUT/SUM/CARRY names: the formula line shows the expression, and
// a name like "A XOR B" would go stale as soon as the tree is edited.
function expandCircuitSpec(spec) {
  // contractSpec() turns an already-normalized spec (what the pure edit
  // helpers return) back into a form the contract reads.
  const normalized = normalizeCircuitSpec(contractSpec(spec));
  if (normalized.kind !== 'preset') return normalized;
  const preset = circuitPresets.find((entry) => entry.id === normalized.id);
  if (!preset) throw new Error(`Unknown circuit "${normalized.id}".`);
  return normalizeCircuitSpec({
    outputs: preset.spec.outputs.map((output) => ({ ...output, label: output.id.toUpperCase() })),
    inputs: normalized.inputs,
  });
}

// Ready-made circuits the engine can build on this board; a preset it
// rejects (today the full adder, at 16 gates) gets no card.
let buildablePresets = null;
function getBuildablePresets() {
  buildablePresets ??= circuitPresets.filter((preset) => validateSpec(preset.spec).ok);
  return buildablePresets;
}

// The rail card that matches the open circuit, if any: a single gate, the
// half-adder, or an unedited preset.
function circuitCardId(spec = state.circuitSpec) {
  if (!spec) return null;
  if (spec.kind === 'half-adder') return 'half-adder';
  const gates = circuitGates(spec);
  if (gates.length === 1) return gates[0];
  const formula = describeSpec(spec).join('|');
  return getBuildablePresets().find((preset) => describeSpec(expandCircuitSpec({ preset: preset.id, inputs: {} })).join('|') === formula)?.id || null;
}

// Everything the renderer labels: gate tiles and the external input ports.
// Only the half-adder lacks tiles; both of its inputs enter from the west.
function getCircuitGeometry(experiment) {
  if (experiment.tiles) {
    const ports = experiment.ports?.filter((port) => port.type === 'input')
      || experiment.tiles.flatMap((tile) => tile.inputs.map((input) => ({ type: 'input', tileIndex: tile.index, ...input })));
    return { tiles: experiment.tiles, ports };
  }
  const { origin, tile, lanes } = getCircuitMarkers(experiment.id);
  return {
    tiles: [{ gateId: experiment.id, index: 0, x: origin.x, y: origin.y, width: tile, height: tile }],
    ports: lanes.map((lane) => ({ tileIndex: 0, name: lane.id, side: 'west', x: origin.x, y: lane.y })),
  };
}

// Short lamp and probe label for an output: the formula line already shows
// the expression, so the lamp just names the output.
function outputLabel(port) {
  if (state.circuitSpec?.kind === 'tree') {
    return state.circuitSpec.outputs.find((output) => output.id === port.id)?.label || port.label;
  }
  return port.label;
}

function exitCircuit() {
  closeChipMenu();
  if (!state.circuit) return;
  state.circuit = null;
  state.circuitSpec = null;
  state.circuitOutputs = null;
  state.truthRows = null;
  updatePresetSelection();
  renderCircuitBar();
}

function openCircuit(spec, { fit = true } = {}) {
  const normalized = expandCircuitSpec(spec);
  const experiment = buildSpec(normalized);
  closeChipMenu();
  state.circuitSpec = normalized;
  state.circuit = experiment;
  state.circuitOutputs = null;
  if (state.truthRows?.key !== truthKey(normalized)) state.truthRows = null;
  // A measured truth table already knows the outputs for these switches.
  const measured = state.truthRows?.rows.find((row) => row.outputs
    && Object.entries(row.inputs).every(([name, value]) => Boolean(normalized.inputs[name]) === Boolean(value)));
  if (measured) state.circuitOutputs = measured.outputs.map((output) => ({ ...output }));
  state.designSettings = mergeDesignSettings(state.designSettings, {
    gridPreset: 'custom',
    width: experiment.board.width,
    height: experiment.board.height,
    wrapping: false,
  });
  replaceBoard(ownedSnapshot(experiment.board));
  state.authoredStart = ownedSnapshot(experiment.authoredBoard);
  state.history.clear();
  updateHistoryControls();
  loadSimulation(state.board, { wrapping: false });
  if (fit) fitCircuit();
  markDesignDirty(true);
  syncDesignControls();
  updatePresetSelection();
  renderInspector();
}

// A measured truth table stays valid while the gates stay the same; flipping
// switches does not discard it.
function truthKey(spec) {
  return spec ? describeSpec(contractSpec(spec)).join('|') : '';
}

function fitCircuit({ deferred = false } = {}) {
  if (!state.circuit) return;
  if (deferred || !canvas.clientWidth) {
    // The frame is still being laid out; refit once it has its real size.
    state.pendingFit = { apply: () => fitCircuit() };
    state.pendingCenter = false;
    if (deferred) window.requestAnimationFrame(resizeCanvas);
    return;
  }
  const experiment = state.circuit;
  const { tiles, ports } = getCircuitGeometry(experiment);
  const viewport = getWorldViewport();
  // On phones the tool strip floats over the top of the canvas; fit below it.
  const inset = circuitTopInset();
  const available = viewport.height - inset;
  // Pixel reserves beside the cells: the "A →" lane label on the west and the
  // widest probe label on the east (drawn right of the probe box).
  ctx.save();
  ctx.font = markerFont();
  const westPx = ctx.measureText('A →').width + 14;
  const labelPx = Math.max(...experiment.outputs.map((port) => ctx.measureText(outputLabel(port)).width)) + 12;
  ctx.restore();
  // Must-see: every tile (labels sit 16px above the top row), every probe box
  // and every port where a lane enters a tile.
  const must = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const include = (x, y, w = 0, h = 0) => {
    must.left = Math.min(must.left, x);
    must.top = Math.min(must.top, y);
    must.right = Math.max(must.right, x + w);
    must.bottom = Math.max(must.bottom, y + h);
  };
  for (const tile of tiles) include(tile.x, tile.y, tile.width, tile.height);
  for (const port of experiment.outputs) include(port.x - Math.floor(port.width / 2), port.y - Math.floor(port.height / 2), port.width, port.height);
  for (const port of ports) include(port.x, port.y);
  must.right += 8;
  // Full: the must-see plus each active lane out to its farthest queued packet.
  const full = { ...must };
  const board = experiment.authoredBoard;
  const liveAcross = (fixed, from, to, horizontal) => {
    const step = from < to ? 1 : -1;
    for (let along = from; step > 0 ? along <= to : along >= to; along += step) {
      for (let offset = -4; offset <= 4; offset += 1) {
        const x = horizontal ? along : fixed + offset;
        const y = horizontal ? fixed + offset : along;
        if (x >= 0 && y >= 0 && x < board.width && y < board.height && board.cells[y * board.width + x] === 1) return along;
      }
    }
    return null;
  };
  for (const port of ports) {
    if (!experiment.inputs?.[port.name]) continue;
    const px = Math.floor(port.x);
    const py = Math.floor(port.y);
    if (port.side === 'south') { const y = liveAcross(px, board.height - 1, must.bottom + 1, false); if (y !== null) full.bottom = Math.max(full.bottom, y + 8); }
    if (port.side === 'north') { const y = liveAcross(px, 0, must.top - 1, false); if (y !== null) full.top = Math.min(full.top, y - 8); }
    if (port.side === 'east') { const x = liveAcross(py, board.width - 1, must.right + 1, true); if (x !== null) full.right = Math.max(full.right, x + 8); }
    if (port.side === 'west') { const x = liveAcross(py, 0, must.left - 1, true); if (x !== null) full.left = Math.min(full.left, x - 8); }
  }
  if (full.bottom === must.bottom) full.bottom = must.bottom + (experiment.tiles ? 56 : 16);
  const zoomFor = (region, padX, padY) => Math.min(1,
    (viewport.width - 2 * padX - westPx - labelPx) / ((region.right - region.left) * BASE_CELL_SIZE),
    (available - 2 * padY) / ((region.bottom - region.top) * BASE_CELL_SIZE));
  const fullZoom = zoomFor(full, 16, 24);
  let zoom;
  let region;
  let panY;
  if (fullZoom >= 0.06) {
    zoom = fullZoom;
    region = full;
    panY = inset + (available - (full.bottom - full.top) * zoom * BASE_CELL_SIZE) / 2 - full.top * zoom * BASE_CELL_SIZE;
  } else {
    // Too tall to fit whole: keep the tiles and labels at the top with 16px
    // padding and let the lanes run off the bottom.
    // 30px padding: room under the bottom row for its "G ↑" lane labels.
    zoom = Math.max(getMinZoom(), zoomFor({ ...must, bottom: must.bottom + 4 }, 8, 30));
    region = must;
    panY = inset + 32 - must.top * zoom * BASE_CELL_SIZE;
  }
  const cellSize = zoom * BASE_CELL_SIZE;
  const width = region.right - region.left;
  state.zoom = zoom;
  state.panX = (viewport.width - (westPx + width * cellSize + labelPx)) / 2 + westPx - region.left * cellSize;
  state.panY = panY;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

// Height of the canvas hidden under the floating tool strip (0 on desktop).
function circuitTopInset() {
  const overlap = elements.toolStrip.getBoundingClientRect().bottom - canvas.getBoundingClientRect().top;
  return overlap > 1 ? overlap + 8 : 0;
}

function markerFont() {
  return `500 12px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`;
}

function setCircuitInput(name, value) {
  if (!state.circuitSpec || state.circuitRunning) return;
  // Refit: an input train appears or disappears, and the fit follows it.
  openCircuit(setInputValue(contractSpec(state.circuitSpec), name, value));
}

// Apply an edit from the formula chips; invalid results are refused quietly
// because the menu already disabled them.
function editCircuit(nextSpec) {
  if (!state.circuitSpec || state.circuitRunning) return;
  const validation = validateSpec(nextSpec);
  if (!validation.ok) {
    showToast(validation.reason, { kind: 'error' });
    return;
  }
  openCircuit(nextSpec);
}

// The spec an edit would produce, or null when the edit is not possible.
function tryEdit(apply) {
  try {
    return apply(state.circuitSpec);
  } catch {
    return null;
  }
}

// Rebuild a saved or recovered circuit from any spec form the contract accepts.
function restoreCircuit(spec) {
  if (!spec || typeof spec !== 'object') return;
  try {
    const expanded = expandCircuitSpec(spec);
    if (!validateSpec(expanded).ok) return;
    openCircuit(expanded, { fit: false });
  } catch {
    return;
  }
  if (state.mode === 'studio') setRailTab('logic');
  fitCircuit({ deferred: true });
}

async function runCircuitExperiment() {
  if (!state.circuit || state.circuitRunning) return;
  const experiment = state.circuit;
  state.playing = false;
  updatePlayButton();
  if (state.board.generation > 0 || state.board.generation > experiment.observeGeneration) resetToStart();
  state.circuitRunning = true;
  state.circuitOutputs = experiment.outputs.map((port) => ({ id: port.id, label: port.label, settled: false, high: null }));
  renderInspector();
  try {
    const load = state.simulationLoad;
    await load;
    if (load !== state.simulationLoad) return;
    const remaining = Math.max(0, experiment.observeGeneration - state.board.generation);
    const snapshot = remaining ? await state.simulation.advance(remaining, {
      onSnapshot: (board) => {
        state.board = ownedSnapshot(board);
        updateStats();
        renderRunProgress();
      },
    }) : ownedSnapshot();
    state.board = ownedSnapshot(snapshot);
    state.circuitOutputs = readCircuitOutputs(experiment, state.board);
    updateStats();
    const summary = state.circuitOutputs.map((output) => `${outputLabel(output)}: ${output.high ? 'HIGH' : 'LOW'}`).join(' · ');
    showToast(summary, { kind: 'success' });
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(`Run stopped: ${getErrorMessage(error)}`, { kind: 'error' });
    state.circuitOutputs = null;
  } finally {
    state.circuitRunning = false;
    renderInspector();
  }
}

// Input letters in alphabetical order, whatever order the tree uses them in.
function circuitInputNames(spec = state.circuitSpec) {
  return spec ? [...getSpecInputs(contractSpec(spec))].sort() : [];
}

// Rough wall-clock estimate for running every input combination, from the
// rate measured on the last run (or a conservative default).
function truthTableEstimate(spec = state.circuitSpec, experiment = state.circuit) {
  const rows = 2 ** circuitInputNames(spec).length;
  const rate = state.circuitRate || 1500;
  const seconds = Math.max(1, Math.round((rows * experiment.observeGeneration) / rate));
  const time = seconds < 90 ? `about ${seconds} seconds` : `about ${Math.max(2, Math.round(seconds / 60))} minutes`;
  return { rows, seconds, text: `${rows} rows, ${time}` };
}

async function fillTruthTable() {
  if (!state.circuit || state.circuitRunning) return;
  const experiment = state.circuit;
  const spec = state.circuitSpec;
  const names = circuitInputNames(spec);
  const estimate = truthTableEstimate(spec, experiment);
  if (names.length > 4 && !window.confirm(`Run all ${estimate.rows} combinations? That takes ${estimate.text.replace(/^\d+ rows, /, '')}.`)) return;
  const rows = getInputCombinations(names);
  state.circuitRunning = true;
  state.truthRows = { key: truthKey(spec), rows: rows.map((inputs) => ({ inputs, outputs: null })), current: 0, generation: 0 };
  state.playing = false;
  updatePlayButton();
  renderInspector();
  const started = performance.now();
  let generations = 0;
  try {
    for (const row of state.truthRows.rows) {
      state.truthRows.current += 1;
      state.truthRows.generation = 0;
      renderRunProgress();
      let rowSpec = spec;
      for (const [name, value] of Object.entries(row.inputs)) rowSpec = setInputValue(contractSpec(rowSpec), name, value);
      const built = buildSpec(rowSpec);
      await state.simulation.load(ownedSnapshot(built.board), { wrapping: false });
      const board = await state.simulation.advance(built.observeGeneration, {
        onSnapshot: (snapshot) => {
          state.truthRows.generation = snapshot.generation;
          renderRunProgress();
        },
      });
      generations += built.observeGeneration;
      row.outputs = readCircuitOutputs(built, board);
      renderTruthTable();
    }
    state.circuitRate = Math.max(1, generations / ((performance.now() - started) / 1000));
    showToast('Truth table complete', { kind: 'success' });
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(`Run stopped: ${getErrorMessage(error)}`, { kind: 'error' });
  } finally {
    state.circuitRunning = false;
    // Put the authored experiment back on the board and in the worker (unless
    // the user has since switched to the Playground board).
    if (state.circuit === experiment) openCircuit(spec, { fit: false });
  }
}

function renderInspector() {
  const experiment = state.circuit;
  elements.circuitSection.hidden = !experiment;
  renderVersionHistory(getActiveCreation());
  if (!experiment) {
    renderCircuitBar();
    return;
  }

  const spec = state.circuitSpec;
  const cardId = circuitCardId(spec);
  const card = getLogicCards().find((entry) => entry.id === cardId);
  const gateCount = spec.kind === 'tree' ? countSpecGates(spec) : 1;
  elements.circuitName.textContent = card
    ? `${card.name}: ${card.note}`
    : `${gateCount} gates. Choose any part of the formula to change it.`;
  renderFormula(spec);

  const { tiles, ports } = getCircuitGeometry(experiment);
  elements.inputsList.innerHTML = '';
  for (const name of circuitInputNames(spec)) {
    const gates = [];
    for (const port of ports) {
      if (port.name !== name) continue;
      const gate = GATE_CARDS[tiles[port.tileIndex]?.gateId]?.name || String(tiles[port.tileIndex]?.gateId || '').toUpperCase();
      if (!gates.includes(gate)) gates.push(gate);
    }
    const listed = gates.length > 1 ? `${gates.slice(0, -1).join(', ')} and ${gates.at(-1)}` : gates[0] || '';
    const row = document.createElement('label');
    row.className = 'switch-row';
    row.innerHTML = `<span>${escapeHtml(name.toUpperCase())}<small>${escapeHtml(listed ? `feeds ${listed}` : '')}</small></span><input class="switch" type="checkbox" role="switch" data-input="${escapeHtml(name)}" aria-label="Input ${escapeHtml(name.toUpperCase())}" ${spec.inputs[name] ? 'checked' : ''} ${state.circuitRunning ? 'disabled' : ''} />`;
    elements.inputsList.append(row);
  }
  // Explain once why a lane may enter a gate from below or the side.
  elements.inputsNote.hidden = !tiles.some((tile) => Number(tile.rotation));

  elements.outputsList.innerHTML = '';
  for (const port of experiment.outputs) {
    const output = state.circuitOutputs?.find((candidate) => candidate.id === port.id) || null;
    const lampState = getLampState(output);
    const row = document.createElement('div');
    row.className = 'lamp-row';
    row.innerHTML = `<span>${escapeHtml(outputLabel(port))}</span><span class="lamp" data-output="${escapeHtml(port.id)}" data-state="${lampState}">${getLampLabel(lampState)}</span>`;
    elements.outputsList.append(row);
  }

  elements.runCircuit.disabled = state.circuitRunning;
  elements.fillTruthTable.disabled = state.circuitRunning;
  elements.runProgress.setAttribute('aria-valuemax', String(experiment.observeGeneration));
  renderRunProgress();
  renderTruthTable();
}

// The circuit as formula lines built from chips: "OUT = (A AND B) OR C".
// Every chip opens a menu (inputs: reuse a letter or grow a gate here; gates:
// remove); "Add gate" at the end wraps the whole expression.
function renderFormula(spec) {
  const editable = spec.kind === 'tree';
  elements.formulaList.hidden = !editable;
  if (!editable) {
    elements.chainNote.hidden = false;
    elements.chainNote.textContent = 'Built as one fixed circuit with two outputs, so its gates cannot be changed here.';
    return;
  }
  const disabled = state.circuitRunning ? ' disabled' : '';
  elements.formulaList.innerHTML = spec.outputs.map((output, outputIndex) => `<div class="formula-row" data-output-index="${outputIndex}">`
    + `<span class="formula-label">${escapeHtml(output.label)} =</span>`
    + formulaHtml(output.tree, outputIndex, [], disabled)
    + `<button class="chip chip-add" id="add-gate-${escapeHtml(output.id)}" type="button" data-chip="add" data-output="${outputIndex}" aria-haspopup="menu" aria-expanded="false"${disabled}>`
    + '<svg class="icon" aria-hidden="true"><use href="#i-plus" /></svg><span>Add gate</span></button>'
    + '</div>').join('');
  // The note appears once no gate at all can wrap the first output.
  const attempts = ['and', 'or', 'not'].map((gate) => tryEdit((current) => wrapOutput(current, 0, gate)));
  const canAdd = attempts.some((attempt) => Boolean(attempt) && validateSpec(attempt).ok);
  elements.chainNote.hidden = canAdd;
  elements.chainNote.textContent = canAdd ? '' : circuitLimitNote(attempts[0]);
}

// Plain words for why an edit cannot be built: the engine's own reason.
function circuitLimitNote(attempt) {
  if (!attempt) return `All ${INPUT_NAMES.length} inputs are in use.`;
  return validateSpec(attempt).reason || `Up to ${CIRCUIT_MAX_GATES} gates.`;
}

function formulaHtml(node, outputIndex, path, disabled) {
  const chip = (kind, label, extra) => `<button class="chip chip-${kind}" type="button" data-chip="${kind}" data-output="${outputIndex}" data-path="${path.join('.')}" ${extra} aria-haspopup="menu" aria-expanded="false"${disabled}>${label}<svg class="icon chip-caret" aria-hidden="true"><use href="#i-chevron" /></svg></button>`;
  if (isInputNode(node)) return chip('input', escapeHtml(node.input.toUpperCase()), `data-input="${escapeHtml(node.input)}"`);
  const operand = (child, step) => (isInputNode(child)
    ? formulaHtml(child, outputIndex, [...path, step], disabled)
    : `<span class="formula-paren" aria-hidden="true">(</span>${formulaHtml(child, outputIndex, [...path, step], disabled)}<span class="formula-paren" aria-hidden="true">)</span>`);
  const gate = chip('gate', escapeHtml(node.gate.toUpperCase()), `data-gate="${escapeHtml(node.gate)}"`);
  if (node.gate === 'not') return `${gate}${operand(node.a, 'a')}`;
  return `${operand(node.a, 'a')}${gate}${operand(node.b, 'b')}`;
}

// One floating menu serves every chip; it is positioned under the chip that
// opened it and lists only the edits that can be built.
function openChipMenu(chip) {
  const spec = state.circuitSpec;
  if (!spec || state.circuitRunning) return;
  const outputIndex = Number(chip.dataset.output);
  const path = chip.dataset.path ? chip.dataset.path.split('.') : [];
  const kind = chip.dataset.chip;
  const items = [];
  // Disabled items say why on screen: after each group, one muted line per
  // distinct reason (a phone has no hover to show a title).
  let reasons = [];
  const option = (action, value, label, candidate) => {
    const ok = Boolean(candidate) && validateSpec(candidate).ok;
    const reason = ok ? '' : circuitLimitNote(candidate);
    if (reason && !reasons.includes(reason)) reasons.push(reason);
    items.push(`<button type="button" role="menuitem" data-chip-action="${action}" data-value="${value}"${ok ? '' : ` disabled title="${escapeHtml(reason)}"`}>${label}</button>`);
  };
  const endGroup = () => {
    for (const reason of reasons) items.push(`<p class="menu-reason">${escapeHtml(reason)}</p>`);
    reasons = [];
  };
  if (kind === 'input') {
    const used = circuitInputNames(spec);
    const highest = Math.max(...used.map((name) => INPUT_NAMES.indexOf(name)));
    for (const name of INPUT_NAMES.slice(0, Math.min(INPUT_NAMES.length, highest + 2))) {
      if (name === chip.dataset.input) continue;
      option('use', name, `Use ${name.toUpperCase()}${used.includes(name) ? '' : ' (new)'}`, tryEdit((current) => setLeafInput(current, outputIndex, path, name)));
    }
    endGroup();
    items.push('<hr class="menu-divider" />');
    for (const gate of ['and', 'or', 'not']) {
      option('grow', gate, `Replace with ${gate.toUpperCase()}`, tryEdit((current) => growLeaf(current, outputIndex, path, gate)));
    }
  } else if (kind === 'gate') {
    option('remove', '', 'Remove this gate', tryEdit((current) => removeGate(current, outputIndex, path)));
  } else {
    for (const gate of ['and', 'or', 'not']) {
      option('wrap', gate, `Wrap in ${gate.toUpperCase()}`, tryEdit((current) => wrapOutput(current, outputIndex, gate)));
    }
  }
  endGroup();
  closeMenus();
  state.chipMenu = { outputIndex, path, kind, chip };
  elements.chipMenu.innerHTML = items.join('');
  elements.chipMenu.hidden = false;
  chip.setAttribute('aria-expanded', 'true');
  positionChipMenu();
  elements.chipMenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}

// Under the chip, or above it when there is no room below; always on screen.
function positionChipMenu() {
  const chip = state.chipMenu?.chip;
  if (!chip) return;
  const rect = chip.getBoundingClientRect();
  const menu = elements.chipMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(document.documentElement.clientWidth - menu.width - 8, rect.left));
  const below = rect.bottom + 6 + menu.height <= window.innerHeight - 8;
  elements.chipMenu.style.left = `${Math.round(left)}px`;
  elements.chipMenu.style.top = `${Math.round(below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - menu.height))}px`;
}

function closeChipMenu() {
  if (!state.chipMenu) return;
  state.chipMenu.chip?.setAttribute('aria-expanded', 'false');
  state.chipMenu = null;
  elements.chipMenu.hidden = true;
}

function applyChipAction(action, value) {
  const open = state.chipMenu;
  if (!open) return;
  const { outputIndex, path } = open;
  closeChipMenu();
  const next = tryEdit((current) => {
    if (action === 'use') return setLeafInput(current, outputIndex, path, value);
    if (action === 'grow') return growLeaf(current, outputIndex, path, value);
    if (action === 'remove') return removeGate(current, outputIndex, path);
    if (action === 'wrap') return wrapOutput(current, outputIndex, value);
    return null;
  });
  if (next) editCircuit(next);
}

function renderRunProgress() {
  const experiment = state.circuit;
  if (!experiment) return;
  const filling = state.circuitRunning && state.truthRows?.current > 0;
  const running = state.circuitRunning && state.circuitOutputs?.some((output) => output.settled === false);
  // Lamps read from the truth table have no run of their own to show.
  const settled = Boolean(state.circuitOutputs?.length) && !running && state.board.generation > 0;
  const generation = Math.min(filling ? state.truthRows.generation : state.board.generation, experiment.observeGeneration);
  const visible = filling || running || settled;
  elements.runProgress.hidden = !visible;
  elements.runProgressText.hidden = !visible;
  elements.runProgress.setAttribute('aria-valuenow', String(generation));
  elements.runProgressBar.style.width = `${(generation / experiment.observeGeneration) * 100}%`;
  elements.runProgressText.textContent = filling
    ? `Row ${state.truthRows.current} of ${state.truthRows.rows.length}`
    : `generation ${generation.toLocaleString()} / ${experiment.observeGeneration.toLocaleString()}`;
  renderCircuitBar();
}

// Phone only: with the Experiment sheet closed, a slim bar above the bottom
// controls keeps the lamps and Run in reach while the board shows the run.
function renderCircuitBar() {
  const experiment = state.mode === 'studio' ? state.circuit : null;
  elements.circuitBar.hidden = !experiment;
  if (!experiment) return;
  elements.circuitBarLamps.innerHTML = experiment.outputs.map((port) => {
    const lampState = getLampState(state.circuitOutputs?.find((candidate) => candidate.id === port.id) || null);
    return `<span class="bar-lamp" data-bar-output="${escapeHtml(port.id)}"><span class="bar-lamp-name">${escapeHtml(outputLabel(port))}</span>`
      + `<span class="lamp" data-state="${lampState}">${getLampLabel(lampState)}</span></span>`;
  }).join('');
  const filling = state.circuitRunning && state.truthRows?.current > 0;
  const running = state.circuitRunning && !filling;
  const generation = Math.min(filling ? state.truthRows.generation : state.board.generation, experiment.observeGeneration);
  elements.circuitBarProgress.textContent = filling
    ? `Row ${state.truthRows.current} of ${state.truthRows.rows.length}`
    : running ? `${generation.toLocaleString()} / ${experiment.observeGeneration.toLocaleString()}` : '';
  elements.runCircuitBar.disabled = state.circuitRunning;
}

function renderTruthTable() {
  const experiment = state.circuit;
  if (!experiment) return;
  const inputNames = circuitInputNames();
  const outputs = experiment.outputs;
  const measured = state.truthRows?.key === truthKey(state.circuitSpec);
  const rows = measured
    ? state.truthRows.rows
    : getInputCombinations(inputNames).map((inputs) => ({ inputs, outputs: null }));
  const header = `<tr>${inputNames.map((name) => `<th scope="col">${escapeHtml(name.toUpperCase())}</th>`).join('')}${outputs.map((port) => `<th scope="col">${escapeHtml(outputLabel(port))}</th>`).join('')}</tr>`;
  const body = rows.map((row) => `<tr>${inputNames.map((name) => `<td>${row.inputs[name] ? 1 : 0}</td>`).join('')}${outputs.map((port) => {
    const output = row.outputs?.find((candidate) => candidate.id === port.id);
    if (!output) return '<td class="pending">·</td>';
    return `<td class="${output.high ? 'high' : 'low'}">${output.high ? 1 : 0}</td>`;
  }).join('')}</tr>`).join('');
  const caption = measured
    ? (state.circuitRunning ? 'Running every combination…' : 'Each row was run on the board.')
    : inputNames.length > 4
      ? `Run all measures every combination: ${truthTableEstimate().text}.`
      : 'Run all to measure every combination.';
  elements.truthTable.innerHTML = `<thead>${header}</thead><tbody>${body}</tbody><caption>${escapeHtml(caption)}</caption>`;
}

/* ---------------------------------------------------------------------------
 * Feedback
 * ------------------------------------------------------------------------- */

function triggerHaptic(action) {
  const pattern = getHapticPattern(action);
  if (pattern.length > 0) navigator.vibrate?.(pattern);
}

// New content (another circuit, an opened sheet) clears a stale toast.
function dismissToast() {
  window.clearTimeout(feedbackTimer);
  elements.toast.hidden = true;
}

function showToast(message, { kind = 'info' } = {}) {
  window.clearTimeout(feedbackTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.kind = kind;
  elements.toast.hidden = false;
  feedbackTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2500);
}

/* ---------------------------------------------------------------------------
 * Canvas geometry
 * ------------------------------------------------------------------------- */

function resizeCanvas() {
  const pixelRatio = window.devicePixelRatio || 1;
  const width = elements.canvasHost.clientWidth;
  const height = elements.canvasHost.clientHeight;
  if (!width || !height) return;
  // The size this workspace's pan was computed for (stored with the workspace).
  const previous = { width: state.viewWidth, height: state.viewHeight };
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (state.pendingFit) {
    const pending = state.pendingFit;
    state.pendingFit = null;
    state.viewInitialized = true;
    if (pending.apply) pending.apply(); else fitRegion(pending.region, pending.options);
  } else if (!state.viewInitialized || state.pendingCenter) {
    state.viewInitialized = true;
    state.pendingCenter = false;
    centerWorld();
  } else if (previous.width && previous.height) {
    // Keep the board centre stable when the frame changes size.
    state.panX += (width - previous.width) / 2;
    state.panY += (height - previous.height) / 2;
  }
  state.viewWidth = width;
  state.viewHeight = height;
  render();
}

function getWorldViewport() {
  return { left: 0, top: 0, width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 };
}

function centerWorld() {
  if (!canvas.clientWidth) {
    // The board is hidden (another section is open); centre once it has a size.
    state.pendingCenter = true;
    state.pendingFit = null;
    return;
  }
  const cellSize = getCellSize();
  const viewport = getWorldViewport();
  state.panX = (viewport.width - state.board.width * cellSize) / 2;
  state.panY = (viewport.height - state.board.height * cellSize) / 2;
}

function getCellSize() {
  return BASE_CELL_SIZE * state.zoom;
}

// The zoom floor: the usual 10%, lowered for boards too big to fit the view
// at 10% so Fit always succeeds (a 3000-wide board on a phone needs ~1%).
function getMinZoom() {
  const viewport = getWorldViewport();
  return getFitZoom({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    regionWidth: state.board.width,
    regionHeight: state.board.height,
    baseCellSize: BASE_CELL_SIZE,
    padding: 24,
    minZoom: 0.004,
    maxZoom: MIN_ZOOM,
  });
}

function screenToCell(localX, localY) {
  const cellSize = getCellSize();
  return {
    x: Math.floor((localX - state.panX) / cellSize),
    y: Math.floor((localY - state.panY) / cellSize),
  };
}

function setZoom(nextZoom, anchorX = canvas.clientWidth / 2, anchorY = canvas.clientHeight / 2) {
  const previousCellSize = getCellSize();
  const worldX = (anchorX - state.panX) / previousCellSize;
  const worldY = (anchorY - state.panY) / previousCellSize;

  // A circuit fit may sit below the floor; never jump up from it.
  state.zoom = Math.min(MAX_ZOOM, Math.max(Math.min(getMinZoom(), state.zoom), nextZoom));

  const nextCellSize = getCellSize();
  state.panX = anchorX - worldX * nextCellSize;
  state.panY = anchorY - worldY * nextCellSize;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitRegion(region, { padding = 24, maxZoom = MAX_ZOOM, deferred = false } = {}) {
  // Deferred: the frame is still being laid out (route change, project open),
  // so the next canvas resize measures the real size and applies the fit.
  if (deferred || !canvas.clientWidth) {
    state.pendingFit = { region, options: { padding, maxZoom } };
    state.pendingCenter = false;
    if (deferred) window.requestAnimationFrame(resizeCanvas);
    return;
  }
  const viewport = getWorldViewport();
  const zoom = getFitZoom({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    regionWidth: region.width,
    regionHeight: region.height,
    baseCellSize: BASE_CELL_SIZE,
    padding,
    minZoom: getMinZoom(),
    maxZoom,
  });
  state.zoom = zoom;
  const cellSize = getCellSize();
  state.panX = (viewport.width - region.width * cellSize) / 2 - region.x * cellSize;
  state.panY = (viewport.height - region.height * cellSize) / 2 - region.y * cellSize;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitBoard({ deferred = false } = {}) {
  fitRegion({ x: 0, y: 0, width: state.board.width, height: state.board.height }, { padding: 24, deferred });
}

function fitLiveCells({ deferred = false } = {}) {
  const coordinates = getLiveCoordinates();
  if (!coordinates.length) {
    fitBoard({ deferred });
    return;
  }
  const bounds = getPatternBounds(coordinates);
  const margin = 8;
  fitRegion({
    x: bounds.minX - margin,
    y: bounds.minY - margin,
    width: bounds.width + margin * 2,
    height: bounds.height + margin * 2,
  }, { padding: 24, maxZoom: 1.6, deferred });
}

function setSpeed(nextSpeed) {
  state.speed = Math.min(40, Math.max(1, nextSpeed));
  elements.speedLabel.textContent = `${state.speed} gen/s`;
  for (const item of elements.speedMenu.querySelectorAll('[data-speed]')) {
    item.setAttribute('aria-checked', String(Number(item.dataset.speed) === state.speed));
  }
}

/* ---------------------------------------------------------------------------
 * Drawing tools and simulation stepping
 * ------------------------------------------------------------------------- */

function paintCell(cellX, cellY, alive) {
  if (!state.designSettings.wrapping && (
    cellX < 0 || cellY < 0 || cellX >= state.board.width || cellY >= state.board.height
  )) {
    return;
  }

  const x = wrap(cellX, state.board.width);
  const y = wrap(cellY, state.board.height);
  const index = cellIndex(state.board, x, y);
  const nextValue = alive ? 1 : 0;

  if (state.board.cells[index] === nextValue) return;

  state.board.cells[index] = nextValue;
  state.boardRevision += 1;
  state.authoredStart = ownedSnapshot();
  markDesignDirty(true);
  updateStats();
}

function applyToolAt(localX, localY) {
  const cell = screenToCell(localX, localY);
  const key = `${wrap(cell.x, state.board.width)},${wrap(cell.y, state.board.height)}`;

  if (state.pointer.lastCell === key) return;

  if (state.pointer.mode === 'draw') paintCell(cell.x, cell.y, true);
  if (state.pointer.mode === 'erase') paintCell(cell.x, cell.y, false);
  if (state.pointer.mode === 'stamp') stampPattern(cell.x, cell.y);

  state.pointer.lastCell = key;
}

function getCellAliveAt(localX, localY) {
  const cell = screenToCell(localX, localY);
  return getCell(state.board, cell.x, cell.y);
}

async function stepSimulation() {
  if (state.circuitRunning) return;
  // Fast repeats keep one step queued instead of dropping it.
  if (state.simulationStepPending) { state.stepQueued = true; return; }
  state.simulationStepPending = true;
  try {
    const load = state.simulationLoad;
    await load;
    if (load !== state.simulationLoad) return;
    const next = await state.simulation.advance(1);
    state.board = ownedSnapshot(next);
    updateStats();
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(`Simulation stopped: ${getErrorMessage(error)}`, { kind: 'error' });
  } finally {
    state.simulationStepPending = false;
    if (state.stepQueued) {
      state.stepQueued = false;
      stepSimulation();
    }
  }
}

function setPlaying(playing) {
  if (state.circuitRunning) return;
  state.playing = playing;
  if (!playing) loadSimulation();
  state.accumulator = 0;
  updatePlayButton();
}

function randomSoup() {
  beginAuthoringCommand();
  state.board = createRandomBoard(state.board.width, state.board.height, 0.18);
  exitCircuit();
  finishAuthoringCommand();
  renderInspector();
}

function clearWorld() {
  beginAuthoringCommand();
  state.board = clearBoard(state.board);
  exitCircuit();
  finishAuthoringCommand();
  renderInspector();
  showToast('Board cleared', { kind: 'success' });
}

function openRleDialog(mode) {
  elements.rleError.hidden = true;
  elements.rleError.textContent = '';
  if (mode === 'export') {
    const coordinates = getLiveCoordinates();
    elements.rleDialogTitle.textContent = 'Export RLE';
    elements.rleNote.textContent = coordinates.length
      ? `${formatCellCount(coordinates.length)} as RLE text.`
      : 'The board is empty, so there is nothing to export yet.';
    elements.rleField.value = encodeRle(coordinates);
    elements.rleCopy.hidden = false;
    elements.rleStamp.hidden = true;
  } else {
    elements.rleDialogTitle.textContent = 'Import RLE';
    elements.rleNote.textContent = 'Paste RLE text from a Life pattern page. The pattern becomes a stamp you can place.';
    elements.rleField.value = '';
    elements.rleCopy.hidden = true;
    elements.rleStamp.hidden = false;
  }
  elements.rleDialog.showModal();
  if (mode === 'export') elements.rleField.select();
  else elements.rleField.focus();
}

function importRleFromDialog() {
  try {
    const pattern = parseRle(elements.rleField.value);
    if (!pattern.coordinates.length) throw new Error('That RLE has no live cells.');
    state.selectedPreset = {
      id: 'rle-import',
      name: 'Imported RLE',
      note: `${pattern.width} × ${pattern.height}`,
      coordinates: pattern.coordinates,
    };
    state.stampRotation = 0;
    state.stampFlipX = false;
    setTool('stamp');
    updatePresetSelection();
    elements.rleDialog.close();
  } catch (error) {
    elements.rleError.hidden = false;
    elements.rleError.textContent = error instanceof Error ? error.message : 'Could not read that RLE.';
  }
}

async function copyRleFromDialog() {
  try {
    await navigator.clipboard.writeText(elements.rleField.value);
    showToast('RLE copied', { kind: 'success' });
    elements.rleDialog.close();
  } catch {
    elements.rleField.select();
    showToast('Select the text and copy it', { kind: 'info' });
  }
}

function getLiveCoordinates() {
  const coordinates = [];

  for (let y = 0; y < state.board.height; y += 1) {
    for (let x = 0; x < state.board.width; x += 1) {
      if (getCell(state.board, x, y)) coordinates.push([x, y]);
    }
  }

  return coordinates;
}

/* ---------------------------------------------------------------------------
 * Rendering
 * ------------------------------------------------------------------------- */

function readPalette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  palette = {
    bg: read('--bg'),
    canvas: read('--canvas'),
    grid: read('--grid'),
    gridMajor: read('--grid-major'),
    cell: read('--cell'),
    line: read('--line'),
    accent: read('--accent'),
    good: read('--good'),
    muted: read('--muted'),
    text: read('--text'),
  };
}

function rgbaFromHex(hex, alpha) {
  const normalized = String(hex || '#000000').replace('#', '');
  const value = /^[0-9a-f]{6}$/i.test(normalized) ? normalized : '000000';
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function isCanvasVisible() {
  return state.mode !== 'community' && !(state.mode === 'studio' && state.studioView === 'projects') && canvas.clientWidth > 0;
}

function render() {
  if (!isCanvasVisible()) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const cellSize = getCellSize();
  const worldWidth = state.board.width * cellSize;
  const worldHeight = state.board.height * cellSize;
  const panX = Math.round(state.panX);
  const panY = Math.round(state.panY);

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(panX, panY);

  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, worldWidth, worldHeight);

  const visible = getVisibleCellRange(cellSize, panX, panY, width, height);
  drawGrid(cellSize, worldWidth, worldHeight, visible);
  drawCells(cellSize, visible);
  drawCircuitMarkers(cellSize);
  drawStampPreview(cellSize);
  drawSelection(cellSize);

  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, worldWidth - 1, worldHeight - 1);

  ctx.restore();
}

function getVisibleCellRange(cellSize, panX, panY, width, height) {
  return {
    startX: Math.max(0, Math.floor(-panX / cellSize) - 1),
    endX: Math.min(state.board.width, Math.ceil((width - panX) / cellSize) + 1),
    startY: Math.max(0, Math.floor(-panY / cellSize) - 1),
    endY: Math.min(state.board.height, Math.ceil((height - panY) / cellSize) + 1),
  };
}

function drawGrid(cellSize, worldWidth, worldHeight, visible) {
  if (cellSize < 3) return;
  const { startX, endX, startY, endY } = visible;
  ctx.lineWidth = 1;

  if (cellSize >= 6) {
    ctx.strokeStyle = palette.grid;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += 1) {
      const px = Math.round(x * cellSize) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, worldHeight);
    }
    for (let y = startY; y <= endY; y += 1) {
      const py = Math.round(y * cellSize) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(worldWidth, py);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = palette.gridMajor;
  ctx.beginPath();
  for (let x = Math.max(0, Math.ceil(startX / 10) * 10); x <= endX; x += 10) {
    const px = Math.round(x * cellSize) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, worldHeight);
  }
  for (let y = Math.max(0, Math.ceil(startY / 10) * 10); y <= endY; y += 10) {
    const py = Math.round(y * cellSize) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(worldWidth, py);
  }
  ctx.stroke();
}

function drawCells(cellSize, visible) {
  if (cellSize < BITMAP_CELL_SIZE) {
    drawCellsBitmap(cellSize, visible);
    return;
  }
  const { startX, endX, startY, endY } = visible;
  const inset = cellSize >= 6 ? 1 : 0;
  const size = Math.max(1, cellSize - inset);
  const cells = state.board.cells;
  const boardWidth = state.board.width;
  ctx.fillStyle = palette.cell;

  for (let y = startY; y < endY; y += 1) {
    const row = y * boardWidth;
    const py = y * cellSize + inset;
    for (let x = startX; x < endX; x += 1) {
      if (cells[row + x] !== 1) continue;
      ctx.fillRect(x * cellSize + inset, py, size, size);
    }
  }
}

// Sub-pixel cells: paint the visible cells into a device-pixel bitmap where a
// pixel lights when any cell under it is alive, then draw it once. The bitmap
// is kept while the board, the zoom and the visible range stay the same, so
// panning a fitted 3000-wide board only re-draws an image.
function drawCellsBitmap(cellSize, visible) {
  const { startX, endX, startY, endY } = visible;
  if (endX <= startX || endY <= startY) return;
  const ratio = window.devicePixelRatio || 1;
  const scale = cellSize * ratio;
  const left = Math.floor(startX * scale);
  const top = Math.floor(startY * scale);
  const width = Math.max(1, Math.ceil(endX * scale) - left);
  const height = Math.max(1, Math.ceil(endY * scale) - top);
  const key = [state.board.generation, state.boardRevision, startX, endX, startY, endY, scale, palette.cell].join(':');
  if (bitmap.board !== state.board || bitmap.key !== key) {
    if (!bitmap.canvas) {
      bitmap.canvas = document.createElement('canvas');
      bitmap.context = bitmap.canvas.getContext('2d');
    }
    if (bitmap.canvas.width !== width || bitmap.canvas.height !== height) {
      bitmap.canvas.width = width;
      bitmap.canvas.height = height;
      bitmap.image = bitmap.context.createImageData(width, height);
      bitmap.pixels = new Uint32Array(bitmap.image.data.buffer);
    }
    const pixels = bitmap.pixels;
    pixels.fill(0);
    const colour = cellPixel(palette.cell);
    const cells = state.board.cells;
    const boardWidth = state.board.width;
    const columns = new Int32Array(endX - startX);
    for (let x = startX; x < endX; x += 1) columns[x - startX] = Math.floor(x * scale) - left;
    for (let y = startY; y < endY; y += 1) {
      const row = y * boardWidth;
      const target = (Math.floor(y * scale) - top) * width;
      for (let x = startX; x < endX; x += 1) {
        if (cells[row + x] === 1) pixels[target + columns[x - startX]] = colour;
      }
    }
    bitmap.context.putImageData(bitmap.image, 0, 0);
    bitmap.board = state.board;
    bitmap.key = key;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap.canvas, 0, 0, width, height, left / ratio, top / ratio, width / ratio, height / ratio);
  ctx.restore();
}

// A hex colour as an opaque little-endian RGBA pixel for a Uint32 image view.
function cellPixel(hex) {
  const normalized = String(hex || '#000000').replace('#', '');
  const value = /^[0-9a-f]{6}$/i.test(normalized) ? normalized : '000000';
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return ((255 << 24) | (blue << 16) | (green << 8) | red) >>> 0;
}

function drawSelection(cellSize) {
  if (!state.selection) return;
  const { x, y, width, height } = state.selection;
  ctx.save();
  ctx.fillStyle = rgbaFromHex(palette.accent, 0.12);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 1;
  ctx.fillRect(x * cellSize, y * cellSize, width * cellSize, height * cellSize);
  ctx.strokeRect(Math.round(x * cellSize) + 0.5, Math.round(y * cellSize) + 0.5, Math.round(width * cellSize) - 1, Math.round(height * cellSize) - 1);
  ctx.restore();
}

function drawStampPreview(cellSize) {
  if (state.tool !== 'stamp' || !state.selectedPreset || !state.hoverCell) return;

  const coordinates = getTransformedPresetCoordinates();
  const bounds = getPatternBounds(coordinates);
  const originX = state.hoverCell.x - Math.floor(bounds.width / 2);
  const originY = state.hoverCell.y - Math.floor(bounds.height / 2);
  const inset = cellSize >= 6 ? 1 : 0;
  const size = Math.max(1, cellSize - inset);

  ctx.save();
  ctx.fillStyle = rgbaFromHex(palette.accent, 0.4);
  for (const [patternX, patternY] of coordinates) {
    const x = state.designSettings.wrapping ? wrap(originX + patternX, state.board.width) : originX + patternX;
    const y = state.designSettings.wrapping ? wrap(originY + patternY, state.board.height) : originY + patternY;
    if (x < 0 || y < 0 || x >= state.board.width || y >= state.board.height) continue;
    ctx.fillRect(x * cellSize + inset, y * cellSize + inset, size, size);
  }
  ctx.restore();
}

function drawCircuitMarkers(cellSize) {
  const experiment = state.circuit;
  if (!experiment || experiment.board.width > state.board.width || experiment.board.height > state.board.height) return;
  const { tiles, ports } = getCircuitGeometry(experiment);
  ctx.save();
  ctx.strokeStyle = palette.accent;
  ctx.fillStyle = palette.accent;
  ctx.lineWidth = 1;
  ctx.font = markerFont();
  ctx.textBaseline = 'middle';

  // Gate tile outlines, named above each tile (inside it when the tile sits
  // at the board's top edge).
  ctx.setLineDash([6, 4]);
  for (const tile of tiles) {
    ctx.strokeRect(Math.round(tile.x * cellSize) + 0.5, Math.round(tile.y * cellSize) + 0.5, Math.round(tile.width * cellSize), Math.round(tile.height * cellSize));
  }
  ctx.setLineDash([]);
  ctx.textAlign = 'left';
  for (const tile of tiles) {
    const name = GATE_CARDS[tile.gateId]?.name || String(tile.gateId).toUpperCase();
    const top = tile.y * cellSize;
    ctx.fillText(name, tile.x * cellSize + 6, top >= 16 ? top - 10 : top + 12);
  }

  // Input lanes with direction arrows, one per port (a reused input has several).
  const boardWidth = state.board.width * cellSize;
  const boardHeight = state.board.height * cellSize;
  for (const port of ports) {
    const active = experiment.inputs?.[port.name];
    const label = port.name.toUpperCase();
    const arrow = PORT_ARROWS[port.side] || '→';
    ctx.globalAlpha = active ? 1 : 0.45;
    const px = Math.round(port.x * cellSize) + 0.5;
    const py = Math.round(port.y * cellSize) + 0.5;
    ctx.beginPath();
    if (port.side === 'west') { ctx.moveTo(0, py); ctx.lineTo(port.x * cellSize - 4, py); }
    else if (port.side === 'east') { ctx.moveTo(boardWidth, py); ctx.lineTo(port.x * cellSize + 4, py); }
    else if (port.side === 'north') { ctx.moveTo(px, 0); ctx.lineTo(px, port.y * cellSize - 4); }
    else { ctx.moveTo(px, boardHeight); ctx.lineTo(px, port.y * cellSize + 4); }
    ctx.stroke();
    if (port.side === 'west') {
      drawArrowHead(port.x * cellSize, py, 0);
      ctx.textAlign = 'right';
      ctx.fillText(`${label} ${arrow}`, port.x * cellSize - 10, py - 10);
    } else if (port.side === 'east') {
      drawArrowHead(port.x * cellSize, py, Math.PI);
      ctx.textAlign = 'left';
      ctx.fillText(`${arrow} ${label}`, port.x * cellSize + 10, py - 10);
    } else if (port.side === 'north') {
      drawArrowHead(px, port.y * cellSize, Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.fillText(`${label} ${arrow}`, px + 8, port.y * cellSize - 14);
    } else {
      drawArrowHead(px, port.y * cellSize, -Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.fillText(`${label} ${arrow}`, px + 8, port.y * cellSize + 14);
    }
  }
  ctx.globalAlpha = 1;

  // Output probe boxes.
  for (const port of experiment.outputs) {
    const output = state.circuitOutputs?.find((candidate) => candidate.id === port.id);
    const lampState = getLampState(output);
    const label = outputLabel(port);
    const x = (port.x - Math.floor(port.width / 2)) * cellSize;
    const y = (port.y - Math.floor(port.height / 2)) * cellSize;
    const w = port.width * cellSize;
    const h = port.height * cellSize;
    ctx.strokeStyle = lampState === 'high' ? palette.good : palette.accent;
    ctx.fillStyle = rgbaFromHex(lampState === 'high' ? palette.good : palette.accent, lampState === 'high' ? 0.22 : 0.08);
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.fillStyle = lampState === 'high' ? palette.good : palette.accent;
    // To the right of the box, outside the tile. The state drops to a second
    // line when one line would run past the canvas edge.
    const suffix = lampState === 'high' ? ' · HIGH' : lampState === 'low' ? ' · LOW' : '';
    const labelX = x + w + 6;
    ctx.textAlign = 'left';
    if (suffix && state.panX + labelX + ctx.measureText(label + suffix).width > canvas.clientWidth - 4) {
      ctx.fillText(label, labelX, y + h / 2 - 7);
      ctx.fillText(suffix.slice(3), labelX, y + h / 2 + 7);
    } else {
      ctx.fillText(label + suffix, labelX, y + h / 2);
    }
  }
  ctx.restore();
}

function drawArrowHead(x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-7, -4);
  ctx.lineTo(-7, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function plural(value, singular, pluralForm = `${singular}s`) {
  const count = wholeNumber(value);
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

function updateStats() {
  const population = getPopulation(state.board);
  elements.generation.textContent = state.board.generation.toLocaleString();
  elements.population.textContent = population.toLocaleString();
  elements.populationUnit.textContent = population === 1 ? 'cell' : 'cells';
  elements.statusMobile.textContent = formatStatus(state.board.generation, population, { compact: true });
}

function updatePlayButton() {
  elements.playLabel.textContent = state.playing ? 'Pause' : 'Play';
  elements.playToggle.setAttribute('aria-label', state.playing ? 'Pause (Space)' : 'Play (Space)');
  elements.body.dataset.playing = String(state.playing);
  updateHistoryControls();
}

/* ---------------------------------------------------------------------------
 * Tool strip
 * ------------------------------------------------------------------------- */

function setTool(tool) {
  state.tool = tool;
  elements.body.dataset.tool = tool;
  for (const button of elements.toolButtons) {
    button.setAttribute('aria-checked', String(button.dataset.tool === tool));
  }
  renderToolStrip();
}

function chooseTool(tool) {
  if (tool === 'stamp' && !state.selectedPreset) {
    setTool('stamp');
    if (MOBILE_QUERY.matches) openRail(true);
    return;
  }
  setTool(tool);
}

function renderToolStrip() {
  const group = getContextualGroup({ tool: state.tool, hasSelection: Boolean(state.selection) });
  elements.selectionGroup.hidden = group !== 'selection';
  elements.stampGroup.hidden = group !== 'stamp';
  if (group === 'stamp') {
    const name = state.selectedPreset?.name || 'Pick a pattern';
    const degrees = state.stampRotation ? ` · ${state.stampRotation}°` : '';
    elements.stampName.textContent = `Stamping: ${name}${degrees}`;
    elements.stampFlip.setAttribute('aria-pressed', String(state.stampFlipX));
    elements.stampRotateLeft.disabled = !state.selectedPreset;
    elements.stampRotateRight.disabled = !state.selectedPreset;
    elements.stampFlip.disabled = !state.selectedPreset;
  }
  const pasteButton = elements.selectionGroup.querySelector('[data-selection-command="paste"]');
  if (pasteButton) pasteButton.disabled = !state.clipboard;
}

/* ---------------------------------------------------------------------------
 * Mode and routing
 * ------------------------------------------------------------------------- */

const WORKSPACE_KEYS = ['board', 'authoredStart', 'history', 'designSettings', 'selection', 'circuit', 'circuitSpec',
  'circuitOutputs', 'truthRows', 'session', 'previewConfig', 'designDirty', 'saveStatus', 'publishStatus', 'zoom', 'panX',
  'panY', 'pendingFit', 'viewWidth', 'viewHeight'];

// Playground and Studio each keep their own board, history and camera; a
// Studio project never overwrites the Playground sketch.
function swapWorkspace(owner) {
  if (owner === state.boardOwner) return;
  if (state.circuitRunning) {
    state.simulation?.cancel();
    state.circuitOutputs = null;
  }
  state.workspaces[state.boardOwner] = Object.fromEntries(WORKSPACE_KEYS.map((key) => [key, state[key]]));
  const fresh = createBoard(DEFAULT_DESIGN_SETTINGS.width, DEFAULT_DESIGN_SETTINGS.height);
  const next = state.workspaces[owner] || {
    board: fresh,
    authoredStart: cloneBoard(fresh),
    history: withEdgeMemory(createBoardHistory()),
    designSettings: DEFAULT_DESIGN_SETTINGS,
    selection: null,
    circuit: null,
    circuitSpec: null,
    circuitOutputs: null,
    truthRows: null,
    session: null,
    previewConfig: {},
    designDirty: false,
    saveStatus: 'new',
    publishStatus: 'draft',
    zoom: 1,
    panX: 0,
    panY: 0,
    pendingFit: null,
    viewWidth: 0,
    viewHeight: 0,
  };
  state.pendingCenter = !state.workspaces[owner];
  Object.assign(state, next);
  state.boardOwner = owner;
  state.playing = false;
  loadSimulation();
  updateStats();
  updatePlayButton();
  updateHistoryControls();
  renderToolStrip();
  syncDesignControls();
  setSaveStatus(state.saveStatus);
  renderPublishButton();
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

// "Open in Studio": a new project that starts from the Playground sketch.
function openSketchInStudio() {
  const sketch = ownedSnapshot();
  sketch.generation = 0;
  const settings = state.designSettings;
  swapWorkspace('studio');
  state.designSettings = settings;
  replaceBoard(sketch);
  state.authoredStart = ownedSnapshot(sketch);
  state.history.clear();
  startProject({ title: 'Untitled project', boardLoaded: true });
  markDesignDirty(true);
  fitLiveCells({ deferred: true });
  navigateTo('/studio');
}

function setMode(mode) {
  const previousMode = state.mode;
  state.mode = mode;
  elements.body.dataset.mode = mode;
  closeMenus();
  closeSheets();

  if (previousMode !== mode) {
    const nextTool = getToolAfterWorkspaceChange({ currentTool: state.tool });
    if (nextTool !== state.tool) {
      state.hoverCell = null;
      state.pointer.active = false;
      setTool(nextTool);
    }
  }

  for (const [button, active] of [
    [elements.modePlayground, mode === 'playground'],
    [elements.modeStudio, mode === 'studio'],
    [elements.modeCommunity, mode === 'community'],
  ]) {
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

  elements.communityPanel.hidden = mode !== 'community';
  if (mode === 'community' && state.playing) setPlaying(false);
  if (mode === 'community') renderCommunity();
  if (mode !== 'community') swapWorkspace(mode);
  renderCircuitBar();
  if (mode === 'studio' && state.recoveryPending) {
    state.recoveryPending = false;
    showToast('Recovered unsaved work', { kind: 'info' });
  }
  elements.openInStudio.hidden = mode !== 'playground';
  if (mode === 'studio' && !state.session && state.studioView === 'project') {
    const activeId = communityState.activeCreationId;
    if (!(activeId && openProject(activeId))) startProject({ title: 'Untitled project' });
  }
  renderStudio();
  renderRail();
  document.title = mode === 'studio' ? 'Studio · Life Lab' : mode === 'community' ? 'Community · Life Lab' : 'Life Lab';
  window.requestAnimationFrame(resizeCanvas);
}

function navigateTo(path, { replace = false, render = true } = {}) {
  const method = replace ? 'replaceState' : 'pushState';
  if (window.location.pathname + window.location.search !== path) window.history[method]({}, '', path);
  if (render) routeCurrentLocation();
}

async function routeCurrentLocation() {
  const path = window.location.pathname;
  // A malformed escape such as /c/%E0%A4%A reads as a pattern that does not exist.
  const creationMatch = path.match(/^\/c\/([^/]+)$/);
  if (creationMatch) { await openPublicCreationRoute(decodePathPart(creationMatch[1])); return; }
  const profileMatch = path.match(/^\/u\/([^/]+)$/);
  const username = profileMatch && decodePathPart(profileMatch[1]);
  if (username) { await openCreatorRoute(username, { updateHistory: false }); return; }
  const mode = getModeForPath(path);
  if (mode === 'community') {
    state.communityView = 'gallery';
    state.publicProfile = null;
  }
  setMode(mode);
}

function decodePathPart(value) {
  try { return decodeURIComponent(value); } catch { return ''; }
}

/* ---------------------------------------------------------------------------
 * Community
 * ------------------------------------------------------------------------- */

function getFamousCommunityDesigns() {
  const famous = [
    { id: 'glider', title: 'Glider', description: 'The smallest spaceship and the hello-world of Life motion.', tags: ['spaceship', 'starter', 'famous'] },
    { id: 'gosper-gun', title: 'Gosper glider gun', description: 'The first known gun: a repeating source that emits gliders.', tags: ['gun', 'glider', 'classic'] },
    { id: 'pulsar', title: 'Pulsar', description: 'A symmetric period-3 oscillator with a readable rhythm.', tags: ['oscillator', 'period-3', 'starter'] },
    { id: 'r-pentomino', title: 'R-pentomino', description: 'A tiny methuselah that stays chaotic for a surprisingly long time.', tags: ['methuselah', 'chaos', 'famous'] },
    { id: 'acorn', title: 'Acorn', description: 'Seven cells that create a long-lived, expansive sequence.', tags: ['methuselah', 'growth', 'classic'] },
    { id: 'diehard', title: 'Diehard', description: 'A finite pattern famous for living a long time before disappearing.', tags: ['methuselah', 'extinction', 'classic'] },
  ];

  return famous.map((entry) => {
    const preset = findPreset(entry.id);
    const bounds = getPatternBounds(preset.coordinates);
    const width = Math.max(80, bounds.width + 24);
    const height = Math.max(60, bounds.height + 24);

    return {
      id: `famous-${entry.id}`,
      title: entry.title,
      slug: `famous-${entry.id}`,
      description: entry.description,
      visibility: 'public',
      ownerId: 'lifewiki',
      ownerName: 'LifeWiki',
      thumbnail: '',
      tags: entry.tags,
      starCount: 0,
      cloneCount: 0,
      viewCount: 0,
      commentCount: 0,
      comments: [],
      starredBy: [],
      remixedFromId: null,
      rootCreationId: `famous-${entry.id}`,
      currentVersion: {
        id: `famous-version-${entry.id}`,
        rle: encodeRle(preset.coordinates),
        width,
        height,
        generation: 0,
        population: preset.coordinates.length,
        rule: 'B3/S23',
        settings: serializeDesignSettings(createDesignSettings({ gridPreset: 'custom', width, height })),
        createdAt: '2026-06-30T00:00:00.000Z',
      },
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      publishedAt: '2026-06-30T00:00:00.000Z',
    };
  });
}

function findCommunityDesign(creationId) {
  if (!creationId) return null;
  return community.findCreation(creationId)
    || state.publicCreations.find((creation) => creation.id === creationId || creation.slug === creationId)
    || getFamousCommunityDesigns().find((creation) => creation.id === creationId || creation.slug === creationId)
    || null;
}

function getCommunityComments(creation) {
  return state.communityComments[creation.id] || creation.comments || [];
}

function isFamous(creation) {
  return String(creation?.id || '').startsWith('famous-');
}

async function renderCommunity() {
  const renderEpoch = (state.communityRenderEpoch || 0) + 1;
  state.communityRenderEpoch = renderEpoch;
  renderCommunityAuth();
  if (state.mode !== 'community') return;
  syncCommunityFilterUi();

  const ownPublic = communityState.creations.filter((creation) => creation.visibility === 'public' && !creation.archivedAt);
  let trending = await community.listTrendingCreations();
  if (state.communityRenderEpoch !== renderEpoch) return;
  if (communityAuth.cloudRepo?.listPublicCreations) {
    state.communityLoadStatus = 'loading';
    try {
      const feed = await communityAuth.cloudRepo.listPublicCreations({ q: state.communitySearch, favorites: '', limit: '48' });
      if (state.communityRenderEpoch !== renderEpoch) return;
      state.publicCreations = feed.creations || [];
      trending = state.publicCreations;
      state.communityLoadStatus = 'ready';
      elements.communityStatus.hidden = true;
    } catch (error) {
      state.communityLoadStatus = error.status === 401 ? 'auth-required' : 'unavailable';
      elements.communityStatus.hidden = false;
      elements.communityStatus.textContent = `Community service unavailable: ${getErrorMessage(error)} Library patterns and local projects are still here.`;
    }
  }
  state.trendingCreations = trending;
  const famous = getFamousCommunityDesigns();
  const newest = [...state.publicCreations, ...ownPublic]
    .filter((creation, index, all) => all.findIndex((item) => item.id === creation.id) === index)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));

  let items;
  if (state.publicProfile) items = state.publicProfile.creations || [];
  else if (state.communityFilter === 'famous') items = famous;
  else if (state.communityFilter === 'trending') items = trending;
  else if (state.communityFilter === 'new') items = newest;
  else items = [...newest, ...famous];

  renderCommunityGrid(filterCommunityItems(items));
  elements.communityGallery.hidden = state.communityView !== 'gallery';
  elements.communityDetail.hidden = state.communityView !== 'detail';
  if (state.communityView === 'detail') renderCommunityDetail(findCommunityDesign(state.selectedCommunityId));
}

function filterCommunityItems(creations) {
  const query = state.communitySearch.trim().toLowerCase();
  if (!query) return creations;
  return creations.filter((creation) => [
    creation.title,
    creation.ownerName,
    creation.description,
    ...(creation.tags || []),
  ].some((value) => String(value || '').toLowerCase().includes(query)));
}

function renderCommunityGrid(creations) {
  elements.communityGrid.innerHTML = '';
  if (state.publicProfile) {
    const heading = document.createElement('p');
    heading.className = 'community-status';
    heading.style.gridColumn = '1 / -1';
    heading.innerHTML = `<button class="button button-quiet" type="button" data-community-action="browse">← All patterns</button> ${escapeHtml(state.publicProfile.displayName)} · ${creations.length} public ${creations.length === 1 ? 'pattern' : 'patterns'}`;
    elements.communityGrid.append(heading);
  }
  if (creations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'community-empty';
    empty.textContent = state.communitySearch.trim()
      ? 'No patterns match that search.'
      : state.communityFilter === 'trending'
        ? 'Nothing is trending yet. Publish a project to start the list.'
        : state.communityFilter === 'new'
          ? 'No published projects yet.'
          : 'Nothing here yet.';
    elements.communityGrid.append(empty);
    return;
  }
  for (const creation of creations) {
    const card = document.createElement('article');
    card.className = 'community-card';
    card.dataset.creationId = creation.id;
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      ${getCommunityPreviewHtml(creation)}
      <div class="community-card-text">
        <strong>${escapeHtml(creation.title)}</strong>
        <span>${isFamous(creation) ? 'Library · LifeWiki' : `by ${escapeHtml(ownerLabel(creation.ownerId, creation.ownerName))}`} · ${formatCellCount(creation.currentVersion?.population)}</span>
      </div>
      <button class="button" type="button" data-community-action="open" data-creation-id="${escapeHtml(creation.id)}">Open</button>
    `;
    elements.communityGrid.append(card);
  }
}

function getCommunityPreviewHtml(creation) {
  try {
    const preview = creation.previewConfig?.version === 1
      ? creation.previewConfig
      : createCreationPreviewConfig(creation);
    return getPreviewGridHtml(preview);
  } catch {
    return '<span class="preview-grid preview-grid-empty" aria-hidden="true"></span>';
  }
}

function getPreviewGridHtml(preview) {
  // Every preview is padded onto the same 24 x 16 field (the largest a preview
  // is downsampled to), so cells are the same size on every card.
  // Stored previews are untrusted: only whole-number cells inside the grid
  // reach the markup.
  const sourceColumns = Math.min(24, wholeNumber(preview?.grid?.columns) || 6);
  const sourceRows = Math.min(16, wholeNumber(preview?.grid?.rows) || 5);
  const columns = Math.max(24, sourceColumns);
  const rows = Math.max(16, sourceRows);
  const offsetX = Math.floor((columns - sourceColumns) / 2);
  const offsetY = Math.floor((rows - sourceRows) / 2);
  const cells = (Array.isArray(preview?.cells) ? preview.cells : [])
    .filter((cell) => Array.isArray(cell) && Number.isInteger(cell[0]) && Number.isInteger(cell[1])
      && cell[0] >= 0 && cell[1] >= 0 && cell[0] < sourceColumns && cell[1] < sourceRows);
  return `
    <span class="preview-grid" aria-hidden="true" style="--preview-cols:${columns};--preview-rows:${rows}">
      ${cells.map(([x, y]) => `<span style="grid-column:${x + offsetX + 1};grid-row:${y + offsetY + 1}"></span>`).join('')}
    </span>
  `;
}

function getCreationPreviewAltText(creation) {
  try {
    return (creation.previewConfig?.version === 1
      ? creation.previewConfig
      : createCreationPreviewConfig(creation)).altText;
  } catch {
    return `Preview of ${creation.title}`;
  }
}

function openCommunityDetail(creationId) {
  const creation = findCommunityDesign(creationId);
  if (!creation) return;
  state.selectedCommunityId = creation.id;
  state.communityView = 'detail';
  elements.communityGallery.hidden = true;
  elements.communityDetail.hidden = false;
  renderCommunityDetail(creation);
  if (creation.visibility === 'public' && creation.slug) navigateTo(`/c/${encodeURIComponent(creation.slug)}`, { render: false });
  elements.communityPanel.scrollTop = 0;
}

function renderCommunityDetail(creation) {
  if (!creation) {
    elements.communityDetail.innerHTML = '<div class="detail-state"><h1>Pattern unavailable</h1><p>It may be private or removed.</p><button class="button" type="button" data-community-action="browse">Back to Community</button></div>';
    return;
  }
  const famous = isFamous(creation);
  const comments = getCommunityComments(creation);
  const starred = creation.starredByViewer
    ?? creation.starredBy?.includes(communityState.profile?.id || 'profile-local')
    ?? false;
  const canStar = !famous || communityAuth.cloudConfigured;
  const canReport = !famous && communityAuth.cloudConfigured;
  const authorName = escapeHtml(ownerLabel(creation.ownerId, creation.ownerName));
  const author = creation.ownerUsername
    ? `<button type="button" data-community-action="creator" data-username="${escapeHtml(creation.ownerUsername)}">${authorName}</button>`
    : authorName;

  elements.communityDetail.innerHTML = `
    <div class="detail-top">
      <button class="button button-quiet" type="button" id="community-back" data-community-action="browse">
        <svg class="icon" aria-hidden="true"><use href="#i-back" /></svg><span>Community</span>
      </button>
    </div>
    <div class="detail-layout">
      <div class="detail-preview" id="detail-preview" role="img" aria-label="${escapeHtml(getCreationPreviewAltText(creation))}">${getCommunityPreviewHtml(creation)}</div>
      <div class="detail-body">
        <h1 id="detail-title">${escapeHtml(creation.title)}</h1>
        <p class="detail-author" id="detail-author">${famous ? 'From the LifeWiki library' : `by ${author}`}</p>
        <p class="detail-description" id="detail-description">${escapeHtml(creation.description || 'No description yet.')}</p>
        <div class="detail-tags" id="detail-tags">${(creation.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="detail-meta">
          <span>${formatCellCount(creation.currentVersion?.population)}</span>
          <span>${wholeNumber(creation.currentVersion?.width)} × ${wholeNumber(creation.currentVersion?.height)}</span>
          ${famous ? '' : `<span>${plural(creation.starCount || 0, 'star')}</span><span>${plural(creation.cloneCount || 0, 'remix', 'remixes')}</span>`}
        </div>
        <div class="detail-actions">
          <button class="button button-primary" type="button" data-community-action="play" data-creation-id="${escapeHtml(creation.id)}">
            <svg class="icon" aria-hidden="true"><use href="#i-play" /></svg><span>Play</span>
          </button>
          <button class="button" type="button" data-community-action="remix" data-creation-id="${escapeHtml(creation.id)}">
            <svg class="icon" aria-hidden="true"><use href="#i-remix" /></svg><span>Remix</span>
          </button>
          ${canStar ? `<button class="button" type="button" data-community-action="star" data-creation-id="${escapeHtml(creation.id)}" aria-pressed="${starred ? 'true' : 'false'}">
            <svg class="icon" aria-hidden="true"><use href="#i-star" /></svg><span>${starred ? 'Starred' : 'Star'}</span>
          </button>` : ''}
          <button class="button" type="button" data-community-action="share" data-creation-id="${escapeHtml(creation.id)}">
            <svg class="icon" aria-hidden="true"><use href="#i-share" /></svg><span>Share</span>
          </button>
          ${canReport ? `<button class="button button-quiet" type="button" data-community-action="report" data-creation-id="${escapeHtml(creation.id)}">Report</button>` : ''}
        </div>
      </div>
    </div>
    ${famous ? '' : `
    <section class="comments" aria-label="Comments">
      <h2>Comments (${comments.length})</h2>
      <div id="comments-list">
        ${comments.length === 0 ? '<p class="community-status">No comments yet.</p>' : comments.map((comment) => `
          <article class="comment">
            <strong>${escapeHtml(ownerLabel(comment.profileId, comment.authorName))}</strong>
            <p>${escapeHtml(comment.body)}</p>
          </article>`).join('')}
      </div>
      <div class="comment-form">
        <textarea id="comment-body" rows="2" placeholder="Add a comment"></textarea>
        <button id="post-comment" class="button" type="button">Comment</button>
      </div>
    </section>`}
  `;
}

async function openPublicCreationRoute(identifier) {
  state.communityView = 'detail';
  state.publicProfile = null;
  setMode('community');
  state.communityRenderEpoch = (state.communityRenderEpoch || 0) + 1;
  elements.communityGallery.hidden = true;
  elements.communityDetail.hidden = false;
  elements.communityDetail.innerHTML = '<p class="community-status" role="status">Loading…</p>';
  try {
    let creation = findCommunityDesign(identifier);
    if (!creation && identifier && communityAuth.cloudRepo?.getPublicCreation) creation = await communityAuth.cloudRepo.getPublicCreation(identifier);
    if (!creation || creation.visibility !== 'public') throw Object.assign(new Error('This pattern is unavailable or private.'), { status: 404 });
    state.publicCreations = [creation, ...state.publicCreations.filter((item) => item.id !== creation.id)];
    state.selectedCommunityId = creation.id;
    if (communityAuth.cloudRepo?.listPublicComments && !isFamous(creation)) {
      const result = await communityAuth.cloudRepo.listPublicComments(creation.slug || creation.id);
      state.communityComments[creation.id] = result.comments || [];
    }
    renderCommunityDetail(creation);
    document.title = `${creation.title} by ${ownerLabel(creation.ownerId, creation.ownerName)} · Life Lab`;
  } catch (error) {
    elements.communityDetail.innerHTML = `<div class="detail-state"><h1>Pattern unavailable</h1><p>${escapeHtml(getErrorMessage(error))}</p><button class="button" type="button" data-community-action="browse">Back to Community</button></div>`;
  }
}

async function openCreatorRoute(username, { updateHistory = true } = {}) {
  if (!username) return;
  if (updateHistory) navigateTo(`/u/${encodeURIComponent(username)}`, { render: false });
  state.communityView = 'gallery';
  setMode('community');
  try {
    if (!communityAuth.cloudRepo?.getPublicProfile) throw Object.assign(new Error('Creator pages need the hosted Community service.'), { status: 503 });
    const profile = await communityAuth.cloudRepo.getPublicProfile(username);
    state.publicProfile = profile;
    state.publicCreations = [...(profile.creations || []), ...state.publicCreations.filter((item) => !(profile.creations || []).some((creation) => creation.id === item.id))];
    document.title = `${profile.displayName} · Life Lab`;
    renderCommunity();
  } catch (error) {
    state.publicProfile = null;
    elements.communityStatus.hidden = false;
    elements.communityStatus.textContent = getErrorMessage(error);
    renderCommunity();
  }
}

function syncCommunityFilterUi() {
  for (const button of elements.communityFilters.querySelectorAll('[data-community-filter]')) {
    button.setAttribute('aria-selected', String(button.dataset.communityFilter === state.communityFilter));
  }
}

async function handleCommunityAction(event) {
  const button = event.target.closest('[data-community-action]');
  if (!button) return;

  const { communityAction, creationId } = button.dataset;

  if (communityAction === 'browse') {
    document.title = 'Community · Life Lab';
    state.communityView = 'gallery';
    state.publicProfile = null;
    navigateTo('/community');
    return;
  }

  if (communityAction === 'open') {
    openCommunityDetail(creationId);
    return;
  }

  if (communityAction === 'creator') {
    if (button.dataset.username) await openCreatorRoute(button.dataset.username);
    return;
  }

  if (communityAction === 'play') {
    playCommunityDesign(creationId);
    return;
  }

  if (communityAction === 'remix') {
    await remixCommunityDesign(creationId);
    return;
  }

  if (communityAction === 'star') {
    if (String(creationId).startsWith('famous-')) {
      if (requiresCloudSignInForSharedAction()) {
        queueAccountAction('favorite-pattern', { patternId: creationId.slice(7) }, 'Sign in to star library patterns.');
      } else if (isCloudCommunityActive()) {
        const patternId = creationId.slice(7);
        await community.setPatternFavorite(patternId, true);
        state.patternFavorites = [...new Set([...state.patternFavorites, patternId])];
        showToast('Starred', { kind: 'success' });
      }
      return;
    }
    await starCommunityCreation(creationId);
    renderCommunityDetail(findCommunityDesign(creationId));
    return;
  }

  if (communityAction === 'share') {
    await copyCommunityDesign(creationId);
    return;
  }

  if (communityAction === 'report') {
    if (requiresCloudSignInForSharedAction()) { queueAccountAction('report', { creationId }, 'Sign in to report this pattern.'); return; }
    const reason = window.prompt('Describe the issue (5–2000 characters):');
    if (!reason) return;
    try { await community.reportCreation(creationId, reason); showToast('Report received', { kind: 'success' }); }
    catch (error) { showToast(`Could not report: ${getErrorMessage(error)}`, { kind: 'error' }); }
  }
}

function playCommunityDesign(creationId) {
  const source = findCommunityDesign(creationId);
  if (!source) return;

  try {
    swapWorkspace('playground');
    loadCreationOntoBoard(source);
    state.selectedCommunityId = creationId;
    navigateTo('/');
    setPlaying(true);
  } catch (error) {
    showToast(`Could not play: ${getErrorMessage(error)}`, { kind: 'error' });
  }
}

async function starCommunityCreation(creationId, { resumed = false } = {}) {
  if (communityAuth.cloudConfigured && requiresCloudSignInForSharedAction()) {
    if (!resumed) queueAccountAction('favorite-creation', { creationId }, 'Sign in to star this pattern.');
    return;
  }

  const profileId = communityState.profile?.id || 'profile-local';
  let nextCreation;
  try {
    nextCreation = await community.toggleStar(creationId, profileId);
    if (!nextCreation) return;
  } catch (error) {
    showToast(`Could not update star: ${getErrorMessage(error)}`, { kind: 'error' });
    return;
  }

  syncCommunity();
  const starred = nextCreation.starredByViewer
    ?? nextCreation.starredBy?.includes(profileId)
    ?? false;
  showToast(starred ? 'Starred' : 'Star removed', { kind: 'success' });
  return nextCreation;
}

// Library patterns are stored in the board's corner; centre them so the sheet
// and the pattern both look placed. User projects load as authored.
function centredBoardFromRle(rle, width, height) {
  const pattern = parseRle(rle);
  const bounds = getPatternBounds(pattern.coordinates);
  return placePattern(createBoard(width, height), pattern.coordinates,
    Math.floor((width - bounds.width) / 2) - bounds.minX, Math.floor((height - bounds.height) / 2) - bounds.minY);
}

function toCommunityCopyInput(source) {
  const version = source.currentVersion || {};
  return {
    title: createRemixTitle({ sourceTitle: source.title, profile: communityState.profile }),
    description: source.description,
    tags: source.tags,
    rle: isFamous(source) ? boardToRle(centredBoardFromRle(version.rle, version.width, version.height)) : version.rle,
    width: source.currentVersion?.width,
    height: source.currentVersion?.height,
    generation: source.currentVersion?.generation,
    population: source.currentVersion?.population,
    thumbnail: source.thumbnail,
    settings: source.currentVersion?.settings,
  };
}

async function copyCommunityDesign(creationId) {
  const creation = findCommunityDesign(creationId);
  if (!creation) return;

  const link = creation.visibility === 'public' && creation.slug
    ? `${window.location.origin}/c/${encodeURIComponent(creation.slug)}`
    : encodeShareLink(creation, { origin: window.location.origin + window.location.pathname });
  try {
    await navigator.clipboard.writeText(link);
    triggerHaptic('copy');
    showToast('Link copied', { kind: 'success' });
  } catch {
    window.prompt('Copy this link:', link);
  }
}

async function remixCommunityDesign(creationId) {
  const creation = findCommunityDesign(creationId);
  if (!creation) return;

  const openRemix = (remix) => {
    swapWorkspace('studio');
    loadCreationOntoBoard(remix);
    startProject({ title: remix.title, creationId: remix.id, source: creation, boardLoaded: true });
    setProjectFields(remix);
    navigateTo('/studio');
    showToast('Remix ready in Studio', { kind: 'success' });
  };

  if (!communityState.profile) {
    try {
      const remix = await localCommunity.saveCreation({
        ...toCommunityCopyInput(creation),
        title: `${creation.title} Remix`,
        attribution: `Remixed from ${creation.title} by ${creation.ownerName}.`,
        parentCreation: creation,
      });
      community = localCommunity;
      communityState = localCommunity.getState();
      openRemix(remix);
    } catch (error) {
      showToast(`Could not remix: ${getErrorMessage(error)}`, { kind: 'error' });
    }
    return;
  }

  if (isFamous(creation)) {
    try {
      const remix = await community.saveCreation(toCommunityCopyInput(creation));
      syncCommunity();
      openRemix(remix);
    } catch (error) {
      showToast(`Could not remix: ${getErrorMessage(error)}`, { kind: 'error' });
    }
    return;
  }

  if (requiresCloudSignInForSharedAction()) {
    openAccountDialog({ context: 'Sign in to remix shared patterns.' });
    return;
  }
  try {
    const remix = await community.cloneCreation(creationId, communityState.profile);
    if (!remix) return;
    syncCommunity();
    openRemix(remix);
  } catch (error) {
    showToast(`Could not remix: ${getErrorMessage(error)}`, { kind: 'error' });
  }
}

async function postCommunityComment({ body: resumedBody, creationId: resumedCreationId, resumed = false } = {}) {
  const creation = findCommunityDesign(resumedCreationId || state.selectedCommunityId);
  if (!creation) {
    showToast('Open a pattern first', { kind: 'info' });
    return;
  }

  const field = $('#comment-body');
  const body = resumedBody ?? field?.value ?? '';
  if (!String(body).trim()) {
    showToast('Write a comment first', { kind: 'info' });
    return;
  }
  if (communityAuth.cloudConfigured && requiresCloudSignInForSharedAction()) {
    if (!resumed) queueAccountAction('comment', { creationId: creation.id, body }, 'Sign in to post this comment. It will be submitted once.');
    return;
  }
  if (isCloudCommunityActive() && !isFamous(creation)) {
    try {
      const comment = await community.createComment(creation.id, body);
      state.communityComments[creation.id] = [comment, ...getCommunityComments(creation)];
      renderCommunityDetail(creation);
      showToast('Comment added', { kind: 'success' });
      return comment;
    } catch (error) {
      showToast(`Could not comment: ${getErrorMessage(error)}`, { kind: 'error' });
      throw error;
    }
  }
  const commented = addCreationComment({
    ...creation,
    comments: getCommunityComments(creation),
  }, {
    profileId: communityState.profile?.id || 'profile-local',
    authorName: communityState.profile?.displayName || 'Local Builder',
    body,
  });

  state.communityComments[creation.id] = commented.comments;
  renderCommunityDetail({
    ...creation,
    comments: commented.comments,
    commentCount: commented.commentCount,
  });
  showToast('Comment added', { kind: 'success' });
  return commented.comments.at(-1);
}

function syncCommunity() {
  communityState = community.getState();
  renderCommunity();
  if (state.mode === 'studio') renderStudio();
}

function getCurrentCreationPreviewConfig() {
  const coordinates = getLiveCoordinates();
  let config = {};
  if (coordinates.length) {
    try {
      config = createCreationPreviewConfig({
        title: elements.projectTitle.value || 'Untitled project',
        previewConfig: state.previewConfig,
        currentVersion: {
          rle: encodeRle(coordinates),
          settings: getCurrentDesignSettings(),
        },
      });
    } catch {
      // Cells spread wider than a preview can encode; the save still goes through.
      config = {};
    }
  }
  // The circuit spec travels with the project; every repository keeps previewConfig as-is.
  return state.circuitSpec ? { ...config, circuit: getCircuitSpec() } : config;
}

// Opens a #build= link (at boot, or pasted into an open tab) as a new Studio
// project. Unsaved Studio work is only replaced after the visitor agrees.
function importSharedBuildFromHash() {
  const shared = decodeShareLink(window.location.hash);
  if (!shared) return;
  // Drop the hash so a reload does not open the link again.
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  const studio = state.boardOwner === 'studio' ? state : state.workspaces.studio;
  if (studio?.designDirty && !window.confirm('Open the shared pattern? It replaces your unsaved Studio work.')) return;

  try {
    const pattern = parseRle(shared.rle);
    const bounds = getPatternBounds(pattern.coordinates);
    swapWorkspace('studio');
    // A pattern larger than the default board gets a board that holds it
    // (within the grid limits) instead of wrapping onto itself.
    const fits = bounds.width <= DEFAULT_DESIGN_SETTINGS.width && bounds.height <= DEFAULT_DESIGN_SETTINGS.height;
    state.designSettings = fits ? DEFAULT_DESIGN_SETTINGS : createDesignSettings({
      gridPreset: 'custom',
      width: Math.max(DEFAULT_DESIGN_SETTINGS.width, bounds.width + 24),
      height: Math.max(DEFAULT_DESIGN_SETTINGS.height, bounds.height + 24),
    });
    const { width, height } = state.designSettings;
    replaceBoard(placePattern(createBoard(width, height), pattern.coordinates,
      Math.floor((width - bounds.width) / 2) - bounds.minX, Math.floor((height - bounds.height) / 2) - bounds.minY));
    state.authoredStart = ownedSnapshot();
    fitLiveCells({ deferred: true });
    startProject({ title: shared.title || 'Shared pattern', boardLoaded: true });
    setProjectFields({ title: shared.title, description: shared.description, tags: shared.tags });
    markDesignDirty(true);
    navigateTo('/studio', { replace: true });
    // The owner name is unverified text from the link: keep it short.
    const owner = String(shared.ownerName || '').replace(/\s+/g, ' ').trim();
    const sharer = owner.length > 40 ? `${owner.slice(0, 39)}…` : owner;
    showToast(sharer ? `Opened a pattern shared by ${sharer}` : 'Opened a shared pattern', { kind: 'success' });
  } catch {
    showToast('That share link could not be opened', { kind: 'error' });
  }
}

/* ---------------------------------------------------------------------------
 * Rail: patterns and logic cards
 * ------------------------------------------------------------------------- */

function setRailTab(tab) {
  state.railTab = tab;
  for (const button of elements.railKindTabs.querySelectorAll('[data-rail-tab]')) {
    button.setAttribute('aria-selected', String(button.dataset.railTab === tab));
  }
  elements.patternPanel.hidden = tab !== 'patterns';
  elements.logicPanel.hidden = tab !== 'logic';
  if (tab === 'logic') renderLogicList();
}

function renderRail() {
  renderPatternList();
  if (state.mode === 'studio') renderLogicList();
  setRailTab(state.railTab);
}

function getVisiblePresets() {
  const query = state.patternQuery.trim().toLowerCase();
  if (query) {
    return presets.filter((preset) => [preset.name, preset.id, PATTERN_NOTES[preset.id], preset.note]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }
  if (state.activePresetGroup === MASTERWORKS_GROUP.id) return [];
  const group = getPresetGroup(presetGroups, state.activePresetGroup) ?? presetGroups[0];
  return group.ids.map((id) => presets.find((preset) => preset.id === id)).filter(Boolean);
}

// Masterworks match on name and discoverer (and the note) when searching.
function getVisibleMasterworks() {
  const query = state.patternQuery.trim().toLowerCase();
  if (query) {
    return masterworks.filter((work) => [work.name, work.discoverer, work.note]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }
  return state.activePresetGroup === MASTERWORKS_GROUP.id ? [...masterworks] : [];
}

function renderPatternList() {
  const searching = Boolean(state.patternQuery.trim());
  elements.patternTabs.parentElement.hidden = searching;
  elements.patternTabs.innerHTML = '';
  for (const group of [...presetGroups, MASTERWORKS_GROUP]) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.dataset.patternTab = group.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(group.id === state.activePresetGroup));
    tab.textContent = group.title;
    elements.patternTabs.append(tab);
  }
  // One scrolling row of tabs: keep the chosen one in view and fade the
  // edge that has more tabs behind it.
  const selected = elements.patternTabs.querySelector('[aria-selected="true"]');
  if (selected && !searching) {
    const row = elements.patternTabs;
    const left = selected.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft) row.scrollLeft = left - 8;
    else if (left + selected.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + selected.offsetWidth - row.clientWidth + 8;
  }
  updatePatternTabsOverflow();

  elements.patternList.innerHTML = '';
  const visible = getVisiblePresets();
  const works = getVisibleMasterworks();
  if (!searching && state.activePresetGroup === presetGroups[0].id) {
    elements.patternList.append(createPatternCard({
      id: 'random-soup',
      name: 'Random soup',
      note: PATTERN_NOTES['random-soup'],
      coordinates: null,
    }));
  }
  for (const preset of visible) elements.patternList.append(createPatternCard(preset));
  for (const work of works) elements.patternList.append(createMasterworkCard(work));
  if (visible.length === 0 && works.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-empty';
    empty.textContent = 'No patterns match.';
    elements.patternList.append(empty);
  }
  updatePresetSelection();
}

function updatePatternTabsOverflow() {
  const row = elements.patternTabs;
  const edges = [];
  if (row.scrollLeft > 1) edges.push('start');
  if (row.scrollLeft + row.clientWidth < row.scrollWidth - 1) edges.push('end');
  row.dataset.overflow = edges.join(' ') || 'none';
}

// A masterwork card: the same card as a pattern, with the discoverer and year
// as its meta line and the size in place of a thumbnail that would be
// illegible. Reference-only works link to their source instead of loading.
function createMasterworkCard(work) {
  const loadable = Boolean(work.loadable);
  const card = document.createElement(loadable ? 'button' : 'div');
  card.className = `card card-masterwork${loadable ? '' : ' card-reference'}`;
  card.dataset.masterworkId = work.id;
  card.setAttribute('role', 'listitem');
  if (loadable) {
    card.type = 'button';
    card.setAttribute('aria-label', `Load ${work.name}`);
  }
  const thumb = document.createElement('span');
  thumb.className = 'card-thumb';
  // Loadable works show their cells (scaled down); one that is fetched on
  // demand shows a play mark. Reference-only works get a dashed link box.
  const thumbnail = loadable ? masterworkThumbnail(work) : null;
  if (thumbnail) thumb.append(thumbnail);
  else {
    thumb.classList.add(loadable ? 'card-thumb-load' : 'card-thumb-link');
    thumb.innerHTML = `<svg class="icon" aria-hidden="true" style="width:22px;height:22px"><use href="#${loadable ? 'i-play' : 'i-external'}" /></svg>`;
  }
  const size = work.size ? `${work.size.width.toLocaleString()} × ${work.size.height.toLocaleString()}` : '';
  const meta = [work.discoverer, work.year].filter(Boolean).join(' · ');
  const loading = state.masterworkLoading === work.id;
  if (loading) {
    card.disabled = true;
    card.setAttribute('aria-busy', 'true');
  }
  const text = document.createElement('span');
  text.className = 'card-text';
  text.innerHTML = `<span class="card-name">${escapeHtml(work.name)}</span>`
    + `<span class="card-meta">${escapeHtml(meta)}</span>`
    + `<span class="card-note">${escapeHtml(work.note)}</span>`
    + (loadable
      ? `<span class="card-size">${loading ? 'Loading…' : `<span class="mono">${size}</span> <span class="card-load-group">cells · <span class="card-load">Load</span></span>`}</span>`
      : `<span class="card-reason">${escapeHtml(work.reason || (size && `${size} cells.`) || '')}</span>`
        + `<a class="card-link" href="${escapeHtml(work.source?.url || '#')}" target="_blank" rel="noopener">Read about it<svg class="icon" aria-hidden="true"><use href="#i-external" /></svg></a>`);
  card.append(thumb, text);
  return card;
}

function masterworkThumbnail(work) {
  let coordinates = masterworkThumbnailCache.get(work.id);
  if (!coordinates) {
    try {
      coordinates = decodeMasterwork(work.id).coordinates;
    } catch {
      return null;
    }
    masterworkThumbnailCache.set(work.id, coordinates);
  }
  const thumbCanvas = document.createElement('canvas');
  drawPatternThumbnail(thumbCanvas, coordinates);
  return thumbCanvas;
}

// Put a masterwork on the board, centred, with bounded edges so spaceships
// and puffers do not wrap into their own trail: the board grows to its
// recommended size first when it is smaller. One undoable command; the view
// fits the cells. The largest works fetch their cells on demand; the card
// shows "Loading…" meanwhile.
async function loadMasterwork(id) {
  const work = getMasterwork(id);
  if (!work?.loadable || state.masterworkLoading) return;
  state.masterworkLoading = id;
  renderPatternList();
  let coordinates;
  try {
    ({ coordinates } = await loadMasterworkCells(id));
  } catch (error) {
    showToast(`Could not load ${work.name}: ${getErrorMessage(error)}`, { kind: 'error' });
    return;
  } finally {
    state.masterworkLoading = null;
    renderPatternList();
  }
  if (state.playing) setPlaying(false);
  const width = Math.max(state.board.width, work.board?.width || 0);
  const height = Math.max(state.board.height, work.board?.height || 0);
  const grew = width !== state.board.width || height !== state.board.height;
  const bounds = getPatternBounds(coordinates);
  if (bounds.width > width || bounds.height > height) {
    showToast(`${work.name} needs a board of at least ${bounds.width} × ${bounds.height}.`, { kind: 'error' });
    return;
  }
  beginAuthoringCommand({ rememberEdges: true });
  exitCircuit();
  state.designSettings = mergeDesignSettings(state.designSettings, grew
    ? { gridPreset: 'custom', width, height, wrapping: false }
    : { wrapping: false });
  const board = createBoard(width, height);
  board.wrapping = false;
  const originX = Math.floor((width - bounds.width) / 2) - bounds.minX;
  const originY = Math.floor((height - bounds.height) / 2) - bounds.minY;
  for (const [x, y] of coordinates) board.cells[(originY + y) * width + originX + x] = 1;
  state.board = board;
  if (state.tool === 'stamp') exitStamp();
  finishAuthoringCommand();
  fitLiveCells();
  syncDesignControls();
  renderInspector();
  if (grew) showToast(`Board grew to ${width} × ${height} to fit ${work.name}. Undo to go back.`, { kind: 'info' });
}

function createPatternCard(preset) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card';
  button.dataset.patternId = preset.id;
  button.setAttribute('role', 'listitem');
  button.setAttribute('aria-pressed', 'false');
  const thumb = document.createElement('span');
  thumb.className = 'card-thumb';
  if (preset.coordinates) {
    const thumbCanvas = document.createElement('canvas');
    drawPatternThumbnail(thumbCanvas, preset.coordinates);
    thumb.append(thumbCanvas);
    button.draggable = true;
    button.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/life-preset-id', preset.id);
      event.dataTransfer.setData('text/plain', preset.name);
    });
  } else {
    thumb.innerHTML = '<svg class="icon" aria-hidden="true" style="width:22px;height:22px"><use href="#i-dice" /></svg>';
  }
  const text = document.createElement('span');
  text.className = 'card-text';
  text.innerHTML = `<span class="card-name">${escapeHtml(preset.name)}</span><span class="card-note">${escapeHtml(PATTERN_NOTES[preset.id] || preset.note || '')}</span>`;
  button.append(thumb, text);
  return button;
}

function drawPatternThumbnail(thumbCanvas, coordinates) {
  const size = 64;
  const ratio = window.devicePixelRatio || 1;
  thumbCanvas.width = size * ratio;
  thumbCanvas.height = size * ratio;
  const preview = thumbCanvas.getContext('2d');
  preview.setTransform(ratio, 0, 0, ratio, 0, 0);
  const bounds = getPatternBounds(coordinates);
  const rawCell = Math.min(8, 56 / Math.max(1, bounds.width, bounds.height));
  // Large patterns shrink below a pixel per cell so they still fit the box.
  const cell = rawCell >= 2 ? Math.floor(rawCell) : rawCell;
  const width = bounds.width * cell;
  const height = bounds.height * cell;
  const offsetX = Math.floor((size - width) / 2);
  const offsetY = Math.floor((size - height) / 2);
  preview.fillStyle = palette.canvas;
  preview.fillRect(0, 0, size, size);
  if (cell >= 4) {
    preview.strokeStyle = palette.grid;
    preview.lineWidth = 1;
    preview.beginPath();
    for (let x = offsetX % cell; x <= size; x += cell) { preview.moveTo(x + 0.5, 0); preview.lineTo(x + 0.5, size); }
    for (let y = offsetY % cell; y <= size; y += cell) { preview.moveTo(0, y + 0.5); preview.lineTo(size, y + 0.5); }
    preview.stroke();
  }
  preview.fillStyle = palette.cell;
  const gap = cell >= 4 ? 1 : 0;
  for (const [x, y] of coordinates) {
    preview.fillRect(offsetX + (x - bounds.minX) * cell + gap, offsetY + (y - bounds.minY) * cell + gap, Math.max(1, cell - gap), Math.max(1, cell - gap));
  }
}

// The densest 16 x 16 patch of the gate at 3px cells with a 1px gap, so the
// card reads as a Life shape rather than the whole 150-cell tile as dust.
function drawGateThumbnail(thumbCanvas, id) {
  const size = 64;
  const cell = 4;
  const span = size / cell;
  const ratio = window.devicePixelRatio || 1;
  thumbCanvas.width = size * ratio;
  thumbCanvas.height = size * ratio;
  const preview = thumbCanvas.getContext('2d');
  preview.setTransform(ratio, 0, 0, ratio, 0, 0);
  let crop = gateThumbnailCache.get(id);
  if (!crop) {
    const preset = circuitPresets.find((entry) => entry.id === id);
    let board;
    let origin;
    let tile;
    if (preset) {
      // A preset shows its first gate tile.
      const built = buildSpec(preset.spec);
      const first = built.tiles?.[0];
      board = built.board;
      origin = first ? { x: first.x, y: first.y } : { x: 0, y: 0 };
      tile = first ? Math.min(first.width, first.height) : Math.min(board.width, board.height, 150);
    } else {
      ({ board } = buildCircuitExperiment(id, {}));
      ({ origin, tile } = getCircuitMarkers(id));
    }
    const stride = tile + 1;
    const sums = new Uint32Array(stride * stride);
    for (let y = 1; y <= tile; y += 1) {
      for (let x = 1; x <= tile; x += 1) {
        sums[y * stride + x] = board.cells[(origin.y + y - 1) * board.width + origin.x + x - 1]
          + sums[(y - 1) * stride + x] + sums[y * stride + x - 1] - sums[(y - 1) * stride + x - 1];
      }
    }
    let best = -1;
    for (let y = 0; y + span <= tile; y += 1) {
      for (let x = 0; x + span <= tile; x += 1) {
        const count = sums[(y + span) * stride + x + span] - sums[y * stride + x + span] - sums[(y + span) * stride + x] + sums[y * stride + x];
        if (count > best) { best = count; crop = { board, x: origin.x + x, y: origin.y + y }; }
      }
    }
    gateThumbnailCache.set(id, crop);
  }
  preview.fillStyle = palette.canvas;
  preview.fillRect(0, 0, size, size);
  preview.fillStyle = palette.cell;
  for (let y = 0; y < span; y += 1) {
    for (let x = 0; x < span; x += 1) {
      if (crop.board.cells[(crop.y + y) * crop.board.width + crop.x + x]) preview.fillRect(x * cell, y * cell, cell - 1, cell - 1);
    }
  }
}

// Logic rail cards: the single gates and the half-adder, then the ready-made
// circuits (XOR) that open as editable formulas.
function getLogicCards() {
  return [
    ...circuitExperiments.map((experiment) => ({
      id: experiment.id,
      name: GATE_CARDS[experiment.id]?.name || experiment.title,
      note: GATE_CARDS[experiment.id]?.note || experiment.description,
      spec: experiment.id === 'half-adder' ? { gates: ['half-adder'], inputs: {} } : { gates: [experiment.id], inputs: {} },
    })),
    ...getBuildablePresets().map((preset) => ({ id: preset.id, name: preset.title, note: PRESET_NOTES[preset.id] || preset.description, spec: { preset: preset.id, inputs: { ...preset.spec.inputs } } })),
  ];
}

function renderLogicList() {
  elements.logicList.innerHTML = '';
  const current = circuitCardId();
  for (const card of getLogicCards()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    button.dataset.gateId = card.id;
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-pressed', String(current === card.id));
    const thumb = document.createElement('span');
    thumb.className = 'card-thumb';
    const thumbCanvas = document.createElement('canvas');
    try {
      drawGateThumbnail(thumbCanvas, card.id);
      thumb.append(thumbCanvas);
    } catch {
      thumb.innerHTML = '<svg class="icon" aria-hidden="true" style="width:22px;height:22px"><use href="#i-logic" /></svg>';
    }
    const text = document.createElement('span');
    text.className = 'card-text';
    text.innerHTML = `<span class="card-name">${escapeHtml(card.name)}</span><span class="card-note">${escapeHtml(card.note)}</span>`;
    button.append(thumb, text);
    elements.logicList.append(button);
  }
}

function updatePresetSelection() {
  for (const button of elements.patternList.querySelectorAll('[data-pattern-id]')) {
    button.setAttribute('aria-pressed', String(state.tool === 'stamp' && button.dataset.patternId === state.selectedPreset?.id));
  }
  const current = circuitCardId();
  for (const button of elements.logicList.querySelectorAll('[data-gate-id]')) {
    button.setAttribute('aria-pressed', String(button.dataset.gateId === current));
  }
}

/* ---------------------------------------------------------------------------
 * Theme, menus, sheets
 * ------------------------------------------------------------------------- */

function getCurrentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, { persist = true } = {}) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try { browserStorage.setItem(THEME_KEY, theme); } catch { /* storage may be unavailable */ }
  }
  elements.themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  elements.themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  readPalette();
  renderRail();
  render();
}

function toggleTheme() {
  applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
}

const menus = [
  ['#top-menu-toggle', '#top-menu'],
  ['#project-menu-toggle', '#project-menu'],
  ['#more-menu-toggle', '#more-menu'],
  ['#speed-toggle', '#speed-menu'],
  ['#how-life-works', '#rules-popover'],
].map(([toggle, menu]) => ({ toggle: $(toggle), menu: $(menu) }));

function isMenuOpen(menu) {
  return menu.id === 'top-menu' ? menu.dataset.open === 'true' : !menu.hidden;
}

function setMenuOpen(entry, open) {
  if (entry.menu.id === 'top-menu') entry.menu.dataset.open = String(open);
  else entry.menu.hidden = !open;
  entry.toggle.setAttribute('aria-expanded', String(open));
}

function closeMenus() {
  for (const entry of menus) setMenuOpen(entry, false);
  closeChipMenu();
}

function anyMenuOpen() {
  return menus.some((entry) => isMenuOpen(entry.menu)) || Boolean(state.chipMenu);
}

function toggleMenu(entry) {
  const open = !isMenuOpen(entry.menu);
  closeMenus();
  setMenuOpen(entry, open);
  if (open) entry.menu.querySelector('button, [tabindex]')?.focus?.({ preventScroll: true });
}

function openRail(open) {
  if (open) dismissToast();
  elements.rail.dataset.open = String(open);
  elements.sheetBackdrop.hidden = !open;
  elements.patternsOpen.setAttribute('aria-expanded', String(open));
  if (open) {
    elements.inspector.dataset.open = 'false';
    elements.inspectorToggle.setAttribute('aria-expanded', 'false');
  }
}

function openInspector(open) {
  if (open) dismissToast();
  elements.inspector.dataset.open = String(open);
  elements.inspectorToggle.setAttribute('aria-expanded', String(open));
  elements.sheetBackdrop.hidden = !open;
  if (open) elements.rail.dataset.open = 'false';
}

function closeSheets() {
  elements.rail.dataset.open = 'false';
  elements.inspector.dataset.open = 'false';
  elements.sheetBackdrop.hidden = true;
  elements.patternsOpen.setAttribute('aria-expanded', 'false');
  elements.inspectorToggle.setAttribute('aria-expanded', 'false');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A number for markup: anything that is not a finite number becomes 0.
function wholeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

/* ---------------------------------------------------------------------------
 * Events
 * ------------------------------------------------------------------------- */

function toLocal(event) {
  const rect = state.pointer.rect || canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function bindEvents() {
  new ResizeObserver(() => resizeCanvas()).observe(elements.canvasHost);
  // Theme can change from the toggle, another tab, or a script; re-read tokens either way.
  new MutationObserver(() => {
    readPalette();
    renderRail();
    render();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(getCurrentTheme(), { persist: false }));
  window.addEventListener('resize', () => { state.pointer.rect = null; });
  MOBILE_QUERY.addEventListener('change', () => { closeSheets(); closeMenus(); });

  canvas.addEventListener('pointerdown', (event) => {
    state.pointer.rect = canvas.getBoundingClientRect();
    const local = toLocal(event);
    state.pointer.pointers.set(event.pointerId, local);
    canvas.setPointerCapture(event.pointerId);
    closeMenus();

    if (state.pointer.pointers.size === 2) {
      // Second finger: switch to pinch zoom and undo any single-finger paint.
      if ((state.pointer.mode === 'draw' || state.pointer.mode === 'erase') && state.pointer.before) {
        state.board = ownedSnapshot(state.pointer.before);
        state.authoredStart = ownedSnapshot();
        updateStats();
      }
      const [first, second] = [...state.pointer.pointers.values()];
      state.pointer.pinch = {
        startDistance: Math.hypot(second.x - first.x, second.y - first.y),
        startZoom: state.zoom,
        lastMid: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      };
      state.pointer.active = false;
      state.pointer.mode = 'pinch';
      return;
    }
    if (state.pointer.pointers.size > 2) return;

    state.pointer.active = true;
    const wantsPan = state.tool === 'pan' || event.button === 1 || event.shiftKey;
    state.pointer.mode = wantsPan
      ? 'pan'
      : state.tool === 'draw'
        ? getLiveToolAction({ playing: state.playing, alive: getCellAliveAt(local.x, local.y) })
        : state.tool;
    state.pointer.lastCell = null;
    state.pointer.lastX = local.x;
    state.pointer.lastY = local.y;
    state.pointer.before = ownedSnapshot();

    if (state.pointer.mode === 'pan') {
      elements.body.dataset.panning = 'true';
      return;
    }

    if (state.pointer.mode === 'draw' || state.pointer.mode === 'erase') beginAuthoringCommand();

    if (state.pointer.mode === 'select') {
      if (state.playing) setPlaying(false);
      state.pointer.selectionStart = screenToCell(local.x, local.y);
      updateSelection(local.x, local.y);
      renderToolStrip();
      return;
    }

    if (state.pointer.mode === 'stamp' && !state.selectedPreset) return;

    applyToolAt(local.x, local.y);
  });

  canvas.addEventListener('pointermove', (event) => {
    const local = toLocal(event);
    if (state.pointer.pointers.has(event.pointerId)) state.pointer.pointers.set(event.pointerId, local);
    if (event.pointerType !== 'touch') state.hoverCell = screenToCell(local.x, local.y);

    if (state.pointer.mode === 'pinch' && state.pointer.pinch && state.pointer.pointers.size >= 2) {
      const [first, second] = [...state.pointer.pointers.values()];
      const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      state.panX += mid.x - state.pointer.pinch.lastMid.x;
      state.panY += mid.y - state.pointer.pinch.lastMid.y;
      state.pointer.pinch.lastMid = mid;
      setZoom(getPinchZoom({ startDistance: state.pointer.pinch.startDistance, distance, startZoom: state.pointer.pinch.startZoom, minZoom: getMinZoom(), maxZoom: MAX_ZOOM }), mid.x, mid.y);
      return;
    }

    if (!state.pointer.active) return;
    if (state.pointer.mode === 'pan') {
      state.panX += local.x - state.pointer.lastX;
      state.panY += local.y - state.pointer.lastY;
      state.pointer.lastX = local.x;
      state.pointer.lastY = local.y;
      return;
    }
    if (state.pointer.mode === 'select') { updateSelection(local.x, local.y); return; }
    if (state.pointer.mode === 'stamp') return;

    applyToolAt(local.x, local.y);
  });

  const endPointer = (event) => {
    state.pointer.pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (state.pointer.mode === 'pinch') {
      if (state.pointer.pointers.size === 0) {
        state.pointer.mode = 'draw';
        state.pointer.pinch = null;
      }
      return;
    }
    if (!state.pointer.active) return;
    state.pointer.active = false;
    if (state.pointer.mode === 'draw' || state.pointer.mode === 'erase') finishAuthoringCommand();
    if (state.pointer.mode === 'select' && state.pointer.selectionStart) {
      const local = toLocal(event);
      updateSelection(local.x, local.y);
      state.pointer.selectionStart = null;
      renderToolStrip();
    }
    state.pointer.lastCell = null;
    state.pointer.before = null;
    delete elements.body.dataset.panning;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('pointerleave', () => {
    state.hoverCell = null;
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const action = getWheelAction(event);
    if (action.type === 'zoom') {
      const local = toLocal(event);
      setZoom(state.zoom * action.zoomDelta, local.x, local.y);
      return;
    }
    state.panX += action.panX;
    state.panY += action.panY;
  }, { passive: false });

  canvas.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  canvas.addEventListener('drop', (event) => {
    event.preventDefault();
    const presetId = event.dataTransfer.getData('text/life-preset-id');
    const preset = presets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    state.pointer.rect = canvas.getBoundingClientRect();
    const local = toLocal(event);
    const cell = screenToCell(local.x, local.y);
    const previous = { preset: state.selectedPreset, rotation: state.stampRotation, flip: state.stampFlipX };
    state.selectedPreset = preset;
    state.stampRotation = 0;
    state.stampFlipX = false;
    stampPattern(cell.x, cell.y);
    if (state.tool !== 'stamp') {
      state.selectedPreset = previous.preset;
      state.stampRotation = previous.rotation;
      state.stampFlipX = previous.flip;
    }
    updatePresetSelection();
  });

  // Transport
  elements.playToggle.addEventListener('click', () => setPlaying(!state.playing));
  elements.step.addEventListener('click', () => { if (state.playing) setPlaying(false); stepSimulation(); });
  elements.reset.addEventListener('click', resetToStart);
  elements.speedMenu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-speed]');
    if (!item) return;
    setSpeed(Number(item.dataset.speed));
    closeMenus();
  });
  elements.zoomOut.addEventListener('click', () => setZoom(state.zoom / 1.25));
  elements.zoomIn.addEventListener('click', () => setZoom(state.zoom * 1.25));
  elements.fit.addEventListener('click', () => { if (state.circuit) fitCircuit(); else fitBoard(); });
  elements.fitMobile.addEventListener('click', () => { closeMenus(); if (state.circuit) fitCircuit(); else fitBoard(); });
  elements.patternsOpen.addEventListener('click', () => openRail(elements.rail.dataset.open !== 'true'));
  elements.railClose.addEventListener('click', () => closeSheets());
  elements.sheetBackdrop.addEventListener('click', () => closeSheets());

  // Tool strip
  for (const button of elements.toolButtons) {
    button.addEventListener('click', () => chooseTool(button.dataset.tool));
  }
  elements.selectionGroup.addEventListener('click', (event) => {
    const button = event.target.closest('[data-selection-command]');
    if (button) selectionCommand(button.dataset.selectionCommand);
  });
  elements.stampRotateLeft.addEventListener('click', () => rotateStamp(-90));
  elements.stampRotateRight.addEventListener('click', () => rotateStamp(90));
  elements.stampFlip.addEventListener('click', flipStamp);
  elements.stampDone.addEventListener('click', exitStamp);
  elements.undo.addEventListener('click', undoBoard);
  elements.redo.addEventListener('click', redoBoard);
  elements.clearBoard.addEventListener('click', () => { closeMenus(); clearWorld(); });
  elements.openInStudio.addEventListener('click', () => { closeMenus(); openSketchInStudio(); });
  elements.importRle.addEventListener('click', () => { closeMenus(); openRleDialog('import'); });
  elements.exportRle.addEventListener('click', () => { closeMenus(); openRleDialog('export'); });
  elements.shortcuts.addEventListener('click', () => { closeMenus(); elements.shortcutsDialog.showModal(); });
  elements.howLifeWorksMobile.addEventListener('click', (event) => {
    event.stopPropagation();
    closeMenus();
    setMenuOpen(menus.find((entry) => entry.menu.id === 'rules-popover'), true);
  });
  elements.rleStamp.addEventListener('click', importRleFromDialog);
  elements.rleCopy.addEventListener('click', copyRleFromDialog);

  // Menus
  for (const entry of menus) {
    entry.toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu(entry);
    });
  }
  document.addEventListener('click', (event) => {
    if (menus.some((entry) => entry.menu.contains(event.target) && entry.menu.id === 'rules-popover')) return;
    if (!event.target.closest('.menu, .popover, .top-actions')) closeMenus();
    else if (event.target.closest('.menu > button')) closeMenus();
  });

  // Theme and account
  elements.themeToggle.addEventListener('click', () => { toggleTheme(); closeMenus(); });
  elements.accountEntry.addEventListener('click', () => { closeMenus(); openAccountDialog(); });
  elements.accountTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-account-mode]');
    if (!button) return;
    state.accountMode = button.dataset.accountMode;
    renderAccountDialog();
  });
  elements.accountSubmit.addEventListener('click', submitAccountDialog);
  elements.accountCreateRecovery.addEventListener('click', generateRecoveryKey);
  elements.accountSignOut.addEventListener('click', async () => { await signOutCommunity(); elements.accountDialog.close(); showToast('Signed out', { kind: 'success' }); });
  elements.accountDelete.addEventListener('click', deleteCurrentAccount);
  elements.accountDialog.addEventListener('keydown', trapAccountDialogFocus);
  elements.accountDialog.addEventListener('close', () => {
    const pending = pendingActions.get();
    if (pending?.attempted) pendingActions.retry(pending.token);
    if (state.accountDialogTrigger?.isConnected) state.accountDialogTrigger.focus({ preventScroll: true });
    state.accountDialogTrigger = null;
  });

  // Navigation
  elements.modePlayground.addEventListener('click', () => navigateTo('/'));
  elements.modeStudio.addEventListener('click', () => { state.studioView = state.session ? 'project' : state.studioView; navigateTo('/studio'); });
  elements.modeCommunity.addEventListener('click', () => { state.communityView = 'gallery'; state.publicProfile = null; navigateTo('/community'); });
  $('#brand').addEventListener('click', (event) => { event.preventDefault(); navigateTo('/'); });
  window.addEventListener('popstate', routeCurrentLocation);
  window.addEventListener('hashchange', importSharedBuildFromHash);

  // Rail
  elements.patternSearch.addEventListener('input', () => {
    state.patternQuery = elements.patternSearch.value;
    renderPatternList();
  });
  elements.patternTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-pattern-tab]');
    if (!tab) return;
    state.activePresetGroup = tab.dataset.patternTab;
    renderPatternList();
  });
  elements.patternTabs.addEventListener('scroll', updatePatternTabsOverflow, { passive: true });
  window.addEventListener('resize', updatePatternTabsOverflow);
  elements.patternList.addEventListener('click', (event) => {
    if (event.target.closest('a')) return;
    const work = event.target.closest('button[data-masterwork-id]');
    if (work) {
      loadMasterwork(work.dataset.masterworkId).then(closeSheets);
      return;
    }
    const card = event.target.closest('[data-pattern-id]');
    if (!card) return;
    if (card.dataset.patternId === 'random-soup') {
      randomSoup();
      closeSheets();
      return;
    }
    const preset = presets.find((candidate) => candidate.id === card.dataset.patternId);
    if (!preset) return;
    selectPreset(preset);
    closeSheets();
  });
  elements.railKindTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-rail-tab]');
    if (tab) setRailTab(tab.dataset.railTab);
  });
  elements.logicList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-gate-id]');
    if (!button) return;
    const card = getLogicCards().find((entry) => entry.id === button.dataset.gateId);
    if (!card) return;
    // Reopening the card that is already open keeps its switches.
    const spec = circuitCardId() === card.id ? state.circuitSpec : card.spec;
    dismissToast();
    openCircuit(spec);
    elements.inspector.scrollTop = 0;
    closeSheets();
  });

  // Studio
  elements.projectsBack.addEventListener('click', showProjectsList);
  elements.newProject.addEventListener('click', () => startProject({ title: 'Untitled project' }));
  elements.projectsList.addEventListener('click', (event) => {
    const card = event.target.closest('[data-project-id]');
    if (card) openProject(card.dataset.projectId);
  });
  elements.projectTitle.addEventListener('input', () => {
    if (state.session) state.session.title = elements.projectTitle.value.trim() || 'Untitled project';
    markDesignDirty(true);
  });
  elements.projectTitle.addEventListener('change', () => setProjectFields({ title: elements.projectTitle.value, description: elements.projectDescription.value, tags: elements.projectTags.value }));
  elements.projectTitle.addEventListener('keydown', (event) => { if (event.key === 'Enter') elements.projectTitle.blur(); });
  elements.projectDescription.addEventListener('input', () => markDesignDirty(true));
  elements.projectTags.addEventListener('input', () => markDesignDirty(true));
  elements.saveProject.addEventListener('click', () => saveCurrentCreation());
  elements.publishProject.addEventListener('click', () => saveCurrentCreation({ publish: true }));
  elements.publishProjectMobile.addEventListener('click', () => saveCurrentCreation({ publish: true }));
  elements.unpublishProject.addEventListener('click', () => { closeMenus(); unpublishActiveCreation(); });
  elements.archiveProject.addEventListener('click', () => { closeMenus(); archiveActiveCreation(); });
  elements.deleteProject.addEventListener('click', () => { closeMenus(); deleteActiveCreation(); });
  elements.inspectorToggle.addEventListener('click', () => openInspector(elements.inspector.dataset.open !== 'true'));
  elements.inspectorClose.addEventListener('click', () => closeSheets());
  elements.gridSize.addEventListener('change', () => applyGridSizeChoice(elements.gridSize.value));
  elements.gridApply.addEventListener('click', applyCustomGridSize);
  elements.gridCustom.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyCustomGridSize();
    if (event.key === 'Escape') {
      elements.gridCustom.hidden = true;
      syncDesignControls();
    }
  });
  elements.edges.addEventListener('change', () => applyEdgesChoice(elements.edges.value));
  elements.inputsList.addEventListener('change', (event) => {
    const input = event.target.closest('[data-input]');
    if (input) setCircuitInput(input.dataset.input, input.checked);
  });
  elements.formulaList.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]');
    if (!chip || chip.disabled) return;
    event.stopPropagation();
    if (state.chipMenu?.chip === chip) closeChipMenu();
    else openChipMenu(chip);
  });
  elements.chipMenu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-chip-action]');
    if (!item || item.disabled) return;
    event.stopPropagation();
    applyChipAction(item.dataset.chipAction, item.dataset.value);
  });
  elements.inspector.addEventListener('scroll', positionChipMenu);
  window.addEventListener('resize', positionChipMenu);
  // On a phone, Run closes the sheet so the board is visible during the run;
  // the circuit bar keeps the lamps on screen.
  elements.runCircuit.addEventListener('click', () => {
    if (MOBILE_QUERY.matches) closeSheets();
    runCircuitExperiment();
  });
  elements.runCircuitBar.addEventListener('click', runCircuitExperiment);
  elements.fillTruthTable.addEventListener('click', fillTruthTable);
  elements.versionHistory.addEventListener('click', (event) => {
    const button = event.target.closest('[data-restore-version-id]');
    if (button) restoreActiveVersion(button.dataset.restoreVersionId);
  });

  // Community
  elements.communityPanel.addEventListener('click', (event) => {
    if (event.target.closest('#post-comment')) { postCommunityComment(); return; }
    handleCommunityAction(event);
  });
  elements.communitySearch.addEventListener('input', () => {
    state.communitySearch = elements.communitySearch.value;
    renderCommunity();
  });
  elements.communityFilters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-community-filter]');
    if (!button) return;
    state.communityFilter = button.dataset.communityFilter;
    state.communityView = 'gallery';
    renderCommunity();
  });

  // Keyboard
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    if (document.querySelector('dialog[open]')) return;
    const key = event.key.toLowerCase();
    const meta = event.metaKey || event.ctrlKey;

    if (event.key === 'Escape') {
      if (anyMenuOpen()) { closeMenus(); return; }
      if (elements.rail.dataset.open === 'true' || elements.inspector.dataset.open === 'true') { closeSheets(); return; }
      if (state.tool === 'stamp') { exitStamp(); return; }
      if (state.selection) selectionCommand('deselect');
      return;
    }
    if (state.mode === 'community' || (state.mode === 'studio' && state.studioView === 'projects')) return;

    if (event.key === ' ') { event.preventDefault(); setPlaying(!state.playing); return; }
    if (meta && key === 'z') { event.preventDefault(); if (event.shiftKey) redoBoard(); else undoBoard(); return; }
    if (meta && (key === 'c' || key === 'v')) { event.preventDefault(); selectionCommand(key === 'c' ? 'copy' : 'paste'); return; }
    if (meta) return;
    if (key === 'n') { if (state.playing) setPlaying(false); stepSimulation(); return; }
    if (key === 'r') { resetToStart(); return; }
    if (key === 'f') { if (state.circuit) fitCircuit(); else fitBoard(); return; }
    const tool = getToolForKey(event.key);
    if (tool) { chooseTool(tool); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection) { event.preventDefault(); selectionCommand('delete'); return; }
    const directions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (state.selection && directions[event.key]) {
      event.preventDefault();
      selectionCommand(directions[event.key]);
    }
  });

  window.addEventListener('offline', () => {
    if (state.designDirty) setSaveStatus('offline');
  });
  window.addEventListener('online', () => {
    if (state.designDirty) setSaveStatus('dirty');
  });
  window.addEventListener('beforeunload', (event) => {
    if (!state.designDirty || !state.recoveryFailed) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

/* ---------------------------------------------------------------------------
 * Loop and boot
 * ------------------------------------------------------------------------- */

function loop(timestamp) {
  if (!state.lastTick) state.lastTick = timestamp;
  const delta = timestamp - state.lastTick;
  state.lastTick = timestamp;

  if (state.playing) {
    state.accumulator += delta;
    const interval = 1000 / state.speed;

    let processed = 0;
    while (state.accumulator >= interval && processed < MAX_MAIN_THREAD_CATCH_UP_STEPS) {
      stepSimulation();
      state.accumulator -= interval;
      processed += 1;
    }
    // A delayed frame must not run an unlimited backlog on the UI thread.
    if (state.accumulator >= interval) state.accumulator = interval - 1;
  }

  render();
  requestAnimationFrame(loop);
}

async function boot() {
  // Blocked or broken storage must never stop the Playground from starting.
  communityState = await localCommunity.loadCommunityState().catch(() => localCommunity.getState());
  state.simulation = createSimulationClient();
  applyTheme(getCurrentTheme(), { persist: false });
  setSpeed(state.speed);
  setZoom(1);
  bindEvents();

  const glider = findPreset('glider');
  const gliderBounds = getPatternBounds(glider.coordinates);
  state.board = placePattern(state.board, glider.coordinates,
    Math.floor(state.board.width / 2 - gliderBounds.width / 2),
    Math.floor(state.board.height / 2 - gliderBounds.height / 2));
  state.authoredStart = ownedSnapshot();
  loadSimulation();
  updateStats();
  updatePlayButton();
  renderToolStrip();
  syncDesignControls();
  resizeCanvas();
  markDesignDirty(false);

  await restoreLocalRecovery();
  importSharedBuildFromHash();
  await routeCurrentLocation();
  initializeCommunityBackend().then(() => {
    const path = window.location.pathname;
    if (/^\/(c|u)\//.test(path) || state.mode === 'community') routeCurrentLocation();
  });
  requestAnimationFrame(loop);
}

// Hook for browser tests: live cell coordinates, a few state facts, and two
// probes (renderTime, resizeBoard) for the large-board checks.
window.__lifeLab = {
  liveCells: () => getLiveCoordinates(),
  circuitGeometry: () => (state.circuit ? { tiles: getCircuitGeometry(state.circuit).tiles, ports: getCircuitGeometry(state.circuit).ports, outputs: state.circuit.outputs } : null),
  snapshot: () => ({
    generation: state.board.generation,
    population: getPopulation(state.board),
    width: state.board.width,
    height: state.board.height,
    tool: state.tool,
    mode: state.mode,
    zoom: state.zoom,
    minZoom: getMinZoom(),
    wrapping: state.designSettings.wrapping,
    panX: state.panX,
    panY: state.panY,
    playing: state.playing,
    circuit: state.circuit?.id || null,
    gates: circuitGates(),
    spec: state.circuitSpec ? describeSpec(contractSpec(state.circuitSpec)) : null,
    inputs: state.circuitSpec ? { ...state.circuitSpec.inputs } : null,
    selection: state.selection,
  }),
  // Average milliseconds for a forced full render of the current view.
  renderTime: (frames = 5) => {
    const started = performance.now();
    for (let frame = 0; frame < frames; frame += 1) {
      if (frame) bitmap.key = '';
      render();
    }
    return (performance.now() - started) / frames;
  },
  // Milliseconds for a render that may reuse the cached bitmap (a pan frame).
  panFrameTime: () => {
    state.panX += 1;
    const started = performance.now();
    render();
    return performance.now() - started;
  },
  resizeBoard: (width, height) => {
    applyBoardSize({ ...mergeDesignSettings(state.designSettings, { gridPreset: 'custom', width, height }), width, height });
    return { width: state.board.width, height: state.board.height };
  },
};

boot();

function findPreset(id) {
  const preset = presets.find((candidate) => candidate.id === id);

  if (!preset) {
    throw new Error(`Missing required preset: ${id}`);
  }

  return preset;
}
