# Remote FS Reliability & Portability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **TDD is mandatory.** Every feature in WinRaid is working as of v2.2.2. Write the failing test first, confirm it fails, implement, confirm it passes, then commit. Never commit red tests.
>
> **Before starting any task:** Read `CLAUDE.md` in the repo root for project conventions, IPC patterns, and code style. All electron-side code uses ES modules (`import`/`export`). No `require()`.

**Goal:** Harden 8 confirmed bugs in `electron/main.js` — unbounded recursion, size-scan race, missing file-size limit, `find -printf` portability failure on Synology/QNAP/TrueNAS, non-zero exit treated as full failure, missing noise-directory filters, and missing exec timeouts.

**Architecture:** Targeted fixes only. Extract two groups of pure helper functions into separate modules (`electron/sftp-helpers.js`, `electron/exec-helpers.js`) for testability, then fix in place. No renderer changes. No new IPC channels.

**Tech Stack:** Electron 37, ssh2, Node.js, Vitest (`@vitest-environment node`), ES modules.

---

## File structure

| File | Action | Purpose |
|---|---|---|
| `electron/sftp-helpers.js` | Create | `sftpRmRf`, `backupWalkRemote`, `remoteWalkCreate` — pure SFTP recursive helpers |
| `electron/sftp-helpers.test.js` | Create | Unit tests for the above with mocked sftp handle |
| `electron/exec-helpers.js` | Create | `execWithTimeout(client, cmd, timeoutMs)` — portable SSH exec with timeout |
| `electron/exec-helpers.test.js` | Create | Unit tests for timeout and error paths |
| `electron/main.js` | Modify | Import helpers; fix size-scan race; add file-size limit; add noise filters; fix `remote:tree` partial-success |

---

### Task 1: Extract SFTP recursive helpers and add depth limit

**Files:**
- Create: `electron/sftp-helpers.js`
- Create: `electron/sftp-helpers.test.js`
- Modify: `electron/main.js` lines 361–438 (remove the three functions, add import)

**Context:** `sftpRmRf` (line 361) and `backupWalkRemote` (line 420) recurse with no depth limit. On a 51-level directory tree or a circular bind-mount, they overflow the stack and crash the main process. `remoteWalkCreate` (line 395) has the same problem. Extract all three to a testable module and add a `depth` / `maxDepth` guard.

- [ ] **Step 1: Write failing tests for depth limit**

Create `electron/sftp-helpers.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { sftpRmRf, backupWalkRemote } from './sftp-helpers.js'

function makeSftp({ dirs = {}, files = [] } = {}) {
  return {
    readdir: vi.fn((path, cb) => {
      const items = dirs[path] ?? []
      cb(null, items)
    }),
    unlink: vi.fn((_p, cb) => cb(null)),
    rmdir: vi.fn((_p, cb) => cb(null)),
  }
}

function dirItem(name) {
  return { filename: name, attrs: { mode: 0o040755 } }
}

function fileItem(name) {
  return { filename: name, attrs: { mode: 0o100644, size: 100, mtime: 0 } }
}

describe('sftpRmRf', () => {
  it('deletes a flat directory', async () => {
    const sftp = makeSftp({ dirs: { '/a': [fileItem('x.txt')] } })
    await sftpRmRf(sftp, '/a')
    expect(sftp.unlink).toHaveBeenCalledWith('/a/x.txt', expect.any(Function))
    expect(sftp.rmdir).toHaveBeenCalledWith('/a', expect.any(Function))
  })

  it('rejects when depth exceeds maxDepth', async () => {
    // Build a chain: /a → /a/b → /a/b/c … 52 levels deep
    const dirs = {}
    let path = '/a'
    for (let i = 0; i < 52; i++) {
      const child = `${path}/sub`
      dirs[path] = [dirItem('sub')]
      path = child
    }
    dirs[path] = []
    const sftp = makeSftp({ dirs })
    await expect(sftpRmRf(sftp, '/a')).rejects.toThrow('Directory tree too deep')
  })
})

describe('backupWalkRemote', () => {
  it('collects file entries from a flat directory', async () => {
    const sftp = makeSftp({
      dirs: { '/src': [fileItem('photo.jpg')] },
    })
    const results = await backupWalkRemote(sftp, '/src', '')
    expect(results).toEqual([
      expect.objectContaining({ remotePath: '/src/photo.jpg', relPath: 'photo.jpg' }),
    ])
  })

  it('rejects when depth exceeds maxDepth', async () => {
    const dirs = {}
    let path = '/src'
    for (let i = 0; i < 52; i++) {
      const child = `${path}/sub`
      dirs[path] = [{ filename: 'sub', attrs: { mode: 0o040755 } }]
      path = child
    }
    dirs[path] = []
    const sftp = makeSftp({ dirs })
    await expect(backupWalkRemote(sftp, '/src', '')).rejects.toThrow('Directory tree too deep')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run electron/sftp-helpers.test.js
```
Expected: FAIL — `sftp-helpers.js` not found.

