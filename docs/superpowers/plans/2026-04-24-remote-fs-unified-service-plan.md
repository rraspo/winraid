# Remote FS Unified Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **TDD is mandatory.** Every feature in WinRaid is working as of v2.2.2. Write the failing test first, confirm it fails, implement, confirm it passes, then commit. Never commit red tests.
>
> **Prerequisites:** The remote-fs-reliability plan must be merged and green before starting this plan.
>
> **Before starting any task:** Read `CLAUDE.md` in the repo root for conventions, IPC patterns, and code style. Read `docs/superpowers/specs/2026-04-24-remote-fs-unified-service-design.md` for the full design rationale. All src/ code uses ES modules. CSS Modules only — no inline styles.

**Goal:** Extract `useBrowse`'s internal `dirCache` into a shared singleton `src/services/remoteFS.js` so that Browse, the upcoming PlayOverlay, and any future feature share a single directory listing cache and a clean API.

**Architecture:** Module-level singleton (not React state) with `list`, `tree`, `update`, `invalidate`, `invalidateSubtree`, `invalidateConnection`, `getSnapshot`, and `subscribe`. A `useRemoteDir` hook wraps it via `useSyncExternalStore`. `useBrowse` is refactored to call remoteFS instead of `window.winraid.remote.list/tree` directly. Cache modes (`stale`/`tree`/`none`) stay as policy in `useBrowse`.

**Tech Stack:** React 18, Vite, Vitest + @testing-library/react + happy-dom.

---

## File structure

| File | Action | Purpose |
|---|---|---|
| `src/services/remoteFS.js` | Create | Singleton cache: list, tree, update, invalidate, subscribe |
| `src/services/remoteFS.test.js` | Create | Unit tests for the singleton |
| `src/__mocks__/remoteFS.js` | Create | Vitest manual mock for hook tests |
| `src/hooks/useRemoteDir.js` | Create | React hook via useSyncExternalStore |
| `src/hooks/useRemoteDir.test.js` | Create | Tests for the hook |
| `src/hooks/useBrowse.js` | Modify | Replace direct IPC calls with remoteFS; move cache mutation logic |

---

### Task 1: Create `remoteFS` singleton and unit tests

**Files:**
- Create: `src/services/remoteFS.js`
- Create: `src/services/remoteFS.test.js`

**Context:** This is the core of the whole spec. The singleton holds a `Map` for cached entries, a `Map` for in-flight dedup, and a `Set` of listeners. All other tasks depend on this API being stable. Do not change this API after Task 1 is merged.

- [ ] **Step 1: Write failing tests**

