# Explorer File Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag files and folders from Windows Explorer onto the BrowseView pane; WinRaid enqueues them for SFTP/SMB transfer to the currently-open remote directory.

**Architecture:** A new optional `remoteDest` field on queue jobs lets the SFTP/SMB backends upload to a caller-specified remote directory instead of the connection's configured `remotePath`. A new `queue:drop-upload` IPC handler accepts local paths (files or folders), walks directories recursively, and enqueues jobs with this field set. The renderer adds `dragover`/`dragleave`/`drop` handlers to the BrowseView container and shows a dashed-border overlay while an external drag hovers.

**Tech Stack:** Electron IPC, Node.js `fs/promises` (already imported in `main.js`), React 18 + CSS Modules, Vitest + @testing-library/react.

---

## File Map

| File | Change |
|---|---|
| `electron/queue.js` | Store `opts.remoteDest ?? null` in the job object |
| `electron/backends/sftp.js` | Use `job.remoteDest ?? cfg.remotePath` as remote base |
| `electron/backends/smb.js` | Same override for SMB |
| `electron/main.js` | New `queue:drop-upload` IPC handler |
| `electron/preload.js` | Expose `queue.dropUpload` |
| `src/__mocks__/winraid.js` | Add `dropUpload` mock to queue namespace |
| `src/views/BrowseView.test.jsx` | External drag/drop integration tests |
| `src/hooks/useBrowse.js` | `externalDropActive` state + three handlers |
| `src/views/BrowseView.jsx` | Wire handlers to container, render overlay |
| `src/views/BrowseView.module.css` | `.dropOverlay` + `.dropOverlayLabel` |

---

## Task 1: Add `remoteDest` to queue job schema

**Files:**
- Modify: `electron/queue.js` (lines 99–125)

The `enqueue` function currently ignores any `opts` fields beyond `relPath`, `operation`, `connectionId`, and `size`. `remoteDest` must be stored so the backend can read it from the job.

- [ ] **Step 1: Add `remoteDest` to the job object inside `enqueue()`**

In `electron/queue.js`, find the `jobs().push({...})` call inside `enqueue()` (around line 106) and add `remoteDest` between `connectionId` and `retries`:

```js
export function enqueue(srcPath, opts = {}) {
  const id           = randomUUID()
  const filename     = srcPath.split(/[/\\]/).pop()
  const relPath      = opts.relPath      ?? filename
  const operation    = opts.operation    ?? 'copy'
  const connectionId = opts.connectionId ?? null

  jobs().push({
    id,
    srcPath,
    filename,
    relPath,
    size:       opts.size      ?? null,
    status:     STATUS.PENDING,
    progress:   0,
    errorMsg:   '',
    errorAt:    null,
    operation,
    connectionId,
    remoteDest: opts.remoteDest ?? null,
    retries:    0,
    createdAt:  Date.now(),
  })
  persist()

  log('info', `Queued: ${filename} (${id.slice(0, 8)})`)
  return id
}
```

- [ ] **Step 2: Verify build**

