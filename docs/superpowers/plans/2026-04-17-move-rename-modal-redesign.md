# Move / Rename Modal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw full-path text field in MoveModal and BulkMoveModal with separate Name and Folder fields, each with a Browse button that opens the existing RemotePathBrowser picker.

**Architecture:** Three files change. MoveModal gets two fields (Name + Folder) and an embedded RemotePathBrowser. BulkMoveModal gets a Browse button on its existing Folder field. BrowseView derives `sftpCfg` from the active connection and passes it to both modals. No IPC, hook, or backend changes.

**Tech Stack:** React 18, CSS Modules (`modals.module.css`), existing `RemotePathBrowser` component.

---

## File Map

| File | Change |
|---|---|
| `src/components/modals/modals.module.css` | Add `.fieldInputRow` flex wrapper class |
| `src/components/modals/MoveModal.jsx` | Full rewrite — Name + Folder fields, Browse button, RemotePathBrowser |
| `src/components/modals/BulkMoveModal.jsx` | Add `sftpCfg` prop, Browse button, RemotePathBrowser |
| `src/views/BrowseView.jsx` | Derive `sftpCfg`, pass to both modals |

---

## Task 1: Add `.fieldInputRow` CSS to `modals.module.css`

**Files:**
- Modify: `src/components/modals/modals.module.css`

This class wraps an `<input>` and a compact Browse button side-by-side. The input takes all remaining space; the button is fixed-width and shrinks nothing.

- [ ] **Step 1: Append the new class to the bottom of the file**

Open `src/components/modals/modals.module.css` and add at the end:

```css
/* Input + Browse button row */
.fieldInputRow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.fieldInputRow .fieldInput {
  flex: 1;
  width: auto;
}

.fieldBrowseBtn {
  height: 36px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
  flex-shrink: 0;
  transition: color var(--transition), background-color var(--transition);
}

.fieldBrowseBtn:hover { background: var(--bg-hover); color: var(--text); }
.fieldBrowseBtn:disabled { opacity: 0.35; cursor: default; }
```

- [ ] **Step 2: Verify no existing class is named `.fieldInputRow` or `.fieldBrowseBtn`**

Run:
```bash
grep -n "fieldInputRow\|fieldBrowseBtn" src/components/modals/modals.module.css
```

Expected: only the lines you just added appear.

---

## Task 2: Rewrite `MoveModal.jsx`

**Files:**
- Modify: `src/components/modals/MoveModal.jsx`

### What this does

- Accepts a new `sftpCfg` prop alongside the existing `target` / `onConfirm` / `onCancel`.
- Splits state into `name` (filename only) and `folder` (directory portion).
- Adds a `browsing` boolean state to mount/unmount `RemotePathBrowser`.
- Assembles the final destination as `folder.replace(/\/+$/, '') + '/' + name` before calling `onConfirm`.
- If `sftpCfg` is null (SMB connection), the Browse button is hidden — the folder field remains editable as plain text, preserving existing behaviour.

### Path splitting helper (inline, no import needed)

```js
// dirOf('/mnt/user/movies/foo.mkv') → '/mnt/user/movies'
// dirOf('/foo.mkv')                 → '/'
function dirOf(fullPath) {
  const idx = fullPath.lastIndexOf('/')
  return idx <= 0 ? '/' : fullPath.slice(0, idx)
}
```

- [ ] **Step 1: Replace the entire file with the new implementation**

```jsx
import { useState } from 'react'
import { FolderInput } from 'lucide-react'
import RemotePathBrowser from '../RemotePathBrowser'
import styles from './modals.module.css'

function dirOf(fullPath) {
  const idx = fullPath.lastIndexOf('/')
  return idx <= 0 ? '/' : fullPath.slice(0, idx)
}

export default function MoveModal({ target, sftpCfg, onConfirm, onCancel }) {
  const [name, setName]       = useState(target.name)
  const [folder, setFolder]   = useState(dirOf(target.path))
  const [browsing, setBrowsing] = useState(false)

  const trimmedName   = name.trim()
  const trimmedFolder = folder.trim().replace(/\/+$/, '') || '/'
  const assembled     = trimmedFolder === '/' ? `/${trimmedName}` : `${trimmedFolder}/${trimmedName}`
  const unchanged     = assembled === target.path
  const invalid       = !trimmedName || unchanged

  function handleSelect(pathOrPaths) {
    const picked = Array.isArray(pathOrPaths) ? pathOrPaths[0] : pathOrPaths
    if (picked) setFolder(picked)
    setBrowsing(false)
  }

  return (
    <>
      <div className={styles.modalOverlay}>
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <span className={styles.modalIconWrap}>
              <FolderInput size={20} />
            </span>
            <div>
              <h2 className={styles.modalTitle}>Move / Rename</h2>
              <p className={styles.modalSubtitle}>
                Rename or move <strong>{target.name}</strong>.
              </p>
            </div>
          </div>

          <div className={styles.modalFields}>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Name</label>
              <input
                className={styles.fieldInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                spellCheck={false}
                autoFocus
              />
            </div>

            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Folder</label>
              <div className={styles.fieldInputRow}>
                <input
                  className={styles.fieldInput}
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  spellCheck={false}
                />
                {sftpCfg && (
                  <button
                    className={styles.fieldBrowseBtn}
                    onClick={() => setBrowsing(true)}
                  >
                    Browse
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={styles.modalActions}>
            <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
            <button
              className={styles.modalConfirmAccent}
              onClick={() => onConfirm(target.path, assembled)}
              disabled={invalid}
            >
              Move
            </button>
          </div>
        </div>
      </div>

      {browsing && sftpCfg && (
        <RemotePathBrowser
          sftpCfg={sftpCfg}
          initialPath={folder || '/'}
          onSelect={handleSelect}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify the app builds without errors**

Run:
```bash
npm run build 2>&1 | tail -20
```

Expected: build completes with no errors referencing `MoveModal`.

---

## Task 3: Rewrite `BulkMoveModal.jsx`

**Files:**
- Modify: `src/components/modals/BulkMoveModal.jsx`

### What this does

- Accepts a new `sftpCfg` prop.
- Adds a Browse button next to the existing destination folder input.
- Opens `RemotePathBrowser`; on select calls `onDestChange` with the picked path.
- Browse button hidden when `sftpCfg` is null.

- [ ] **Step 1: Replace the entire file**

```jsx
import { useState } from 'react'
import { FolderInput } from 'lucide-react'
import RemotePathBrowser from '../RemotePathBrowser'
import styles from './modals.module.css'

