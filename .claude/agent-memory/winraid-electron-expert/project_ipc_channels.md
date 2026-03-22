---
name: IPC channel contracts
description: All known IPC channels in WinRaid with their payload shapes and process boundaries
type: project
---

## Established channels (preload.js contextBridge -> main.js handlers)

### watcher:start (updated 2026-03-19 — multi-connection)
- Preload: `start: (connectionId) => ipcRenderer.invoke('watcher:start', connectionId)`
- Handler: looks up connection from config by connectionId, validates localFolder exists, starts watcher. Returns `{ ok, error? }`
- Response: sends `watcher:status` push with full states map after start

### watcher:stop (updated 2026-03-19)
- Preload: `stop: (connectionId) => ipcRenderer.invoke('watcher:stop', connectionId)`
- Handler: stops and removes that connection's watcher from the map. Sends updated full states map.

### watcher:list (added 2026-03-19)
- Preload: `list: () => ipcRenderer.invoke('watcher:list')`
- Returns: `Record<connectionId, { watching, folder, state, file }>` — the full watcher state map
- Used by App.jsx on mount to initialise watcherStatus state

### watcher:pause-all (added 2026-03-19)
- Preload: `pauseAll: () => ipcRenderer.invoke('watcher:pause-all')`
- Handler: captures currently-watching connectionIds into `_watchingBeforePause`, calls `stopAllWatchers()`, stops worker, sends updated map.
- This is the global kill switch (tray menu and future UI controls).

### watcher:resume-all (added 2026-03-19)
- Preload: `resumeAll: () => ipcRenderer.invoke('watcher:resume-all')`
- Handler: restarts all connections in `_watchingBeforePause`, clears the set, restarts worker, sends updated map.

### watcher:status event payload shape (updated 2026-03-19)
`Record<connectionId, { watching: boolean, folder: string|null, state: 'watching'|'enqueueing'|null, file: string|null }>`
- Always the FULL map — no longer per-connection partial updates.
- App.jsx replaces entire watcherStatus state on each push.

### queue:cancel (added 2026-03-18)
- Preload: `cancel: (jobId) => ipcRenderer.invoke('queue:cancel', jobId)`
- Handler: finds job by id; if PENDING, sets ERROR then removes (sends `removed` event); if TRANSFERRING, sets ERROR with "Cancelled" message (sends `updated` event); returns `{ ok, error? }`
- Note: TRANSFERRING cancel is best-effort — no active stream abort mechanism exists yet

### queue:enqueue-batch (updated 2026-03-19)
- Preload: `enqueueBatch: (connectionId, localFolder, relPaths) => ipcRenderer.invoke('queue:enqueue-batch', connectionId, localFolder, relPaths)`
- Handler: looks up connection by connectionId, uses conn.folderMode and conn.operation (not top-level cfg)
- Used by ConnectionView VerifyResultDialog "Enqueue" action

### queue:updated event payload shape
`{ type: 'added'|'updated'|'retry'|'cleared'|'removed', jobId?, job? }`
- `updated`: carries full `job` object with current status
- `removed`: carries `jobId`
- `cleared`: no extra fields (all DONE jobs removed)
- `retry`: carries `jobId`
- `added`: carries `jobId`

### transfer:progress event payload shape
`{ jobId, percent, bytesTransferred, totalBytes }`

**Why:** Needed for App.jsx activeTransfers counter and QueueView live updates.
**How to apply:** When adding new queue operations, always send the appropriate `queue:updated` type and include the full `job` object for `updated` events so the renderer can optimistically update without a full list refresh.

## Multi-connection architecture decisions (2026-03-19)

### Job schema: connectionId field added
`queue.js enqueue()` now stores `connectionId` on each job. `hasActiveJob(srcPath, connectionId)` filters on both fields.

### Watcher manager: Map<connectionId, WatcherInstance>
Each instance owns: `{ watcher, folder, paused, onFileReady, statusCb, inFlight, currentFile, debounceMap, isInitialPhase }`.
`statusCb` receives the full `listWatcherStates()` map on every state change so main.js can broadcast it uniformly.

### Global pause state: _watchingBeforePause
Module-level `Set<connectionId>` in main.js. Populated on pause-all, consumed and cleared on resume-all. Tray menu duplicates this logic (not delegated to IPC handler) to avoid circular patterns.

### Tray menu: global syncing toggle
Label: "Pause syncing" when not paused, "Resume syncing" when paused. Stops/restarts all watchers and the worker. No per-watcher controls in tray.

### Connection overlap validation
Done in ConnectionView.jsx `handleSave()` — client-side, reads current connections from config, normalises backslashes, checks parent/child overlap. Shows error inline in Source section.
