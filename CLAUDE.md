# WinRaid

Windows desktop app for homelab file sync. Watches local folders and pushes files to NAS devices over SFTP or SMB. Also provides a remote file browser, NAS→local backup, transfer queue, and log viewer.

## Stack

| | |
|---|---|
| Desktop shell | Electron 37 |
| Renderer | React 18 + Vite (electron-vite) |
| Styling | CSS Modules + `src/styles/tokens.css` |
| Virtualization | `@tanstack/react-virtual` v3 |
| Table | `@tanstack/react-table` v8 |
| Icons | lucide-react |
| SSH/SFTP | ssh2 |
| File watching | chokidar v4 |
| Testing | Vitest + @testing-library/react + happy-dom |

## Project structure

```
winraid/
├── electron/
│   ├── main.js          # IPC handlers, SFTP pool, nas-stream:// protocol, backup, tray, auto-updater (~2250 lines)
│   ├── preload.js       # contextBridge — exposes window.winraid to renderer
│   ├── config.js        # JSON config at %APPDATA%\WinRaid\config.json
│   ├── queue.js         # Job queue persisted to queue.json; atomic writes
│   ├── worker.js        # Serial job processor — dequeues and calls backend
│   ├── watcher.js       # WatcherManager — Map<connId, WatcherInstance> with chokidar
│   ├── logger.js        # Dated log files + IPC push to renderer
│   └── backends/
│       ├── sftp.js      # SFTP transfer, mkdirp, openRemoteChecker
│       └── smb.js       # SMB/UNC copy backend
├── src/
│   ├── App.jsx          # Root: view routing, shared state, IPC subscriptions
│   ├── hooks/
│   │   ├── useBrowse.js         # Browse state + handlers; composes useSelection + useDragDrop
│   │   ├── useSelection.js      # Pointer/rubber-band selection, Shift/Ctrl/plain click
│   │   ├── useDragDrop.js       # Multi-file drag, stacked ghost, dwell-timer, move ops
│   │   ├── useVirtualizers.js   # useGridVirtualizer + useListVirtualizer
│   │   └── useNavHistory.js     # useRef-based back/forward history stack
│   ├── views/
│   │   ├── BrowseView.jsx       # Shell: modals, header, breadcrumb
│   │   ├── BrowseList.jsx       # List virtualizer view
│   │   ├── BrowseGrid.jsx       # Grid virtualizer view with rubber-band lasso
│   │   ├── SizeView.jsx         # Recursive folder-size scan + sunburst visualization
│   │   ├── QueueView.jsx        # TanStack Table with column resizing
│   │   ├── DashboardView.jsx
│   │   ├── BackupView.jsx
│   │   ├── ConnectionView.jsx
│   │   ├── SettingsView.jsx
│   │   └── LogView.jsx
│   ├── components/
│   │   ├── browse/
│   │   │   ├── GridCard.jsx         # React.memo grid card
│   │   │   ├── BrowseListRow.jsx    # React.memo list row
│   │   │   ├── EntryMenu.jsx        # 3-dot context menu, position:fixed dropdown
│   │   │   ├── Thumbnail.jsx        # Image/video preview with error fallback
│   │   │   ├── VideoThumb.jsx       # IntersectionObserver lazy video
│   │   │   └── NewFolderPrompt.jsx  # Inline new-folder input, list/grid variants
│   │   ├── size/
│   │   │   └── SizeSunburst.jsx     # D3 treemap sunburst with drill-down
│   │   ├── modals/
│   │   │   ├── DeleteModal.jsx / MoveModal.jsx / ConfirmModal.jsx
│   │   │   └── BulkDeleteModal.jsx / BulkMoveModal.jsx
│   │   ├── QuickLookOverlay.jsx     # Full-screen preview: image/video/audio/text
│   │   ├── EditorModal.jsx          # CodeMirror remote file editor
│   │   ├── TabBar.jsx               # Multi-connection tab switcher
│   │   ├── ConnectionIcon.jsx       # Icon picker for connections
│   │   ├── Sidebar.jsx / Header.jsx / StatusBar.jsx
│   │   ├── RemotePathBrowser.jsx / ConnectionModal.jsx / IconPicker.jsx
│   │   └── ui/
│   │       └── Tooltip / Button / Badge / ProgressBar / AnimatedText
│   ├── utils/
│   │   ├── format.js        # formatSize, formatDate
│   │   └── fileTypes.js     # Extension sets, isImageFile, isVideoFile, isEditableFile, fileType
│   └── styles/
│       ├── tokens.css       # All CSS custom properties (dark + light theme)
│       ├── global.css
│       └── shimmer.css
├── assets/
├── electron-builder.yml
└── package.json
```

## Agents

Two agents are available. Many tasks touch both — see **Intertwined work** below.

### `react-expert`
Owns everything under `src/`. Component architecture, hooks, virtualization, memoization, CSS Modules, re-render analysis, and React idioms.

### `winraid-electron-expert`
Owns everything under `electron/`. IPC design, contextBridge surface, SFTP pool, watcher, queue, worker, config, security, packaging, and auto-updater.

### Intertwined work

The boundary between agents is the `window.winraid` IPC surface in `preload.js`. Tasks that cross it need both agents.