Create `src/services/remoteFS.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We import the module fresh each test to get a clean singleton.
// Use vi.resetModules() to clear the module cache between tests.
let remoteFS

beforeEach(async () => {
  vi.resetModules()
  // Provide a minimal window.winraid.remote mock
  global.window = global.window ?? {}
  window.winraid = {
    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: [{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }] }),
      tree: vi.fn().mockResolvedValue({ ok: true, dirMap: { '/photos': [{ name: 'b.jpg', type: 'file', size: 200, modified: 0 }] } }),
    },
  }
  remoteFS = await import('./remoteFS.js')
})

describe('list()', () => {
  it('calls window.winraid.remote.list and returns entries', async () => {
    const entries = await remoteFS.list('conn1', '/photos')
    expect(window.winraid.remote.list).toHaveBeenCalledWith('conn1', '/photos')
    expect(entries).toEqual([{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }])
  })

  it('returns cached result without firing IPC again', async () => {
    await remoteFS.list('conn1', '/photos')
    await remoteFS.list('conn1', '/photos')
    expect(window.winraid.remote.list).toHaveBeenCalledTimes(1)
  })

  it('deduplicates in-flight requests', async () => {
    const [a, b] = await Promise.all([
      remoteFS.list('conn1', '/photos'),
      remoteFS.list('conn1', '/photos'),
    ])
    expect(window.winraid.remote.list).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)  // same array reference
  })

  it('notifies subscribers after populating cache', async () => {
    const listener = vi.fn()
    remoteFS.subscribe(listener)
    await remoteFS.list('conn1', '/photos')
    expect(listener).toHaveBeenCalled()
  })
})

describe('tree()', () => {
  it('populates cache for all paths in dirMap', async () => {
    await remoteFS.tree('conn1', '/photos')
    const snapshot = remoteFS.getSnapshot('conn1', '/photos')
    expect(snapshot).toEqual([{ name: 'b.jpg', type: 'file', size: 200, modified: 0 }])
  })

  it('notifies subscribers after populating', async () => {
    const listener = vi.fn()
    remoteFS.subscribe(listener)
    await remoteFS.tree('conn1', '/photos')
    expect(listener).toHaveBeenCalled()
  })
})

describe('getSnapshot()', () => {
  it('returns null when key not in cache', () => {
    expect(remoteFS.getSnapshot('conn1', '/missing')).toBeNull()
  })

  it('returns cached entries after list()', async () => {
    await remoteFS.list('conn1', '/photos')
    expect(remoteFS.getSnapshot('conn1', '/photos')).toEqual([
      { name: 'a.jpg', type: 'file', size: 100, modified: 0 },
    ])
  })

  it('returns the same array reference on repeated calls (stable reference)', async () => {
    await remoteFS.list('conn1', '/photos')
    const a = remoteFS.getSnapshot('conn1', '/photos')
    const b = remoteFS.getSnapshot('conn1', '/photos')
    expect(a).toBe(b)
  })
})

describe('update()', () => {
  it('applies updater and replaces cache entry', async () => {
    await remoteFS.list('conn1', '/photos')
    remoteFS.update('conn1', '/photos', (entries) => entries.filter((e) => e.name !== 'a.jpg'))
    expect(remoteFS.getSnapshot('conn1', '/photos')).toEqual([])
  })

  it('notifies subscribers', async () => {
    await remoteFS.list('conn1', '/photos')
    const listener = vi.fn()
    remoteFS.subscribe(listener)
    remoteFS.update('conn1', '/photos', (e) => e)
    expect(listener).toHaveBeenCalled()
  })

  it('does nothing when key not in cache', () => {
    expect(() => remoteFS.update('conn1', '/missing', (e) => e)).not.toThrow()
  })
})

describe('invalidate()', () => {
  it('removes key from cache', async () => {
    await remoteFS.list('conn1', '/photos')
    remoteFS.invalidate('conn1', '/photos')
    expect(remoteFS.getSnapshot('conn1', '/photos')).toBeNull()
  })

  it('notifies subscribers', async () => {
    const listener = vi.fn()
    remoteFS.subscribe(listener)
    remoteFS.invalidate('conn1', '/photos')
    expect(listener).toHaveBeenCalled()
  })

  it('causes next list() to fire IPC again', async () => {
    await remoteFS.list('conn1', '/photos')
    remoteFS.invalidate('conn1', '/photos')
    await remoteFS.list('conn1', '/photos')
    expect(window.winraid.remote.list).toHaveBeenCalledTimes(2)
  })
})

describe('invalidateSubtree()', () => {
  it('removes all keys under the root path', async () => {
    window.winraid.remote.list
      .mockResolvedValueOnce({ ok: true, entries: [] })
      .mockResolvedValueOnce({ ok: true, entries: [] })
    await remoteFS.list('conn1', '/photos')
    await remoteFS.list('conn1', '/photos/2024')
    remoteFS.invalidateSubtree('conn1', '/photos')
    expect(remoteFS.getSnapshot('conn1', '/photos')).toBeNull()
    expect(remoteFS.getSnapshot('conn1', '/photos/2024')).toBeNull()
  })
})

describe('invalidateConnection()', () => {
  it('removes all keys for the connection', async () => {
    await remoteFS.list('conn1', '/photos')
    await remoteFS.list('conn1', '/videos')
    remoteFS.invalidateConnection('conn1')
    expect(remoteFS.getSnapshot('conn1', '/photos')).toBeNull()
    expect(remoteFS.getSnapshot('conn1', '/videos')).toBeNull()
  })
})

describe('subscribe()', () => {
  it('returns an unsubscribe function that stops notifications', async () => {
    const listener = vi.fn()
    const unsub = remoteFS.subscribe(listener)
    unsub()
    await remoteFS.list('conn1', '/photos')
    expect(listener).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/services/remoteFS.test.js
```
Expected: FAIL — `remoteFS.js` not found.