```bash
cd X:\WebstormProjects\winraid && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

---

## Task 2: SFTP backend — use `job.remoteDest` when set

**Files:**
- Modify: `electron/backends/sftp.js` (line 27)

- [ ] **Step 1: Update `buildRemotePath` call in `transfer()`**

In `electron/backends/sftp.js`, find line 27:

```js
const remotePath = buildRemotePath(cfg.remotePath, job.relPath)
```

Replace with:

```js
const remotePath = buildRemotePath(job.remoteDest ?? cfg.remotePath, job.relPath)
```

- [ ] **Step 2: Verify build**

```bash
cd X:\WebstormProjects\winraid && npm run build 2>&1 | tail -5
```

Expected: clean build.

---

## Task 3: SMB backend — use `job.remoteDest` when set

**Files:**
- Modify: `electron/backends/smb.js` (line 33)

- [ ] **Step 1: Update remote path construction in `transfer()`**

In `electron/backends/smb.js`, find line 33:

```js
const subPath  = win32.join(cfg.remotePath, job.relPath.replace(/\//g, '\\'))
```

Replace with:

```js
const subPath  = win32.join(job.remoteDest ?? cfg.remotePath, job.relPath.replace(/\//g, '\\'))
```

- [ ] **Step 2: Verify build**

```bash
cd X:\WebstormProjects\winraid && npm run build 2>&1 | tail -5
```

Expected: clean build.

---

## Task 4: New IPC handler `queue:drop-upload` in `main.js`

**Files:**
- Modify: `electron/main.js` (after the `queue:enqueue-batch` handler, around line 725)

All imports needed (`readdirAsync`, `statAsync`, `basename`, `join`) are already present at the top of `main.js`.

- [ ] **Step 1: Add the handler after the `queue:enqueue-batch` block**

Find the line `return { ok: true, count: relPaths.length }` that closes `queue:enqueue-batch` (around line 724), then add the new handler immediately after the closing `})`:

```js
  ipcMain.handle('queue:drop-upload', async (_e, connectionId, remoteDest, localPaths) => {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      return { ok: false, error: 'Invalid connectionId' }
    }
    if (typeof remoteDest !== 'string' || !remoteDest.startsWith('/')) {
      return { ok: false, error: 'Invalid remoteDest' }
    }
    if (!Array.isArray(localPaths) || localPaths.length === 0) {
      return { ok: false, error: 'invalid localPaths' }
    }

    const { getConfig } = await import('./config.js')
    const cfg  = getConfig()
    const conn = (cfg.connections ?? []).find((c) => c.id === connectionId)
    if (!conn) return { ok: false, error: 'Connection not found' }

    async function collectFiles(dirPath, relPrefix) {
      const results = []
      const dirEntries = await readdirAsync(dirPath, { withFileTypes: true })
      for (const entry of dirEntries) {
        const fullPath = join(dirPath, entry.name)
        const relPath  = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          results.push(...await collectFiles(fullPath, relPath))
        } else if (entry.isFile()) {
          results.push({ fullPath, relPath })
        }
      }
      return results
    }

    const q = await getQueue()
    let count = 0

    for (const localPath of localPaths) {
      if (typeof localPath !== 'string') continue
      let s
      try { s = await statAsync(localPath) } catch { continue }

      if (s.isFile()) {
        const jobId = q.enqueue(localPath, {
          relPath:      basename(localPath),
          remoteDest,
          operation:    conn.operation,
          connectionId,
          size:         s.size,
        })
        sendToRenderer('queue:updated', { type: 'added', jobId })
        count++
      } else if (s.isDirectory()) {
        const dirName = basename(localPath)
        const files   = await collectFiles(localPath, dirName)
        for (const { fullPath, relPath } of files) {
          let fileSize = null
          try { fileSize = (await statAsync(fullPath)).size } catch { /* file removed */ }
          const jobId = q.enqueue(fullPath, {
            relPath,
            remoteDest,
            operation:    conn.operation,
            connectionId,
            size:         fileSize,
          })
          sendToRenderer('queue:updated', { type: 'added', jobId })
          count++
        }
      }
    }

    try {
      const { ensureWorkerRunning } = await import('./worker.js')
      ensureWorkerRunning()
    } catch { /* worker may already be running */ }

    return { ok: true, count }
  })
```

- [ ] **Step 2: Verify build**

```bash
cd X:\WebstormProjects\winraid && npm run build 2>&1 | tail -5
```

Expected: clean build.

---

## Task 5: Expose `queue.dropUpload` in preload

**Files:**
- Modify: `electron/preload.js` (queue namespace, around line 80)

- [ ] **Step 1: Add `dropUpload` after `enqueueBatch`**

In `electron/preload.js`, find the `enqueueBatch` line inside the `queue:` namespace:

```js
    enqueueBatch: (connectionId, localFolder, relPaths) => ipcRenderer.invoke('queue:enqueue-batch', connectionId, localFolder, relPaths),
```

Add immediately after it:

```js
    /** Enqueue files/folders dropped from Explorer into the current remote directory. */
    dropUpload: (connectionId, remoteDest, localPaths) => ipcRenderer.invoke('queue:drop-upload', connectionId, remoteDest, localPaths),
