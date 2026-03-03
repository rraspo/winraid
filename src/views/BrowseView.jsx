import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Folder, File, Image, ChevronRight, HardDrive, Download, RefreshCw,
  AlertCircle, TriangleAlert, List, LayoutGrid, MoreHorizontal,
} from 'lucide-react'
import styles from './BrowseView.module.css'
import EditorModal from '../components/EditorModal'

const EDITABLE_EXTENSIONS = new Set([
  'json', 'yml', 'yaml', 'sh', 'bash', 'zsh',
  'conf', 'ini', 'env', 'toml', 'txt', 'xml', 'lua', 'py', 'nginx',
])

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'])

function isEditableFile(name) {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return EDITABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

function isImageFile(name) {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024)      return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function joinRemote(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

function isOutsideRoot(remotePath, cfgRemotePath) {
  if (!cfgRemotePath) return false
  const base = cfgRemotePath.replace(/\/+$/, '')
  return remotePath !== base && !remotePath.startsWith(base + '/')
}

function remoteParent(p) {
  const parts = p.split('/').filter(Boolean)
  parts.pop()
  return '/' + parts.join('/')
}

// ---------------------------------------------------------------------------
// EntryMenu — 3-dot context menu, shared by grid cards and list rows.
// Uses position:fixed on the dropdown so it escapes any overflow container.
// ---------------------------------------------------------------------------
function EntryMenu({ isDir, isEditable, busy, onCheckout, onEdit, onMove, onDelete }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, right: 0 })
  const wrapRef = useRef(null)

  function toggle(e) {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function act(fn) {
    return (e) => { e.stopPropagation(); setOpen(false); fn() }
  }

  return (
    <div ref={wrapRef} className={styles.menuWrap}>
      <button
        className={styles.menuDotBtn}
        onClick={toggle}
        disabled={busy}
        title="Actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div className={styles.menuDropdown} style={{ top: pos.top, right: pos.right }}>
          {isDir && (
            <button className={styles.menuItem} onClick={act(onCheckout)}>
              Check out
            </button>
          )}
          {isEditable && (
            <button className={styles.menuItem} onClick={act(onEdit)}>
              Edit
            </button>
          )}
          <button className={styles.menuItem} onClick={act(onMove)}>
            Move / Rename
          </button>
          <div className={styles.menuDivider} />
          <button
            className={[styles.menuItem, styles.menuItemDanger].join(' ')}
            onClick={act(onDelete)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GridCard
// ---------------------------------------------------------------------------
function GridCard({ entry, entryPath, isDir, busy, onNavigate, onCheckout, onEdit, onMove, onDelete }) {
  const icon = isDir
    ? <Folder size={40} className={styles.gridIconDir} />
    : isImageFile(entry.name)
      ? <Image  size={40} className={styles.gridIconFile} />
      : <File   size={40} className={styles.gridIconFile} />

  return (
    <div
      className={[styles.gridCard, isDir ? styles.gridCardDir : ''].join(' ')}
      onClick={isDir ? () => onNavigate(entryPath) : undefined}
    >
      <div className={styles.gridThumb}>{icon}</div>

      <div className={styles.gridMeta}>
        <div className={styles.gridMetaRow}>
          <span className={styles.gridName} title={entry.name}>{entry.name}</span>
          <EntryMenu
            isDir={isDir}
            isEditable={!isDir && isEditableFile(entry.name)}
            busy={busy}
            onCheckout={() => onCheckout(entryPath)}
            onEdit={() => onEdit(entryPath)}
            onMove={() => onMove({ name: entry.name, path: entryPath })}
            onDelete={() => onDelete({ name: entry.name, path: entryPath, isDir })}
          />
        </div>
        {!isDir && <span className={styles.gridSize}>{formatSize(entry.size)}</span>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeleteModal
// ---------------------------------------------------------------------------
function DeleteModal({ target, onConfirm, onCancel }) {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={[styles.modalIconWrap, styles.modalIconDanger].join(' ')}>
            <AlertCircle size={20} />
          </span>
          <div>
            <h2 className={styles.modalTitle}>
              Delete {target.isDir ? 'folder' : 'file'}?
            </h2>
            <p className={styles.modalSubtitle}>
              <strong>{target.name}</strong> will be permanently deleted
              {target.isDir ? ' along with all its contents' : ''}.
              This cannot be undone.
            </p>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button className={styles.modalConfirm} onClick={() => onConfirm(target)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MoveModal
// ---------------------------------------------------------------------------
function MoveModal({ target, onConfirm, onCancel }) {
  const [dest, setDest] = useState(target.path)
  const trimmed = dest.trim()
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalIconWrap}>
            <TriangleAlert size={20} />
          </span>
          <div>
            <h2 className={styles.modalTitle}>Move / Rename</h2>
            <p className={styles.modalSubtitle}>
              Enter the new full path for <strong>{target.name}</strong>.
            </p>
          </div>
        </div>
        <div className={styles.modalFields}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Destination path</label>
            <input
              className={styles.fieldInput}
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              spellCheck={false}
              autoFocus
            />
            <p className={styles.fieldHint}>
              Change the directory portion to move, or just the filename to rename.
            </p>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button
            className={styles.modalConfirmAccent}
            onClick={() => onConfirm(target.path, trimmed)}
            disabled={!trimmed || trimmed === target.path}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConfirmModal (checkout outside root)
// ---------------------------------------------------------------------------
function ConfirmModal({ remotePath, cfgRemotePath, localFolder, onConfirm, onCancel }) {
  const [checkoutPath, setCheckoutPath] = useState(remotePath)
  const [watchFolder,  setWatchFolder]  = useState(localFolder)
  const newSyncRoot = remoteParent(checkoutPath.trim() || remotePath)

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalIconWrap}><TriangleAlert size={20} /></span>
          <div>
            <h2 className={styles.modalTitle}>Outside sync root</h2>
            <p className={styles.modalSubtitle}>
              This folder is outside your configured remote path. The watch folder will
              be cleared and the sync root will be updated to match.
            </p>
          </div>
        </div>

        <div className={styles.modalFields}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Current sync root</label>
            <div className={styles.fieldReadonly}>{cfgRemotePath}</div>
            <p className={styles.fieldHint}>Your existing remote path configuration</p>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Checking out</label>
            <input
              className={styles.fieldInput}
              value={checkoutPath}
              onChange={(e) => setCheckoutPath(e.target.value)}
              spellCheck={false}
            />
            <p className={styles.fieldHint}>Remote folder whose structure will be mirrored locally</p>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>New sync root</label>
            <div className={styles.fieldReadonly}>{newSyncRoot}</div>
            <p className={styles.fieldHint}>Replaces your current sync root so relative paths stay aligned</p>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Local watch folder</label>
            <input
              className={styles.fieldInput}
              value={watchFolder}
              onChange={(e) => setWatchFolder(e.target.value)}
              spellCheck={false}
            />
            <p className={styles.fieldHint}>All contents will be deleted before checkout</p>
          </div>
        </div>

        <div className={styles.modalWarning}>
          <AlertCircle size={14} />
          <span>
            Everything inside <strong>{watchFolder || localFolder}</strong> will be
            permanently deleted before the folder structure is created.
          </span>
        </div>

        <div className={styles.modalActions}>
          <button className={styles.modalCancel} onClick={onCancel}>Cancel</button>
          <button
            className={styles.modalConfirm}
            onClick={() => onConfirm(checkoutPath, watchFolder, newSyncRoot)}
            disabled={!checkoutPath.trim() || !watchFolder.trim()}
          >
            Clear &amp; check out
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function BrowseView() {
  const [cfg, setCfg]                   = useState(null)
  const [localFolder, setLocalFolder]   = useState('')
  const [path, setPath]                 = useState('/mnt/user')
  const [entries, setEntries]           = useState([])
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const [status, setStatus]             = useState(null)
  const [opInFlight, setOpInFlight]     = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [editingFile, setEditingFile]   = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [moveTarget, setMoveTarget]     = useState(null)
  const [viewMode, setViewMode]         = useState(() => localStorage.getItem('browse-view') ?? 'list')

  useEffect(() => {
    localStorage.setItem('browse-view', viewMode)
  }, [viewMode])

  useEffect(() => {
    async function load() {
      const sftp   = await window.winraid?.config.get('sftp')
      const folder = await window.winraid?.config.get('localFolder')
      setCfg(sftp   ?? null)
      setLocalFolder(folder ?? '')
    }
    load()
  }, [])

  const fetchDir = useCallback(async (targetPath) => {
    if (!cfg?.host) return
    setLoading(true)
    setError('')
    setStatus(null)
    const res = await window.winraid?.remote.list(cfg, targetPath)
    setLoading(false)
    if (res?.ok) {
      setEntries(res.entries)
    } else {
      setError(res?.error || 'Failed to list directory')
      setEntries([])
    }
  }, [cfg])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cfg) fetchDir(path)
  }, [cfg, path, fetchDir])

  function navigate(newPath) {
    setPath(newPath)
    setEntries([])
  }

  function buildBreadcrumbs() {
    const parts = path.split('/').filter(Boolean)
    const crumbs = [{ label: 'root', path: '/' }]
    let built = ''
    for (const p of parts) {
      built += '/' + p
      crumbs.push({ label: p, path: built })
    }
    return crumbs
  }

  async function doCheckout(remotePath, clearFirst = false, targetFolder = localFolder, newSyncRoot = null) {
    setOpInFlight(true)
    setStatus(null)
    if (clearFirst) {
      const clearRes = await window.winraid?.local.clearFolder(targetFolder)
      if (!clearRes?.ok) {
        setOpInFlight(false)
        setStatus({ ok: false, msg: `Failed to clear watch folder: ${clearRes?.error}` })
        return
      }
    }
    const res = await window.winraid?.remote.checkout(cfg, remotePath, targetFolder)
    setOpInFlight(false)
    if (res?.ok) {
      if (newSyncRoot) {
        const updated = { ...cfg, remotePath: newSyncRoot }
        await window.winraid?.config.set('sftp', updated)
        setCfg(updated)
      }
      setStatus({ ok: true, msg: `Created ${res.created?.length ?? 0} folder(s) under ${targetFolder}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Checkout failed' })
    }
  }

  function handleCheckout(remotePath) {
    if (!cfg || !localFolder || opInFlight) return
    if (isOutsideRoot(remotePath, cfg.remotePath)) {
      setConfirmTarget(remotePath)
    } else {
      doCheckout(remotePath)
    }
  }

  function handleConfirm(checkoutPath, targetFolder, newSyncRoot) {
    setConfirmTarget(null)
    doCheckout(checkoutPath, true, targetFolder, newSyncRoot)
  }

  async function handleSetRoot(remotePath) {
    if (!cfg) return
    const updated = { ...cfg, remotePath }
    await window.winraid?.config.set('sftp', updated)
    setCfg(updated)
    setStatus({ ok: true, msg: `Sync root updated to ${remotePath}` })
  }

  async function handleDelete(target) {
    setDeleteTarget(null)
    setOpInFlight(true)
    setStatus(null)
    const res = await window.winraid?.remote.delete(cfg, target.path, target.isDir)
    setOpInFlight(false)
    if (res?.ok) {
      setEntries((prev) => prev.filter((e) => e.name !== target.name))
      setStatus({ ok: true, msg: `Deleted ${target.path}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Delete failed' })
    }
  }

  async function handleMove(srcPath, dstPath) {
    setMoveTarget(null)
    setOpInFlight(true)
    setStatus(null)
    const res = await window.winraid?.remote.move(cfg, srcPath, dstPath)
    setOpInFlight(false)
    if (res?.ok) {
      setStatus({ ok: true, msg: `Moved to ${dstPath}` })
      fetchDir(path)
    } else {
      setStatus({ ok: false, msg: res?.error || 'Move failed' })
    }
  }

  const busy     = opInFlight
  const noConfig = !cfg?.host
  const crumbs   = buildBreadcrumbs()

  return (
    <div className={styles.container}>

      {editingFile && (
        <EditorModal cfg={cfg} filePath={editingFile} onClose={() => setEditingFile(null)} />
      )}
      {confirmTarget && (
        <ConfirmModal
          remotePath={confirmTarget}
          cfgRemotePath={cfg.remotePath}
          localFolder={localFolder}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          target={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {moveTarget && (
        <MoveModal
          target={moveTarget}
          onConfirm={handleMove}
          onCancel={() => setMoveTarget(null)}
        />
      )}

      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>Browse Remote</span>
        <div className={styles.headerRight}>
          {!noConfig && (
            <>
              {cfg?.remotePath && path !== cfg.remotePath && (
                <button
                  className={styles.goRootBtn}
                  onClick={() => navigate(cfg.remotePath)}
                  disabled={loading}
                  title={`Jump to sync root: ${cfg.remotePath}`}
                >
                  ↑ Go to root
                </button>
              )}
              <button
                className={styles.setRootBtn}
                onClick={() => handleSetRoot(path)}
                disabled={busy || loading || cfg?.remotePath === path}
                title="Set current folder as sync root"
              >
                Set root here
              </button>
              <button
                className={styles.checkoutBtn}
                onClick={() => handleCheckout(path)}
                disabled={busy || loading}
                title={`Check out current folder structure to ${localFolder}`}
              >
                <Download size={13} />
                Check out here
              </button>
            </>
          )}

          <div className={styles.viewToggle}>
            <button
              className={[styles.viewBtn, viewMode === 'list' ? styles.viewBtnActive : ''].join(' ')}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <List size={14} />
            </button>
            <button
              className={[styles.viewBtn, viewMode === 'grid' ? styles.viewBtnActive : ''].join(' ')}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <LayoutGrid size={14} />
            </button>
          </div>

          <button
            className={styles.refreshBtn}
            onClick={() => fetchDir(path)}
            disabled={loading || noConfig}
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? styles.spinning : ''} />
          </button>
        </div>
      </div>

      {noConfig ? (
        <div className={styles.emptyState}>
          <AlertCircle size={28} />
          <span>No SSH connection configured. Set one up in Settings.</span>
        </div>
      ) : (
        <>
          {/* Breadcrumb */}
          <div className={styles.breadcrumb}>
            {crumbs.map((c, i) => (
              <span key={c.path} className={styles.crumbGroup}>
                {i > 0 && <ChevronRight size={11} className={styles.crumbSep} />}
                <button
                  className={[styles.crumb, c.path === path ? styles.crumbActive : ''].join(' ')}
                  onClick={() => c.path !== path && navigate(c.path)}
                  disabled={c.path === path}
                >
                  {i === 0 ? <HardDrive size={11} /> : c.label}
                </button>
              </span>
            ))}
          </div>

          {status && (
            <div className={[styles.statusFlash, status.ok ? styles.statusOk : styles.statusErr].join(' ')}>
              {status.msg}
            </div>
          )}

          {error && (
            <div className={styles.errorBanner}>
              <AlertCircle size={13} />
              {error}
            </div>
          )}

          {/* List view */}
          {viewMode === 'list' && (
            <div className={styles.listWrapper}>
              {entries.length === 0 && !loading && !error && (
                <div className={styles.emptyDir}>Empty folder</div>
              )}
              {entries.length > 0 && (
                <div className={styles.colHeader}>
                  <span className={styles.colName}>Name</span>
                  <span className={styles.colSize}>Size</span>
                  <span className={styles.colDate}>Modified</span>
                  <span className={styles.colActions} />
                </div>
              )}
              {entries.map((entry) => {
                const entryPath = joinRemote(path, entry.name)
                const isDir     = entry.type === 'dir'
                const icon      = isDir
                  ? <Folder size={14} className={styles.iconDir} />
                  : isImageFile(entry.name)
                    ? <Image size={14} className={styles.iconFile} />
                    : <File  size={14} className={styles.iconFile} />
                return (
                  <div
                    key={entry.name}
                    className={[styles.row, isDir ? styles.rowDir : ''].join(' ')}
                  >
                    <div className={styles.rowName}>
                      {icon}
                      {isDir ? (
                        <button className={styles.nameBtn} onClick={() => navigate(entryPath)}>
                          {entry.name}
                        </button>
                      ) : (
                        <span className={styles.nameText}>{entry.name}</span>
                      )}
                    </div>
                    <span className={styles.rowSize}>{isDir ? '—' : formatSize(entry.size)}</span>
                    <span className={styles.rowDate}>{formatDate(entry.modified)}</span>
                    <div className={styles.rowActions}>
                      <EntryMenu
                        isDir={isDir}
                        isEditable={!isDir && isEditableFile(entry.name)}
                        busy={busy}
                        onCheckout={() => handleCheckout(entryPath)}
                        onEdit={() => setEditingFile(entryPath)}
                        onMove={() => setMoveTarget({ name: entry.name, path: entryPath })}
                        onDelete={() => setDeleteTarget({ name: entry.name, path: entryPath, isDir })}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Grid view */}
          {viewMode === 'grid' && (
            <div className={styles.gridWrapper}>
              {entries.length === 0 && !loading && !error && (
                <div className={styles.emptyDir}>Empty folder</div>
              )}
              {entries.map((entry) => {
                const entryPath = joinRemote(path, entry.name)
                const isDir     = entry.type === 'dir'
                return (
                  <GridCard
                    key={entry.name}
                    entry={entry}
                    entryPath={entryPath}
                    isDir={isDir}
                    busy={busy}
                    onNavigate={navigate}
                    onCheckout={handleCheckout}
                    onEdit={setEditingFile}
                    onMove={setMoveTarget}
                    onDelete={setDeleteTarget}
                  />
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