- [ ] **Step 3: Create `src/services/remoteFS.js`**

```js
const cache     = new Map()  // `${connId}:${path}` → entries[]
const inflight  = new Map()  // `${connId}:${path}` → Promise<entries[]>
const listeners = new Set()  // Set<() => void>

function key(connId, path) {
  return `${connId}:${path}`
}

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(connId, path) {
  return cache.get(key(connId, path)) ?? null
}

export function list(connId, path) {
  const k = key(connId, path)
  const cached = cache.get(k)
  if (cached !== undefined) return Promise.resolve(cached)
  const existing = inflight.get(k)
  if (existing) return existing
  const p = window.winraid.remote.list(connId, path).then((res) => {
    inflight.delete(k)
    if (res?.ok) {
      cache.set(k, res.entries)
      notify()
      return res.entries
    }
    throw new Error(res?.error ?? 'list failed')
  }).catch((err) => {
    inflight.delete(k)
    throw err
  })
  inflight.set(k, p)
  return p
}

export function tree(connId, rootPath) {
  return window.winraid.remote.tree(connId, rootPath).then((res) => {
    if (!res?.ok && !res?.partial) return
    for (const [dirPath, entries] of Object.entries(res.dirMap ?? {})) {
      cache.set(key(connId, dirPath), entries)
    }
    notify()
  })
}

export function update(connId, path, updaterFn) {
  const k = key(connId, path)
  const current = cache.get(k)
  if (current === undefined) return
  cache.set(k, updaterFn(current))
  notify()
}

export function invalidate(connId, path) {
  const k = key(connId, path)
  cache.delete(k)
  inflight.delete(k)
  notify()
}

export function invalidateSubtree(connId, rootPath) {
  const prefix = key(connId, rootPath)
  for (const k of [...cache.keys()]) {
    if (k === prefix || k.startsWith(prefix + '/')) {
      cache.delete(k)
      inflight.delete(k)
    }
  }
  notify()
}

export function invalidateConnection(connId) {
  const prefix = `${connId}:`
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) {
      cache.delete(k)
      inflight.delete(k)
    }
  }
  notify()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/services/remoteFS.test.js
```
Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```
npx vitest run
```
Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```
git add src/services/remoteFS.js src/services/remoteFS.test.js
git commit -m "add remoteFS singleton service with list, tree, update, invalidate, subscribe"
```

---

### Task 2: Create `src/__mocks__/remoteFS.js`

**Files:**
- Create: `src/__mocks__/remoteFS.js`

**Context:** All hook tests that consume `remoteFS` need to mock it. Vitest supports manual mocks in `__mocks__/` directories. When a test calls `vi.mock('../services/remoteFS')`, Vitest will automatically use this file.

- [ ] **Step 1: Create the mock**

```js
// src/__mocks__/remoteFS.js
import { vi } from 'vitest'

export const list = vi.fn().mockResolvedValue([])
export const tree = vi.fn().mockResolvedValue(undefined)
export const update = vi.fn()
export const invalidate = vi.fn()
export const invalidateSubtree = vi.fn()
export const invalidateConnection = vi.fn()
export const getSnapshot = vi.fn().mockReturnValue(null)
export const subscribe = vi.fn().mockReturnValue(() => {})
```

- [ ] **Step 2: Verify the mock file exists and is valid JS**

```
npx vitest run --reporter=verbose 2>&1 | head -20
```
Expected: test suite runs without import errors.

- [ ] **Step 3: Commit**

```
git add src/__mocks__/remoteFS.js
git commit -m "add remoteFS vitest manual mock for hook tests"
```

---