| Task type | electron-expert | react-expert |
|---|---|---|
| New feature with UI + backend | `ipcMain.handle` in `main.js`, expose via `preload.js` | Hook/component that calls `window.winraid.*` |
| Config schema change | `config.js` update, migration, IPC handler | `ConnectionView`, `SettingsView`, or `useBrowse` |
| New push event (main → renderer) | `webContents.send` + `preload.js` subscription | `useEffect` subscriber + state update |
| Queue/watcher shape change | Job or status enum change in `queue.js`/`watcher.js` | `QueueView`, `StatusBar`, `Header` consuming the new shape |

**electron-expert goes first** when a new or changed IPC channel is required. **react-expert goes first** when the change is purely in the renderer with no new IPC surface.

## IPC conventions

- Pattern: `ipcMain.handle` / `ipcRenderer.invoke` for request-response
- Push: `mainWindow.webContents.send(channel, payload)` → `ipcRenderer.on` in preload
- Naming: `noun:verb` — e.g. `queue:list`, `watcher:start`, `remote:delete`
- All renderer API exposed through `contextBridge` as `window.winraid.*`
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — never regress these
- Validate and sanitize all IPC inputs in `main.js` before acting on them

## `window.winraid` API surface

```
getVersion()
cache.thumbSize() / .clearThumbs()
config.get(key?) / config.set(key, value)
selectFolder()
selectDownloadPath(defaultName, isDir)
watcher.start(connId) / .stop(connId) / .list() / .onStatus(cb) / .pauseAll() / .resumeAll()
queue.list() / .retry(id) / .remove(id) / .cancel(id) / .clearDone() / .clearStale()
      .pause() / .resume()
      .onUpdated(cb) / .onProgress(cb) / .enqueueBatch(connId, folder, relPaths)
remote.list(connId, path) / .checkout(connId, path, local) / .download(connId, path, localPath, isDir)
       .delete(connId, path, isDir) / .move(connId, src, dst) / .mkdir(connId, path)
       .readFile(connId, path) / .writeFile(connId, path, content)
       .verifyClean(connId, folder) / .verifyDelete(folder, relPaths)
       .diskUsage(connId)
       .sizeScan(connId) / .sizeCancel(connId) / .sizeLoadCache(connId) / .sizeSaveCache(connId, data)
       .onDownloadProgress(cb) / .onSizeProgress(cb) / .onSizeLevel(cb) / .onSizeDone(cb) / .onSizeError(cb)
backup.run(cfg) / .cancel() / .onProgress(cb)
ssh.test(cfg) / .scanConfigs() / .listDir(cfg)
local.clearFolder(path)
log.tail(n) / .getPath() / .reveal() / .clear() / .onEntry(cb)
update.check() / .install() / .onStatus(cb)
```

## Custom protocol

`nas-stream://{connectionId}{/remote/path}` streams SFTP files directly to the renderer for image/video/audio preview. Handles `Range` requests for video seeking. Registered in `main.js` before `app.whenReady()`.

## Connection config shape

```js
{
  id: string,           // UUID
  name: string,
  icon: string,         // icon identifier for TabBar/Sidebar display
  type: 'sftp' | 'smb',
  localFolder: string,  // absolute local path to watch
  operation: 'copy',
  folderMode: 'flat' | 'mirror' | 'mirror_clean',
  extensions: string[], // file extension filter, e.g. ['.jpg', '.mp4']; empty = all
  sftp: { host, port, username, password, keyPath, remotePath },
  smb: { host, share, username, password, remotePath },
}
```

Passwords stored as `enc:<base64>` (Electron `safeStorage` / DPAPI). Never log or transmit plaintext passwords.

## Queue job shape

```js
{
  id, srcPath, filename, relPath, size,
  status: 'PENDING' | 'TRANSFERRING' | 'DONE' | 'ERROR',
  progress,    // 0–1
  errorMsg, errorAt, operation, connectionId, remoteDest, retries, createdAt,
}
```

## Design tokens

All values in `src/styles/tokens.css`. Dark is default; light overrides via `[data-theme="light"]` on `<html>`. Key tokens: `--bg`, `--bg-panel`, `--bg-card`, `--text`, `--text-muted`, `--accent`, `--border`, `--space-{1–12}`, `--radius-{xs–xl}`, `--transition`.

## Code conventions

- `master` branch
- No emojis in code or comments
- POSIX paths for all remote operations
- CSS Modules only — no CSS-in-JS
- Shared utilities in `src/utils/` — never duplicate `formatSize`, `formatDate`, or extension logic

## Known issues

| Issue | File |
|---|---|
| `main.js` is ~2250 lines — SFTP pool, protocol, backup, ops, tray, IPC in one file | `electron/main.js` |
| No automatic retry — ERROR jobs require manual retry; no exponential backoff | `electron/worker.js` |
| `calcDirSize` blocks the main process (sync fs calls in backup handler) | `electron/main.js` |
| `activeTransfers` counter can be stale — should derive from TRANSFERRING jobs | `src/App.jsx` |

## Planned work

- Automatic retry with exponential backoff (3 retries, 2s/8s/32s) in `worker.js`
- Split `main.js` — extract SFTP pool, nas-stream protocol, backup, and tray into separate modules
- Async `calcDirSize` to unblock the main process during backups

## Building and releasing

```bash
npm run dev          # electron-vite dev + HMR
npm run build        # production build
npm run dist:win     # build + package Windows installer
npm test             # vitest run
npm run lint         # eslint src/ electron/

make release         # bump patch, build, tag, publish GitHub Release
make release minor   # bump minor version
make dist            # build installer only
make clean           # remove build output
```

Releasing requires `gh` CLI authenticated and `GH_TOKEN` set.