export default function BulkMoveModal({ count, names, dest, onDestChange, onConfirm, onCancel, currentPath, sftpCfg }) {
  const [browsing, setBrowsing] = useState(false)

  function handleSelect(pathOrPaths) {
    const picked = Array.isArray(pathOrPaths) ? pathOrPaths[0] : pathOrPaths
    if (picked) onDestChange(picked)
    setBrowsing(false)
  }

  return (
    <>
      <div className={styles.modalOverlay}>
        <div className={styles.modal}>
          <div className={styles.modalHeader}>
            <span className={styles.modalIconWrap}>
              <FolderInput size={20} />
            </span>
            <div>
              <h2 className={styles.modalTitle}>
                Move {count} item{count !== 1 ? 's' : ''}
              </h2>
              <p className={styles.modalSubtitle}>
                Move {names.join(', ')} to a new location.
              </p>
            </div>
          </div>

          <div className={styles.modalFields}>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Destination folder</label>
              <div className={styles.fieldInputRow}>
                <input
                  className={styles.fieldInput}
                  value={dest}
                  onChange={(e) => onDestChange(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
                {sftpCfg && (
                  <button
                    className={styles.fieldBrowseBtn}
                    onClick={() => setBrowsing(true)}
                  >
                    Browse
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={styles.modalActions}>
            <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
            <button
              className={styles.modalConfirmAccent}
              onClick={onConfirm}
              disabled={!dest.trim() || dest.trim() === currentPath}
            >
              Move
            </button>
          </div>
        </div>
      </div>

      {browsing && sftpCfg && (
        <RemotePathBrowser
          sftpCfg={sftpCfg}
          initialPath={dest || currentPath || '/'}
          onSelect={handleSelect}
          onClose={() => setBrowsing(false)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: no errors referencing `BulkMoveModal`.

---

## Task 4: Pass `sftpCfg` from `BrowseView`

**Files:**
- Modify: `src/views/BrowseView.jsx`

### What this does

Derives `sftpCfg` from the active connection and passes it to both `MoveModal` and `BulkMoveModal`. The derivation reads from `connections` (already in scope via `useBrowse`) and `selectedId`.

- [ ] **Step 1: Add the `sftpCfg` derivation after the `useBrowse` destructure block**

In `BrowseView.jsx`, after the closing `} = browse` line (around line 42), add:

```js
const sftpCfg = (connections ?? []).find((c) => c.id === selectedId)?.sftp ?? null
```

- [ ] **Step 2: Pass `sftpCfg` to `MoveModal`**

Find the `MoveModal` usage (around line 102) and add the prop:

```jsx
{moveTarget && (
  <MoveModal
    target={moveTarget}
    sftpCfg={sftpCfg}
    onConfirm={handleMove}
    onCancel={() => setMoveTarget(null)}
  />
)}
```

- [ ] **Step 3: Pass `sftpCfg` to `BulkMoveModal`**

Find the `BulkMoveModal` usage (around line 117) and add the prop:

```jsx
{bulkAction === 'move' && (
  <BulkMoveModal
    count={selected.size}
    names={selectedEntries.map((e) => e.name)}
    dest={bulkMoveDest}
    onDestChange={setBulkMoveDest}
    onConfirm={handleBulkMove}
    onCancel={() => { setBulkAction(null); setBulkMoveDest('') }}
    currentPath={path}
    sftpCfg={sftpCfg}
  />
)}
```

- [ ] **Step 4: Final build and smoke test**

```bash
npm run build 2>&1 | tail -20
```

Expected: clean build. Then run `npm run dev`, open the app, navigate to a connection's browse view, right-click a file and choose "Move / Rename" — confirm you see two separate Name and Folder fields with a Browse button on the Folder field.

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/modals.module.css \
        src/components/modals/MoveModal.jsx \
        src/components/modals/BulkMoveModal.jsx \
        src/views/BrowseView.jsx
git commit -m "improve move/rename modal UX: split name and folder fields with remote browser"
```
