// Installs a browser-only stand-in for window.winraid (the Electron preload
// bridge, see electron/preload.js) plus the screen-driving logic that puts
// the app on the screen named by the ?screen= query param. Loaded via a
// <script type="module"> injected before /src/main.jsx (see vite.config.js)
// so the bridge exists before React mounts.
//
// This is a plain implementation, not the vitest mock (src/__mocks__/winraid.js
// depends on `vi` and cannot run in a browser) — but it mirrors the same
// method surface so the two stay easy to compare.
//
// Image bytes: nas-stream:// is a custom URL scheme. A browser refuses it
// (net::ERR_UNKNOWN_URL_SCHEME) before any page script — including this
// bridge — ever sees the request, so there is no way to serve pixels for it
// from here. scripts/preview/shoot.mjs fulfills those requests instead, via
// a Playwright network route registered before navigation. window.winraid
// still exposes __winraidPreview.streamUrl below as the documented override
// point, for whenever src/utils/nasStream.js is wired to consult it.
import {
  CONFIG, WATCHER_STATUS, QUEUE_JOBS, QUEUE_STATS,
  ACTIVITY_ENTRIES, LOG_ENTRIES, REMOTE_ENTRIES, DISK_USAGE,
  SIZE_TREES, SIZE_META, MEDIA_FILES, SYSTEM_ACCENT_COLOR,
} from './fixtures.js'
import { SCREEN_NAMES } from './screens.js'

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function getByPath(source, path) {
  return path.split('.').reduce((value, segment) => (value == null ? undefined : value[segment]), source)
}

function setByPath(target, path, value) {
  const segments = path.split('.')
  let node = target
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (typeof node[segment] !== 'object' || node[segment] === null) node[segment] = {}
    node = node[segment]
  }
  node[segments[segments.length - 1]] = value
}

