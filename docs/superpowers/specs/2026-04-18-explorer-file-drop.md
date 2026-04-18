# Explorer File Drop — Design Spec

**Date:** 2026-04-18
**Status:** Approved

## Goal

Allow the user to drag files and folders from Windows Explorer onto the BrowseView pane. WinRaid enqueues them for transfer to the currently-open remote directory, bypassing the need for a configured root watch folder.

## Scope

| Layer | Files |
|---|---|
| Main process | `electron/main.js` (new IPC handler), `electron/backends/sftp.js`, `electron/backends/smb.js` |
| IPC surface | `electron/preload.js` |
| Renderer | `src/hooks/useBrowse.js`, `src/views/BrowseView.jsx`, `src/views/BrowseView.module.css` |

No changes to `queue.js` schema beyond an optional field, `worker.js`, or any other file.

---

## Main Process

### Job schema addition

The job object gains an optional field:

```js
remoteDest?: string   // absolute remote dir path; overrides conn.sftp.remotePath in backend
```

Jobs without `remoteDest` behave identically to today.

### New IPC handler: `queue:drop-upload`

**Channel:** `queue:drop-upload`
**Args:** `(connectionId: string, remoteDest: string, localPaths: string[])`

Behaviour:
1. Validate `connectionId` (non-empty string), `remoteDest` (string starting with `/`), `localPaths` (non-empty array of strings).
2. Look up connection from config; return `{ ok: false, error }` if not found.
3. For each path in `localPaths`:
   - Call `fs.promises.stat(path)` to determine file vs directory.
   - **File:** enqueue with `relPath = basename(path)`, `remoteDest`, `size = stat.size`.
   - **Directory:** walk with `fs.promises.readdir(path, { recursive: true })`; for each file entry enqueue with `relPath = dirBasename + '/' + entryRelPath` (POSIX separators), `remoteDest`, `size` from stat.
4. No `localFolder` containment check — Explorer drops may come from anywhere.
5. Call `ensureWorkerRunning()`.
6. Return `{ ok: true, count }`.

### Backend changes

**`electron/backends/sftp.js`** — one-line change in `transfer()`:

```js
// before
const remotePath = buildRemotePath(cfg.remotePath, job.relPath)
// after
const remotePath = buildRemotePath(job.remoteDest ?? cfg.remotePath, job.relPath)
```

**`electron/backends/smb.js`** — same override applied to its equivalent remote path construction.

### Preload

```js
// added to queue namespace
dropUpload: (connectionId, remoteDest, localPaths) =>
  ipcRenderer.invoke('queue:drop-upload', connectionId, remoteDest, localPaths),
```

---

## Renderer

### `useBrowse` additions

**New state:**
```js
const [externalDropActive, setExternalDropActive] = useState(false)
```

**New handlers (returned from the hook):**

```js
function handleExternalDragOver(e) {
  if (dragSource) return                           // internal drag — ignore
  if (!e.dataTransfer.types.includes('Files')) return
  e.preventDefault()
  setExternalDropActive(true)
}

function handleExternalDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    setExternalDropActive(false)
  }
}

async function handleExternalDrop(e) {
  e.preventDefault()
  setExternalDropActive(false)
  if (!selectedId) return
  const localPaths = Array.from(e.dataTransfer.files).map((f) => f.path).filter(Boolean)
  if (!localPaths.length) return
  await window.winraid?.queue.dropUpload(selectedId, path, localPaths)
}
```

`dragSource` comes from `useDragDrop` (already in scope in `useBrowse`). The check prevents the external overlay from activating during internal drag-and-drop operations.

All three handlers and `externalDropActive` are returned from `useBrowse`.

### `BrowseView.jsx`

The root container `<div>` receives:

```jsx
onDragOver={handleExternalDragOver}
onDragLeave={handleExternalDragLeave}
onDrop={handleExternalDrop}
```

When `externalDropActive` is true, a drop overlay is rendered inside the container:

```jsx
{externalDropActive && (
  <div className={styles.dropOverlay}>
    <span className={styles.dropOverlayLabel}>Drop to upload to {path}</span>
  </div>
)}
```

### `BrowseView.module.css`

```css
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

Z-index 10 keeps the overlay above the list/grid but below modals (which use z-index 100).

---

## Edge Cases

| Case | Behaviour |
|---|---|
| Internal drag active | `handleExternalDragOver` returns early; overlay never shows |
| SMB connection | `job.remoteDest` overrides SMB base path the same way as SFTP |
| No active connection (`selectedId` null) | `handleExternalDrop` returns early, no IPC call |
| `f.path` undefined (non-Electron context) | Filtered out by `.filter(Boolean)` |
| Empty directory dropped | Walk yields no files; count = 0, no jobs enqueued |
| Mixed file + folder drop | Both handled in the same loop in `queue:drop-upload` |