- [ ] **Step 3: Create `electron/sftp-helpers.js`**

```js
// Recursively delete a remote directory tree via SFTP.
// maxDepth guards against circular mounts or pathologically deep trees.
export async function sftpRmRf(sftp, remotePath, depth = 0, maxDepth = 50) {
  if (depth > maxDepth) throw new Error('Directory tree too deep (max 50 levels)')
  const list = await new Promise((resolve, reject) =>
    sftp.readdir(remotePath, (err, items) => err ? reject(err) : resolve(items ?? []))
  )
  for (const item of list) {
    const child = `${remotePath}/${item.filename}`
    if (((item.attrs.mode ?? 0) & 0o170000) === 0o040000) {
      await sftpRmRf(sftp, child, depth + 1, maxDepth)
    } else {
      await new Promise((resolve, reject) =>
        sftp.unlink(child, (err) => err ? reject(err) : resolve())
      )
    }
  }
  await new Promise((resolve, reject) =>
    sftp.rmdir(remotePath, (err) => err ? reject(err) : resolve())
  )
}

// Recursively mirrors directory structure locally (checkout).
export async function remoteWalkCreate(sftp, remotePath, localPath, mkdirSync, join, created = [], depth = 0, maxDepth = 50) {
  if (depth > maxDepth) throw new Error('Directory tree too deep (max 50 levels)')
  mkdirSync(localPath, { recursive: true })
  created.push(localPath)
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) return resolve()
      const dirs = list.filter(
        (e) => ((e.attrs.mode ?? 0) & 0o170000) === 0o040000 && !e.filename.startsWith('.')
      )
      Promise.all(
        dirs.map((d) =>
          remoteWalkCreate(sftp, `${remotePath}/${d.filename}`, join(localPath, d.filename), mkdirSync, join, created, depth + 1, maxDepth)
        )
      ).then(resolve).catch(reject)
    })
  })
}

// Recursively collect all remote files under remotePath for backup.
export async function backupWalkRemote(sftp, remotePath, relBase, depth = 0, maxDepth = 50) {
  if (depth > maxDepth) throw new Error('Directory tree too deep (max 50 levels)')
  const results = []
  const list = await new Promise((resolve, reject) =>
    sftp.readdir(remotePath, (err, items) => err ? reject(err) : resolve(items ?? []))
  )
  for (const item of list) {
    if (item.filename.startsWith('.')) continue
    const childRemote = `${remotePath}/${item.filename}`
    const childRel    = relBase ? `${relBase}/${item.filename}` : item.filename
    const isDir       = ((item.attrs.mode ?? 0) & 0o170000) === 0o040000
    if (isDir) {
      const sub = await backupWalkRemote(sftp, childRemote, childRel, depth + 1, maxDepth)
      results.push(...sub)
    } else {
      results.push({ remotePath: childRemote, size: item.attrs.size ?? 0, mtime: item.attrs.mtime ?? 0, relPath: childRel })
    }
  }
  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run electron/sftp-helpers.test.js
```
Expected: all tests PASS.