### Task 3: Create `useRemoteDir` hook and tests

**Files:**
- Create: `src/hooks/useRemoteDir.js`
- Create: `src/hooks/useRemoteDir.test.js`

**Context:** A thin React hook that subscribes to the remoteFS cache for a specific `(connId, path)` key via `useSyncExternalStore`. Returns the current snapshot or `null`. Does NOT trigger fetches — callers do that via `remoteFS.list()` in their own effects.

- [ ] **Step 1: Write failing test**

Create `src/hooks/useRemoteDir.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRemoteDir } from './useRemoteDir'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

beforeEach(() => {
  vi.clearAllMocks()
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
})

describe('useRemoteDir', () => {
  it('returns null when cache is empty', () => {
    const { result } = renderHook(() => useRemoteDir('conn1', '/photos'))
    expect(result.current).toBeNull()
  })

  it('returns cached entries from getSnapshot', () => {
    const entries = [{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }]
    remoteFS.getSnapshot.mockReturnValue(entries)
    const { result } = renderHook(() => useRemoteDir('conn1', '/photos'))
    expect(result.current).toBe(entries)
  })

  it('subscribes to remoteFS and unsubscribes on unmount', () => {
    const unsub = vi.fn()
    remoteFS.subscribe.mockReturnValue(unsub)
    const { unmount } = renderHook(() => useRemoteDir('conn1', '/photos'))
    expect(remoteFS.subscribe).toHaveBeenCalled()
    unmount()
    expect(unsub).toHaveBeenCalled()
  })

  it('re-renders when remoteFS notifies', () => {
    let notifyFn
    remoteFS.subscribe.mockImplementation((fn) => {
      notifyFn = fn
      return () => {}
    })
    const entries = [{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }]
    remoteFS.getSnapshot.mockReturnValue(null)
    const { result } = renderHook(() => useRemoteDir('conn1', '/photos'))
    expect(result.current).toBeNull()
    remoteFS.getSnapshot.mockReturnValue(entries)
    act(() => notifyFn())
    expect(result.current).toBe(entries)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/hooks/useRemoteDir.test.js
```
Expected: FAIL — `useRemoteDir.js` not found.

- [ ] **Step 3: Create `src/hooks/useRemoteDir.js`**

```js
import { useSyncExternalStore } from 'react'
import * as remoteFS from '../services/remoteFS'

export function useRemoteDir(connId, path) {
  return useSyncExternalStore(
    remoteFS.subscribe,
    () => remoteFS.getSnapshot(connId, path),
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/hooks/useRemoteDir.test.js
```
Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```
npx vitest run
```
Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```
git add src/hooks/useRemoteDir.js src/hooks/useRemoteDir.test.js
git commit -m "add useRemoteDir hook via useSyncExternalStore wrapping remoteFS singleton"
```

---

### Task 4: Refactor `useBrowse` fetch logic to use remoteFS

**Files:**
- Modify: `src/hooks/useBrowse.js`

**Context:** Replace `dirCache` (a `useRef(new Map())`) and all direct `window.winraid?.remote.list/tree` calls in `fetchDir` and the tree-preload effect with `remoteFS.list()`, `remoteFS.tree()`, and `remoteFS.getSnapshot()`. Cache modes (`stale`/`tree`/`none`) stay as policy here — the service has no concept of modes.

The `dirCache` ref is removed. The `fetchDir` callback shrinks significantly because cache population is handled by the service.

- [ ] **Step 1: Write failing tests for the refactored fetchDir**

