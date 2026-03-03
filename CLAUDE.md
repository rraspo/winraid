# WinRaid — Project Context for Claude

## What is this?

WinRaid is a Windows desktop app for homelab file sync.
It watches a local folder and automatically pushes files to a NAS
via SFTP/SMB, and can pull NAS folders back down as a local backup.

## Stack

- **Electron** — main process, IPC, native dialogs, system tray
- **React + Vite** (electron-vite) — renderer UI
- **CSS Modules** — scoped styles, design-token variables in `src/index.css`
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
│   ├── queue.js         # Transfer job queue (PENDING→TRANSFERRING→DONE/ERROR)
│   ├── worker.js        # Transfer worker, backend factory
│   ├── logger.js        # Dated log files + log:entry IPC push to renderer
│   ├── config.js        # JSON config persistence (%APPDATA%\WinRaid\config.json)
│   └── backends/
│       ├── sftp.js      # SFTP upload backend (ssh2)
│       └── smb.js       # SMB/local copy backend
├── src/
│   ├── App.jsx          # Root — view routing, shared state (backupRun, watcherStatus)
│   ├── views/
│   │   ├── QueueView.jsx        # Transfer queue list
│   │   ├── BrowseView.jsx       # Remote NAS browser
│   │   ├── BackupView.jsx       # NAS→local backup config + run status
│   │   ├── SettingsView.jsx     # SFTP connection + watcher settings
│   │   └── LogView.jsx          # Live log tail
│   └── components/
│       ├── Sidebar.jsx          # Nav (Browse/Queue/Backup top, Logs/Settings bottom)
│       ├── StatusBar.jsx        # Watcher state + active transfer indicator
│       ├── RemotePathBrowser.jsx # Modal SFTP directory browser
│       ├── EditorModal.jsx
│       └── ui/
│           ├── Button.jsx
│           └── Tooltip.jsx      # Portal tooltip, side prop for left/right opening
├── assets/
│   └── winraid_icon.ico
├── electron-builder.yml
└── package.json
```

## Architecture notes

- IPC follows `ipcMain.handle` / `ipcRenderer.invoke` pattern; all renderer API goes through `contextBridge` in `preload.js`
- Watcher emits three states to renderer: `watching`, `enqueueing` (file detected, stabilising), implied stopped
- Backup reuses the shared SFTP config from Settings — no separate connection form
- `backupRun` state is lifted to `App.jsx` so it survives view switches
- Incremental backup skip: mtime + size match (SFTP attrs already carry mtime from `readdir`)
- `logger.js` writes to dated file under `%APPDATA%\WinRaid\logs\` and pushes `log:entry` to renderer

## Design tokens

CSS variables defined in `src/index.css`. Key ones:

```
--bg-base, --bg-panel, --bg-card, --bg-input
--text, --text-muted, --text-faint
--accent, --accent-subtle
--border, --border-input, --border-strong
--success, --warning, --error, --success-subtle, --error-subtle
--radius-sm/md/lg, --space-1…6, --font-size-xs/sm/md/base
```

## Code conventions

- `master` branch
- No emojis in code or comments

## Known gaps / next steps

### Security
- [x] Credentials encrypted on disk via Electron `safeStorage` (DPAPI on Windows) — `enc:` prefix for backward compat
- [x] Path traversal blocked in `backup:run` — resolved path validated against `resolve(localDest) + sep`
- [x] `contextIsolation: true`, `nodeIntegration: false` confirmed in BrowserWindow config

### Reliability
- [ ] No retry logic — failed transfers stay in ERROR state permanently
- [ ] No queue persistence — pending jobs lost on restart
- [ ] `calcDirSize` is synchronous (`readdirSync`/`statSync`) and blocks the main process on large backup destinations — make async
- [ ] SFTP mtime tolerance — some servers/filesystems round mtime to 2s boundaries; use `Math.abs(diff) <= 1` instead of strict equality
- [ ] `activeTransfers` counter caps at 1 and resets on any job completion regardless of other in-flight jobs

### Quality
- [ ] No test coverage anywhere
- [ ] Multi-folder watch (currently single source folder)
- [ ] Drag & drop files onto tray icon (Windows shell integration)

## Running locally

```bash
npm install
npm run dev
```

## Building

```bash
npm run build
# output: dist\WinRaid-Setup.exe
```
