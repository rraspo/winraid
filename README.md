# WinRaid

A Windows desktop app for multi-connection homelab file sync. Watch multiple local folders and automatically push new files to NAS devices via SFTP or SMB, browse remote filesystems, and pull NAS folders back down as incremental local backups.

## Features

- **Multi-connection sync** — configure multiple NAS connections, each with its own watch folder, remote path, and transfer settings
- **Folder watcher** — per-connection file monitoring with debounce and stability polling
- **SFTP & SMB backends** — push files to any Linux/NAS host over SSH or a network share
- **Remote browser** — navigate the NAS filesystem, edit files, move/rename/delete, checkout folder structures
- **Incremental backup** — pull remote directories to local storage, skipping unchanged files (mtime + size)
- **Transfer queue** — real-time view of pending, in-flight, and completed jobs with per-connection filtering
- **Live logs** — dated log files with in-app tail view
- **System tray** — runs silently in background, pause/resume all watchers from taskbar
- **Credential encryption** — passwords encrypted on disk via Windows DPAPI (Electron safeStorage)
- **Auto-updater** — checks GitHub Releases for new versions on startup
- **Dark & light themes** — toggle from the sidebar

## Download

Grab the latest installer from [GitHub Releases](../../releases/latest).

## Requirements

- Windows 10 / 11
- Node.js 18+ (dev only)

## Dev setup

```bash
npm install
make dev
```

## Build & Release

```bash
make release              # bump patch, build installer, push tag, publish GitHub Release
make release minor        # bump minor version
make release major        # bump major version
make dist                 # build installer only (no tag, no publish)
make clean                # remove build output
```

Requires `gh` CLI authenticated (`gh auth login`) and `GH_TOKEN` set for the auto-updater publish step.

Run `make` for the full command reference.

## Configuration

Settings are stored at `%APPDATA%\WinRaid\config.json`. Passwords are encrypted with a `enc:` prefix.

On first launch, add a connection and configure:

- **Connection type** — SFTP or SMB
- **Host / credentials** — hostname, port, username, password or private key
- **Local folder** — the directory WinRaid watches for this connection
- **Remote path** — destination on the NAS
- **Transfer mode** — copy (keep local) or move (delete after upload)
- **Folder mode** — flat, mirror, or mirror + clean local
- **Extension filter** — optional whitelist by file type

## Architecture

```
electron/              Main process (Node.js)
  main.js              IPC handlers, watcher/queue orchestration, backup, remote browser
  watcher.js           WatcherManager — Map<connectionId, WatcherInstance>, chokidar + stability polling
  queue.js             Job queue with connectionId routing, persisted to queue.json
  worker.js            Transfer worker, resolves connection per job, backend factory
  logger.js            Rotating daily log files + IPC push to renderer
  config.js            JSON config persistence, safeStorage encryption, schema migration
  backends/
    sftp.js            SFTP upload via ssh2
    smb.js             SMB / stream-based copy

src/                   Renderer (React + Vite)
  App.jsx              Root, view routing, per-connection watcher status
  views/               Dashboard, Queue, Browse, Backup, Connection, Settings, Log
  components/          Sidebar, Header, StatusBar, RemotePathBrowser, EditorModal
  styles/tokens.css    Design tokens (dark/light themes)
```

## License

MIT
