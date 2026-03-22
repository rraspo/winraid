import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Folder, File, Image, Film, ChevronRight, HardDrive, Download, RefreshCw,
  AlertCircle, TriangleAlert, List, LayoutGrid, MoreHorizontal, Loader,
  Trash2, FolderInput, FolderPlus, X as XIcon,
} from 'lucide-react'
import styles from './BrowseView.module.css'
import EditorModal from '../components/EditorModal'
import QuickLookOverlay from '../components/QuickLookOverlay'
import Tooltip from '../components/ui/Tooltip'

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

  const dropdownRef = useRef(null)

  function toggle(e) {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right, bottom: null })
    setOpen(true)
  }

  // Flip above the button if the dropdown overflows the viewport
  useEffect(() => {
    if (!open || !dropdownRef.current || !wrapRef.current) return
    const dropRect = dropdownRef.current.getBoundingClientRect()
    if (dropRect.bottom > window.innerHeight) {
      const btnRect = wrapRef.current.getBoundingClientRect()
      setPos((prev) => ({ ...prev, top: btnRect.top - dropRect.height - 4, bottom: null }))
    }
  }, [open])

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
      <Tooltip tip="Actions" side="bottom">
        <button
          className={styles.menuDotBtn}
          onClick={toggle}
          disabled={busy}
        >
          <MoreHorizontal size={14} />
        </button>
      </Tooltip>

      {open && (
        <div ref={dropdownRef} className={styles.menuDropdown} style={{ top: pos.top ?? undefined, bottom: pos.bottom ?? undefined, right: pos.right }}>
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
    if (isImageFile(name)) return <Image size={40} className={styles.gridIconFile} />
    if (isVideoFile(name)) return <Film size={40} className={styles.gridIconFile} />
    return <File size={40} className={styles.gridIconFile} />
  }
  if (isImageFile(name)) return <Image size={14} className={styles.iconFile} />
  if (isVideoFile(name)) return <Film  size={14} className={styles.iconFile} />
  return <File size={14} className={styles.iconFile} />
}