```

- [ ] **Step 2: Verify build**

```bash
cd X:\WebstormProjects\winraid && npm run build 2>&1 | tail -5
```

Expected: clean build.

---

## Task 6: Update winraid mock — add `dropUpload`

**Files:**
- Modify: `src/__mocks__/winraid.js`

- [ ] **Step 1: Add `dropUpload` to the queue namespace in the mock**

In `src/__mocks__/winraid.js`, find the `queue:` object (around line 33). Add `dropUpload` after `enqueueBatch`:

```js
    queue: {
      list: vi.fn().mockResolvedValue([]),
      retry: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clearDone:    vi.fn().mockResolvedValue(undefined),
      clearStale:   vi.fn().mockResolvedValue({ removed: 0 }),
      enqueueBatch: vi.fn().mockResolvedValue(undefined),
      dropUpload:   vi.fn().mockResolvedValue({ ok: true, count: 1 }),
      cancel:       vi.fn().mockResolvedValue(undefined),
      onUpdated:    vi.fn().mockReturnValue(() => {}),
      onProgress:   vi.fn().mockReturnValue(() => {}),
      ...overrides.queue,
    },
```

- [ ] **Step 2: Run existing tests to confirm nothing is broken**

```bash
cd X:\WebstormProjects\winraid && npm test 2>&1 | tail -20
```

Expected: all existing tests pass.

---

## Task 7: Write failing tests for external drop behaviour

**Files:**
- Modify: `src/views/BrowseView.test.jsx`

These tests verify the overlay appears/disappears and that `dropUpload` is called. Write them before the implementation so they fail first.

- [ ] **Step 1: Add the test suite at the bottom of `BrowseView.test.jsx`**

```jsx
describe('External file drop (from Explorer)', () => {
  function makeDragEvent(type, hasFiles = true) {
    const evt = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(evt, 'dataTransfer', {
      value: {
        types:   hasFiles ? ['Files'] : ['text/plain'],
        files:   hasFiles
          ? [Object.assign(new File([''], 'photo.jpg'), { path: 'C:\\Users\\porras\\Pictures\\photo.jpg' })]
          : [],
        preventDefault: () => {},
      },
    })
    return evt
  }

  it('shows the drop overlay when an external file is dragged over the container', async () => {
    render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    const container = document.querySelector('[data-testid="browse-container"]')
    act(() => container.dispatchEvent(makeDragEvent('dragover')))

    expect(await screen.findByText(/Drop to upload to/i)).toBeInTheDocument()
  })

  it('hides the overlay when the drag leaves the container', async () => {
    render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    const container = document.querySelector('[data-testid="browse-container"]')
    act(() => container.dispatchEvent(makeDragEvent('dragover')))
    await screen.findByText(/Drop to upload to/i)

    const leaveEvt = new Event('dragleave', { bubbles: true })
    Object.defineProperty(leaveEvt, 'currentTarget', { value: container })
    Object.defineProperty(leaveEvt, 'relatedTarget', { value: null })
    act(() => container.dispatchEvent(leaveEvt))

    await waitFor(() =>
      expect(screen.queryByText(/Drop to upload to/i)).not.toBeInTheDocument()
    )
  })

  it('calls queue.dropUpload with the connection id, current path, and dropped file paths', async () => {
    const dropUpload = vi.fn().mockResolvedValue({ ok: true, count: 1 })
    window.winraid = createWinraidMock({
      config: {
        get: vi.fn().mockImplementation((key) => {
          if (key === 'connections') return Promise.resolve(TEST_CONNECTIONS)
          return Promise.resolve({ connections: TEST_CONNECTIONS })
        }),
      },
      remote: {
        list: vi.fn().mockResolvedValue({ ok: true, entries: SAMPLE_ENTRIES }),
      },
      queue: { dropUpload },
    })

    render(<BrowseView onHistoryPush={() => {}} />)
    await screen.findByText('Documents')

    const container = document.querySelector('[data-testid="browse-container"]')
    act(() => container.dispatchEvent(makeDragEvent('drop')))

    await waitFor(() =>
      expect(dropUpload).toHaveBeenCalledWith(
        'conn-1',
        '/mnt/user/data',
        ['C:\\Users\\porras\\Pictures\\photo.jpg'],
      )
    )
  })
})
```

- [ ] **Step 2: Run the new tests — confirm they fail**

```bash
cd X:\WebstormProjects\winraid && npm test -- --reporter=verbose 2>&1 | grep -A 3 "External file drop"
```

Expected: 3 tests fail with errors like "Cannot read properties of null" (container not found) or assertion failures.

---

## Task 8: Implement external drop handlers in `useBrowse.js`

**Files:**
- Modify: `src/hooks/useBrowse.js`

- [ ] **Step 1: Add `externalDropActive` state after the existing state declarations**

In `useBrowse.js`, after `const [downloadProgress, setDownloadProgress] = useState(null)` (around line 42), add:

```js
  const [externalDropActive, setExternalDropActive] = useState(false)
