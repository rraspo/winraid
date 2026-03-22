// Playwright CT setup — runs in the browser before each component mount.
// Imports global styles and injects the window.winraid mock so components
// can call IPC methods without the Electron preload bridge.

import '../src/styles/tokens.css'
import '../src/styles/global.css'

import { beforeMount } from '@playwright/experimental-ct-react/hooks'

// Default mock — individual tests can override via page.evaluate()
beforeMount(async ({ hooksConfig }) => {
  const noop = () => () => {}
  const resolved = (v) => () => Promise.resolve(v)

  // configData: { connections: [...], activeConnectionId: '...' }
  // If provided, config.get(key) returns configData[key]; otherwise returns the whole map.
  const cfgData = hooksConfig?.configData ?? {}
  const configGet = (key) => Promise.resolve(key ? cfgData[key] : cfgData)

  window.winraid = {
    getVersion: resolved('1.1.0'),
    selectFolder: resolved(null),
    config: {
      get: configGet,
      set: resolved(undefined),
    },
    watcher: {
      start: resolved(undefined),
      stop: resolved(undefined),
      list: resolved({}),
      pauseAll: resolved(undefined),
      resumeAll: resolved(undefined),
      onStatus: noop,
    },
    queue: {
      list: resolved(hooksConfig?.queueJobs ?? []),
      retry: resolved(undefined),
      remove: resolved(undefined),
      clearDone: resolved(undefined),
      enqueueBatch: resolved(undefined),
      cancel: resolved(undefined),
      onUpdated: noop,
      onProgress: noop,
    },
    log: {
      getPath: resolved('/tmp/winraid.log'),
      tail: resolved([]),
      reveal: resolved(undefined),
      onEntry: noop,
    },
    ssh: {
      test: resolved({ ok: true }),
      scanConfigs: resolved([]),
      listDir: resolved({ ok: true, entries: [] }),
    },
    backup: {
      run: resolved({ ok: true, stats: {} }),
      cancel: resolved(undefined),
      onProgress: noop,
    },
    local: {
      clearFolder: resolved({ ok: true }),
    },
    remote: {
      list: resolved(hooksConfig?.remoteEntries ?? { ok: true, entries: [] }),
      checkout: resolved({ ok: true, created: [] }),
      readFile: resolved({ ok: true, content: '' }),
      writeFile: resolved({ ok: true }),
      delete: resolved({ ok: true }),
      move: resolved({ ok: true }),
      verifyClean: resolved({ ok: true, total: 0, confirmed: [], notFound: [] }),
      verifyDelete: resolved({ ok: true, deleted: 0, errors: [] }),
    },

    // Apply any test-specific overrides
    ...hooksConfig?.winraidOverrides,
  }
})