// ---------------------------------------------------------------------------
// GridCard
// ---------------------------------------------------------------------------
function GridCard({ entry, entryPath, connectionId, isDir, busy, isSelected, isDragSource, isDropTarget, isLastVisited, isHighlighted, highlightRef, onSelect, onNavigate, onQuickLook, onCheckout, onEdit, onMove, onDelete, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }) {
  const icon = isDir
    ? <Folder size={40} className={styles.gridIconDir} />
    : <Thumbnail name={entry.name} remotePath={entryPath} connectionId={connectionId} size="grid" />

  return (
    <div
      ref={isHighlighted ? highlightRef : undefined}
      className={[
        styles.gridCard,
        isDir ? styles.gridCardDir : styles.gridCardFile,
        isSelected ? styles.gridCardSelected : '',
        isDragSource ? styles.dragging : '',
        isDropTarget ? styles.dropTarget : '',
        isLastVisited ? styles.lastVisited : '',
        isHighlighted ? 'shimmer shimmer-border shimmer-once' : '',
      ].join(' ')}
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={isDir ? onDragOver : undefined}
      onDragLeave={isDir ? onDragLeave : undefined}
      onDrop={isDir ? onDrop : undefined}
      onClick={isDir ? () => onNavigate(entryPath) : () => onQuickLook(entry, entryPath)}
    >
      <div className={styles.gridThumb}>
        {icon}
        <label className={styles.gridCheckbox} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={(e) => onSelect(entry.name, e)} />
          <span className={styles.checkmark} />
        </label>
      </div>

      <div className={styles.gridMeta}>
        <div className={styles.gridMetaRow}>
          <div className={styles.gridNameWrap}>
            <Tooltip tip={entry.name} followMouse><span className={styles.gridName}>{entry.name}</span></Tooltip>
          </div>
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
  const [newFolderName, setNewFolderName] = useState(null)  // string when prompt is open, null when closed
  const [viewMode, setViewMode]         = useState(() => localStorage.getItem('browse-view') ?? 'list')
  const [selectedFile, setSelectedFile] = useState(null)
  const [showQuickLook, setShowQuickLook] = useState(false)
  const [dragSource, setDragSource]       = useState(null)   // { name, path }
  const [dropTargetPath, setDropTargetPath] = useState(null)  // remote dir path being hovered
  const [moveInFlight, setMoveInFlight]   = useState(null)    // { name, from, to } while move is running
  const [lastVisitedDir, setLastVisitedDir] = useState(null) // folder name to highlight after navigating up
  const [highlightFile, setHighlightFile]  = useState(null)  // filename to briefly highlight after queue navigation
  const [selected, setSelected]           = useState(new Set())  // Set of entry names
  const [bulkAction, setBulkAction]       = useState(null)   // 'delete' | 'move' | null
  const [bulkMoveDest, setBulkMoveDest]   = useState('')
  const dwellTimer = useRef(null)  // auto-navigate timer when hovering a folder while dragging
  const listScrollRef = useRef(null)

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 41, // 40px row + 1px border
    overscan: 15,
  })

  useEffect(() => {
    localStorage.setItem('browse-view', viewMode)
  }, [viewMode])

  // Clean up dwell timer on unmount
  useEffect(() => () => clearTimeout(dwellTimer.current), [])


  // Restore navigation state when App drives a back/forward to a browse entry
  useEffect(() => {
    if (!browseRestore) return

    // Switch connection if specified and different from current
    if (browseRestore.connectionId && browseRestore.connectionId !== selectedId) {
      setSelectedId(browseRestore.connectionId)
      setEntries([])
      setError('')
      setStatus(null)
    }

    // Only clear entries when the path actually changes. If we are just toggling
    // Quick Look on the same folder, keeping entries avoids a needless refetch.
    if (browseRestore.path !== path) { // eslint-disable-line react-hooks/exhaustive-deps
      // Highlight the folder we came from when going back to a parent
      if (path.startsWith(browseRestore.path) && path !== browseRestore.path) {
        const remainder = path.slice(browseRestore.path === '/' ? 1 : browseRestore.path.length + 1)
        const immediateChild = remainder.split('/')[0]
        setLastVisitedDir(immediateChild || null)
      } else {
        setLastVisitedDir(null)
      }
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
    if (browseRestore.highlightFile) {
      setHighlightFile(browseRestore.highlightFile)
    }
  }, [browseRestore]) // token on browseRestore ensures this fires even if path is same

  // Clear highlight when user navigates to a different directory
  const prevPath = useRef(path)
  useEffect(() => {
    if (prevPath.current !== path && !browseRestore?.highlightFile) {
      setHighlightFile(null)
    }
    prevPath.current = path
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll the highlighted element into view via virtualizer or DOM
  const highlightRef = useCallback((node) => {
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  // Scroll virtualizer to highlighted file when entries load
  useEffect(() => {
    if (!highlightFile || entries.length === 0) return
    const idx = entries.findIndex((e) => e.name === highlightFile)
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'center', behavior: 'smooth' })
  }, [highlightFile, entries]) // eslint-disable-line react-hooks/exhaustive-deps

  const browseRestoreRef = useRef(browseRestore)
  browseRestoreRef.current = browseRestore

  useEffect(() => {
    async function load() {
      const conns    = await window.winraid?.config.get('connections') ?? []
      const activeId = await window.winraid?.config.get('activeConnectionId')
      setConnections(conns)
      const restore = browseRestoreRef.current
      if (restore?.connectionId && conns.find((c) => c.id === restore.connectionId)) {
        // browseRestore already set selectedId and path — connections are now loaded
        setSelectedId(restore.connectionId)
        if (restore.path) setPath(restore.path)
        return
      }
      const initial = conns.find((c) => c.id === activeId) ?? conns[0] ?? null
      setSelectedId(initial?.id ?? null)
      if (initial?.sftp?.remotePath) setPath(initial.sftp.remotePath)
    }
    load().then(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Push an initial browse history entry so the back button can return here
  const initialPushed = useRef(false)
  useEffect(() => {
    if (initialPushed.current || !selectedId) return
    initialPushed.current = true
    onHistoryPush?.({ kind: 'browse', path, quickLookFile: null })
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedConn = connections.find((c) => c.id === selectedId) ?? null
  const cfgRemotePath = selectedConn?.sftp?.remotePath ?? ''
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
    if (!selectedId) return
    setLoading(true)
    setError('')
    setStatus(null)
    const res = await window.winraid?.remote.list(selectedId, targetPath)
    setLoading(false)
    if (res?.ok) {
      setEntries(res.entries)
    } else {
      setError(res?.error || 'Failed to list directory')
      setEntries([])
    }
  }, [selectedId])

  useEffect(() => {
    if (selectedId) fetchDir(path)
  }, [selectedId, path, fetchDir])

  function navigate(newPath) {
    // When navigating to a parent/ancestor, highlight the folder we came from
    if (path.startsWith(newPath) && path !== newPath) {
      const remainder = path.slice(newPath === '/' ? 1 : newPath.length + 1)
      const immediateChild = remainder.split('/')[0]
      setLastVisitedDir(immediateChild || null)
    } else {
      setLastVisitedDir(null)
    }
    setPath(newPath)
    setEntries([])
    setShowQuickLook(false)
    setSelectedFile(null)
    onHistoryPush?.({ kind: 'browse', path: newPath, quickLookFile: null })
  }

  function openQuickLook(entry, entryPath) {
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
    const res = await window.winraid?.remote.checkout(selectedId, remotePath, targetFolder)
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
    if (!selectedId || !localFolder || opInFlight) return
    if (isOutsideRoot(remotePath, cfgRemotePath)) {
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
    if (!selectedId || !selectedConn) return
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
    const res = await window.winraid?.remote.delete(selectedId, target.path, target.isDir)
    setOpInFlight(false)
    if (res?.ok) {
      setEntries((prev) => prev.filter((e) => e.name !== target.name))
      setStatus({ ok: true, msg: `Deleted ${target.path}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Delete failed' })
      fetchDir(path)
    }
  }

  async function handleMove(srcPath, dstPath) {
    setMoveTarget(null)
    setOpInFlight(true)
    setStatus(null)
    const res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
    setOpInFlight(false)
    await fetchDir(path)
    if (res?.ok) {
      setStatus({ ok: true, msg: `Moved to ${dstPath}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Move failed' })
    }
  }

  async function handleCreateFolder() {
    const name = newFolderName?.trim()
    if (!name || !selectedId) return
    setNewFolderName(null)
    setOpInFlight(true)
    setStatus(null)
    const folderPath = joinRemote(path, name)
    const res = await window.winraid?.remote.mkdir(selectedId, folderPath)
    setOpInFlight(false)
    if (res?.ok) {
      await fetchDir(path)
      setStatus({ ok: true, msg: `Created folder ${name}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Failed to create folder' })
    }
  }

  // ── Selection helpers ────────────────────────────────────────────────────
  function toggleSelect(name, e) {
    if (e) e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === entries.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(entries.map((e) => e.name)))
    }
  }

  function clearSelection() { setSelected(new Set()) }

  // Clear selection when navigating to a different directory
  useEffect(() => { setSelected(new Set()) }, [path])

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(e.name)),
    [entries, selected],
  )

  // ── Bulk operations ────────────────────────────────────────────────────
  async function handleBulkDelete() {
    setBulkAction(null)
    setOpInFlight(true)
    setStatus(null)
    let ok = 0, fail = 0
    for (const entry of selectedEntries) {
      const entryPath = joinRemote(path, entry.name)
      const isDir = entry.type === 'dir'
      const res = await window.winraid?.remote.delete(selectedId, entryPath, isDir)
      if (res?.ok) ok++
      else fail++
    }
    setOpInFlight(false)
    clearSelection()
    await fetchDir(path)
    if (fail === 0) {
      setStatus({ ok: true, msg: `Deleted ${ok} item${ok !== 1 ? 's' : ''}` })
    } else {
      setStatus({ ok: false, msg: `Deleted ${ok}, failed ${fail}` })
    }
  }

  async function handleBulkMove() {
    const dest = bulkMoveDest.trim()
    if (!dest) return
    setBulkAction(null)
    setBulkMoveDest('')
    setOpInFlight(true)
    setStatus(null)
    let ok = 0, fail = 0
    for (const entry of selectedEntries) {
      const srcPath = joinRemote(path, entry.name)
      const dstPath = joinRemote(dest, entry.name)
      if (srcPath === dstPath) continue
      const res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
      if (res?.ok) ok++
      else fail++
    }
    setOpInFlight(false)
    clearSelection()
    await fetchDir(path)
    if (fail === 0) {
      setStatus({ ok: true, msg: `Moved ${ok} item${ok !== 1 ? 's' : ''} to ${dest}` })
    } else {
      setStatus({ ok: false, msg: `Moved ${ok}, failed ${fail}` })
    }
  }

  async function handleBulkCheckout() {
    if (!selectedId || !localFolder) return
    setOpInFlight(true)
    setStatus(null)
    let ok = 0, fail = 0
    for (const entry of selectedEntries) {
      const entryPath = joinRemote(path, entry.name)
      const res = await window.winraid?.remote.checkout(selectedId, entryPath, localFolder)
      if (res?.ok) ok++
      else fail++
    }
    setOpInFlight(false)
    clearSelection()
    if (fail === 0) {
      setStatus({ ok: true, msg: `Downloaded ${ok} item${ok !== 1 ? 's' : ''}` })
    } else {
      setStatus({ ok: false, msg: `Downloaded ${ok}, failed ${fail}` })
    }
  }

  // ── Drag-and-drop handlers ──────────────────────────────────────────────
  function handleDragStart(e, entry, entryPath) {
    setDragSource({ name: entry.name, path: entryPath })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', entryPath)
  }

  function handleDragEnd() {
    setDragSource(null)
    setDropTargetPath(null)
    clearTimeout(dwellTimer.current)
  }

  function handleDragOverFolder(e, folderPath) {
    // Don't allow dropping onto self or into the same source path
    if (!dragSource || dragSource.path === folderPath) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (dropTargetPath !== folderPath) {
      setDropTargetPath(folderPath)
      // Start dwell timer — auto-navigate into the folder after 600ms
      clearTimeout(dwellTimer.current)
      if (folderPath !== path) {
        dwellTimer.current = setTimeout(() => {
          navigate(folderPath)
        }, 600)
      }
    }
  }

  function handleDragLeaveFolder() {
    setDropTargetPath(null)
    clearTimeout(dwellTimer.current)
  }

  async function handleDrop(e, targetDirPath) {
    e.preventDefault()
    setDropTargetPath(null)
    clearTimeout(dwellTimer.current)
    if (!dragSource || !selectedId) return
    const srcPath = dragSource.path
    // Prevent dropping a folder onto or inside itself
    if (targetDirPath === srcPath || targetDirPath.startsWith(srcPath + '/')) return
    const dstPath = joinRemote(targetDirPath, dragSource.name)
    if (srcPath === dstPath) return
    setDragSource(null)
    setMoveInFlight({ name: dragSource.name, from: srcPath, to: dstPath })
    setStatus(null)
    const moveName = dragSource.name
    const res = await window.winraid?.remote.move(selectedId, srcPath, dstPath)
    setMoveInFlight(null)
    await fetchDir(path)
    if (res?.ok) {
      setStatus({ ok: true, msg: `Moved ${moveName} to ${targetDirPath}` })
    } else {
      setStatus({ ok: false, msg: res?.error || 'Move failed' })
    }
  }

  const busy     = opInFlight || !!moveInFlight
  const noConfig = !selectedId || (!selectedConn?.sftp?.host && !browseRestore?.connectionId)
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
        <EditorModal connectionId={selectedId} filePath={editingFile} onClose={() => setEditingFile(null)} />
      )}
      {showQuickLook && selectedFile && (
        <QuickLookOverlay
          file={selectedFile}
          connectionId={selectedId}
          remoteBasePath={cfgRemotePath}
          files={fileEntries}
          onNavigate={(f) => {
            setSelectedFile(f)
            onHistoryPush?.({ kind: 'browse', path, quickLookFile: f })
          }}
          onClose={() => { setShowQuickLook(false); setSelectedFile(null); onHistoryPush?.({ kind: 'browse', path, quickLookFile: null }) }}
          onDelete={(target) => { setShowQuickLook(false); setSelectedFile(null); onHistoryPush?.({ kind: 'browse', path, quickLookFile: null }); setDeleteTarget(target) }}
        />
      )}
      {confirmTarget && (
        <ConfirmModal
          remotePath={confirmTarget}
          cfgRemotePath={cfgRemotePath}
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
      {bulkAction === 'delete' && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={[styles.modalIconWrap, styles.modalIconDanger].join(' ')}>
                <AlertCircle size={20} />
              </span>
              <div>
                <h2 className={styles.modalTitle}>
                  Delete {selected.size} item{selected.size !== 1 ? 's' : ''}?
                </h2>
                <p className={styles.modalSubtitle}>
                  {selectedEntries.map((e) => e.name).join(', ')} will be permanently deleted. This cannot be undone.
                </p>
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => setBulkAction(null)}>Cancel</button>
              <button className={styles.modalConfirm} onClick={handleBulkDelete}>
                Delete {selected.size} item{selected.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkAction === 'move' && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalIconWrap}>
                <FolderInput size={20} />
              </span>
              <div>
                <h2 className={styles.modalTitle}>
                  Move {selected.size} item{selected.size !== 1 ? 's' : ''}
                </h2>
                <p className={styles.modalSubtitle}>
                  Move {selectedEntries.map((e) => e.name).join(', ')} to a new location.
                </p>
              </div>
            </div>
            <div className={styles.modalFields}>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Destination folder</label>
                <input
                  className={styles.fieldInput}
                  value={bulkMoveDest}
                  onChange={(e) => setBulkMoveDest(e.target.value)}
                  spellCheck={false}
                  autoFocus
                />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => { setBulkAction(null); setBulkMoveDest('') }}>Cancel</button>
              <button
                className={styles.modalConfirmAccent}
                onClick={handleBulkMove}
                disabled={!bulkMoveDest.trim() || bulkMoveDest.trim() === path}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}

      {moveInFlight && (
        <div className={styles.moveOverlay}>
          <Loader size={24} className={styles.spinning} />
          <span className={styles.moveOverlayText}>Moving {moveInFlight.name}</span>
          <span className={styles.moveOverlayPath}>{moveInFlight.from} → {moveInFlight.to}</span>
        </div>
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
              {cfgRemotePath && path !== cfgRemotePath && (
                <Tooltip tip={`Jump to sync root: ${cfgRemotePath}`} side="bottom">
                  <button
                    className={styles.goRootBtn}
                    onClick={() => navigate(cfgRemotePath)}
                    disabled={loading}
                  >
                    ↑ Go to root
                  </button>
                </Tooltip>
              )}
              <Tooltip tip="Set current folder as sync root" side="bottom">
                <button
                  className={styles.setRootBtn}
                  onClick={() => handleSetRoot(path)}
                  disabled={busy || loading || cfgRemotePath === path}
                >
                  Set root here
                </button>
              </Tooltip>
              {localFolder && (
                <Tooltip tip={`Check out current folder structure to ${localFolder}`} side="bottom">
                  <button
                    className={styles.checkoutBtn}
                    onClick={() => handleCheckout(path)}
                    disabled={busy || loading}
                  >
                    <Download size={13} />
                    Check out here
                  </button>
                </Tooltip>
              )}
            </>
          )}

          <div className={styles.viewToggle}>
            <Tooltip tip="List view" side="bottom">
              <button
                className={[styles.viewBtn, viewMode === 'list' ? styles.viewBtnActive : ''].join(' ')}
                onClick={() => setViewMode('list')}
              >
                <List size={14} />
              </button>
            </Tooltip>
            <Tooltip tip="Grid view" side="bottom">
              <button
                className={[styles.viewBtn, viewMode === 'grid' ? styles.viewBtnActive : ''].join(' ')}
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid size={14} />
              </button>
            </Tooltip>
          </div>

          <Tooltip tip="New folder" side="bottom">
            <button
              className={styles.refreshBtn}
              onClick={() => setNewFolderName('')}
              disabled={busy || loading || noConfig}
            >
              <FolderPlus size={13} />
            </button>
          </Tooltip>
          <Tooltip tip="Refresh" side="left">
            <button
              className={styles.refreshBtn}
              onClick={() => fetchDir(path)}
              disabled={loading || noConfig}
            >
              <RefreshCw size={13} className={loading ? styles.spinning : ''} />
            </button>
          </Tooltip>
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
                  className={[
                    styles.crumb,
                    c.path === path ? styles.crumbActive : '',
                    dropTargetPath === c.path ? styles.crumbDropTarget : '',
                  ].join(' ')}
                  onClick={() => c.path !== path && navigate(c.path)}
                  disabled={c.path === path && !dragSource}
                  onDragOver={(e) => handleDragOverFolder(e, c.path)}
                  onDragLeave={handleDragLeaveFolder}
                  onDrop={(e) => handleDrop(e, c.path)}
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
            <div
              ref={listScrollRef}
              className={[styles.listWrapper, selected.size > 0 ? styles.hasSelection : ''].join(' ')}
              onDragOver={(e) => { if (dragSource) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' } }}
              onDrop={(e) => handleDrop(e, path)}
            >
              {entries.length === 0 && !loading && !error && (
                <div className={styles.emptyDir}>Empty folder</div>
              )}
              {entries.length > 0 && (
                <div className={styles.colHeader}>
                  <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={entries.length > 0 && selected.size === entries.length}
                      ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < entries.length }}
                      onChange={toggleSelectAll}
                    />
                    <span className={styles.checkmark} />
                  </label>
                  <span className={styles.colName}>Name</span>
                  <span className={styles.colSize}>Size</span>
                  <span className={styles.colDate}>Modified</span>
                  <span className={styles.colActions} />
                </div>
              )}
              {newFolderName !== null && (
                <div className={styles.newFolderRow}>
                  <Folder size={14} className={styles.iconDir} />
                  <input
                    className={styles.newFolderInput}
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder()
                      if (e.key === 'Escape') setNewFolderName(null)
                    }}
                    placeholder="Folder name"
                    autoFocus
                    spellCheck={false}
                  />
                  <button className={styles.newFolderConfirm} onClick={handleCreateFolder} disabled={!newFolderName?.trim()}>
                    Create
                  </button>
                  <button className={styles.newFolderCancel} onClick={() => setNewFolderName(null)}>
                    <XIcon size={13} />
                  </button>
                </div>
              )}
              {entries.length > 0 && (
                <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const entry = entries[virtualRow.index]
                    const entryPath = joinRemote(path, entry.name)
                    const isDir     = entry.type === 'dir'
                    const icon = isDir
                      ? <Folder size={14} className={styles.iconDir} />
                      : (isImageFile(entry.name) || isVideoFile(entry.name))
                        ? <Thumbnail name={entry.name} remotePath={entryPath} connectionId={selectedId} size="list" />
                        : <File size={14} className={styles.iconFile} />
                    const isHighlit = highlightFile === entry.name
                    return (
                      <div
                        key={entry.name}
                        ref={isHighlit ? highlightRef : undefined}
                        className={[
                          styles.row,
                          isDir ? styles.rowDir : '',
                          selected.has(entry.name) ? styles.rowSelected : '',
                          dragSource?.path === entryPath ? styles.dragging : '',
                          isDir && dropTargetPath === entryPath ? styles.dropTarget : '',
                          isDir && lastVisitedDir === entry.name ? styles.lastVisited : '',
                          isHighlit ? 'shimmer shimmer-border shimmer-once' : '',
                        ].join(' ')}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                          cursor: !isDir ? 'pointer' : undefined,
                        }}
                        draggable={!busy}
                        onDragStart={(e) => handleDragStart(e, entry, entryPath)}
                        onDragEnd={handleDragEnd}
                        onDragOver={isDir ? (e) => handleDragOverFolder(e, entryPath) : undefined}
                        onDragLeave={isDir ? handleDragLeaveFolder : undefined}
                        onDrop={isDir ? (e) => { e.stopPropagation(); handleDrop(e, entryPath) } : undefined}
                        onClick={!isDir ? () => openQuickLook(entry, entryPath) : undefined}
                      >
                        <label className={styles.checkbox} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(entry.name)} onChange={(e) => toggleSelect(entry.name, e)} />
                          <span className={styles.checkmark} />
                        </label>
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
            </div>
          )}

          {/* Grid view */}
          {viewMode === 'grid' && (
            <div
              className={[styles.gridWrapper, selected.size > 0 ? styles.hasSelection : ''].join(' ')}
              onDragOver={(e) => { if (dragSource) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' } }}
              onDrop={(e) => handleDrop(e, path)}
            >
              {newFolderName !== null && (
                <div className={styles.newFolderCard}>
                  <div className={styles.newFolderCardIcon}>
                    <FolderPlus size={32} className={styles.iconDir} />
                  </div>
                  <div className={styles.newFolderCardBody}>
                    <input
                      className={styles.newFolderInput}
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateFolder()
                        if (e.key === 'Escape') setNewFolderName(null)
                      }}
                      placeholder="Folder name"
                      autoFocus
                      spellCheck={false}
                    />
                    <div className={styles.newFolderCardActions}>
                      <button className={styles.newFolderConfirm} onClick={handleCreateFolder} disabled={!newFolderName?.trim()}>
                        Create
                      </button>
                      <button className={styles.newFolderCancel} onClick={() => setNewFolderName(null)}>
                        <XIcon size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {entries.length === 0 && !loading && !error && newFolderName === null && (
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
                    isSelected={selected.has(entry.name)}
                    isDragSource={dragSource?.path === entryPath}
                    isDropTarget={isDir && dropTargetPath === entryPath}
                    isLastVisited={isDir && lastVisitedDir === entry.name}
                    isHighlighted={highlightFile === entry.name}
                    highlightRef={highlightRef}
                    onSelect={toggleSelect}
                    onNavigate={navigate}
                    onQuickLook={openQuickLook}
                    onCheckout={handleCheckout}
                    onEdit={setEditingFile}
                    onMove={setMoveTarget}
                    onDelete={setDeleteTarget}
                    onDragStart={(e) => handleDragStart(e, entry, entryPath)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOverFolder(e, entryPath)}
                    onDragLeave={handleDragLeaveFolder}
                    onDrop={(e) => { e.stopPropagation(); handleDrop(e, entryPath) }}
                  />
                )
              })}
            </div>
          )}

          {/* Bulk action drawer — always rendered for animation, toggled via class */}
          <div className={[styles.bulkBar, selected.size > 0 ? styles.bulkBarOpen : ''].join(' ')}>
            <span className={styles.bulkCount}>
              {selected.size} selected
            </span>
            <div className={styles.bulkActions}>
              <Tooltip tip="Download selected" side="top">
                <button className={styles.bulkBtn} onClick={handleBulkCheckout} disabled={busy}>
                  <Download size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Move selected" side="top">
                <button className={styles.bulkBtn} onClick={() => { setBulkAction('move'); setBulkMoveDest(path) }} disabled={busy}>
                  <FolderInput size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Delete selected" side="top">
                <button className={[styles.bulkBtn, styles.bulkBtnDanger].join(' ')} onClick={() => setBulkAction('delete')} disabled={busy}>
                  <Trash2 size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Clear selection" side="top">
                <button className={styles.bulkBtn} onClick={clearSelection}>
                  <XIcon size={13} />
                </button>
              </Tooltip>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