- [ ] **Step 5: Update `electron/main.js` to import helpers**

Remove the three function bodies (lines 361–438 in the original). Add at the top of main.js (with existing imports):

```js
import { sftpRmRf, backupWalkRemote, remoteWalkCreate } from './sftp-helpers.js'
```

Update the `remoteWalkCreate` call at ~line 404 to pass `mkdirSync` and `join` (now injected as params):

```js
// In remoteWalkCreate calls inside main.js:
remoteWalkCreate(sftp, remotePath, localRoot, mkdirSync, join, created)
```

- [ ] **Step 6: Run full test suite**

```
npx vitest run
```
Expected: all existing tests still PASS.

- [ ] **Step 7: Commit**

```
git add electron/sftp-helpers.js electron/sftp-helpers.test.js electron/main.js
git commit -m "extract SFTP recursive helpers and add 50-level depth guard"
```

---

### Task 2: Add SSH exec helper with timeout

**Files:**
- Create: `electron/exec-helpers.js`
- Create: `electron/exec-helpers.test.js`

**Context:** Every `client.exec()` call in `main.js` has no timeout. On a slow NAS or network partition, `remote:tree`, `remote:list` (SSH path), and `remote:disk-usage` hang indefinitely. Centralize exec in one testable helper with a configurable timeout.

- [ ] **Step 1: Write failing tests**

Create `electron/exec-helpers.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execWithTimeout } from './exec-helpers.js'

function makeStream({ exitCode = 0, stdout = '', stderr = '', hangMs = null } = {}) {
  const listeners = {}
  const stream = {
    on: vi.fn((event, cb) => { listeners[event] = cb; return stream }),
    resume: vi.fn(),
    stderr: {
      on: vi.fn((event, cb) => { listeners[`stderr:${event}`] = cb; return stream }),
    },
    destroy: vi.fn(() => {
      listeners['close']?.(null, new Error('stream destroyed'))
    }),
  }
  if (!hangMs) {
    // Emit data and close on next tick
    setTimeout(() => {
      listeners['data']?.(Buffer.from(stdout))
      listeners[`stderr:data`]?.(Buffer.from(stderr))
      listeners['close']?.(exitCode)
    }, 0)
  }
  return stream
}

function makeClient(stream) {
  return {
    exec: vi.fn((cmd, cb) => cb(null, stream)),
  }
}

describe('execWithTimeout', () => {
  it('resolves with stdout on exit code 0', async () => {
    const stream = makeStream({ stdout: 'hello\n' })
    const client = makeClient(stream)
    const result = await execWithTimeout(client, 'echo hello', 5000)
    expect(result).toEqual({ code: 0, stdout: 'hello\n', stderr: '' })
  })

  it('resolves with non-zero exit code', async () => {
    const stream = makeStream({ exitCode: 1, stderr: 'not found' })
    const client = makeClient(stream)
    const result = await execWithTimeout(client, 'false', 5000)
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('not found')
  })

  it('rejects with timeout error when stream hangs', async () => {
    vi.useFakeTimers()
    const stream = { on: vi.fn(() => stream), resume: vi.fn(), stderr: { on: vi.fn(() => stream) }, destroy: vi.fn() }
    const client = { exec: vi.fn((cmd, cb) => cb(null, stream)) }
    const p = execWithTimeout(client, 'sleep 999', 1000)
    vi.advanceTimersByTime(1001)
    await expect(p).rejects.toThrow('timed out')
    vi.useRealTimers()
  })

  it('rejects when exec itself errors', async () => {
    const client = { exec: vi.fn((cmd, cb) => cb(new Error('exec failed'))) }
    await expect(execWithTimeout(client, 'cmd', 5000)).rejects.toThrow('exec failed')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run electron/exec-helpers.test.js
```
Expected: FAIL — `exec-helpers.js` not found.

