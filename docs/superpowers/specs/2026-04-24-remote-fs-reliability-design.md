# Remote FS Reliability & Portability — Design Spec

**Goal:** Harden the existing remote filesystem IPC handlers against crashes, races, hangs, and NAS-platform incompatibilities. No new features — pure reliability and portability.

**Architecture:** Targeted fixes to `electron/main.js` and `electron/backends/sftp.js`. Renderer code unchanged except where a bug fix requires a matching renderer-side guard. All changes covered by TDD before implementation.

**Tech Stack:** Electron 37, ssh2, Node.js fs, Vitest

---

## Scope

Eight confirmed bugs across three categories:

### Category 1 — Critical crashes & races

**Bug 1: Unbounded recursion in `sftpRmRf` and `backupWalkRemote`**
- Location: `electron/main.js` ~line 361 (`sftpRmRf`), ~line 420 (`backupWalkRemote`)
- Problem: No depth limit or cycle detection. On a deep tree or a circular NFS/bind-mount, the recursive SFTP readdir calls exhaust the call stack and crash the main process.
- Fix: Add a `depth` parameter defaulting to 0, throw an error (which rejects the handler promise) if `depth > 50`.

**Bug 2: `remote:move` SSH stream race**
- Location: `electron/main.js` ~line 1184
- Problem: Promise resolves in the `close` handler before stdout is fully drained. Stderr is only consumed in the error path — on the success path, unflushed stderr can block the SSH window and leak memory.
- Fix: Always consume stdout and stderr via `.resume()` before the promise settles. Drain stderr unconditionally.

**Bug 3: Concurrent `remote:size-scan` race**
- Location: `electron/main.js` ~line 1430
- Problem: Two rapid calls to `remote:size-scan` for the same `connectionId` create separate `scanState` objects. The old scan is cancelled but not awaited — its in-flight `sendToRenderer` calls fire after the new scan starts, corrupting UI state. `_sizeScans.delete()` races with pending sends.
- Fix: Before starting a new scan, await the old scan's cancellation (set a `cancelled` flag and wait for its next `send` guard to see it). Use a per-scan ID to ignore sends from stale scans.

**Bug 4: No file size limit on `remote:read-file` / `remote:write-file`**
- Location: `electron/main.js` ~line 1144, ~line 1347
- Problem: A 2 GB file read via IPC will buffer entirely in memory and likely OOM the renderer process.
- Fix: Add a 50 MB limit. If `sftp.stat()` shows the file exceeds the limit, return `{ ok: false, error: 'File too large for editor (max 50 MB)' }` before reading.

### Category 2 — NAS portability

**Bug 5: `find -printf` not available on Synology/QNAP/TrueNAS Core**
- Location: `electron/main.js` ~line 961 (`remote:list` SSH path), ~line 1027 (`remote:tree`)
- Problem: `-printf` is GNU findutils only. BusyBox (`find` on Synology DSM, QNAP QTS) and BSD `find` (TrueNAS Core) do not support it. The code silently falls back to SFTP `readdir` on failure, masking the incompatibility in logs.
- Fix: Replace `-printf '%y\t%s\t%T@\t%f\n'` with a portable shell pipeline:
  ```sh
  find '{path}' -mindepth 1 -maxdepth 1 -not -name '.*' | while IFS= read -r p; do
    t=$([ -d "$p" ] && echo d || echo f)
    s=$(stat -c '%s' "$p" 2>/dev/null || echo 0)
    m=$(stat -c '%Y' "$p" 2>/dev/null || echo 0)
    n=$(basename "$p")
    printf '%s\t%s\t%s\t%s\n' "$t" "$s" "$m" "$n"
  done
  ```
  `stat -c` is available on all GNU Linux NAS (Unraid, TrueNAS SCALE). For TrueNAS Core (BSD), fall back to SFTP `readdir` when the first output line fails to parse — the existing fallback path is correct, it just needs to log clearly.
- Same fix applies to `remote:tree`'s `find -printf` command.

**Bug 6: `find` non-zero exit treated as full failure**
- Location: `electron/main.js` ~line 1027 (`remote:tree` close handler)
- Problem: On Synology, `find` exits non-zero when any subdirectory denies traversal (e.g. `@eaDir`). The current handler returns `{ ok: false }` discarding all collected results.
- Fix: Treat non-zero exit as `{ ok: true, partial: true, dirMap }` — return whatever was collected. Log a warning. This matches the existing `remote:list` fallback spirit.

**Bug 7: No noise filtering for Synology system directories**
- Location: `electron/main.js` ~line 961, ~line 1027, ~line 74 (`_runDuLevel`)
- Problem: Synology creates `@eaDir` in every directory (thumbnail metadata), `#recycle` at share roots, and `.@__thumb`. These pollute tree views and size scans.
- Fix: Add prune patterns to all `find` and `du` commands:
  - `find`: add `-not -path '*/@eaDir*' -not -name '#recycle' -not -name '.@__thumb'`
  - `du`: pipe through `grep -v '@eaDir\|#recycle\|\.@__thumb'`

### Category 3 — Timeouts

**Bug 8: No operation timeouts on SSH exec calls**
- Location: `electron/main.js` — all `client.exec()` calls
- Problem: SSH exec streams have no wall-clock timeout. On a slow NAS or a network partition, `remote:tree`, `remote:list` (SSH path), `remote:move`, and `remote:disk-usage` hang indefinitely.
- Fix: Wrap each `client.exec` stream in a 60-second timeout. On timeout, destroy the stream and reject the promise with `{ ok: false, error: 'Operation timed out' }`. `remote:size-scan` gets 5 minutes (it's intentionally long-running).

---

## What is NOT in scope

- Renderer-side cache changes (Spec B)
- Async `calcDirSize` (separate planned work)
- Splitting `main.js` into modules (separate planned work)
- `remote:checkout` / `remote:download` local path validation (low risk, separate)

---

## Testing approach

All fixes are in `electron/main.js` (Node.js process). Unit tests live in `electron/__tests__/` using Vitest. Mock `ssh2` client and SFTP handle. Test each fix in isolation:

- `sftpRmRf` depth guard: mock a 51-level deep directory tree, assert rejects
- Size-scan race: call handler twice rapidly, assert second scan's results are not mixed with first
- File size limit: mock `sftp.stat()` returning large size, assert `{ ok: false }`
- Timeout: mock exec stream that never closes, advance fake timers 61s, assert rejects
- Noise filter: mock find output including `@eaDir` entries, assert they are absent from returned entries
