// Synthetic data for the renderer preview harness. Every value here is
// invented — no real hostnames, credentials, or file contents — and shaped
// to match what the app's IPC surface (electron/preload.js) actually
// returns, so the screens render with realistic-looking content instead of
// empty states.
//
// Imported by both scripts/preview/bridge.js (runs in the browser, installs
// window.winraid) and scripts/preview/shoot.mjs (runs in Node, fulfills
// nas-stream:// requests) — kept framework-agnostic (no `vi`, no DOM).

const NOW = Date.now()
const MINUTES = 60 * 1000
const HOURS = 60 * MINUTES
const DAYS = 24 * HOURS

export const CONNECTIONS = [
  {
    id: 'atlas',
    name: 'Atlas',
    icon: { type: 'lucide', value: 'HardDrive' },
    type: 'sftp',
    sftp: {
      host: 'nas.local', port: 22, username: 'winraid',
      password: '', keyPath: '', remotePath: '/mnt/user/media',
    },
    smb: { host: '', share: '', username: '', password: '', remotePath: '' },
    localFolder: 'C:\\Users\\user\\Pictures\\Import',
    operation: 'copy',
    folderMode: 'flat',
    extensions: [],
    ignoredExtensions: [],
  },
  {
    id: 'work-documents',
    name: 'Work documents',
    icon: { type: 'lucide', value: 'Folder' },
    type: 'sftp',
    sftp: {
      host: 'nas.local', port: 22, username: 'winraid',
      password: '', keyPath: '', remotePath: '/mnt/user/documents',
    },
    smb: { host: '', share: '', username: '', password: '', remotePath: '' },
    localFolder: 'C:\\Users\\user\\Documents\\WorkSync',
    operation: 'move',
    folderMode: 'mirror',
    extensions: [],
    ignoredExtensions: [],
  },
  {
    id: 'downloads-to-media',
    name: 'Downloads to media',
    icon: { type: 'lucide', value: 'Download' },
    type: 'smb',
    sftp: { host: '', port: 22, username: '', password: '', keyPath: '', remotePath: '' },
    smb: {
      host: 'nas.local', share: 'media', username: 'winraid',
      password: '', remotePath: 'downloads',
    },
    localFolder: 'C:\\Users\\user\\Downloads',
    operation: 'copy',
    folderMode: 'flat',
    extensions: [],
    ignoredExtensions: [],
  },
]

export const WATCHER_STATUS = {
  atlas: { watching: true, folder: 'C:\\Users\\user\\Pictures\\Import', state: 'watching', file: null },
  'work-documents': { watching: true, folder: 'C:\\Users\\user\\Documents\\WorkSync', state: 'enqueueing', file: 'invoice.pdf' },
  'downloads-to-media': { watching: false, folder: null, state: null, file: null },
}

export const QUEUE_JOBS = [
  {
    id: 'job-transferring-1',
    filename: 'sunrise.jpg',
    connectionId: 'atlas',
    status: 'TRANSFERRING',
    progress: 0.62,
    size: 4_200_000,
    createdAt: NOW - 2 * MINUTES,
    relPath: 'sunrise.jpg',
    remoteDest: '/mnt/user/media/photos',
  },
  {
    id: 'job-pending-1',
    filename: 'family-trip.mp4',
    connectionId: 'atlas',
    status: 'PENDING',
    progress: 0,
    size: 250_000_000,
    createdAt: NOW - 90 * 1000,
    relPath: 'family-trip.mp4',
    remoteDest: '/mnt/user/media/video',
  },
  {
    id: 'job-pending-2',
    filename: 'invoice.pdf',
    connectionId: 'work-documents',
    status: 'PENDING',
    progress: 0,
    size: 118_000,
    createdAt: NOW - 45 * 1000,
    relPath: 'invoice.pdf',
    remoteDest: '/mnt/user/documents',
  },
  {
    id: 'job-error-1',
    filename: 'corrupted-export.png',
    connectionId: 'atlas',
    status: 'ERROR',
    progress: 0,
    size: 812_000,
    createdAt: NOW - 20 * MINUTES,
    relPath: 'corrupted-export.png',
    remoteDest: '/mnt/user/media/photos',
    errorMsg: 'Connection reset while uploading',
    errorAt: NOW - 19 * MINUTES,
  },
]

export const QUEUE_STATS = { lifetimeCompleted: 428 }

export const ACTIVITY_ENTRIES = [
  {
    id: 'activity-1', type: 'upload', connectionId: 'atlas', level: 'ok',
    title: 'Uploaded sunset-beach.jpg', detail: '/mnt/user/media/photos', ts: NOW - 3 * MINUTES,
    nav: { kind: 'remote', path: '/mnt/user/media/photos', highlight: 'sunset-beach.jpg' },
  },
  {
    id: 'activity-2', type: 'mkdir', connectionId: 'work-documents', level: 'ok',
    title: 'Created folder Q3-reports', detail: '/mnt/user/documents', ts: NOW - 40 * MINUTES,
    nav: { kind: 'remote', path: '/mnt/user/documents/Q3-reports' },
  },
  {
    id: 'activity-3', type: 'delete', connectionId: 'atlas', level: 'warn',
    title: 'Deleted duplicate-import.jpg', detail: '/mnt/user/media/photos', ts: NOW - 2 * HOURS,
    nav: { kind: 'remote', path: '/mnt/user/media/photos' },
  },
  {
    id: 'activity-4', type: 'verify-missing', connectionId: 'downloads-to-media', level: 'error',
    title: '3 local files missing on NAS', detail: 'Verify & Clean', ts: NOW - 5 * HOURS,
    nav: null,
  },
]