function createChannel() {
  const subscribers = new Set()
  return {
    subscribe(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    emit(payload) {
      subscribers.forEach((callback) => callback(payload))
    },
  }
}

const configStore = clone(CONFIG)
const queueJobs = clone(QUEUE_JOBS)

const channels = {
  watcherStatus: createChannel(),
  queueUpdated: createChannel(),
  queueProgress: createChannel(),
  logEntry: createChannel(),
  activityEntry: createChannel(),
  backupProgress: createChannel(),
  updateStatus: createChannel(),
  downloadProgress: createChannel(),
  sizeProgress: createChannel(),
  sizeLevel: createChannel(),
  sizeDone: createChannel(),
  sizeError: createChannel(),
  mediaFound: createChannel(),
  mediaDone: createChannel(),
  mediaError: createChannel(),
  ffmpegDownloadProgress: createChannel(),
}

window.winraid = {
  getVersion: () => Promise.resolve('0.0.0-preview'),
  getPathForFile: (file) => (file?.name ?? ''),
  selectFolder: () => Promise.resolve(null),
  selectDownloadPath: () => Promise.resolve(null),
  showImageContextMenu: () => Promise.resolve({ ok: true }),

  url: {
    fetch: () => Promise.resolve({ ok: false, error: 'URL fetch is not available in the preview harness' }),
  },

  cache: {
    thumbSize: () => Promise.resolve({ bytes: 42 * 1024 * 1024 }),
    clearThumbs: () => Promise.resolve(undefined),
    invalidateFile: () => Promise.resolve({ ok: true }),
  },

  config: {
    get: (key) => Promise.resolve(key == null ? clone(configStore) : clone(getByPath(configStore, key))),
    set: (key, value) => {
      setByPath(configStore, key, value)
      return Promise.resolve(undefined)
    },
  },

  watcher: {
    start: () => Promise.resolve(undefined),
    stop: () => Promise.resolve(undefined),
    list: () => Promise.resolve(clone(WATCHER_STATUS)),
    pauseAll: () => Promise.resolve(undefined),
    resumeAll: () => Promise.resolve(undefined),
    onStatus: (callback) => channels.watcherStatus.subscribe(callback),
  },

  queue: {
    list: (connectionId) => Promise.resolve(
      clone(connectionId ? queueJobs.filter((job) => job.connectionId === connectionId) : queueJobs),
    ),
    stats: () => Promise.resolve(clone(QUEUE_STATS)),
    reduceCompleted: () => Promise.resolve(clone(QUEUE_STATS)),
    retry: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(undefined),
    clearDone: () => Promise.resolve(undefined),
    clearStale: () => Promise.resolve({ removed: 0 }),
    enqueueBatch: () => Promise.resolve(undefined),
    dropUpload: () => Promise.resolve({ ok: true, count: 0 }),
    cancel: () => Promise.resolve(undefined),
    pause: () => Promise.resolve(undefined),
    resume: () => Promise.resolve(undefined),
    onUpdated: (callback) => channels.queueUpdated.subscribe(callback),
    onProgress: (callback) => channels.queueProgress.subscribe(callback),
  },

  log: {
    getPath: () => Promise.resolve('C:\\Users\\user\\AppData\\Roaming\\WinRaid\\logs\\winraid.log'),
    tail: () => Promise.resolve(clone(LOG_ENTRIES)),
    reveal: () => Promise.resolve(undefined),
    clear: () => Promise.resolve(undefined),
    onEntry: (callback) => channels.logEntry.subscribe(callback),
  },

  activity: {
    tail: () => Promise.resolve(clone(ACTIVITY_ENTRIES)),
    onEntry: (callback) => channels.activityEntry.subscribe(callback),
    reveal: () => Promise.resolve({ ok: true }),
  },

  ssh: {
    test: () => Promise.resolve({ ok: true }),
    forgetHostKey: () => Promise.resolve({ ok: true }),
    scanConfigs: () => Promise.resolve([]),
    listDir: () => Promise.resolve({ ok: true, entries: [] }),
    mkdir: () => Promise.resolve({ ok: true }),
  },

  backup: {
    run: () => Promise.resolve({ ok: true, stats: {} }),
    cancel: () => Promise.resolve(undefined),
    onProgress: (callback) => channels.backupProgress.subscribe(callback),
  },

  update: {
    check: () => Promise.resolve({ ok: true, version: '0.0.0-preview' }),
    install: () => {},
    onStatus: (callback) => channels.updateStatus.subscribe(callback),
  },

  whatsNew: {
    open: () => Promise.resolve({ ok: true }),
    close: () => Promise.resolve({ ok: true }),
  },

  local: {
    clearFolder: () => Promise.resolve({ ok: true }),
    exists: () => Promise.resolve(true),
    reveal: () => Promise.resolve({ ok: true }),
  },

  remote: {
    list: (connectionId, path) => {
      const entries = REMOTE_ENTRIES[`${connectionId}:${path}`] ?? []
      return Promise.resolve({ ok: true, entries: clone(entries) })
    },
    tree: () => Promise.resolve({ ok: true, dirMap: {} }),
    checkout: () => Promise.resolve({ ok: true, created: [] }),
    download: () => Promise.resolve({ ok: true }),
    readFile: () => Promise.resolve({ ok: true, content: '' }),
    writeFile: () => Promise.resolve({ ok: true }),
    writeFileBinary: () => Promise.resolve({ ok: true }),
    delete: () => Promise.resolve({ ok: true }),
    move: () => Promise.resolve({ ok: true }),
    mkdir: () => Promise.resolve({ ok: true }),
    verifyClean: () => Promise.resolve({ ok: true, total: 0, confirmed: [], notFound: [] }),
    verifyDelete: () => Promise.resolve({ ok: true, deleted: 0, errors: [] }),
    onDownloadProgress: (callback) => channels.downloadProgress.subscribe(callback),

    diskUsage: (connectionId) => Promise.resolve(clone(DISK_USAGE[connectionId] ?? { ok: false, error: 'Not supported' })),

    sizeScan: () => Promise.resolve({ ok: true }),
    sizeCancel: () => Promise.resolve(undefined),
    onSizeProgress: (callback) => channels.sizeProgress.subscribe(callback),
    onSizeLevel: (callback) => channels.sizeLevel.subscribe(callback),
    onSizeDone: (callback) => channels.sizeDone.subscribe(callback),
    onSizeError: (callback) => channels.sizeError.subscribe(callback),
    sizeLoadCache: (connectionId) => {
      const tree = SIZE_TREES[connectionId]
      if (!tree) return Promise.resolve(null)
      return Promise.resolve(clone({ tree, scanMeta: SIZE_META[connectionId] ?? null }))
    },
    sizeSaveCache: () => Promise.resolve({ ok: true }),

    mediaScan: (connectionId) => {
      const files = MEDIA_FILES[connectionId] ?? []
      // Deferred so effects that subscribe to onMediaFound/onMediaDone
      // before calling mediaScan (as the real app does) see both events.
      setTimeout(() => {
        if (files.length > 0) channels.mediaFound.emit({ files: clone(files) })
        channels.mediaDone.emit({ totalMatches: files.length, durationMs: 420 })
      }, 30)
      return Promise.resolve({ ok: true })
    },
    mediaCancel: () => Promise.resolve(undefined),
    onMediaFound: (callback) => channels.mediaFound.subscribe(callback),
    onMediaDone: (callback) => channels.mediaDone.subscribe(callback),
    onMediaError: (callback) => channels.mediaError.subscribe(callback),

    trimVideo: () => Promise.resolve({ ok: true, outPath: '' }),
    rotateVideo: () => Promise.resolve({ ok: true, outPath: '' }),
    cropVideo: () => Promise.resolve({ ok: true, outPath: '' }),
    trimCapability: () => Promise.resolve({ ok: true, mode: 'none' }),
    downloadFfmpeg: () => Promise.resolve({ ok: true, path: '' }),
    cancelFfmpegDownload: () => Promise.resolve({ ok: true }),
    onFfmpegDownloadProgress: (callback) => channels.ffmpegDownloadProgress.subscribe(callback),
    locateFfmpeg: () => Promise.resolve({ ok: true, path: '' }),
  },

  // Not part of the real preload surface (grep across src/ turns up no
  // consumer) — included because the card asked for it explicitly. Kept
  // here as a documented, currently-inert namespace rather than left out.
  system: {
    accentColor: () => Promise.resolve(SYSTEM_ACCENT_COLOR),
    onAccentColorChanged: () => () => {},
  },

  // Window chrome for the frameless shell. A browser tab has no window
  // controls to drive, so these resolve without doing anything.
  window: {
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
    isMaximized: () => Promise.resolve(false),
    onMaximizedChanged: () => () => {},
  },
}

// Documented override point for a future src/utils/nasStream.js change that
// would consult it — see the file header for why the harness does not rely
// on this today.
window.__winraidPreview = {
  streamUrl(connectionId, remotePath) {
    const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/')
    return `nas-stream://${connectionId}${encodedPath}`
  },
}

// ---------------------------------------------------------------------------
// Screen driving
// ---------------------------------------------------------------------------
// Each screen is an ordered list of steps. A step finds an element (by CSS
// selector, or by accessible role + name) and acts on it, retrying for up to
// 5s so it survives the app's async loads (config fetch, directory listing,
// media scan). The app sets data-preview-ready on <html> once its steps
// finish, which shoot.mjs waits on before screenshotting.

function findByRole(role, name) {
  const candidates = Array.from(document.querySelectorAll(role === 'button' ? 'button' : `[role="${role}"]`))
  return candidates.find((el) => (el.textContent ?? '').trim() === name) ?? null
}

function findFirst(selector) {
  return document.querySelector(selector)
}

async function retryUntil(findFn, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = findFn()
    if (found) return found
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

async function runStep(step) {
  const element = await retryUntil(step.find)
  if (!element) {
    console.warn(`[preview] step could not find its target: ${step.description}`)
    return false
  }
  step.act(element)
  return true
}

function clickNav(name) {
  return {
    description: `click nav item "${name}"`,
    find: () => findByRole('button', name),
    act: (el) => el.click(),
  }
}

function clickSelector(selector, description) {
  return {
    description: description ?? `click ${selector}`,
    find: () => findFirst(selector),
    act: (el) => el.click(),
  }
}

const FIRST_CONNECTION_BROWSE = '[data-testid^="sub-browse-"]'
const FIRST_CONNECTION_BACKUP = '[data-testid^="sub-backup-"]'
const FIRST_CONNECTION_SIZE = '[data-testid^="sub-size-"]'
const FIRST_IMAGE_ENTRY = '[data-entry-path$=".jpg"]'
const PLAY_BUTTON = '[aria-label="Play media slideshow"]'
const VIEW_TOGGLE_BUTTON = '[class*="viewToggleBtn"]'
const ADD_CONNECTION_BUTTON = '[class*="addBtn"]'

const SCREEN_STEPS = {
  dashboard: [],
  connections: [
    clickSelector(ADD_CONNECTION_BUTTON, 'open the add-connection form'),
  ],
  queue: [
    clickNav('Queue'),
  ],
  browse: [
    clickSelector(FIRST_CONNECTION_BROWSE, 'open the first connection\'s Browse tab'),
    clickSelector(VIEW_TOGGLE_BUTTON, 'switch Browse to grid view'),
  ],
  'browse-list': [
    clickSelector(FIRST_CONNECTION_BROWSE, 'open the first connection\'s Browse tab'),
  ],
  'quick-look': [
    clickSelector(FIRST_CONNECTION_BROWSE, 'open the first connection\'s Browse tab'),
    clickSelector(FIRST_IMAGE_ENTRY, 'open the first image entry in Quick Look'),
  ],
  play: [
    clickSelector(FIRST_CONNECTION_BROWSE, 'open the first connection\'s Browse tab'),
    clickSelector(PLAY_BUTTON, 'start the media slideshow'),
  ],
  size: [
    clickSelector(FIRST_CONNECTION_SIZE, 'open the first connection\'s Size tab'),
  ],
  backup: [
    clickSelector(FIRST_CONNECTION_BACKUP, 'open the first connection\'s Backup tab'),
  ],
  logs: [
    clickNav('Logs'),
  ],
  settings: [
    clickNav('Settings'),
  ],
}

async function driveToScreen(screenName) {
  const steps = SCREEN_STEPS[screenName]
  if (steps === undefined) {
    console.warn(`[preview] unknown screen "${screenName}" — known screens: ${SCREEN_NAMES.join(', ')}`)
  } else {
    for (const step of steps) {
      // Steps are an ordered sequence (each depends on the previous one's
      // result), so they run one at a time rather than in parallel.
      await runStep(step)
    }
  }
  document.documentElement.setAttribute('data-preview-ready', 'true')
}

const requestedScreen = new URLSearchParams(location.search).get('screen')
if (requestedScreen) {
  // Wait for the app to mount before driving it — main.jsx renders
  // synchronously, but the initial config.get() round-trip is async.
  window.addEventListener('DOMContentLoaded', () => {
    driveToScreen(requestedScreen)
  })
} else {
  document.documentElement.setAttribute('data-preview-ready', 'true')
}
