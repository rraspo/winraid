# Security Hardening A — IPC Remote Path Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `validateRemotePath` to all `remote:*` IPC handlers and the `nas-stream://` protocol handler so malformed or traversal paths are rejected before reaching the SFTP layer.

**Architecture:** A pure `validateRemotePath(p)` function is extracted to `electron/validation.js` (no Electron deps, fully testable), imported into `main.js`, and applied as an early-return guard in 8 IPC handlers and the protocol handler. No changes to happy paths or error handling.

**Tech Stack:** Electron 37, Node.js ESM, Vitest (node environment)

---

### Task 1: Write failing tests for `validateRemotePath`

**Files:**
- Create: `electron/main.validateRemotePath.test.js`

- [ ] **Step 1: Create the test file**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { validateRemotePath } from './validation.js'

describe('validateRemotePath', () => {
  // --- valid paths ---
  it('accepts a simple absolute path', () => {
    expect(validateRemotePath('/mnt/user/data')).toBe(true)
  })
  it('accepts root slash', () => {
    expect(validateRemotePath('/')).toBe(true)
  })
  it('accepts a deep nested path', () => {
    expect(validateRemotePath('/mnt/user/data/Documents/2024')).toBe(true)
  })
  it('accepts hidden directory names (dot-prefix, not traversal)', () => {
    expect(validateRemotePath('/mnt/user/..hidden')).toBe(true)
  })
  it('accepts three-dot names', () => {
    expect(validateRemotePath('/mnt/user/...dots')).toBe(true)
  })

  // --- invalid paths ---
  it('rejects empty string', () => {
    expect(validateRemotePath('')).toBe(false)
  })
  it('rejects relative path (no leading slash)', () => {
    expect(validateRemotePath('relative/path')).toBe(false)
  })
  it('rejects traversal segment in middle', () => {
    expect(validateRemotePath('/mnt/../etc/passwd')).toBe(false)
  })
  it('rejects traversal segment at end', () => {
    expect(validateRemotePath('/mnt/user/data/..')).toBe(false)
  })
  it('rejects multi-level traversal', () => {
    expect(validateRemotePath('/mnt/user/../../etc')).toBe(false)
  })
  it('rejects null byte in path', () => {
    expect(validateRemotePath('/valid/path\0injected')).toBe(false)
  })
  it('rejects null', () => {
    expect(validateRemotePath(null)).toBe(false)
  })
  it('rejects a number', () => {
    expect(validateRemotePath(123)).toBe(false)
  })
  it('rejects undefined', () => {
    expect(validateRemotePath(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
npm test -- electron/main.validateRemotePath.test.js
```

Expected output: FAIL — `Cannot find module './validation.js'` (or similar import error). If they pass, something is wrong.

---

### Task 2: Implement `validateRemotePath` in `electron/validation.js`

**Files:**
- Create: `electron/validation.js`

- [ ] **Step 1: Create the file**

```js
/**
 * Returns true if p is a safe absolute POSIX remote path:
 *   - non-empty string
 *   - starts with /
 *   - no null bytes
 *   - no .. path segments (e.g. /../, /.., or standalone ..)
 *
 * Does NOT restrict which connection root the path belongs to —
 * all absolute paths are accepted so free navigation works.
 *
 * @param {unknown} p
 * @returns {boolean}
 */
export function validateRemotePath(p) {
  return typeof p === 'string'
    && p.startsWith('/')
    && !p.includes('\0')
    && !/(?:^|\/)\.\.(?:\/|$)/.test(p)
}
```

- [ ] **Step 2: Run the tests — confirm they all pass**

```bash
npm test -- electron/main.validateRemotePath.test.js
```

Expected output: 14 tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add electron/validation.js electron/main.validateRemotePath.test.js
git commit -m "add validateRemotePath helper with tests"
```

---

### Task 3: Import `validateRemotePath` in `main.js`

**Files:**
- Modify: `electron/main.js:20` (after the logger import)

- [ ] **Step 1: Add the import**

Current line 20:
```js
import { initLogger, getLogPath, clearLog, log } from './logger.js'
```

Add one line immediately after it:
```js
import { validateRemotePath } from './validation.js'
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass (the import has no side effects).

---

### Task 4: Guard `remote:list`, `remote:checkout`, `remote:read-file`

**Files:**
- Modify: `electron/main.js` — three handlers

- [ ] **Step 1: Add guard to `remote:list` (around line 860)**

Find this handler:
```js
ipcMain.handle('remote:list', async (_e, connectionId, remotePath) => {
  try {
    const sftp = await _poolGet(connectionId)
```

Add the guard as the very first line inside the handler, before `try`:
```js
ipcMain.handle('remote:list', async (_e, connectionId, remotePath) => {
  if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
  try {
    const sftp = await _poolGet(connectionId)
```

- [ ] **Step 2: Add guard to `remote:checkout` (around line 889)**

Find:
```js
ipcMain.handle('remote:checkout', async (_e, connectionId, remotePath, localRoot) => {
  try {
    const sftp = await _poolGet(connectionId)
```

Add guard before `try`:
```js
ipcMain.handle('remote:checkout', async (_e, connectionId, remotePath, localRoot) => {
  if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
  try {
    const sftp = await _poolGet(connectionId)
```

- [ ] **Step 3: Add guard to `remote:read-file` (around line 952)**

Find:
```js
ipcMain.handle('remote:read-file', async (_e, connectionId, remotePath) => {
  try {
    const sftp = await _poolGet(connectionId)
```

Add guard before `try`:
```js
ipcMain.handle('remote:read-file', async (_e, connectionId, remotePath) => {
  if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
  try {
    const sftp = await _poolGet(connectionId)
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

---

### Task 5: Guard `remote:write-file`, `remote:delete`, `remote:mkdir`

**Files:**
- Modify: `electron/main.js` — three more handlers

- [ ] **Step 1: Add guard to `remote:write-file` (around line 1115)**

Find:
```js
ipcMain.handle('remote:write-file', async (_e, connectionId, remotePath, content) => {
  try {
    const sftp = await _poolGet(connectionId)
```

Add guard before `try`:
```js
ipcMain.handle('remote:write-file', async (_e, connectionId, remotePath, content) => {
  if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
  try {
    const sftp = await _poolGet(connectionId)
```

- [ ] **Step 2: Add guard to `remote:delete` (around line 969)**

Find:
```js
ipcMain.handle('remote:delete', async (_e, connectionId, remotePath, isDir) => {
  try {
    const sftp = await _poolGet(connectionId)
```

Add guard before `try`:
```js
ipcMain.handle('remote:delete', async (_e, connectionId, remotePath, isDir) => {
  if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
  try {
    const sftp = await _poolGet(connectionId)
```

- [ ] **Step 3: Add guard to `remote:mkdir` (around line 1018)**

Find:
```js
ipcMain.handle('remote:mkdir', async (_e, connectionId, remotePath) => {
  try {
    const sftp = await _poolGet(connectionId)
```

Add guard before `try`:
```js
ipcMain.handle('remote:mkdir', async (_e, connectionId, remotePath) => {
  if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
  try {
    const sftp = await _poolGet(connectionId)
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

---

### Task 6: Guard `remote:download` and `remote:move`

**Files:**
- Modify: `electron/main.js` — two handlers

- [ ] **Step 1: Add guard to `remote:download` (around line 913)**

The handler already validates `connectionId`. Find:
```js
ipcMain.handle('remote:download', async (_e, connectionId, remotePath, localPath, isDir) => {
  if (typeof connectionId !== 'string' || !connectionId.trim()) return { ok: false, error: 'invalid connectionId' }
  try {
```

Add the `remotePath` guard on the line immediately after the existing `connectionId` check:
```js
ipcMain.handle('remote:download', async (_e, connectionId, remotePath, localPath, isDir) => {
  if (typeof connectionId !== 'string' || !connectionId.trim()) return { ok: false, error: 'invalid connectionId' }
  if (!validateRemotePath(remotePath)) return { ok: false, error: 'Invalid remote path' }
  try {
```

- [ ] **Step 2: Add guard to `remote:move` (around line 990)**

`remote:move` takes two path parameters. Find:
```js
ipcMain.handle('remote:move', async (_e, connectionId, srcPath, dstPath) => {
  try {
    const sftp = await _poolGet(connectionId)
```

Add guard before `try` — validate both paths:
```js
ipcMain.handle('remote:move', async (_e, connectionId, srcPath, dstPath) => {
  if (!validateRemotePath(srcPath) || !validateRemotePath(dstPath)) return { ok: false, error: 'Invalid remote path' }
  try {
    const sftp = await _poolGet(connectionId)
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

---

### Task 7: Guard the `nas-stream://` protocol handler

**Files:**
- Modify: `electron/main.js` — protocol handler (around line 1978)

- [ ] **Step 1: Add guard to the protocol handler**

Find the existing null-check block (around line 1985):
```js
const connId     = url.hostname
const remotePath = decodeURIComponent(url.pathname)

if (!connId || !remotePath) {
  return new Response('Bad Request', { status: 400 })
}
```

Replace with a stricter check that also validates the path:
```js
const connId     = url.hostname
const remotePath = decodeURIComponent(url.pathname)

if (!connId || !validateRemotePath(remotePath)) {
  return new Response('Bad Request', { status: 400 })
}
```

Note: `validateRemotePath` already rejects empty string (returns false), so the `!remotePath` part of the original check is covered. The `!connId` check remains unchanged.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit all handler changes**

```bash
git add electron/main.js
git commit -m "apply validateRemotePath guards to all remote IPC handlers and nas-stream protocol"
```

---

### Task 8: Smoke test in the running app

**Files:** none — manual verification

- [ ] **Step 1: Start the app in dev mode**

```bash
npm run dev
```

- [ ] **Step 2: Verify normal browse navigation still works**

Open the Browse view. Navigate into a subfolder. Navigate back up via breadcrumbs. Confirm entries load correctly with no errors in the DevTools console.

- [ ] **Step 3: Verify images and video still load in QuickLook**

Click a photo or video file. Confirm the QuickLook overlay opens and the media plays. This exercises the `nas-stream://` protocol handler.

- [ ] **Step 4: Verify drag-and-drop move still works**

Drag a file onto a folder. Confirm the move operation completes and the directory re-loads. This exercises `remote:move`.
