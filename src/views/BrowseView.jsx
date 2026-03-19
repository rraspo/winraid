import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Folder, File, Image, Film, ChevronRight, HardDrive, Download, RefreshCw,
  AlertCircle, TriangleAlert, List, LayoutGrid, MoreHorizontal,
} from 'lucide-react'
import styles from './BrowseView.module.css'
import EditorModal from '../components/EditorModal'
import QuickLookOverlay from '../components/QuickLookOverlay'

const EDITABLE_EXTENSIONS = new Set([
  'json', 'yml', 'yaml', 'sh', 'bash', 'zsh',
  'conf', 'ini', 'env', 'toml', 'txt', 'xml', 'lua', 'py', 'nginx',
])

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov'])

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

function isVideoFile(name) {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return VIDEO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
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
// VideoThumb — lazy-loads via IntersectionObserver so only visible video
// thumbnails trigger SFTP range requests.
// ---------------------------------------------------------------------------
function VideoThumb({ url, className, onError }) {
  const wrapRef  = useRef(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setActive(true); obs.disconnect() } },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={wrapRef} className={className}>
      {active && (
        <video
          src={url}
          preload="metadata"
          muted
          className={styles.thumbFill}
          onError={onError}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Thumbnail — cover-fit preview for images and video, icon fallback on error.
// size: 'grid' | 'list'
// ---------------------------------------------------------------------------
function Thumbnail({ name, remotePath, connectionId, size }) {
  const [error, setError] = useState(false)
  const url    = `nas-stream://${connectionId}${remotePath}`
  const isGrid = size === 'grid'

  if (!error && isImageFile(name)) {
    return (
      <img
        src={url}
        loading="lazy"
        className={isGrid ? styles.thumbGrid : styles.thumbList}
        onError={() => setError(true)}
        alt=""
      />
    )
  }

  if (!error && isVideoFile(name)) {
    return (
      <VideoThumb
        url={url}
        className={isGrid ? styles.thumbGrid : styles.thumbList}
        onError={() => setError(true)}
      />
    )
  }

  // Fallback icons
  if (isGrid) {
    if (isImageFile(name) || isVideoFile(name)) return <Film size={40} className={styles.gridIconFile} />
    return <File size={40} className={styles.gridIconFile} />
  }
  if (isImageFile(name)) return <Image size={14} className={styles.iconFile} />
  if (isVideoFile(name)) return <Film  size={14} className={styles.iconFile} />
  return <File size={14} className={styles.iconFile} />
}

// ---------------------------------------------------------------------------
// GridCard
// ---------------------------------------------------------------------------
function GridCard({ entry, entryPath, connectionId, isDir, busy, onNavigate, onQuickLook, onCheckout, onEdit, onMove, onDelete }) {
  const icon = isDir
    ? <Folder size={40} className={styles.gridIconDir} />
    : <Thumbnail name={entry.name} remotePath={entryPath} connectionId={connectionId} size="grid" />

  return (
    <div
      className={[styles.gridCard, isDir ? styles.gridCardDir : styles.gridCardFile].join(' ')}
      onClick={isDir ? () => onNavigate(entryPath) : () => onQuickLook(entry, entryPath)}
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
export default function BrowseView({ onHistoryPush, browseRestore }) {
  const [connections, setConnections]   = useState([])
  const [selectedId, setSelectedId]     = useState(null)
  const [path, setPath]                 = useState('/')
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
  const [selectedFile, setSelectedFile] = useState(null)
  const [showQuickLook, setShowQuickLook] = useState(false)
  // True once the starting path has been recorded in history. Reset on remount.
  // Prevents a duplicate push when browseRestore sets the path programmatically.
  const hasPushedInitialRef = useRef(false)

  useEffect(() => {
    localStorage.setItem('browse-view', viewMode)
  }, [viewMode])

  // Restore navigation state when App drives a back/forward to a browse entry
  useEffect(() => {
    if (!browseRestore) return
    hasPushedInitialRef.current = true  // being restored — no need to push initial
    // Only clear entries when the path actually changes. If we are just toggling
    // Quick Look on the same folder, keeping entries avoids a needless refetch.
    if (browseRestore.path !== path) { // eslint-disable-line react-hooks/exhaustive-deps
      setPath(browseRestore.path)
      setEntries([])
    }
    if (browseRestore.quickLookFile) {
      setSelectedFile(browseRestore.quickLookFile)
      setShowQuickLook(true)
    } else {
      setShowQuickLook(false)
      setSelectedFile(null)
    }
  }, [browseRestore]) // token on browseRestore ensures this fires even if path is same

  useEffect(() => {
    async function load() {
      const conns    = await window.winraid?.config.get('connections') ?? []
      const activeId = await window.winraid?.config.get('activeConnectionId')
      setConnections(conns)
      const initial = conns.find((c) => c.id === activeId) ?? conns[0] ?? null
      setSelectedId(initial?.id ?? null)
      if (initial?.sftp?.remotePath) setPath(initial.sftp.remotePath)
    }
    load()
  }, [])

  // Derive cfg and localFolder from the currently selected connection.
  // cfg must be memoized — a spread creates a new object every render, which
  // would cause fetchDir's useCallback to re-create on every render and trigger
  // the fetchDir useEffect in an infinite loop.
  const selectedConn = connections.find((c) => c.id === selectedId) ?? null
  const cfg = useMemo(
    () => selectedConn ? { ...selectedConn.sftp } : null,
    [selectedId, connections] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const localFolder = selectedConn?.localFolder ?? ''

  function handleSelectConnection(id) {
    const conn = connections.find((c) => c.id === id)
    if (!conn) return
    setSelectedId(id)
    setEntries([])
    setError('')
    setStatus(null)
    const newPath = conn.sftp?.remotePath || '/'
    setPath(newPath)
    onHistoryPush?.({ kind: 'browse', path: newPath, quickLookFile: null })
  }

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

  function pushInitialIfNeeded() {
    if (!hasPushedInitialRef.current) {
      hasPushedInitialRef.current = true
      onHistoryPush?.({ kind: 'browse', path, quickLookFile: null })
    }
  }

  function navigate(newPath) {
    pushInitialIfNeeded()
    setPath(newPath)
    setEntries([])
    setShowQuickLook(false)
    setSelectedFile(null)
    onHistoryPush?.({ kind: 'browse', path: newPath, quickLookFile: null })
  }

  function openQuickLook(entry, entryPath) {
    pushInitialIfNeeded()
    setSelectedFile({ ...entry, path: entryPath })
    setShowQuickLook(true)
    onHistoryPush?.({ kind: 'browse', path, quickLookFile: { ...entry, path: entryPath } })
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
      if (newSyncRoot && selectedConn) {
        const updatedConns = connections.map((c) =>
          c.id === selectedConn.id
            ? { ...c, sftp: { ...c.sftp, remotePath: newSyncRoot } }
            : c
        )
        await window.winraid?.config.set('connections', updatedConns)
        setConnections(updatedConns)
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
    if (!cfg || !selectedConn) return
    const updatedConns = connections.map((c) =>
      c.id === selectedConn.id
        ? { ...c, sftp: { ...c.sftp, remotePath } }
        : c
    )
    await window.winraid?.config.set('connections', updatedConns)
    setConnections(updatedConns)
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

  // Flat list of non-folder entries with their full remote path, used for
  // Quick Look navigation (prev / next arrows).
  const fileEntries = useMemo(
    () => entries
      .filter((e) => e.type !== 'dir')
      .map((e) => ({ ...e, path: joinRemote(path, e.name) })),
    [entries, path]
  )

  return (
    <div className={styles.container}>

      {editingFile && (
        <EditorModal cfg={cfg} filePath={editingFile} onClose={() => setEditingFile(null)} />
      )}
      {showQuickLook && selectedFile && (
        <QuickLookOverlay
          file={selectedFile}
          connectionId={selectedId}
          cfg={cfg}
          files={fileEntries}
          onNavigate={(f) => {
            setSelectedFile(f)
            onHistoryPush?.({ kind: 'browse', path, quickLookFile: f })
          }}
          onClose={() => setShowQuickLook(false)}
          onDelete={(target) => { setShowQuickLook(false); setDeleteTarget(target) }}
        />
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
        <div className={styles.titleRow}>
          <span className={styles.title}>Browse Remote</span>
          {connections.length > 1 && (
            <select
              className={styles.connSelect}
              value={selectedId ?? ''}
              onChange={(e) => handleSelectConnection(e.target.value)}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>{c.name || c.sftp?.host || c.id}</option>
              ))}
            </select>
          )}
        </div>
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

      {connections.length === 0 ? (
        <div className={styles.emptyState}>
          <AlertCircle size={28} />
          <span>No connections configured. Add one in Connections.</span>
        </div>
      ) : noConfig ? (
        <div className={styles.emptyState}>
          <AlertCircle size={28} />
          <span>Selected connection has no host configured.</span>
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
                const icon = isDir
                  ? <Folder size={14} className={styles.iconDir} />
                  : (isImageFile(entry.name) || isVideoFile(entry.name))
                    ? <Thumbnail name={entry.name} remotePath={entryPath} connectionId={selectedId} size="list" />
                    : <File size={14} className={styles.iconFile} />
                return (
                  <div
                    key={entry.name}
                    className={[styles.row, isDir ? styles.rowDir : ''].join(' ')}
                    onClick={!isDir ? () => openQuickLook(entry, entryPath) : undefined}
                    style={!isDir ? { cursor: 'pointer' } : undefined}
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
                    connectionId={selectedId}
                    isDir={isDir}
                    busy={busy}
                    onNavigate={navigate}
                    onQuickLook={openQuickLook}
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
