# Remote FS Unified Service — Design Spec

**Goal:** Extract the directory listing cache out of `useBrowse` into a shared singleton service so that Browse, the upcoming PlayOverlay, and any future feature share a single cache and a clean API — eliminating redundant SFTP trips and inconsistent direct calls to `window.winraid.remote.*`.

**Architecture:** New `src/services/remoteFS.js` singleton. Refactored `src/hooks/useBrowse.js` consumes it. New `src/hooks/useRemoteDir.js` React hook wraps it via `useSyncExternalStore`. SizeView is out of scope (different data type).

**Tech Stack:** React 18, Vite, Vitest + @testing-library/react + happy-dom. Depends on Spec A being merged first (portability fixes stabilise the IPC layer this service wraps).

**Prerequisites:** Spec A (remote-fs-reliability) merged and green.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/services/remoteFS.js` | Create | Singleton cache: list, tree, update, invalidate, subscribe |
| `src/hooks/useRemoteDir.js` | Create | React hook wrapping remoteFS via useSyncExternalStore |
| `src/hooks/useBrowse.js` | Modify | Replace direct `window.winraid.remote.list/tree` calls with remoteFS; move cache mutation logic to remoteFS.update/invalidate |
| `src/__mocks__/remoteFS.js` | Create | Vitest mock for the service |

---

## `src/services/remoteFS.js`

Module-level singleton. Not React state — survives remounts and is shared across all hook instances.

### Internal state

```js
const cache    = new Map()   // key: `${connId}:${path}` → entries[]
const inflight = new Map()   // key: `${connId}:${path}` → Promise<entries[]>
const listeners = new Set()  // Set<() => void>
```

### API

**`list(connId, path): Promise<entries[]>`**
- If `cache` has the key: return `Promise.resolve(cached)`
- If `inflight` has the key: return the existing promise (deduplication)
- Otherwise: fire `window.winraid.remote.list(connId, path)`, store in `inflight`, on resolve populate `cache`, delete from `inflight`, call `notify()`, return entries
- On error: delete from `inflight`, rethrow

**`tree(connId, rootPath): Promise<void>`**
- Calls `window.winraid.remote.tree(connId, rootPath)`
- On resolve: for each `[path, entries]` in `res.dirMap`, set `cache.set(key, entries)`
- Calls `notify()` once after all entries are populated
- SFTP-only guard stays at the call site in `useBrowse` (not inside the service)

**`update(connId, path, updaterFn): void`**
- Synchronously applies `updaterFn` to the cached entries array for `key`
- Replaces the array with a new array (no mutation): `cache.set(key, updaterFn(cache.get(key) ?? []))`
- Calls `notify()`
- Used by `useBrowse` mutation handlers (delete, move, mkdir) for optimistic UI

**`invalidate(connId, path): void`**
- Deletes `cache.get(key)` and `inflight.get(key)`
- Calls `notify()`

**`invalidateSubtree(connId, rootPath): void`**
- Deletes all cache and inflight keys where key starts with `${connId}:${rootPath}`
- Calls `notify()`

**`invalidateConnection(connId): void`**
- Deletes all cache and inflight keys for a given `connId`
- Called when a connection is removed or its config changes
- Calls `notify()`

**`getSnapshot(connId, path): entries[] | null`**
- Returns `cache.get(key) ?? null`
- Must return a stable reference when data hasn't changed (same array object)

**`subscribe(listener: () => void): () => void`**
- Adds `listener` to `listeners`
- Returns an unsubscribe function: `() => listeners.delete(listener)`

**`notify(): void`** (internal)
- Calls every listener synchronously

---

## `src/hooks/useRemoteDir.js`

```js
import { useSyncExternalStore } from 'react'
import * as remoteFS from '../services/remoteFS'

export function useRemoteDir(connId, path) {
  const entries = useSyncExternalStore(
    remoteFS.subscribe,
    () => remoteFS.getSnapshot(connId, path),
  )
  return entries
}
```

Simple read hook. Consumers that need to trigger fetches call `remoteFS.list()` directly in effects. This hook only subscribes to cache state.

---

## `src/hooks/useBrowse.js` changes

Replace all direct `window.winraid.remote.list(...)` and `window.winraid.remote.tree(...)` calls with `remoteFS.list()` and `remoteFS.tree()`.

### Cache mode policy stays in useBrowse

The three modes (`stale`, `tree`, `none`) remain as consumer policy in `useBrowse`:
- `'stale'`: call `remoteFS.getSnapshot()` first; if hit, return immediately and fire `remoteFS.list()` in the background to refresh
- `'tree'`: on mount, call `remoteFS.tree()` to warm the entire cache; subsequent navigations call `remoteFS.list()` which will hit the cache
- `'none'`: call `remoteFS.invalidate()` then `remoteFS.list()` every time

### Mutation handlers

Replace in-place `dirCache.current.set(...)` splice logic with `remoteFS.update()`:

```js
// After successful delete:
remoteFS.update(connId, path, (entries) => entries.filter(e => e.name !== deletedName))

// After successful mkdir:
remoteFS.update(connId, path, (entries) => [...entries, newDirEntry])

// After successful move:
remoteFS.invalidate(connId, srcParent)
remoteFS.invalidate(connId, dstParent)
```

Call `invalidate()`/`update()` synchronously in the same `.then()` handler as the mutation result — no `await` between mutation completion and cache invalidation.

### SFTP-only guard

The `remote:tree` call is wrapped with:
```js
if (conn?.type !== 'sftp') return
```
This guard stays in `useBrowse`, not in `remoteFS.tree()`.

---

## Cache modes interaction with remoteFS

| Mode | On navigate | On mount |
|---|---|---|
| `none` | `invalidate()` + `list()` | same |
| `stale` | `getSnapshot()` → return cached; `list()` in background | `list()` |
| `tree` | `list()` → cache hit (instant) | `tree()` to warm all paths |

---

## `src/__mocks__/remoteFS.js`

Vitest manual mock. Allows tests to control cache state directly without IPC:

```js
import { vi } from 'vitest'

export const list = vi.fn()
export const tree = vi.fn()
export const update = vi.fn()
export const invalidate = vi.fn()
export const invalidateSubtree = vi.fn()
export const invalidateConnection = vi.fn()
export const getSnapshot = vi.fn(() => null)
export const subscribe = vi.fn(() => () => {})
```

---

## Testing approach

### `remoteFS.js` unit tests (`src/services/remoteFS.test.js`)

- `list()` cache hit: call list twice with same key, assert `window.winraid.remote.list` called once
- `list()` inflight dedup: fire two concurrent list calls, assert only one IPC call
- `list()` populates cache: after list resolves, `getSnapshot()` returns entries
- `update()` applies transform: mutates cache key, notifies listeners
- `invalidate()` clears entry and notifies
- `invalidateSubtree()` removes all keys under path
- `subscribe()` / `notify()`: listener called after list resolves
- `getSnapshot()` stable reference: same object returned if cache unchanged

### `useBrowse.js` tests (update existing)

- Existing tests must pass without change after refactor (use `__mocks__/remoteFS.js`)
- Add: stale mode fires background refresh via `remoteFS.list()`
- Add: mutation handlers call `remoteFS.update()` not direct cache write

### `useRemoteDir.js` tests

- Renders with `null` when no cache entry
- Re-renders when `remoteFS.notify()` is called with new data for the subscribed key

---

## What is NOT in scope

- SizeView integration (different data type — `du -sk` disk usage)
- PlayOverlay (Spec C, depends on this spec)
- Splitting `main.js`
- Main-process cache (not needed — renderer inflight dedup is sufficient)
