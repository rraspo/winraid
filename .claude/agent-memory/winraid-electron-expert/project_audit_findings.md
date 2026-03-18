---
name: Code Audit Findings (March 2026)
description: Key issues discovered during comprehensive code audit of all main electron and renderer files
type: project
---

Comprehensive audit performed 2026-03-18 covering all electron/ and src/ files.

**Why:** Baseline audit to catalog tech debt, security issues, and reliability gaps before new feature work.

**How to apply:** Use this as the authoritative issue backlog when prioritising fixes. Do not re-audit files that haven't changed since this date — update this entry instead.

## Critical
- smb.js netUse: shell injection via `exec` despite metacharacter filter — `"` character not in blocklist (host/share/user can escape the quoted args)
- main.js remote:verify-clean: `walkLocal` is synchronous (readdirSync) and blocks main process on large folders — no path-traversal guard on localFolder itself
- main.js local:clear-folder: no path validation at all — renderer can wipe any directory on disk by passing an arbitrary folderPath
- main.js backup:run: `calcDirSize` called synchronously on potentially large backup destination after download completes (blocks main thread)

## High
- main.js ssh:test / remote:list / remote:* handlers: cfg object passed directly from renderer with no validation — host/port/username/password not sanitized in main before use
- queue.js removeJob / clearDone: directly mutate `_jobs` without going through `jobs()` accessor — if called before first load, `_jobs` is null and will throw
- config.js setConfig: dot-notation key allows writing arbitrary deep paths with no allowlist — renderer can overwrite any config key including connections array
- worker.js activeTransfers bug (known): `setActiveTransfers((n) => Math.max(n, 1))` in App.jsx caps counter at 1 and resets to 0 on any job completion regardless of concurrency
- logger.js: log stream never closed on app quit — could lose final log lines on abrupt exit; no log rotation (single file per calendar day, unbounded growth)

## Medium
- ConnectionView.jsx handleSave: calls config.set 5 times sequentially (connections, activeConnectionId, localFolder, operation, folderMode, extensions) — not atomic, crash mid-save leaves config partially updated
- main.js watcher:start: passes `folder` parameter directly from renderer to startWatcher with no existence check or path validation
- sftp.js connect: keyPath used directly without ~ expansion (unlike every other call site in main.js that does expand ~) — key auth silently fails for ~ paths
- queue.js persist: writeFileSync on every enqueue/update — chatty for large queues; no debounce
- DashboardView.jsx logEntry key: uses `Math.random()` as part of key — causes unnecessary re-renders and is unstable across renders
- App.jsx activeTransfers: counter resets to 0 on ANY job status change away from TRANSFERRING, even if other jobs are still transferring (known bug)
- ConnectionView.jsx makeDefault: `crypto.randomUUID()` called on every render via initializer — is fine as useState lazy init but worth noting
- BackupView.jsx: no debounce/guard on Run button — double-clicking can trigger two concurrent backup:run IPC calls

## UX/UI fixes applied 2026-03-18

- [FIXED] App.jsx openConnEdit: now async; sets activeConnectionId in config AND state immediately on connection click — sidebar highlight is instant
- [FIXED] App.jsx handleWatcherToggle: now reads localFolder from active connection (connections array) instead of legacy top-level localFolder key
- [FIXED] SettingsView handleWatcherToggle: same fix — reads localFolder from active connection, falls back to legacy key, shows informative error if not set
- [FIXED] DashboardView connCard: active card now gets connCardActive CSS class (accent border + tinted background) to visually distinguish it
- [FIXED] DashboardView TransferCard progressFill: added progressFillIdle CSS class; fixed className join to filter falsy values (prevents "undefined" in class string)
- [FIXED] Sidebar connActive:hover: now preserves accent color on hover (previously reverted to --text color on hover)
- [FIXED] Sidebar connItemIcon: active connection icon now shows at full opacity
- [FIXED] QueueView empty state hint: updated text to reflect that watch folder is now per-connection, not in Settings
- [FIXED] DashboardView: added connCardActive CSS rule

## Low
- [FIXED 2026-03-18] main.js sandbox: false — changed to sandbox: true
- [FIXED 2026-03-18] No CSP — added via session.defaultSession.webRequest.onHeadersReceived in app.whenReady(); allows cdn.jsdelivr.net and raw.githubusercontent.com in connect-src and img-src
- [FIXED 2026-03-18] preload.js stale JSDoc — removed "from SQLite" from queue.list comment
- [FIXED 2026-03-18] main.js parseSshConfig multi-value Host: now splits Host value on whitespace; each non-wildcard token becomes its own entry sharing the same block's options
- [FIXED 2026-03-18] ConnectionView.jsx SSHWizardDialog: replaced index key with `${e.host}:${e.port}:${e.username}`
- [FIXED 2026-03-18] main.js backup:run localDest validation: added home-directory guard (same pattern as local:clear-folder) before opening SFTP connection; returns { ok: false, error: 'invalid destination' } if localDest is not a subdirectory of home
- autoUpdater already guarded by app.isPackaged check (initAutoUpdater returns early if !app.isPackaged) — L4 was already resolved
- walkLocal already async (uses readdirAsync/statAsync) — L6 was already resolved
- watcher.js waitForStable: paused flag checked after stability polling completes, not during sleep — a paused watcher still finishes in-flight stability checks and calls onFileReady
- smb.js copyWithProgress: reader error destroys writer but does not reject on writer error explicitly before pipe finishes — minor edge case
