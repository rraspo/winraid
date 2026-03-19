---
name: nas-stream protocol and QuickLookOverlay
description: Custom Electron protocol for streaming SFTP files to renderer, and the QuickLookOverlay component wired into BrowseView
type: project
---

## nas-stream:// Electron custom protocol (added 2026-03-19)

Registered in `electron/main.js` using `protocol.handle('nas-stream', handler)`.

URL format: `nas-stream://{connectionId}/{remote/path/to/file}`

Key design decisions:
- `protocol.registerSchemesAsPrivileged` must be called **before** `app.whenReady()` — it runs at module top level. `registerNasStreamProtocol()` (which calls `protocol.handle`) is called **inside** `app.whenReady()`.
- Scheme privileges: `standard: true, supportFetchAPI: true, stream: true`.
- `_streamPool` Map (`connectionId -> { client, sftp, timer }`) reuses live SFTP connections across range requests with a 30 s idle TTL.
- Password decryption: checks for `enc:` prefix, calls `safeStorage.decryptString` — mirrors the pattern in `config.js`.
- Range support: parses `bytes=start-end`, returns 206 with `Content-Range` and `Accept-Ranges: bytes` headers — required for `<video>` seeking.
- MIME types: looked up from `MIME_BY_EXT` map by file extension; falls back to `application/octet-stream`.
- CSP updated to include `nas-stream:` in `default-src`, `img-src`, and `media-src` directives (packaged build only).

**Why:** Streaming from SFTP requires a custom protocol so that `<video>`, `<audio>`, and `<img>` elements can use native browser range requests without routing through IPC (which can't return a streaming body to native media elements).

## QuickLookOverlay component (added 2026-03-19)

Files:
- `src/components/QuickLookOverlay.jsx`
- `src/components/QuickLookOverlay.module.css`

Props: `{ file, connectionId, cfg, files, onNavigate, onClose }`

- `file` — `{ name, path, size, modified }` (path is the full remote path)
- `cfg` — SFTP cfg object (passed through for text file reading via existing `remote:read-file` IPC)
- `files` — flat array of non-folder entries in the current directory, each augmented with `.path`
- Navigation: keyboard (Escape, ArrowLeft, ArrowRight) and prev/next buttons
- Type dispatch by extension: image → `<img>`, video → `<video>`, audio → `<audio>`, text (EDITABLE_EXTENSIONS) → `<pre>` via `window.winraid.remote.readFile`, unknown → metadata card

## BrowseView.jsx changes (2026-03-19)

- `selectedFile` + `showQuickLook` state added
- `fileEntries` derived via `useMemo` — non-folder entries with `.path = joinRemote(path, e.name)`
- `openQuickLook(entry, entryPath)` sets both state values
- `navigate()` resets Quick Look state to avoid stale overlay across directory changes
- List view: entire file row has `onClick={openQuickLook}` (cursor: pointer via inline style)
- Grid view: `GridCard` gains `onQuickLook` prop; file cards use `gridCardFile` CSS class for pointer cursor
- EditorModal flow via 3-dot menu is unchanged — Quick Look is only the default single-click action

**How to apply:** When adding new file actions or modifying BrowseView, be aware that single-click on a file row already opens Quick Look. Preserve the 3-dot menu as the path to Edit/Delete/Move.
