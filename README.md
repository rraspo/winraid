# WinRaid

A Windows desktop app for homelab file sync. Watch a local folder and automatically push new files to a NAS via SFTP or SMB, and pull NAS folders back down as incremental local backups.

## Features

- **Folder watcher** — monitors a local folder and queues new files automatically
- **SFTP & SMB backends** — push files to any Linux/NAS host over SSH or a network share
- **Incremental backup** — pull remote directories to local storage, skipping files that haven't changed (mtime + size)
- **Remote browser** — navigate the NAS filesystem visually to pick paths
- **Transfer queue** — real-time view of pending, in-flight, and completed jobs
- **Live logs** — dated log files with in-app tail view
- **System tray** — runs silently in background, accessible from taskbar

## Requirements

- Windows 10 / 11
- Node.js 18+ (dev only)

## Dev setup

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
# installer output: dist\WinRaid-Setup.exe
```

## Configuration

Settings are stored at `%APPDATA%\WinRaid\config.json`.

On first launch open **Settings** and configure:

**SSH / SFTP connection**
- Host, port, username
- Password or path to a private key file

**Watcher**
- Local folder to monitor
- Remote destination path
- Transfer mode: SFTP or SMB

**Backup**
- One or more remote source paths to pull down
- Local destination folder

## Architecture

```
electron/          Main process (Node.js)
  main.js          IPC handlers, watcher + queue orchestration
  watcher.js       chokidar watcher with debounce + stability polling
  queue.js         PENDING → TRANSFERRING → DONE / ERROR job queue
  worker.js        Transfer worker, backend factory
  logger.js        Rotating daily log files
  config.js        JSON config persistence
  backends/
    sftp.js        SFTP upload via ssh2
    smb.js         SMB / local copy

src/               Renderer (React + Vite)
  App.jsx          Root, view routing, shared state
  views/           QueueView, BrowseView, BackupView, SettingsView, LogView
  components/      Sidebar, StatusBar, RemotePathBrowser, Tooltip, Button
```

## License

MIT
