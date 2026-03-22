# WinRaid

**Automatic file sync for your homelab NAS**
Watch local folders → push to NAS via SFTP/SMB → browse, backup, repeat.

[![Latest release](https://img.shields.io/github/v/release/rraspo/winraid?style=flat-square&color=blue)](https://github.com/rraspo/winraid/releases/latest)
![Windows 10/11](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4?style=flat-square&logo=windows11&logoColor=white)
![Electron](https://img.shields.io/badge/electron-37-47848F?style=flat-square&logo=electron&logoColor=white)
![MIT License](https://img.shields.io/github/license/rraspo/winraid?style=flat-square)

---

## Why WinRaid?

Most NAS sync tools are either cloud-first, Linux-only, or way too complex for a simple "watch folder, push files" workflow. WinRaid is built for Windows homelabbers who want a lightweight, set-and-forget sync agent that just works.

## Features

| | |
|---|---|
| **Multi-connection sync** | Configure multiple NAS connections, each with its own watch folder, remote path, and transfer settings |
| **Folder watcher** | Per-connection file monitoring with debounce and stability polling |
| **SFTP & SMB** | Push files to any Linux/NAS host over SSH or a network share |
| **Remote browser** | Navigate the NAS filesystem — edit, move, rename, delete, create folders, bulk select |
| **Incremental backup** | Pull remote directories to local storage, skipping unchanged files (mtime + size) |
| **Transfer queue** | Real-time view of pending, in-flight, and completed jobs with per-connection filtering |
| **Live logs** | Dated log files with in-app tail view |
| **System tray** | Runs silently in the background; pause/resume all watchers from the taskbar |
| **Encrypted credentials** | Passwords encrypted on disk via Windows DPAPI (Electron safeStorage) |
| **Auto-updater** | Checks GitHub Releases for new versions on startup |
| **Dark & light themes** | Toggle from the sidebar |

## Install

Download the latest **WinRaid-Setup.exe** from [GitHub Releases](https://github.com/rraspo/winraid/releases/latest) and run it. That's it.

## Quick start

1. Launch WinRaid
2. Click **New Connection** in the sidebar
3. Pick SFTP or SMB, fill in host/credentials, choose a local watch folder and remote destination
4. Hit **Save** — the watcher starts automatically
5. Drop files into the watch folder and watch them land on your NAS

## Configuration

Settings live at `%APPDATA%\WinRaid\config.json`. Passwords are stored with an `enc:` prefix (DPAPI-encrypted).

Each connection can be tuned with:

- **Transfer mode** — copy (keep local) or move (delete after upload)
- **Folder mode** — flat, mirror, or mirror + clean local
- **Extension filter** — optional whitelist by file type

## Building from source

Requires **Node.js 18+**.

```bash
git clone https://github.com/rraspo/winraid.git
cd winraid
npm install
npm run dev          # dev server with hot reload
npm run dist         # build installer → release/WinRaid-Setup.exe
```

## Tech stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron 37 |
| Renderer | React 18 + Vite |
| Styles | CSS Modules + design tokens |
| File watcher | chokidar |
| SFTP | ssh2 |
| Icons | lucide-react |

## License

MIT