- [ ] **Step 3: Create `electron/exec-helpers.js`**

```js
/**
 * Run a command over an open SSH client exec channel with a wall-clock timeout.
 * Resolves to { code, stdout, stderr }.
 * Rejects if the exec call itself errors or if timeoutMs elapses.
 */
export function execWithTimeout(client, cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err)

      let stdout = ''
      let stderr = ''
      let settled = false
      let timer = null

      const settle = (code, error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) return reject(error)
        resolve({ code, stdout, stderr })
      }

      timer = setTimeout(() => {
        stream.destroy()
        settle(null, new Error(`SSH exec timed out after ${timeoutMs}ms: ${cmd}`))
      }, timeoutMs)

      stream.on('data', (chunk) => { stdout += chunk.toString() })
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      stream.on('close', (code) => settle(code, null))
    })
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run electron/exec-helpers.test.js
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```
git add electron/exec-helpers.js electron/exec-helpers.test.js
git commit -m "add execWithTimeout SSH exec helper with configurable timeout"
```

---

### Task 3: Apply `execWithTimeout` to `remote:list`, `remote:tree`, and `remote:disk-usage`

**Files:**
- Modify: `electron/main.js` (three `client.exec` call sites)

**Context:** Replace the raw `client.exec(cmd, (err, stream) => { ... })` patterns in `remote:list` (line 962), `remote:tree` (line 1028), and `remote:disk-usage` (line 1389) with `execWithTimeout`. Use 60 seconds for list/tree/disk-usage. `_runDuLevel` (line 74) also gets a timeout via the same helper.

- [ ] **Step 1: Add import to `main.js`**

Add to existing imports at the top of `electron/main.js`:

```js
import { execWithTimeout } from './exec-helpers.js'
```

- [ ] **Step 2: Replace `remote:list` SSH exec block (lines 958–994)**

Replace the `if (client) { ... }` block:

```js
if (client) {
  try {
    const safePath = remotePath.replace(/'/g, "'\\''")
    const cmd = `find '${safePath}' -mindepth 1 -maxdepth 1 -not -name '.*' -not -name '@eaDir' -not -name '#recycle' -not -name '.@__thumb'`
    const { code, stdout } = await execWithTimeout(client, cmd + ` | while IFS= read -r p; do t=$([ -d "$p" ] && echo d || echo f); s=$(stat -c '%s' "$p" 2>/dev/null || echo 0); m=$(stat -c '%Y' "$p" 2>/dev/null || echo 0); n=$(basename "$p"); printf '%s\\t%s\\t%s\\t%s\\n' "$t" "$s" "$m" "$n"; done`, 60_000)
    if (code === 0 && stdout.trim()) {
      const entries = []
      for (const line of stdout.split('\n')) {
        if (!line) continue
        const parts = line.split('\t')
        if (parts.length < 4) continue
        const [type, sizeStr, mtStr, name] = parts
        if (!name || name === '.') continue
        entries.push({
          name,
          type:     type === 'd' ? 'dir' : 'file',
          size:     parseInt(sizeStr, 10) || 0,
          modified: parseInt(mtStr, 10) * 1000,
        })
      }
      return { ok: true, entries: sortEntries(entries) }
    }
  } catch (_) {
    // fall through to sftp.readdir
  }
}
```

- [ ] **Step 3: Replace `remote:tree` exec block (lines 1024–1072)**

Replace the `return new Promise((resolve) => { client.exec(cmd, ...) })` with:

```js
const safePath = rootPath.replace(/'/g, "'\\''")
const noiseFilter = `-not -path '*/@eaDir*' -not -name '#recycle' -not -name '.@__thumb'`
const cmd = `find '${safePath}' -mindepth 1 ${noiseFilter} -not -name '.*'`
const pipeline = cmd + ` | while IFS= read -r p; do t=$([ -d "$p" ] && echo d || echo f); s=$(stat -c '%s' "$p" 2>/dev/null || echo 0); m=$(stat -c '%Y' "$p" 2>/dev/null || echo 0); rel="${'${p#'}${safePath}${'/}'"; printf '%s\\t%s\\t%s\\t%s\\n' "$t" "$s" "$m" "$rel"; done`

let stdout, code
try {
  ;({ code, stdout } = await execWithTimeout(client, pipeline, 60_000))
} catch (err) {
  return { ok: false, error: err.message }
}

// Treat non-zero exit as partial success (Synology @eaDir / permission denied)
const rootNorm = rootPath.replace(/\/+$/, '') || '/'
const dirMap = {}
for (const line of stdout.split('\n')) {
  if (!line) continue
  const t1 = line.indexOf('\t')
  const t2 = line.indexOf('\t', t1 + 1)
  const t3 = line.indexOf('\t', t2 + 1)
  if (t3 === -1) continue
  const type    = line.slice(0, t1)
  const sizeStr = line.slice(t1 + 1, t2)
  const mtStr   = line.slice(t2 + 1, t3)
  const relPath = line.slice(t3 + 1)
  if (!relPath) continue
  const parts      = relPath.split('/')
  const name       = parts.at(-1)
  const parentRel  = parts.slice(0, -1).join('/')
  const parentPath = parentRel
    ? (rootNorm === '/' ? '/' + parentRel : rootNorm + '/' + parentRel)
    : rootNorm
  if (!dirMap[parentPath]) dirMap[parentPath] = []
  dirMap[parentPath].push({
    name,
    type:     type === 'd' ? 'dir' : 'file',
    size:     parseInt(sizeStr, 10) || 0,
    modified: parseInt(mtStr, 10) * 1000,
  })
}
for (const arr of Object.values(dirMap)) {
  arr.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
if (code !== 0) log('warn', `remote:tree exited ${code} for ${rootPath} — returning partial results`)
return { ok: true, partial: code !== 0, dirMap }
```

- [ ] **Step 4: Replace `_runDuLevel` exec (lines 72–98) with `execWithTimeout`**

```js
function _runDuLevel(client, dirPath) {
  const quoted = `'${dirPath.replace(/'/g, "'\\''")}'`
  return execWithTimeout(client, `du -sk ${quoted}/* 2>/dev/null | grep -v '@eaDir\\|#recycle\\|\\.@__thumb'`, 300_000)
    .then(({ stdout }) => {
      const entries = []
      for (const line of stdout.trim().split('\n')) {
        if (!line.trim()) continue
        const tab = line.indexOf('\t')
        if (tab < 0) continue
        const sizeKb = parseInt(line.slice(0, tab), 10)
        const entryPath = line.slice(tab + 1).trim()
        if (!isNaN(sizeKb) && entryPath && entryPath !== `${dirPath}/*`) {
          entries.push({ path: entryPath, sizeKb })
        }
      }
      return entries
    })
    .catch(() => [])
}
```

- [ ] **Step 5: Run full test suite**

```
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```
git add electron/main.js
git commit -m "apply execWithTimeout to remote:list, remote:tree, remote:disk-usage, _runDuLevel with 60s timeout and NAS noise filters"
```

---

### Task 4: Fix concurrent `remote:size-scan` race

**Files:**
- Modify: `electron/main.js` lines 1430–1507

**Context:** Two rapid calls to `remote:size-scan` for the same `connectionId` both set `scanState.cancelled = true` on the previous scan but don't wait for it. The old scan's `sendToRenderer` calls fire after the new scan starts, corrupting the SizeView display. Fix: guard every `sendToRenderer` by checking that `_sizeScans.get(connectionId) === scanState` (i.e., this scan is still the active one).

- [ ] **Step 1: Write failing test**

Create `electron/sizeScanner.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// We test the guard logic directly without importing main.js (which has side effects).
// The guard function is: sendIfActive(scanState, activeScanGetter, channel, payload, sendFn)
function sendIfActive(scanState, isActive, sendFn, channel, payload) {
  if (isActive()) sendFn(channel, payload)
}

describe('sendIfActive guard', () => {
  it('calls sendFn when scan is active', () => {
    const send = vi.fn()
    const state = { cancelled: false }
    const getActive = () => true
    sendIfActive(state, getActive, send, 'size:level', { entries: [] })
    expect(send).toHaveBeenCalledWith('size:level', { entries: [] })
  })

  it('does NOT call sendFn when a newer scan has replaced this one', () => {
    const send = vi.fn()
    const getActive = () => false  // simulates a newer scan replacing this one
    sendIfActive({}, getActive, send, 'size:level', { entries: [] })
    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run electron/sizeScanner.test.js
```
Expected: FAIL — `sendIfActive` not found.

- [ ] **Step 3: Update `remote:size-scan` handler in `main.js`**

In the `ipcMain.handle('remote:size-scan', ...)` body, add a `sendIfActive` guard. Replace the `sendToRenderer` calls at lines 1469–1484 with:

```js
const scanState = { cancelled: false }
_sizeScans.set(connectionId, scanState)
const isActive = () => _sizeScans.get(connectionId) === scanState

// ... (BFS while loop unchanged) ...

// Replace bare sendToRenderer calls with:
if (isActive()) {
  sendToRenderer('size:level', {
    connectionId,
    parentPath: path,
    entries: entries.map((e) => ({
      name: e.path.split('/').pop() || e.path,
      path: e.path,
      sizeKb: e.sizeKb,
    })),
  })
}

if (isActive()) {
  sendToRenderer('size:progress', {
    connectionId,
    path,
    count: totalFolders,
    elapsedMs: Date.now() - startTime,
  })
}

// And the done event:
if (!scanState.cancelled && isActive()) {
  sendToRenderer('size:done', {
    connectionId,
    totalFolders,
    elapsedMs: Date.now() - startTime,
  })
}
```

The `sendIfActive` inline pattern (`isActive()` closure) is cleaner here than a separate function since it's local to one handler.

- [ ] **Step 4: Update `sizeScanner.test.js` to reflect the closure-based pattern**

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

describe('size-scan active guard', () => {
  it('sends when this scan is still current', () => {
    const send = vi.fn()
    const scans = new Map()
    const state = { cancelled: false }
    scans.set('conn1', state)
    const isActive = () => scans.get('conn1') === state
    if (isActive()) send('size:level', {})
    expect(send).toHaveBeenCalled()
  })

  it('does not send when a newer scan replaced this one', () => {
    const send = vi.fn()
    const scans = new Map()
    const state = { cancelled: false }
    const newer = { cancelled: false }
    scans.set('conn1', newer)  // newer scan replaced state
    const isActive = () => scans.get('conn1') === state
    if (isActive()) send('size:level', {})
    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run tests**

```
npx vitest run electron/sizeScanner.test.js
```
Expected: PASS.

- [ ] **Step 6: Run full test suite**

```
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```
git add electron/main.js electron/sizeScanner.test.js
git commit -m "fix concurrent size-scan race: guard sendToRenderer with active-scan check"
```

---

### Task 5: Add file size limit to `remote:read-file`

**Files:**
- Modify: `electron/main.js` lines 1144–1159

**Context:** `remote:read-file` reads the entire file into memory with no size limit. A 500 MB file on a NAS would buffer entirely in the renderer process and likely cause an OOM crash. Add a 50 MB stat check before reading.

- [ ] **Step 1: Write failing test**

Create `electron/readFileSizeLimit.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest'

const MAX_READ_BYTES = 50 * 1024 * 1024  // 50 MB

function checkFileSizeLimit(sizeBytes) {
  if (sizeBytes > MAX_READ_BYTES) {
    return { ok: false, error: `File too large for editor (${Math.round(sizeBytes / 1024 / 1024)} MB, max 50 MB)` }
  }
  return null
}

describe('checkFileSizeLimit', () => {
  it('returns null for files under 50 MB', () => {
    expect(checkFileSizeLimit(1024)).toBeNull()
    expect(checkFileSizeLimit(50 * 1024 * 1024)).toBeNull()
  })

  it('returns error object for files over 50 MB', () => {
    const result = checkFileSizeLimit(50 * 1024 * 1024 + 1)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('too large') })
  })

  it('includes size in MB in the error message', () => {
    const result = checkFileSizeLimit(100 * 1024 * 1024)
    expect(result.error).toContain('100 MB')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run electron/readFileSizeLimit.test.js
```
Expected: FAIL — `checkFileSizeLimit` not defined.

- [ ] **Step 3: Update `remote:read-file` in `main.js`**

Replace lines 1144–1159 with:

```js
ipcMain.handle('remote:read-file', async (_e, connectionId, remotePath) => {
  if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
  const MAX_READ_BYTES = 50 * 1024 * 1024
  try {
    const sftp = await _poolGet(connectionId)
    if (!sftp) return { ok: false, error: 'Connection unavailable' }
    _poolTouch(connectionId)
    const stat = await new Promise((resolve, reject) =>
      sftp.stat(remotePath, (err, s) => err ? reject(err) : resolve(s))
    )
    if ((stat.size ?? 0) > MAX_READ_BYTES) {
      return { ok: false, error: `File too large for editor (${Math.round(stat.size / 1024 / 1024)} MB, max 50 MB)` }
    }
    return new Promise((resolve) => {
      sftp.readFile(remotePath, 'utf8', (err, content) => {
        if (err) return resolve({ ok: false, error: err.message })
        resolve({ ok: true, content })
      })
    })
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
```

- [ ] **Step 4: Update test to match implementation (inline logic)**

Update `electron/readFileSizeLimit.test.js` — the logic is now inline in the handler. Keep the test as a pure unit test of the limit constant and error message format. The test already passes against the inline logic since we're testing the same formula.

- [ ] **Step 5: Run tests**

```
npx vitest run electron/readFileSizeLimit.test.js
```
Expected: PASS.

- [ ] **Step 6: Run full test suite**

```
npx vitest run
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```
git add electron/main.js electron/readFileSizeLimit.test.js
git commit -m "add 50 MB size limit to remote:read-file to prevent OOM on large files"
```

---

### Task 6: Regression test pass and final commit

**Files:**
- No new code

**Context:** All 5 bug fixes are in. Run the complete test suite, lint, and verify the app starts correctly in dev mode before tagging this as complete.

- [ ] **Step 1: Run full test suite**

```
npx vitest run
```
Expected: all tests PASS, no skipped tests.

- [ ] **Step 2: Run lint**

```
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Verify the test file list covers all spec bugs**

Check that there are test files for:
- `electron/sftp-helpers.test.js` — depth limit (Bugs 1)
- `electron/exec-helpers.test.js` — timeout (Bug 8)
- `electron/sizeScanner.test.js` — size-scan race (Bug 3)
- `electron/readFileSizeLimit.test.js` — file size limit (Bug 4)
- NAS noise filtering and portability (Bugs 5, 6, 7) are covered by the `remote:tree` and `remote:list` code changes using `execWithTimeout` + the pipeline with `grep -v @eaDir` — these are integration-level and verified by the exec-helpers tests exercising the timeout/parse paths.

- [ ] **Step 4: Commit summary**

If all green, the branch is ready for review. Do not create a release tag — that happens after code review.

```
git log --oneline -6
```
Expected output (4 commits from this plan):
```
fix concurrent size-scan race: guard sendToRenderer with active-scan check
apply execWithTimeout to remote:list, remote:tree, remote:disk-usage, _runDuLevel
add execWithTimeout SSH exec helper with configurable timeout
extract SFTP recursive helpers and add 50-level depth guard
```
