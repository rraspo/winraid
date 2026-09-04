<!-- noinspection HtmlDeprecatedAttribute -->
<p align="center">
  <img src="assets/winraid_icon.ico" alt="WinRaid icon" width="96" />
</p>

<h1 align="center">WinRaid</h1>

<p align="center">
  <strong>Your NAS, one folder away.</strong><br/>
  Watch local folders &rarr; push to your NAS over SFTP/SMB &rarr; browse, edit, play, back up. No cloud in between.
</p>

<p align="center">
  <a href="https://github.com/rraspo/winraid/releases/latest"><img src="https://img.shields.io/github/v/release/rraspo/winraid?style=flat-square&color=blue" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4?style=flat-square&logo=windows11&logoColor=white" alt="Windows 10/11" />
  <img src="https://img.shields.io/badge/electron-37-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/github/license/rraspo/winraid?style=flat-square" alt="GPL-3.0 License" />
</p>

---

## Why WinRaid?

You bought a NAS so your files would live somewhere safe. Getting them there from a Windows PC is still a chore: dragging over a network share and hoping nothing stalls, a sync script nobody remembers how to run, or a "cloud" tool that wants an account, a subscription, and a copy of everything on someone else's servers.

WinRaid is the missing piece. It is a small Windows app that watches the folders you choose and quietly pushes whatever lands in them to your NAS. Drop a file in, and moments later it is on the server. No cloud, no account, no middleman. Your data goes from your PC to your hardware and nowhere else.

Once your files are on the NAS, WinRaid keeps being useful: a remote browser that works like a local drive, a Quick Look viewer with built-in photo and video tools, a media wall, a storage map, and incremental backups back to your PC.

## Philosophy

WinRaid is a personal tool that grew up. It started as one homelabber's answer to "why is this still hard on Windows" and is shaped by daily use rather than a feature checklist. That sets the priorities:

1. **Set it and forget it.** Setup is one form. After that it lives in the tray and stays out of the way.
2. **Never lose a file silently.** Name conflicts, failed transfers, and mid-flight disconnects always end in something you can see: a numbered copy, a clear error, or a retry. Nothing is overwritten or dropped without telling you.
3. **Your hardware, your data.** Everything talks directly to your NAS. Credentials are encrypted with Windows' own protection and never leave the machine.
4. **Sync first, then the rest.** The core promise is reliable watch-and-push. Browsing, media tools, and backups are built on top of it, never at its expense.

External users are welcome. Issues and pull requests get triaged, and releases ship through the built-in auto-updater.

## Features

### Sync engine

- **Multi-connection sync** — any number of NAS connections, each with its own watch folder, remote path, and rules
- **SFTP and SMB** — push files to any Linux/NAS host over SSH (password or private key) or to a Windows/Samba share
- **Folder watcher** — debounce and stability polling so a file is only sent once it has finished writing; files that appeared while the watcher was stopped are picked up on restart
- **Transfer mode** — copy (keep the local file) or move (delete after a confirmed upload)
- **Folder mode** — flat, mirror, or mirror + clean local, with an option to keep empty folders for download clients that expect them
- **Duplicate handling** — upload conflicts as `name (1).ext`, or keep the file local and report an error; nothing is ever silently overwritten
- **Extension filters** — an allow-list and an ignore-list per connection
- **Verify** — walk the local watch folder against the NAS, then enqueue what is missing or delete confirmed local copies
- **SSH config wizard** — auto-fill a connection from `~/.ssh/config`, including WSL distros
- **Host key pinning** — SSH host keys are trusted on first use and checked on every connection after that
- **Pause and resume** — stop all watchers from the tray or the app; queued transfers still finish

### Transfer queue

- Live view of pending, active, completed, and failed jobs with per-connection filtering
- Retry, cancel, remove, clear done, clear stale
- Lifetime completed counter and NAS disk usage on the dashboard

### Remote browser