```

- [ ] **Step 2: Add the three handlers after `handleCreateFolder` (around line 382)**

After the `handleCreateFolder` callback and before the `// ── Sub-hook composition` comment:

```js
  const handleExternalDragOver = useCallback((e) => {
    if (dragDrop.dragSource) return
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    setExternalDropActive(true)
  }, [dragDrop.dragSource])

  const handleExternalDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setExternalDropActive(false)
    }
  }, [])

  const handleExternalDrop = useCallback(async (e) => {
    e.preventDefault()
    setExternalDropActive(false)
    if (!selectedId) return
    const localPaths = Array.from(e.dataTransfer?.files ?? [])
      .map((f) => f.path)
      .filter(Boolean)
    if (!localPaths.length) return
    await window.winraid?.queue.dropUpload(selectedId, pathRef.current, localPaths)
  }, [selectedId])
```

> Note: `dragDrop` is not yet in scope at this point in the file — it is composed below in the sub-hook section. Move these three handlers to **after** the `const dragDrop = useDragDrop({...})` block (around line 396).

- [ ] **Step 3: Add the three new values to the return object**

In `useBrowse.js`, find the `return {` block (around line 485). Add at the end, before the closing `}`:

```js
    externalDropActive,
    handleExternalDragOver,
    handleExternalDragLeave,
    handleExternalDrop,
```

- [ ] **Step 4: Run the tests — the first two tests should now pass**

```bash
cd X:\WebstormProjects\winraid && npm test -- --reporter=verbose 2>&1 | grep -A 3 "External file drop"
```

Expected: "shows the drop overlay" and "hides the overlay" pass; "calls queue.dropUpload" still fails (overlay not wired yet).

---

## Task 9: BrowseView overlay — JSX + CSS

**Files:**
- Modify: `src/views/BrowseView.jsx`
- Modify: `src/views/BrowseView.module.css`

- [ ] **Step 1: Destructure the new values from `useBrowse`**

In `BrowseView.jsx`, find the destructure block from `browse` (the `const { ... } = browse` block starting around line 23). Add the four new values:

```js
    externalDropActive,
    handleExternalDragOver,
    handleExternalDragLeave,
    handleExternalDrop,
```

alongside the existing destructured values.

- [ ] **Step 2: Add handlers and `data-testid` to the root container**

Find the opening `<div className={styles.container} style={style}>` (around line 56). Replace it with:

```jsx
<div
  className={styles.container}
  style={style}
  data-testid="browse-container"
  onDragOver={handleExternalDragOver}
  onDragLeave={handleExternalDragLeave}
  onDrop={handleExternalDrop}
>
```

- [ ] **Step 3: Render the overlay inside the container (after the opening div, before the first child)**

Immediately after the new opening `<div ...>` tag, add:

```jsx
      {externalDropActive && (
        <div className={styles.dropOverlay}>
          <span className={styles.dropOverlayLabel}>Drop to upload to {path}</span>
        </div>
      )}
```

- [ ] **Step 4: Add CSS for the overlay**

At the end of `src/views/BrowseView.module.css`, add:

```css
/* ── External file drop overlay ───────────────────────────────────────────── */
.dropOverlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  border: 2px dashed var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  border-radius: var(--radius-md);
}

.dropOverlayLabel {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--accent);
  background: var(--bg-panel);
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-lg);
  border: 1px solid var(--accent-glow);
}
```

- [ ] **Step 5: Run all tests**

```bash
cd X:\WebstormProjects\winraid && npm test 2>&1 | tail -20
```

Expected: all 3 new external drop tests pass, all pre-existing tests still pass.

- [ ] **Step 6: Build**

```bash
cd X:\WebstormProjects\winraid && npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 7: Commit everything**

```bash
cd X:\WebstormProjects\winraid && git add \
  electron/queue.js \
  electron/backends/sftp.js \
  electron/backends/smb.js \
  electron/main.js \
  electron/preload.js \
  src/__mocks__/winraid.js \
  src/views/BrowseView.test.jsx \
  src/hooks/useBrowse.js \
  src/views/BrowseView.jsx \
  src/views/BrowseView.module.css && \
git commit -m "add explorer file drop: drag local files/folders into browse view to upload"
```