Create `src/hooks/useBrowse.fetchDir.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBrowse } from './useBrowse'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

function makeConnections(type = 'sftp') {
  return [{
    id: 'conn1', name: 'NAS', type, icon: 'server',
    localFolder: 'C:\\sync', operation: 'copy', folderMode: 'mirror',
    extensions: [],
    sftp: { host: 'nas.local', port: 22, username: 'user', password: '', keyPath: '', remotePath: '/media' },
    smb: { host: '', share: '', username: '', password: '', remotePath: '' },
  }]
}

beforeEach(() => {
  vi.clearAllMocks()
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
  remoteFS.list.mockResolvedValue([{ name: 'a.jpg', type: 'file', size: 100, modified: 0 }])
  window.winraid = {
    config: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      verifyClean: vi.fn().mockResolvedValue({ ok: true, clean: true }),
    },
    watcher: { list: vi.fn().mockResolvedValue({}) },
    queue: {
      list: vi.fn().mockResolvedValue([]),
      onUpdated: vi.fn().mockReturnValue(() => {}),
      onProgress: vi.fn().mockReturnValue(() => {}),
    },
  }
})

describe('useBrowse fetchDir — mode none', () => {
  it('calls remoteFS.list and sets entries', async () => {
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: makeConnections(), connectionId: 'conn1' })
    )
    await waitFor(() => expect(remoteFS.list).toHaveBeenCalledWith('conn1', '/'))
  })
})

describe('useBrowse fetchDir — mode stale', () => {
  it('returns cached snapshot immediately and fires background refresh', async () => {
    const cached = [{ name: 'cached.jpg', type: 'file', size: 0, modified: 0 }]
    remoteFS.getSnapshot.mockReturnValue(cached)
    window.winraid.config.get.mockResolvedValue({ cacheMode: 'stale' })
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: makeConnections(), connectionId: 'conn1' })
    )
    await waitFor(() => expect(result.current.entries).toEqual(cached))
    // Background refresh should still fire
    await waitFor(() => expect(remoteFS.list).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/hooks/useBrowse.fetchDir.test.js
```
Expected: FAIL — `useBrowse` still calls `window.winraid.remote.list` directly.

- [ ] **Step 3: Refactor `fetchDir` in `useBrowse.js`**

Add import at the top of `src/hooks/useBrowse.js`:

```js
import * as remoteFS from '../services/remoteFS'
```

Remove `dirCache` ref (line 52: `const dirCache = useRef(new Map())`).

Replace the entire `fetchDir` callback (lines 223–269) with:

```js
const fetchDir = useCallback(async (targetPath) => {
  if (!selectedId) return
  const mode = cacheModeRef.current

  if (mode === 'stale') {
    const cached = remoteFS.getSnapshot(selectedId, targetPath)
    if (cached) {
      setEntries(cached)
      setError('')
      setLoading(false)
      // Background refresh — don't block or show loading
      remoteFS.invalidate(selectedId, targetPath)
      remoteFS.list(selectedId, targetPath).then((entries) => {
        setEntries(entries)
      }).catch(() => {})
      return
    }
  } else if (mode === 'tree') {
    const cached = remoteFS.getSnapshot(selectedId, targetPath)
    if (cached) {
      setEntries(cached)
      setError('')
      setLoading(false)
      setStatus(null)
      return
    }
    // cache miss — fall through to single-dir fetch
  }

  // 'none' mode, or cache miss
  setLoading(true)
  setError('')
  setStatus(null)
  try {
    const entries = await remoteFS.list(selectedId, targetPath)
    setLoading(false)
    setEntries(entries)
  } catch (err) {
    setLoading(false)
    setError(err.message || 'Failed to list directory')
    setEntries([])
  }
}, [selectedId])
```

Replace the tree-preload effect (lines 277–288) with:

```js
useEffect(() => {
  if (!selectedId || cacheModeRef.current !== 'tree') return
  const conn = connections.find((c) => c.id === selectedId)
  if (conn?.type !== 'sftp' || !conn?.sftp?.remotePath) return
  const rootPath = conn.sftp.remotePath.replace(/\/+$/, '') || '/'
  remoteFS.tree(selectedId, rootPath).catch(() => {})
}, [selectedId, connections])
```

- [ ] **Step 4: Run tests**

```
npx vitest run src/hooks/useBrowse.fetchDir.test.js
```
Expected: PASS.

- [ ] **Step 5: Run full test suite**

```
npx vitest run
```
Expected: all tests PASS. If any existing useBrowse tests fail because they set `dirCache.current` directly, update them to use `remoteFS.getSnapshot.mockReturnValue(...)` instead.

