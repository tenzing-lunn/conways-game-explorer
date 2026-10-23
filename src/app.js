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
import { buildCircuitChain, buildCircuitExperiment, circuitExperiments, readCircuitOutputs, validateCircuitChain } from './circuits.js';
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
import { readRecovery, writeRecovery, deleteRecovery } from './local-database.js';

const WORLD_WIDTH = 300;
const WORLD_HEIGHT = 200;
const LOCAL_RECOVERY_KEY = 'life-logic-dev-recovery-v1';
const THEME_KEY = 'life-theme';
const BASE_CELL_SIZE = 10;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 3.6;
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
  toolButtons: $$('[data-tool]'),
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
  howLifeWorks: $('#how-life-works'),
  rulesPopover: $('#rules-popover'),
  inspector: $('#inspector'),
  inspectorClose: $('#inspector-close'),
  gridSize: $('#grid-size'),
  edges: $('#edges'),
  circuitSection: $('#circuit-section'),
  circuitName: $('#circuit-name'),
  chainRow: $('#chain-row'),
  chainList: $('#chain-list'),
  chainNote: $('#chain-note'),
  addGate: $('#add-gate'),
  addGateMenu: $('#add-gate-menu'),
  inputsList: $('#inputs-list'),
  outputsList: $('#outputs-list'),
  runCircuit: $('#run-circuit'),
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

