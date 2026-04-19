import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Credential encryption — connection passwords are encrypted on disk using
// the OS keychain (DPAPI on Windows) via Electron safeStorage.
// In-memory cache always holds plaintext.
// ---------------------------------------------------------------------------
const SENSITIVE_CONN_PATHS = ['sftp.password', 'smb.password']

function encryptValue(v) {
  if (!v || !safeStorage.isEncryptionAvailable()) return v
  return 'enc:' + safeStorage.encryptString(v).toString('base64')
}

function decryptValue(v) {
  if (typeof v !== 'string' || !v.startsWith('enc:')) return v
  try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) }
  catch { return '' }
}

function applyToSensitive(obj, fn) {
  const result = structuredClone(obj)
  for (const conn of result.connections ?? []) {
    for (const path of SENSITIVE_CONN_PATHS) {
      const parts = path.split('.')
      let node = conn
      for (let i = 0; i < parts.length - 1; i++) node = node?.[parts[i]]
      if (node && parts.at(-1) in node) node[parts.at(-1)] = fn(node[parts.at(-1)])
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULTS = {
  backup: {
    sources:   [],   // string[] — remote paths on the NAS to pull down
    localDest: '',   // local folder to receive the backup
  },
  browse: {
    cacheMode:     'stale',   // 'stale' | 'tree' | 'none'
    cacheMutation: 'update',  // 'update' | 'refetch'
  },
  connections:        [],
  activeConnectionId: null,
}

// ---------------------------------------------------------------------------
// Migration — move legacy top-level fields into the first connection object
// ---------------------------------------------------------------------------
function migrateConfig(cfg) {
  const hasLegacy = cfg.localFolder || cfg.watcher
  if (!hasLegacy) return cfg

  if (cfg.localFolder) {
    const conn = (cfg.connections ?? [])[0]
    if (conn) {
      if (!conn.localFolder)  conn.localFolder  = cfg.localFolder
      if (!conn.operation)    conn.operation     = cfg.operation ?? 'copy'
      if (!conn.folderMode)   conn.folderMode   = cfg.folderMode ?? 'flat'
      if (!conn.extensions)   conn.extensions    = cfg.extensions ?? []
    }
    delete cfg.localFolder
    delete cfg.operation
    delete cfg.folderMode
    delete cfg.extensions
  }

  delete cfg.watcher

  return cfg
}

// ---------------------------------------------------------------------------
// Paths — resolved lazily so app.getPath() is only called after app is ready
// ---------------------------------------------------------------------------
let _dir  = null
let _file = null

function paths() {
  if (!_file) {
    _dir  = join(app.getPath('userData'), 'WinRaid')
    _file = join(_dir, 'config.json')
  }
  return { dir: _dir, file: _file }
}

// ---------------------------------------------------------------------------
// Deep merge: apply saved values on top of DEFAULTS so new keys always exist
// ---------------------------------------------------------------------------
function deepMerge(defaults, overrides) {
  const result = { ...defaults }
  for (const key of Object.keys(overrides ?? {})) {
    if (
      overrides[key] !== null &&
      typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key]) &&
      key in defaults &&
      typeof defaults[key] === 'object'
    ) {
      result[key] = deepMerge(defaults[key], overrides[key])
    } else {
      result[key] = overrides[key]
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
let _cache = null

function load() {
  if (_cache) return _cache
  const { file } = paths()
  if (!existsSync(file)) {
    _cache = structuredClone(DEFAULTS)
    return _cache
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const merged = deepMerge(DEFAULTS, raw)
    const migrated = migrateConfig(merged)
    _cache = applyToSensitive(migrated, decryptValue)
    // Persist migration changes so they only run once
    if (raw.localFolder !== undefined || raw.watcher !== undefined) persist()
  } catch {
    _cache = structuredClone(DEFAULTS)
  }
  return _cache
}

function persist() {
  const { dir, file } = paths()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(applyToSensitive(_cache, encryptValue), null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// Public API  (same surface as before — IPC handlers unchanged)
// ---------------------------------------------------------------------------

/**
 * Returns the full config object, or a dot-notation path value if key given.
 * @param {string|null} key
 */
export function getConfig(key = null) {
  const cfg = load()
  if (key == null) return cfg
  return key.split('.').reduce((obj, k) => obj?.[k], cfg)
}

/**
 * Sets a top-level key or dot-notation path, then persists to disk.
 * @param {string} key
 * @param {*} value
 */
export function setConfig(key, value) {
  const cfg = load()
  const parts = key.split('.')
  if (parts.length === 1) {
    cfg[key] = value
  } else {
    let node = cfg
    for (let i = 0; i < parts.length - 1; i++) {
      if (node[parts[i]] == null || typeof node[parts[i]] !== 'object') {
        node[parts[i]] = {}
      }
      node = node[parts[i]]
    }
    node[parts.at(-1)] = value
  }
  persist()
}
