# WinRaid — Project Context for Claude

## What is this?

WinRaid is a Windows desktop app for multi-connection homelab file sync.
It watches multiple local folders (one per connection) and automatically
pushes files to NAS devices via SFTP/SMB. Each connection can also browse
its remote filesystem and pull folders back down as a local backup.

## Stack

- **Electron** — main process, IPC, native dialogs, system tray
- **React + Vite** (electron-vite) — renderer UI
- **Zustand** — state management (planned, replacing lifted state in App.jsx)
- **CSS Modules** — scoped styles, design-token variables in `src/styles/tokens.css`
- **chokidar** — filesystem watcher
- **ssh2** — SFTP/SSH backend
- **lucide-react** — icons

## Project structure

```
winraid/
├── electron/
│   ├── main.js          # Main process — IPC handlers, watcher/queue wiring, backup handler
│   ├── preload.js       # contextBridge API exposed to renderer (window.winraid)
│   ├── watcher.js       # File watcher (chokidar + debounce + stability polling)
│   ├── queue.js         # Transfer job queue (PENDING→TRANSFERRING→DONE/ERROR), persisted to queue.json
│   ├── worker.js        # Transfer worker, backend factory, polling-based executor
│   ├── logger.js        # Dated log files + log:entry IPC push to renderer
│   ├── config.js        # JSON config persistence (%APPDATA%\WinRaid\config.json), safeStorage encryption
│   └── backends/
│       ├── sftp.js      # SFTP upload backend (ssh2), ad-hoc connections
│       └── smb.js       # SMB/local copy backend (stream-based)
├── src/
│   ├── App.jsx          # Root — view routing, shared state
│   ├── views/
│   │   ├── DashboardView.jsx    # System health, bento grid, recent activity
│   │   ├── QueueView.jsx        # Transfer queue list (filterable by connection)
│   │   ├── BrowseView.jsx       # Remote NAS browser with file ops
│   │   ├── BackupView.jsx       # NAS→local backup config + run status
│   │   ├── ConnectionView.jsx   # New/edit connection form
│   │   ├── SettingsView.jsx     # Global watcher + app settings
│   │   └── LogView.jsx          # Live log tail
│   ├── components/
│   │   ├── Sidebar.jsx          # Nav with connection list + global views
│   │   ├── StatusBar.jsx        # Aggregate watcher state + active transfers
│   │   ├── RemotePathBrowser.jsx # Modal SFTP directory browser
│   │   ├── EditorModal.jsx      # CodeMirror file editor
│   │   └── ui/
│   │       ├── Button.jsx
│   │       └── Tooltip.jsx      # Portal tooltip
│   └── styles/
│       └── tokens.css           # Design tokens (dark/light themes)
├── assets/
│   └── winraid_icon.ico
├── electron-builder.yml
└── package.json
```

## Architecture notes

- IPC follows `ipcMain.handle` / `ipcRenderer.invoke` pattern; all renderer API goes through `contextBridge` in `preload.js`
- Connections are stored as an array in config; each connection owns its localFolder, remotePath, operation mode, and extension filters
- Watcher emits three states to renderer: `watching`, `enqueueing` (file detected, stabilising), stopped
- `logger.js` writes to dated file under `%APPDATA%\WinRaid\logs\` and pushes `log:entry` to renderer
- Queue persists to `queue.json` with atomic writes; stuck TRANSFERRING jobs reset to PENDING on load
- Worker polls queue at 800ms intervals; backend factory selects SFTP or SMB per connection type
- Incremental backup skip: mtime + size match (2s tolerance for filesystem rounding)

## Multi-connection architecture (target)

### Core changes
- **WatcherManager**: `Map<connectionId, WatcherInstance>` — each connection has its own chokidar instance, debounce map, pause state
- **Queue jobs**: each job carries a `connectionId` field for routing and filtering
- **Worker**: reads `job.connectionId` to look up connection config and build the correct backend; supports per-connection concurrency
- **ConnectionPool**: reusable SSH/SFTP connections keyed by connectionId with idle timeout (30s)
- **Config**: top-level `localFolder`/`operation`/`folderMode`/`extensions` removed — these live inside each connection object

### IPC changes for multi-connection
- `watcher:start(connId)` / `watcher:stop(connId)` — per-connection control
- `watcher:status` emits `{ connectionId, state, file }`
- `queue:list(connId?)` — optional connection filter
- `backup:run` accepts connectionId

### UI changes
- Sidebar: collapsible connection list with status indicators, global views below
- ConnectionDashboard: per-connection view with tabs (overview, browse, backup, settings)
- QueueView: connection filter dropdown
- StatusBar: aggregate status across all connections
- Zustand store replaces lifted App.jsx state

## Design tokens

CSS variables defined in `src/styles/tokens.css`. Dark theme default, light theme via `[data-theme="light"]`.

Key tokens:
```
--bg-base, --bg-panel, --bg-card, --bg-input
--text, --text-muted, --text-faint
--accent, --accent-subtle
--border, --border-input, --border-strong
--success, --warning, --error, --success-subtle, --error-subtle
--radius-xs/sm/md/lg/xl, --space-1…12, --font-size-xs…2xl
```

## Code conventions

- `master` branch
- No emojis in code or comments
- POSIX paths for remote (normalized in SFTP backend)
- Credentials encrypted via `safeStorage` with `enc:` prefix

## Implementation roadmap

### Phase 1 — Multi-connection core (backend)
1. Refactor `watcher.js` to WatcherManager (Map-based, per-connection instances)
2. Add `connectionId` to queue jobs
3. Update worker to route jobs by `job.connectionId`
4. Update IPC channels in main.js and preload.js
5. Config schema migration (move top-level fields into connections)

### Phase 2 — Multi-connection UI
6. Introduce Zustand store (connections, watchers, queue, backupRuns)
7. Redesign Sidebar with connection list + status dots
8. Build ConnectionDashboard view (tabs: overview, browse, backup, settings)
9. Update QueueView with connection filter
10. Update StatusBar for aggregate state

### Phase 3 — Stability
11. Retry logic with exponential backoff (3 retries, 2s/8s/32s)
12. Connection pooling (ConnectionPool class with idle timeout)
13. Per-connection transfer concurrency (semaphore per connectionId)
14. Async `calcDirSize` (replace readdirSync/statSync)
15. Fix `activeTransfers` — derive count from actual TRANSFERRING jobs

### Phase 4 — Polish
16. Global settings view (theme, notifications, auto-start, updates)
17. Onboarding wizard / empty states
18. View transitions and animations
19. Toast notification system
20. Keyboard shortcuts

## Security (completed)

- [x] Credentials encrypted on disk via Electron `safeStorage` (DPAPI on Windows) — `enc:` prefix
- [x] Path traversal blocked in `backup:run` — resolved path validated against `resolve(localDest) + sep`
- [x] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`

## Running locally

```bash
npm install
npm run dev
```

## Building

```bash
npm run build
# output: release\WinRaid-Setup.exe
```