const state = {
  board: createBoard(DEFAULT_DESIGN_SETTINGS.width, DEFAULT_DESIGN_SETTINGS.height),
  authoredStart: null,
  history: createBoardHistory(),
  clipboard: null,
  selection: null,
  circuit: null,
  circuitInputs: {},
  circuitOutputs: null,
  circuitRunning: false,
  truthRows: null,
  simulation: null,
  simulationLoad: null,
  selectedPreset: null,
  stampRotation: 0,
  stampFlipX: false,
  playing: false,
  speed: 10,
  zoom: 1,
  mode: 'playground',
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
  const displayName = localProfile?.displayName
    || user?.name
    || getDisplayNameFromEmail(email)
    || 'Life Builder';

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
  if (signedIn) elements.accountContext.textContent = `Signed in as ${communityAuth.user?.email || communityAuth.session?.user?.email || 'Life Builder'}.`;
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
  renderAccountDialog();
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
  return snapshot;
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

function beginAuthoringCommand() {
  if (state.playing) {
    state.playing = false;
    updatePlayButton();
  }
  state.simulation?.cancel();
  loadSimulation();
  state.history.record(ownedSnapshot());
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
    const origin = rect || screenToCell(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const x = Math.max(0, Math.min(state.board.width - state.clipboard.width, origin.x));
    const y = Math.max(0, Math.min(state.board.height - state.clipboard.height, origin.y));
    result = pasteSelection(state.board, state.clipboard, x, y);
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
  replaceBoard(previous);
  state.authoredStart = ownedSnapshot(previous);
  markDesignDirty(true);
  updateHistoryControls();
}

function redoBoard() {
  if (state.playing) return;
  const next = state.history.redo(ownedSnapshot());
  if (!next) return;
  replaceBoard(next);
  state.authoredStart = ownedSnapshot(next);
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
  setSaveStatus(dirty ? (navigator.onLine === false ? 'offline' : 'dirty') : 'saved');
  if (dirty) scheduleLocalRecovery();
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
  window.clearTimeout(recoveryTimer);
  recoveryTimer = window.setTimeout(async () => {
    try {
      const authored = ownedSnapshot(state.authoredStart || state.board);
      if (!state.session && authored.population === 0) return;
      const recovery = {
        format: 'life-board-binary-v1',
        creationId: state.session?.creationId || null,
        title: state.session?.title || elements.projectTitle.value || 'Untitled project',
        description: elements.projectDescription.value || '',
        tags: elements.projectTags.value || '',
        cells: new Uint8Array(authored.cells),
        width: authored.width,
        height: authored.height,
        generation: 0,
        population: authored.population,
        settings: getCurrentDesignSettings(),
        circuit: getCircuitSpec(),
        savedAt: new Date().toISOString(),
      };
      await writeRecovery(LOCAL_RECOVERY_KEY, recovery);
      localStorage.removeItem(LOCAL_RECOVERY_KEY);
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
    localStorage.removeItem(LOCAL_RECOVERY_KEY);
    deleteRecovery(LOCAL_RECOVERY_KEY).catch(() => {});
    state.recoveryFailed = false;
  } catch {
    // A completed repository save is still authoritative if local recovery cleanup fails.
  }
}

async function restoreLocalRecovery() {
  try {
    const raw = localStorage.getItem(LOCAL_RECOVERY_KEY);
    const recovery = await readRecovery(LOCAL_RECOVERY_KEY) || (raw && JSON.parse(raw));
    if (!recovery) return false;
    if (!recovery.creationId && !(Number(recovery.population) > 0)) return false;
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
    showToast('Recovered unsaved work', { kind: 'info' });
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

function getCurrentDesignSettings() {
  return serializeDesignSettings({
    ...state.designSettings,
    width: state.board.width,
    height: state.board.height,
    speed: state.speed,
    zoom: state.zoom,
    camera: {
      x: Math.round(state.panX),
      y: Math.round(state.panY),
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

function applyGridSizeChoice(gridPreset) {
  const next = mergeDesignSettings(state.designSettings, { gridPreset });
  if (next.width === state.board.width && next.height === state.board.height) return;
  beginAuthoringCommand();
  state.designSettings = next;
  state.board = resizeBoardKeepingCells(next.width, next.height);
  exitCircuit();
  finishAuthoringCommand();
  fitBoard();
  syncDesignControls();
  showToast(`Grid is now ${next.width} × ${next.height}`, { kind: 'success' });
}

function applyEdgesChoice(value) {
  const wrapping = value === 'wrapped';
  if (wrapping === state.designSettings.wrapping) return;
  state.designSettings = mergeDesignSettings(state.designSettings, { wrapping });
  loadSimulation();
  markDesignDirty(true);
  syncDesignControls();
}

function syncDesignControls() {
  const settings = state.designSettings;
  const custom = elements.gridSize.querySelector('option[value="custom"]');
  const isPresetSize = ['small', 'medium', 'large'].includes(settings.gridPreset)
    && createDesignSettings({ gridPreset: settings.gridPreset }).width === state.board.width;
  custom.hidden = isPresetSize;
  custom.textContent = `${state.board.width} × ${state.board.height}`;
  elements.gridSize.value = isPresetSize ? settings.gridPreset : 'custom';
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
    setPublishStatus('validating');
    const readiness = getCreationPublishReadiness({
      ...input,
      currentVersion: { rle: input.rle },
    });
    if (!readiness.ready) {
      const message = readiness.issues[0]?.message || 'Add publish details first.';
      setPublishStatus('failed');
      showToast(message, { kind: 'error' });
      if (MOBILE_QUERY.matches) openInspector(true);
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
  showToast(publish ? (isCloudCommunityActive() ? 'Published to Community' : 'Published on this device') : 'Saved', { kind: 'success' });
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
  const nextBoard = boardFromRle(version.rle, {
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
  fitLiveCells();
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
    elements.unpublishProject.disabled = creation?.visibility !== 'public';
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
      <span>${Number(creation.currentVersion?.population || 0).toLocaleString()} cells · ${creation.currentVersion?.width || 0} × ${creation.currentVersion?.height || 0}</span>
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
      <span><strong>Version ${version.versionNumber || 1}</strong><small>${current ? 'Current' : `${Number(version.population || 0).toLocaleString()} cells`}</small></span>
      ${current ? '' : `<button class="button button-small" type="button" data-restore-version-id="${escapeHtml(version.id)}">Restore</button>`}
    `;
    elements.versionHistory.append(row);
  }
}

/* ---------------------------------------------------------------------------
 * Circuits (Studio → Logic)
 * ------------------------------------------------------------------------- */

// A circuit is a list of gate ids: AND/OR/NOT chain left to right (one gate is
// cell-for-cell the single-gate experiment); the half-adder stays standalone.
function circuitGates(experiment = state.circuit) {
  return experiment ? experiment.gates || [experiment.id] : [];
}

function buildCircuit(gates, inputs) {
  return gates[0] === 'half-adder' ? buildCircuitExperiment('half-adder', inputs) : buildCircuitChain({ gates, inputs });
}

function getCircuitSpec() {
  return state.circuit ? { gates: circuitGates(), inputs: { ...state.circuit.inputs } } : null;
}

// Tiles and input ports to draw and label. Only the half-adder lacks them;
// both of its inputs enter from the west.
function getCircuitGeometry(experiment) {
  if (experiment.tiles) return { tiles: experiment.tiles, ports: experiment.ports.filter((port) => port.type === 'input') };
  const { origin, tile, lanes } = getCircuitMarkers(experiment.id);
  return {
    tiles: [{ gateId: experiment.id, x: origin.x, y: origin.y, width: tile, height: tile }],
    ports: lanes.map((lane) => ({ tileIndex: 0, name: lane.id, side: 'west', x: origin.x, y: lane.y })),
  };
}

function exitCircuit() {
  if (!state.circuit) return;
  state.circuit = null;
  state.circuitOutputs = null;
  state.truthRows = null;
  updatePresetSelection();
}

function openCircuit(gates, { fit = true, inputs = null } = {}) {
  const key = gates.join('>');
  state.circuitInputs[key] = inputs || state.circuitInputs[key] || {};
  const experiment = buildCircuit(gates, state.circuitInputs[key]);
  state.circuit = experiment;
  state.circuitOutputs = null;
  if (state.truthRows?.id !== experiment.id) state.truthRows = null;
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

function fitCircuit({ deferred = false } = {}) {
  if (!state.circuit) return;
  const { tiles } = getCircuitGeometry(state.circuit);
  const first = tiles[0];
  const last = tiles[tiles.length - 1];
  // Room for the "A →" lane on the west, the probe label on the east and the
  // south lanes below (the half-adder has none).
  const region = {
    x: first.x - 44,
    y: first.y - 16,
    width: last.x + last.width - first.x + 44 + 56,
    height: first.height + 16 + (state.circuit.tiles ? 56 : 16),
  };
  const options = { padding: 16, maxZoom: 1 };
  // A restored project is still mid-layout; the next canvas resize applies the fit.
  if (deferred) state.pendingFit = { region, options };
  else fitRegion(region, options);
}

function setCircuitInput(name, value) {
  if (!state.circuit) return;
  const gates = circuitGates();
  state.circuitInputs[gates.join('>')][name] = Boolean(value);
  openCircuit(gates, { fit: false });
}

function changeChain(gates) {
  if (!state.circuit || state.circuitRunning || !validateCircuitChain(gates).ok) return;
  openCircuit(gates, { inputs: { ...state.circuit.inputs } });
}

// Rebuild a saved or recovered circuit from its { gates, inputs } spec.
function restoreCircuit(spec) {
  if (!Array.isArray(spec?.gates) || !spec.gates.length) return;
  if (spec.gates[0] !== 'half-adder' && !validateCircuitChain(spec.gates).ok) return;
  openCircuit(spec.gates, { fit: false, inputs: { ...(spec.inputs || {}) } });
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
    const summary = state.circuitOutputs.map((output) => `${output.label}: ${output.high ? 'HIGH' : 'LOW'}`).join(' · ');
    showToast(summary, { kind: 'success' });
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(`Run stopped: ${getErrorMessage(error)}`, { kind: 'error' });
    state.circuitOutputs = null;
  } finally {
    state.circuitRunning = false;
    renderInspector();
  }
}

async function fillTruthTable() {
  if (!state.circuit || state.circuitRunning) return;
  const experiment = state.circuit;
  const gates = circuitGates(experiment);
  const rows = getInputCombinations(experiment.inputs ? Object.keys(experiment.inputs) : []);
  state.circuitRunning = true;
  state.truthRows = { id: experiment.id, rows: rows.map((inputs) => ({ inputs, outputs: null })), current: 0, generation: 0 };
  state.playing = false;
  updatePlayButton();
  renderInspector();
  try {
    for (const row of state.truthRows.rows) {
      state.truthRows.current += 1;
      state.truthRows.generation = 0;
      renderRunProgress();
      const built = buildCircuit(gates, row.inputs);
      await state.simulation.load(ownedSnapshot(built.board), { wrapping: false });
      const board = await state.simulation.advance(built.observeGeneration, {
        onSnapshot: (snapshot) => {
          state.truthRows.generation = snapshot.generation;
          renderRunProgress();
        },
      });
      row.outputs = readCircuitOutputs(built, board);
      renderTruthTable();
    }
    showToast('Truth table complete', { kind: 'success' });
  } catch (error) {
    if (error?.name !== 'AbortError') showToast(`Run stopped: ${getErrorMessage(error)}`, { kind: 'error' });
  } finally {
    state.circuitRunning = false;
    // Put the authored experiment back on the board and in the worker.
    openCircuit(gates, { fit: false });
  }
}

function renderInspector() {
  const experiment = state.circuit;
  elements.circuitSection.hidden = !experiment;
  renderVersionHistory(getActiveCreation());
  if (!experiment) return;

  const gates = circuitGates(experiment);
  const card = GATE_CARDS[gates[0]] || { name: experiment.title };
  elements.circuitName.textContent = gates.length > 1 ? 'Each gate feeds the next.' : `${card.name}: ${card.note || experiment.description}`;
  renderChainRow(experiment);

  const { tiles, ports } = getCircuitGeometry(experiment);
  elements.inputsList.innerHTML = '';
  for (const [name, value] of Object.entries(experiment.inputs || {})) {
    const port = ports.find((candidate) => candidate.name === name);
    const entry = port ? `${port.side === 'west' ? '→' : '↑'} ${GATE_CARDS[tiles[port.tileIndex].gateId]?.name || ''}` : '';
    const row = document.createElement('label');
    row.className = 'switch-row';
    row.innerHTML = `<span>${name.toUpperCase()}<small>${entry}</small></span><input class="switch" type="checkbox" role="switch" data-input="${name}" aria-label="Input ${name.toUpperCase()}" ${value ? 'checked' : ''} ${state.circuitRunning ? 'disabled' : ''} />`;
    elements.inputsList.append(row);
  }

  elements.outputsList.innerHTML = '';
  for (const port of experiment.outputs) {
    const output = state.circuitOutputs?.find((candidate) => candidate.id === port.id) || null;
    const lampState = getLampState(output);
    const row = document.createElement('div');
    row.className = 'lamp-row';
    row.innerHTML = `<span>${escapeHtml(port.label)}</span><span class="lamp" data-output="${port.id}" data-state="${lampState}">${getLampLabel(lampState)}</span>`;
    elements.outputsList.append(row);
  }

  elements.runCircuit.disabled = state.circuitRunning;
  elements.fillTruthTable.disabled = state.circuitRunning;
  elements.runProgress.setAttribute('aria-valuemax', String(experiment.observeGeneration));
  renderRunProgress();
  renderTruthTable();
}

function renderChainRow(experiment) {
  const gates = circuitGates(experiment);
  elements.chainRow.hidden = !experiment.tiles;
  if (!experiment.tiles) {
    elements.chainNote.hidden = false;
    elements.chainNote.textContent = 'Standalone component.';
    return;
  }
  elements.chainList.innerHTML = gates.map((id, index) => `${index ? '<span class="chain-arrow" aria-hidden="true">→</span>' : ''}<span class="chain-chip" data-chain-gate="${id}">${GATE_CARDS[id].name}${gates.length > 1
    ? `<button class="chain-remove" type="button" data-remove-gate="${index}" aria-label="Remove ${GATE_CARDS[id].name}" ${state.circuitRunning ? 'disabled' : ''}><svg class="icon" aria-hidden="true"><use href="#i-close" /></svg></button>`
    : ''}</span>`).join('');
  const canAdd = validateCircuitChain([...gates, 'and']).ok;
  elements.addGate.disabled = !canAdd || state.circuitRunning;
  elements.chainNote.hidden = canAdd;
  elements.chainNote.textContent = canAdd ? '' : 'Up to 3 gates.';
}

function renderRunProgress() {
  const experiment = state.circuit;
  if (!experiment) return;
  const filling = state.circuitRunning && state.truthRows?.current > 0;
  const running = state.circuitRunning && state.circuitOutputs?.some((output) => output.settled === false);
  const settled = Boolean(state.circuitOutputs?.length) && !running;
  const generation = Math.min(filling ? state.truthRows.generation : state.board.generation, experiment.observeGeneration);
  const visible = filling || running || settled;
  elements.runProgress.hidden = !visible;
  elements.runProgressText.hidden = !visible;
  elements.runProgress.setAttribute('aria-valuenow', String(generation));
  elements.runProgressBar.style.width = `${(generation / experiment.observeGeneration) * 100}%`;
  elements.runProgressText.textContent = filling
    ? `Row ${state.truthRows.current} of ${state.truthRows.rows.length}`
    : `generation ${generation.toLocaleString()} / ${experiment.observeGeneration.toLocaleString()}`;
}

function renderTruthTable() {
  const experiment = state.circuit;
  if (!experiment) return;
  const inputNames = Object.keys(experiment.inputs || {});
  const outputs = experiment.outputs;
  const rows = state.truthRows?.id === experiment.id
    ? state.truthRows.rows
    : getInputCombinations(inputNames).map((inputs) => ({ inputs, outputs: null }));
  const header = `<tr>${inputNames.map((name) => `<th scope="col">${name.toUpperCase()}</th>`).join('')}${outputs.map((port) => `<th scope="col">${escapeHtml(port.label)}</th>`).join('')}</tr>`;
  const body = rows.map((row) => `<tr>${inputNames.map((name) => `<td>${row.inputs[name] ? 1 : 0}</td>`).join('')}${outputs.map((port) => {
    const output = row.outputs?.find((candidate) => candidate.id === port.id);
    if (!output) return '<td class="pending">·</td>';
    return `<td class="${output.high ? 'high' : 'low'}">${output.high ? 1 : 0}</td>`;
  }).join('')}</tr>`).join('');
  const caption = state.truthRows?.id === experiment.id
    ? (state.circuitRunning ? '<caption>Running every combination…</caption>' : '<caption>Measured from real probe cells.</caption>')
    : '<caption>Run all to measure every combination.</caption>';
  elements.truthTable.innerHTML = `<thead>${header}</thead><tbody>${body}</tbody>${caption}`;
}

/* ---------------------------------------------------------------------------
 * Feedback
 * ------------------------------------------------------------------------- */

function triggerHaptic(action) {
  const pattern = getHapticPattern(action);
  if (pattern.length > 0) navigator.vibrate?.(pattern);
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
  const previous = { width: canvas.clientWidth, height: canvas.clientHeight };
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (state.pendingFit) {
    const { region, options } = state.pendingFit;
    state.pendingFit = null;
    state.viewInitialized = true;
    fitRegion(region, options);
  } else if (!state.viewInitialized || state.pendingCenter) {
    state.viewInitialized = true;
    state.pendingCenter = false;
    centerWorld();
  } else if (previous.width && previous.height) {
    // Keep the board centre stable when the frame changes size.
    state.panX += (width - previous.width) / 2;
    state.panY += (height - previous.height) / 2;
  }
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

  state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

  const nextCellSize = getCellSize();
  state.panX = anchorX - worldX * nextCellSize;
  state.panY = anchorY - worldY * nextCellSize;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitRegion(region, { padding = 24, maxZoom = MAX_ZOOM } = {}) {
  if (!canvas.clientWidth) {
    state.pendingFit = { region, options: { padding, maxZoom } };
    state.pendingCenter = false;
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
    minZoom: MIN_ZOOM,
    maxZoom,
  });
  state.zoom = zoom;
  const cellSize = getCellSize();
  state.panX = (viewport.width - region.width * cellSize) / 2 - region.x * cellSize;
  state.panY = (viewport.height - region.height * cellSize) / 2 - region.y * cellSize;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitBoard() {
  fitRegion({ x: 0, y: 0, width: state.board.width, height: state.board.height }, { padding: 24 });
}

function fitLiveCells() {
  const coordinates = getLiveCoordinates();
  if (!coordinates.length) {
    fitBoard();
    return;
  }
  const bounds = getPatternBounds(coordinates);
  const margin = 8;
  fitRegion({
    x: bounds.minX - margin,
    y: bounds.minY - margin,
    width: bounds.width + margin * 2,
    height: bounds.height + margin * 2,
  }, { padding: 24, maxZoom: 1.6 });
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
  if (state.simulationStepPending || state.circuitRunning) return;
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
      ? `${coordinates.length.toLocaleString()} live cells as RLE text.`
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
    showToast('Click the board to place the pattern', { kind: 'info' });
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
  if (!experiment || experiment.board.width !== state.board.width || experiment.board.height !== state.board.height) return;
  const { tiles, ports } = getCircuitGeometry(experiment);
  const labelSize = 12;
  ctx.save();
  ctx.strokeStyle = palette.accent;
  ctx.fillStyle = palette.accent;
  ctx.lineWidth = 1;
  ctx.font = `500 ${labelSize}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`;
  ctx.textBaseline = 'middle';

  // Gate tile outlines.
  ctx.setLineDash([6, 4]);
  for (const tile of tiles) {
    ctx.strokeRect(Math.round(tile.x * cellSize) + 0.5, Math.round(tile.y * cellSize) + 0.5, Math.round(tile.width * cellSize), Math.round(tile.height * cellSize));
  }
  ctx.setLineDash([]);
  ctx.textAlign = 'left';
  for (const tile of tiles) {
    ctx.fillText(GATE_CARDS[tile.gateId]?.name || tile.gateId, tile.x * cellSize + 6, tile.y * cellSize - 10);
  }

  // Input lanes with direction arrows.
  for (const port of ports) {
    const active = experiment.inputs?.[port.name];
    const label = port.name.toUpperCase();
    ctx.globalAlpha = active ? 1 : 0.45;
    if (port.side === 'west') {
      const py = Math.round(port.y * cellSize) + 0.5;
      const endX = port.x * cellSize;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(endX - 4, py);
      ctx.stroke();
      drawArrowHead(endX, py, 0);
      ctx.textAlign = 'right';
      ctx.fillText(`${label} →`, endX - 10, py - 10);
    } else {
      const px = Math.round(port.x * cellSize) + 0.5;
      const startY = state.board.height * cellSize;
      const endY = port.y * cellSize;
      ctx.beginPath();
      ctx.moveTo(px, startY);
      ctx.lineTo(px, endY + 4);
      ctx.stroke();
      drawArrowHead(px, endY, -Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.fillText(`${label} ↑`, px + 8, endY + 14);
    }
  }
  ctx.globalAlpha = 1;

  // Output probe boxes.
  for (const port of experiment.outputs) {
    const output = state.circuitOutputs?.find((candidate) => candidate.id === port.id);
    const lampState = getLampState(output);
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
    ctx.textAlign = 'center';
    ctx.fillText(`${port.label}${lampState === 'high' ? ' · HIGH' : lampState === 'low' ? ' · LOW' : ''}`, x + w / 2, y + h + 12);
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

function updateStats() {
  const population = getPopulation(state.board);
  elements.generation.textContent = state.board.generation.toLocaleString();
  elements.population.textContent = population.toLocaleString();
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
    showToast('Pick a pattern to stamp', { kind: 'info' });
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
  const creationMatch = path.match(/^\/c\/([^/]+)$/);
  if (creationMatch) { await openPublicCreationRoute(decodeURIComponent(creationMatch[1])); return; }
  const profileMatch = path.match(/^\/u\/([^/]+)$/);
  if (profileMatch) { await openCreatorRoute(decodeURIComponent(profileMatch[1]), { updateHistory: false }); return; }
  const mode = getModeForPath(path);
  if (mode === 'community') {
    state.communityView = 'gallery';
    state.publicProfile = null;
  }
  setMode(mode);
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
        <span>${isFamous(creation) ? 'Library · LifeWiki' : `by ${escapeHtml(creation.ownerName)}`} · ${Number(creation.currentVersion?.population || 0).toLocaleString()} cells</span>
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
  // Small patterns are padded onto a 16 x 12 field so a glider reads as a
  // pattern on a board rather than three giant blocks.
  const sourceColumns = Number(preview?.grid?.columns || 6);
  const sourceRows = Number(preview?.grid?.rows || 5);
  const columns = Math.max(16, sourceColumns);
  const rows = Math.max(12, sourceRows);
  const offsetX = Math.floor((columns - sourceColumns) / 2);
  const offsetY = Math.floor((rows - sourceRows) / 2);
  return `
    <span class="preview-grid" aria-hidden="true" style="--preview-cols:${columns};--preview-rows:${rows}">
      ${(preview?.cells || []).map(([x, y]) => `<span style="grid-column:${x + offsetX + 1};grid-row:${y + offsetY + 1}"></span>`).join('')}
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
  const author = creation.ownerUsername
    ? `<button type="button" data-community-action="creator" data-username="${escapeHtml(creation.ownerUsername)}">${escapeHtml(creation.ownerName)}</button>`
    : escapeHtml(creation.ownerName);

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
          <span>${Number(creation.currentVersion?.population || 0).toLocaleString()} cells</span>
          <span>${creation.currentVersion?.width || 0} × ${creation.currentVersion?.height || 0}</span>
          ${famous ? '' : `<span>${creation.starCount || 0} stars</span><span>${creation.cloneCount || 0} remixes</span>`}
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
            <strong>${escapeHtml(comment.authorName)}</strong>
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
    if (!creation && communityAuth.cloudRepo?.getPublicCreation) creation = await communityAuth.cloudRepo.getPublicCreation(identifier);
    if (!creation || creation.visibility !== 'public') throw Object.assign(new Error('This pattern is unavailable or private.'), { status: 404 });
    state.publicCreations = [creation, ...state.publicCreations.filter((item) => item.id !== creation.id)];
    state.selectedCommunityId = creation.id;
    if (communityAuth.cloudRepo?.listPublicComments && !isFamous(creation)) {
      const result = await communityAuth.cloudRepo.listPublicComments(creation.slug || creation.id);
      state.communityComments[creation.id] = result.comments || [];
    }
    renderCommunityDetail(creation);
    document.title = `${creation.title} by ${creation.ownerName} · Life Lab`;
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
    state.session = null;
    loadCreationOntoBoard(source);
    state.selectedCommunityId = creationId;
    navigateTo('/');
    fitLiveCells();
    setPlaying(true);
    showToast(`Playing ${source.title}`, { kind: 'success' });
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

function toCommunityCopyInput(source) {
  return {
    title: createRemixTitle({ sourceTitle: source.title, profile: communityState.profile }),
    description: source.description,
    tags: source.tags,
    rle: source.currentVersion?.rle,
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
  if (!coordinates.length) return {};
  const config = createCreationPreviewConfig({
    title: elements.projectTitle.value || 'Untitled project',
    previewConfig: state.previewConfig,
    currentVersion: {
      rle: encodeRle(coordinates),
      settings: getCurrentDesignSettings(),
    },
  });
  // The circuit spec travels with the project; every repository keeps previewConfig as-is.
  return state.circuit ? { ...config, circuit: getCircuitSpec() } : config;
}

function importSharedBuildFromHash() {
  const shared = decodeShareLink(window.location.hash);
  if (!shared) return;

  try {
    const pattern = parseRle(shared.rle);
    state.board = clearBoard(state.board);
    state.board = placePattern(state.board, pattern.coordinates, 0, 0);
    state.authoredStart = ownedSnapshot();
    loadSimulation();
    fitLiveCells();
    updateStats();
    startProject({ title: shared.title || 'Shared pattern', boardLoaded: true });
    setProjectFields({ title: shared.title, description: shared.description, tags: shared.tags });
    markDesignDirty(true);
    navigateTo('/studio', { replace: true });
    showToast(shared.ownerName ? `Opened a pattern shared by ${shared.ownerName}` : 'Opened a shared pattern', { kind: 'success' });
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
  const group = getPresetGroup(presetGroups, state.activePresetGroup) ?? presetGroups[0];
  return group.ids.map((id) => presets.find((preset) => preset.id === id)).filter(Boolean);
}

function renderPatternList() {
  const searching = Boolean(state.patternQuery.trim());
  elements.patternTabs.hidden = searching;
  elements.patternTabs.innerHTML = '';
  for (const group of presetGroups) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.dataset.patternTab = group.id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(group.id === state.activePresetGroup));
    tab.textContent = group.title;
    elements.patternTabs.append(tab);
  }

  elements.patternList.innerHTML = '';
  const visible = getVisiblePresets();
  if (!searching && state.activePresetGroup === presetGroups[0].id) {
    elements.patternList.append(createPatternCard({
      id: 'random-soup',
      name: 'Random soup',
      note: PATTERN_NOTES['random-soup'],
      coordinates: null,
    }));
  }
  for (const preset of visible) elements.patternList.append(createPatternCard(preset));
  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'card-empty';
    empty.textContent = 'No patterns match.';
    elements.patternList.append(empty);
  }
  updatePresetSelection();
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
  const size = 54;
  const ratio = window.devicePixelRatio || 1;
  thumbCanvas.width = size * ratio;
  thumbCanvas.height = size * ratio;
  const preview = thumbCanvas.getContext('2d');
  preview.setTransform(ratio, 0, 0, ratio, 0, 0);
  const bounds = getPatternBounds(coordinates);
  const rawCell = Math.min(8, 46 / Math.max(1, bounds.width, bounds.height));
  const cell = rawCell >= 2 ? Math.floor(rawCell) : Math.max(0.6, rawCell);
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

function drawGateThumbnail(thumbCanvas, id) {
  const size = 54;
  const ratio = window.devicePixelRatio || 1;
  thumbCanvas.width = size * ratio;
  thumbCanvas.height = size * ratio;
  const preview = thumbCanvas.getContext('2d');
  preview.setTransform(ratio, 0, 0, ratio, 0, 0);
  preview.fillStyle = palette.canvas;
  preview.fillRect(0, 0, size, size);
  const cacheKey = `${id}:${palette.cell}`;
  let tileImage = gateThumbnailCache.get(cacheKey);
  if (!tileImage) {
    const experiment = buildCircuitExperiment(id, {});
    const { origin, tile } = getCircuitMarkers(id);
    const offscreen = document.createElement('canvas');
    offscreen.width = tile;
    offscreen.height = tile;
    const tileCtx = offscreen.getContext('2d');
    tileCtx.fillStyle = palette.canvas;
    tileCtx.fillRect(0, 0, tile, tile);
    tileCtx.fillStyle = palette.cell;
    const board = experiment.board;
    for (let y = 0; y < tile; y += 1) {
      for (let x = 0; x < tile; x += 1) {
        if (board.cells[(origin.y + y) * board.width + origin.x + x]) tileCtx.fillRect(x, y, 1.6, 1.6);
      }
    }
    tileImage = offscreen;
    gateThumbnailCache.set(cacheKey, tileImage);
  }
  preview.imageSmoothingEnabled = true;
  preview.drawImage(tileImage, 3, 3, size - 6, size - 6);
}

function renderLogicList() {
  elements.logicList.innerHTML = '';
  for (const experiment of circuitExperiments) {
    const card = GATE_CARDS[experiment.id] || { name: experiment.title, note: experiment.description };
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    button.dataset.gateId = experiment.id;
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-pressed', String(circuitGates().join('>') === experiment.id));
    const thumb = document.createElement('span');
    thumb.className = 'card-thumb';
    const thumbCanvas = document.createElement('canvas');
    drawGateThumbnail(thumbCanvas, experiment.id);
    thumb.append(thumbCanvas);
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
  for (const button of elements.logicList.querySelectorAll('[data-gate-id]')) {
    button.setAttribute('aria-pressed', String(button.dataset.gateId === circuitGates().join('>')));
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
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage may be unavailable */ }
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
  ['#add-gate', '#add-gate-menu'],
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
}

function toggleMenu(entry) {
  const open = !isMenuOpen(entry.menu);
  closeMenus();
  setMenuOpen(entry, open);
  if (open) entry.menu.querySelector('button, [tabindex]')?.focus?.({ preventScroll: true });
}

function openRail(open) {
  elements.rail.dataset.open = String(open);
  elements.sheetBackdrop.hidden = !open;
  elements.patternsOpen.setAttribute('aria-expanded', String(open));
  if (open) {
    elements.inspector.dataset.open = 'false';
    elements.inspectorToggle.setAttribute('aria-expanded', 'false');
  }
}

function openInspector(open) {
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
    .replace(/"/g, '&quot;');
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

    if (state.pointer.mode === 'stamp' && !state.selectedPreset) {
      showToast('Pick a pattern to stamp', { kind: 'info' });
      return;
    }

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
      setZoom(getPinchZoom({ startDistance: state.pointer.pinch.startDistance, distance, startZoom: state.pointer.pinch.startZoom, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }), mid.x, mid.y);
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
    showToast(`Placed ${preset.name}`, { kind: 'success' });
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
  elements.patternList.addEventListener('click', (event) => {
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
    const card = event.target.closest('[data-gate-id]');
    if (!card) return;
    openCircuit([card.dataset.gateId]);
    closeSheets();
    showToast(`${GATE_CARDS[card.dataset.gateId]?.name || 'Gate'} loaded. Flip the inputs, then run.`, { kind: 'success' });
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
  elements.edges.addEventListener('change', () => applyEdgesChoice(elements.edges.value));
  elements.inputsList.addEventListener('change', (event) => {
    const input = event.target.closest('[data-input]');
    if (input) setCircuitInput(input.dataset.input, input.checked);
  });
  elements.addGateMenu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-add-gate]');
    if (item) changeChain([...circuitGates(), item.dataset.addGate]);
  });
  elements.chainList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-gate]');
    if (button) changeChain(circuitGates().filter((_, index) => index !== Number(button.dataset.removeGate)));
  });
  elements.runCircuit.addEventListener('click', runCircuitExperiment);
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
      if (menus.some((entry) => isMenuOpen(entry.menu))) { closeMenus(); return; }
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
  communityState = await localCommunity.loadCommunityState();
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

// Read-only hook for browser tests: live cell coordinates and a few state facts.
window.__lifeLab = {
  liveCells: () => getLiveCoordinates(),
  snapshot: () => ({
    generation: state.board.generation,
    population: getPopulation(state.board),
    width: state.board.width,
    height: state.board.height,
    tool: state.tool,
    mode: state.mode,
    zoom: state.zoom,
    playing: state.playing,
    circuit: state.circuit?.id || null,
    gates: circuitGates(),
    selection: state.selection,
  }),
};

boot();

function findPreset(id) {
  const preset = presets.find((candidate) => candidate.id === id);

  if (!preset) {
    throw new Error(`Missing required preset: ${id}`);
  }

  return preset;
}