- [ ] **Step 6: Commit**

```
git add src/hooks/useBrowse.js src/hooks/useBrowse.fetchDir.test.js
git commit -m "refactor useBrowse fetchDir to use remoteFS singleton instead of internal dirCache"
```

---

### Task 5: Refactor `useBrowse` mutation handlers to use remoteFS

**Files:**
- Modify: `src/hooks/useBrowse.js` (mutation handlers)

**Context:** `handleDelete`, `handleMove`, `handleCreateFolder`, and the bulk equivalents all update `dirCache.current` directly with splice logic. Replace those with `remoteFS.update()` for optimistic mutations and `remoteFS.invalidate()` for refetch fallbacks. The `cacheMutRef` policy (`update` vs `none`) stays here.

- [ ] **Step 1: Write failing tests for mutation handlers**

Create `src/hooks/useBrowse.mutations.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBrowse } from './useBrowse'

vi.mock('../services/remoteFS')
import * as remoteFS from '../services/remoteFS'

const CONNECTIONS = [{
  id: 'conn1', name: 'NAS', type: 'sftp', icon: 'server',
  localFolder: 'C:\\sync', operation: 'copy', folderMode: 'mirror', extensions: [],
  sftp: { host: 'nas.local', port: 22, username: 'user', password: '', keyPath: '', remotePath: '/media' },
  smb: { host: '', share: '', username: '', password: '', remotePath: '' },
}]

beforeEach(() => {
  vi.clearAllMocks()
  remoteFS.getSnapshot.mockReturnValue(null)
  remoteFS.subscribe.mockReturnValue(() => {})
  remoteFS.list.mockResolvedValue([])
  window.winraid = {
    config: { get: vi.fn().mockResolvedValue({ cacheMutation: 'update' }), set: vi.fn() },
    remote: {
      list: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
      move: vi.fn().mockResolvedValue({ ok: true }),
      mkdir: vi.fn().mockResolvedValue({ ok: true }),
      onDownloadProgress: vi.fn().mockReturnValue(() => {}),
      verifyClean: vi.fn().mockResolvedValue({ ok: true, clean: true }),
    },
    watcher: { list: vi.fn().mockResolvedValue({}) },
    queue: {
      list: vi.fn().mockResolvedValue([]),
      onUpdated: vi.fn().mockReturnValue(() => {}),
      onProgress: vi.fn().mockReturnValue(() => {}),
    },
  }
})

describe('handleDelete', () => {
  it('calls remoteFS.update to remove the deleted entry from cache', async () => {
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => !result.current.loading)
    act(() => result.current.setDeleteTarget({ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }))
    await act(() => result.current.handleDelete({ name: 'photo.jpg', path: '/media/photo.jpg', isDir: false }))
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })
})

describe('handleCreateFolder', () => {
  it('calls remoteFS.update to add the new folder to cache', async () => {
    const { result } = renderHook(() =>
      useBrowse({ connectionsProp: CONNECTIONS, connectionId: 'conn1' })
    )
    await waitFor(() => !result.current.loading)
    act(() => result.current.setNewFolderName('NewAlbum'))
    await act(() => result.current.handleCreateFolder())
    expect(remoteFS.update).toHaveBeenCalledWith('conn1', expect.any(String), expect.any(Function))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/hooks/useBrowse.mutations.test.js
```
Expected: FAIL — handlers still write to `dirCache.current`.

- [ ] **Step 3: Update `handleDelete` in `useBrowse.js`**

Replace the `dirCache` mutation block inside `handleDelete` (lines 410–412) with:

```js
if (res?.ok) {
  if (cacheMutRef.current === 'update') {
    remoteFS.update(selectedId, path, (entries) => entries.filter((e) => e.name !== target.name))
  } else {
    remoteFS.invalidate(selectedId, path)
  }
  setEntries((prev) => prev.filter((e) => e.name !== target.name))
  setStatus({ ok: true, msg: `Deleted ${target.path}` })
} else {
  remoteFS.invalidate(selectedId, path)
  setStatus({ ok: false, msg: res?.error || 'Delete failed' })
  fetchDir(path)
}
```

