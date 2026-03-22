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
      clearDone: vi.fn().mockResolvedValue(undefined),
      enqueueBatch: vi.fn().mockResolvedValue(undefined),
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
      checkout: vi.fn().mockResolvedValue({ ok: true, created: [] }),
      readFile: vi.fn().mockResolvedValue({ ok: true, content: '' }),
      writeFile: vi.fn().mockResolvedValue({ ok: true }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
      move: vi.fn().mockResolvedValue({ ok: true }),
      verifyClean: vi.fn().mockResolvedValue({ ok: true, total: 0, confirmed: [], notFound: [] }),
      verifyDelete: vi.fn().mockResolvedValue({ ok: true, deleted: 0, errors: [] }),
      ...overrides.remote,
    },
  }
}