- **Grid and list views** with thumbnails for images and videos, and PDF preview
- **Favorite folders** per connection, pinned in the sidebar
- **Navigation** — breadcrumbs, back/forward history, jump to the sync root
- **Sort** by name, newest, or oldest; folders on top; sort remembered globally, per folder, or per sibling group
- **Search** — filter the current folder as you type, or just start typing a name to jump to it
- **File actions** — right-click or dot menu for download, edit, move, delete, and reveal in Explorer; rename keeps the extension in its own field
- **Bulk select** with download, move, and delete
- **Drag and drop** — move between folders, or drop files from Windows Explorer to upload
- **Paste** — an image from the clipboard or a URL lands in the current folder
- **Check out** the current folder structure to the local mirror
- **Built-in text editor** with tabs and unsaved-changes markers
- **Directory cache** — stale-while-revalidate, full tree on connect, or always fetch
- **Activity feed** of recent operations

### Quick Look

- Full-screen image and video viewer; arrow keys step through the folder and continue past the current list
- Folder breadcrumbs inside the viewer rescope what you are stepping through
- Rotate images with one click; rotate videos losslessly
- Trim videos with a draggable in/out range bar and playhead scrubbing; save in place or as a new file
- Crop images and videos
- Save a video snapshot as JPEG, PNG, or WebP
- Local ffmpeg fallback with a cancelable download when the NAS has none

### Play wall

- Masonry media wall of a folder; videos autoplay as they scroll into view, GIFs animate
- Shuffle, recursive scan, fullscreen
- Open any tile into Quick Look and keep browsing from there

### Size map

- Sunburst chart of where your storage is going, with parallel scans and drill-down on demand
- Click a slice to jump to that folder in the browser
- Scan results cached between sessions

### Backup

- Incremental pull of a remote folder to local storage, skipping unchanged files (mtime + size)
- Progress with downloaded, skipped, errors, and total size; cancelable

### App

- **System tray** — runs silently in the background; show or quit from the taskbar
- **Auto-updater** — checks GitHub Releases on startup, install from Settings
- **What's New** screen after an update
- **Dark and light themes**
- **Live logs** — dated log files with in-app tail, clear, and reveal in Explorer
- **Encrypted credentials** — passwords encrypted on disk via Windows DPAPI (Electron safeStorage)

## Install

Download the latest **WinRaid-Setup.exe** from [GitHub Releases](https://github.com/rraspo/winraid/releases/latest) and run it. That's it.

> The installer is currently **unsigned**, so Windows SmartScreen may warn about an unknown publisher — choose **More info → Run anyway**. Code signing is planned.

## Quick start

1. Launch WinRaid
2. Click **New Connection** in the sidebar
3. Pick SFTP or SMB, fill in host/credentials (or let the SSH config wizard do it), choose a local watch folder and remote destination
4. Hit **Save** — the watcher starts automatically
5. Drop files into the watch folder and watch them land on your NAS

## Configuration

Settings live at `%APPDATA%\WinRaid\config.json`. Passwords are stored with an `enc:` prefix (DPAPI-encrypted).

Per connection:

- **Transfer mode** — copy (keep local) or move (delete after upload)
- **Folder mode** — flat, mirror, or mirror + clean local (optionally keeping empty folders)
- **Rename duplicates** — for move / mirror + clean, upload name conflicts as `name (1).ext` so every file lands; when off, conflicting files stay local and the transfer is reported as an error
- **Extension filters** — optional allow-list and ignore-list by file type
- **Favorite folders** — pinned remote paths shown in the sidebar

App-wide (Settings view):

- **Connections on startup** — expanded, collapsed, or remembered
- **Video thumbnail position** — in seconds or a percentage, to skip past black intros
- **Video snapshot format** — JPEG, PNG, or WebP
- **Directory cache** and **on folder mutation** behavior
- **Sort persistence** — default only, per folder, or per siblings
- **Thumbnail cache** size and clear

## Building from source

Requires **Node.js 18+**.

```bash
git clone https://github.com/rraspo/winraid.git
cd winraid
npm install
npm run dev          # dev server with hot reload
npm test             # vitest
npm run lint         # eslint
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
| Tests | vitest |

## License

GPL-3.0