- [ ] **Step 4: Update `handleMove` in `useBrowse.js`**

Replace the `dirCache` mutation block inside `handleMove` (lines 432–457) with:

```js
if (res?.ok) {
  if (cacheMutRef.current === 'update') {
    const srcName    = srcPath.split('/').at(-1)
    const dstName    = dstPath.split('/').at(-1)
    const dstDir     = dstPath.split('/').slice(0, -1).join('/') || '/'
    const movedEntry = entriesRef.current.find((e) => e.name === srcName)
    remoteFS.update(selectedId, path, (entries) => entries.filter((e) => e.name !== srcName))
    setEntries((prev) => prev.filter((e) => e.name !== srcName))
    if (movedEntry) {
      remoteFS.update(selectedId, dstDir, (entries) => {
        const updated = [...entries, { ...movedEntry, name: dstName }]
        return updated.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      })
    }
    setStatus({ ok: true, msg: `Moved to ${dstPath}` })
  } else {
    remoteFS.invalidate(selectedId, path)
    await fetchDir(path)
    setStatus({ ok: true, msg: `Moved to ${dstPath}` })
  }
} else {
  remoteFS.invalidate(selectedId, path)
  await fetchDir(path)
  setStatus({ ok: false, msg: res?.error || 'Move failed' })
}
```

- [ ] **Step 5: Update `handleCreateFolder` in `useBrowse.js`**

Replace the `dirCache` mutation block inside `handleCreateFolder` (lines 475–487) with:

```js
if (res?.ok) {
  setHighlightFile(name)
  if (cacheMutRef.current === 'update') {
    const newEntry = { name, type: 'dir', size: 0, modified: Date.now() }
    const splice = (arr) => [...arr, newEntry].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    setEntries((prev) => splice(prev))
    remoteFS.update(selectedId, path, splice)
  } else {
    remoteFS.invalidate(selectedId, path)
    await fetchDir(path)
  }
  setStatus({ ok: true, msg: `Created folder ${name}` })
```

- [ ] **Step 6: Update bulk handlers**

In `handleBulkDelete` and `handleBulkMove`, replace any `dirCache.current.set(...)` calls with `remoteFS.update(...)` or `remoteFS.invalidate(...)` following the same pattern as the single handlers above.

Search for any remaining `dirCache.current` references:

```
grep -n "dirCache" src/hooks/useBrowse.js
```
Expected: zero matches after this step.

- [ ] **Step 7: Run tests**

```
npx vitest run src/hooks/useBrowse.mutations.test.js
```
Expected: all tests PASS.

- [ ] **Step 8: Run full test suite**

```
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```
git add src/hooks/useBrowse.js src/hooks/useBrowse.mutations.test.js
git commit -m "refactor useBrowse mutation handlers to use remoteFS.update and remoteFS.invalidate"
```

---

### Task 6: Final verification

**Files:** None — verification only.

- [ ] **Step 1: Confirm `dirCache` is fully removed**

```
grep -rn "dirCache" src/
```
Expected: zero matches.

- [ ] **Step 2: Confirm no direct `remote.list` or `remote.tree` calls remain in `useBrowse.js`**

```
grep -n "remote\.list\|remote\.tree" src/hooks/useBrowse.js
```
Expected: zero matches.

- [ ] **Step 3: Run full test suite**

```
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 4: Run lint**

```
npm run lint
```
Expected: no errors.

- [ ] **Step 5: Confirm the new files are all committed**

```
git log --oneline -6
```
Expected (5 commits from this plan):
```
refactor useBrowse mutation handlers to use remoteFS.update and remoteFS.invalidate
refactor useBrowse fetchDir to use remoteFS singleton instead of internal dirCache
add useRemoteDir hook via useSyncExternalStore wrapping remoteFS singleton
add remoteFS vitest manual mock for hook tests
add remoteFS singleton service with list, tree, update, invalidate, subscribe
```
