import { vi } from 'vitest'

/**
 * Creates a complete mock of the window.winraid contextBridge API.
 * Every IPC method returns a resolved promise with sensible defaults.
 * Event subscribers return no-op unsubscribe functions.
 *
 * Usage:
 *   beforeEach(() => { window.winraid = createWinraidMock() })
 *   afterEach(() => { delete window.winraid })
 */
export function createWinraidMock(overrides = {}) {
  return {
    getVersion: vi.fn().mockResolvedValue('1.1.0'),
    getPathForFile: vi.fn((f) => f?.path ?? ''),
    selectFolder: vi.fn().mockResolvedValue(null),

    config: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      ...overrides.config,
    },

    watcher: {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({}),
      pauseAll: vi.fn().mockResolvedValue(undefined),
      resumeAll: vi.fn().mockResolvedValue(undefined),
      onStatus: vi.fn().mockReturnValue(() => {}),
      ...overrides.watcher,
    },

    queue: {
      list: vi.fn().mockResolvedValue([]),
      retry: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clearDone:  vi.fn().mockResolvedValue(undefined),
      clearStale: vi.fn().mockResolvedValue({ removed: 0 }),
      enqueueBatch: vi.fn().mockResolvedValue(undefined),
      dropUpload: vi.fn().mockResolvedValue({ ok: true, count: 1 }),
      cancel: vi.fn().mockResolvedValue(undefined),
      onUpdated: vi.fn().mockReturnValue(() => {}),
      onProgress: vi.fn().mockReturnValue(() => {}),
      ...overrides.queue,
    },

    log: {
      getPath: vi.fn().mockResolvedValue('/tmp/winraid.log'),
      tail: vi.fn().mockResolvedValue([]),
      reveal: vi.fn().mockResolvedValue(undefined),
      onEntry: vi.fn().mockReturnValue(() => {}),
      ...overrides.log,
    },

    ssh: {
      test: vi.fn().mockResolvedValue({ ok: true }),
      scanConfigs: vi.fn().mockResolvedValue([]),
      listDir: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      ...overrides.ssh,
    },

    backup: {
      run: vi.fn().mockResolvedValue({ ok: true, stats: {} }),
      cancel: vi.fn().mockResolvedValue(undefined),
      onProgress: vi.fn().mockReturnValue(() => {}),
      ...overrides.backup,
    },

    update: {
      check: vi.fn().mockResolvedValue({ ok: true, version: '1.1.0' }),
      install: vi.fn(),
      onStatus: vi.fn().mockReturnValue(() => {}),
      ...overrides.update,
    },

    local: {
      clearFolder: vi.fn().mockResolvedValue({ ok: true }),
      ...overrides.local,
    },

    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      tree: vi.fn().mockResolvedValue({ ok: true, dirMap: {} }),
      checkout: vi.fn().mockResolvedValue({ ok: true, created: [] }),
      readFile: vi.fn().mockResolvedValue({ ok: true, content: '' }),
      writeFile: vi.fn().mockResolvedValue({ ok: true }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
      move: vi.fn().mockResolvedValue({ ok: true }),
      verifyClean: vi.fn().mockResolvedValue({ ok: true, total: 0, confirmed: [], notFound: [] }),
      verifyDelete: vi.fn().mockResolvedValue({ ok: true, deleted: 0, errors: [] }),
      diskUsage: vi.fn().mockResolvedValue({ ok: true, total: 10 * 1024 ** 3, used: 4 * 1024 ** 3, free: 6 * 1024 ** 3 }),
      sizeScan:       vi.fn().mockResolvedValue({ ok: true }),
      sizeCancel:     vi.fn().mockResolvedValue(undefined),
      onSizeProgress:      vi.fn().mockReturnValue(() => {}),
      onSizeLevel:         vi.fn().mockReturnValue(() => {}),
      onSizeDone:          vi.fn().mockReturnValue(() => {}),
      onSizeError:         vi.fn().mockReturnValue(() => {}),
      sizeLoadCache:       vi.fn().mockResolvedValue(null),
      sizeSaveCache:       vi.fn().mockResolvedValue({ ok: true }),
      onDownloadProgress:  vi.fn().mockReturnValue(() => {}),
      ...overrides.remote,
    },
  }
}