// Keyed by "connectionId:remotePath" — matches the same shape remote.list
// resolves with: { ok, entries: [{ name, type, size, modified }] }.
export const REMOTE_ENTRIES = {
  'atlas:/mnt/user/media': [
    { name: 'photos', type: 'dir' },
    { name: 'video', type: 'dir' },
    { name: 'docs', type: 'dir' },
    { name: 'sunrise.jpg', type: 'file', size: 4_200_000, modified: NOW - 2 * MINUTES },
    { name: 'poster.png', type: 'file', size: 1_800_000, modified: NOW - 6 * HOURS },
    { name: 'family-trip.mp4', type: 'file', size: 250_000_000, modified: NOW - 90 * 1000 },
    { name: 'loop.gif', type: 'file', size: 3_400_000, modified: NOW - 1 * DAYS },
    { name: 'manual.pdf', type: 'file', size: 912_000, modified: NOW - 3 * DAYS },
    { name: 'notes.txt', type: 'file', size: 2_100, modified: NOW - 4 * DAYS },
    { name: 'README.md', type: 'file', size: 4_500, modified: NOW - 10 * DAYS },
  ],
  'atlas:/mnt/user/media/photos': Array.from({ length: 12 }, (_, i) => {
    const index = String(i + 1).padStart(2, '0')
    return {
      name: `vacation-${index}.jpg`,
      type: 'file',
      size: 2_100_000 + i * 137_000,
      modified: NOW - i * 6 * HOURS,
    }
  }),
}

export const DISK_USAGE = {
  atlas: { ok: true, total: 8 * 1024 ** 4, used: 3.1 * 1024 ** 4, free: 4.9 * 1024 ** 4 },
  'work-documents': { ok: true, total: 2 * 1024 ** 4, used: 0.4 * 1024 ** 4, free: 1.6 * 1024 ** 4 },
  'downloads-to-media': { ok: true, total: 8 * 1024 ** 4, used: 3.1 * 1024 ** 4, free: 4.9 * 1024 ** 4 },
}

// Cached size-scan results, keyed by connectionId — read directly via
// remote.sizeLoadCache so the Size screen renders straight into its RESULTS
// phase without simulating a live scan.
export const SIZE_TREES = {
  atlas: {
    name: 'media',
    path: '/mnt/user/media',
    sizeKb: 483_200,
    children: [
      { name: 'photos', path: '/mnt/user/media/photos', sizeKb: 210_400, children: [] },
      { name: 'video', path: '/mnt/user/media/video', sizeKb: 259_800, children: [] },
      { name: 'docs', path: '/mnt/user/media/docs', sizeKb: 13_000, children: [] },
    ],
  },
}

export const SIZE_META = {
  atlas: { totalFolders: 3, elapsedMs: 1850, scannedAt: NOW - 30 * MINUTES },
}

// Media files a recursive Play scan would find under the connection's root —
// consumed via the mediaScan → onMediaFound/onMediaDone push-event sequence.
export const MEDIA_FILES = {
  atlas: [
    ...Array.from({ length: 12 }, (_, i) => {
      const index = String(i + 1).padStart(2, '0')
      return {
        path: `/mnt/user/media/photos/vacation-${index}.jpg`,
        size: 2_100_000 + i * 137_000,
        mtime: NOW - i * 6 * HOURS,
        type: 'image',
      }
    }),
    { path: '/mnt/user/media/loop.gif', size: 3_400_000, mtime: NOW - 1 * DAYS, type: 'image' },
    { path: '/mnt/user/media/family-trip.mp4', size: 250_000_000, mtime: NOW - 90 * 1000, type: 'video' },
  ],
}

export const LOG_ENTRIES = [
  { ts: NOW - 6 * HOURS, level: 'info', message: 'Watcher started for Atlas (C:\\Users\\user\\Pictures\\Import)' },
  { ts: NOW - 5 * HOURS, level: 'info', message: 'Uploaded sunrise.jpg to /mnt/user/media/photos (4.2 MB)' },
  { ts: NOW - 3 * HOURS, level: 'warn', message: 'Retrying family-trip.mp4 after a transient SFTP timeout' },
  { ts: NOW - 2 * HOURS, level: 'error', message: 'Failed to upload corrupted-export.png: connection reset' },
  { ts: NOW - 40 * MINUTES, level: 'info', message: 'Created remote folder /mnt/user/documents/Q3-reports' },
  { ts: NOW - 5 * MINUTES, level: 'info', message: 'Backup pull completed for Atlas: 42 files, 0 errors' },
]

export const BACKUP_BY_CONNECTION = {
  atlas: {
    sources: ['/mnt/user/media/photos', '/mnt/user/media/video'],
    localDest: 'C:\\Users\\user\\Backups\\Atlas',
  },
}

export const PLAY_DEFAULTS = { recursive: true, shuffle: true }

export const APPEARANCE = { theme: 'dark', accent: 'system' }

export const SYSTEM_ACCENT_COLOR = '#0078D4'

// Full config object, as returned by config.get() with no key. Individual
// dot-path reads (e.g. config.get('browse.cacheMode')) are resolved against
// this same object by the bridge.
export const CONFIG = {
  connections: CONNECTIONS,
  favoritesByConnection: {
    atlas: ['/mnt/user/media/photos'],
  },
  backupByConnection: BACKUP_BY_CONNECTION,
  browse: {
    cacheMode: 'stale',
    cacheMutation: 'update',
    dirsFirst: true,
    sortPersistence: 'default',
  },
  playDefaults: PLAY_DEFAULTS,
  snapshot: { format: 'jpeg' },
  thumbSeek: { mode: 'percent', value: 10 },
  activeConnectionId: 'atlas',
  appearance: APPEARANCE,
}
