import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight, ChevronDown, HardDrive,
  AlertCircle, Loader, CirclePlus, List, LayoutGrid,
  Trash2, Scissors, Copy, ClipboardPaste, Pencil,
  X as XIcon, Play, Search, ArrowUpDown, MoreHorizontal,
  ArrowLeft, ArrowRight, ArrowUp, Home, RefreshCw,
} from 'lucide-react'
import { isFavorite } from '../utils/favorites'
import { normalizeForSearch } from '../utils/normalizeForSearch'
import { isEditableFile } from '../utils/fileTypes'
import { localMirrorPath } from '../utils/mirrorPath'
import styles from './BrowseView.module.css'
import entryMenuStyles from '../components/browse/EntryMenu.module.css'
import { formatSize } from '../utils/format'
import QuickLookOverlay from '../components/QuickLookOverlay'
import DeleteModal from '../components/modals/DeleteModal'
import MoveModal from '../components/modals/MoveModal'
import ConfirmModal from '../components/modals/ConfirmModal'
import BulkDeleteModal from '../components/modals/BulkDeleteModal'
import PasteImageModal from '../components/modals/PasteImageModal'
import PropertiesModal from '../components/modals/PropertiesModal'
import OptionsPopover from '../components/browse/OptionsPopover'
import BrowseList from './BrowseList'
import BrowseGrid from './BrowseGrid'
import Tooltip from '../components/ui/Tooltip'
import ConnectionPicker from '../components/ConnectionPicker'
import { useBrowse } from '../hooks/useBrowse'
import PlayOverlay from '../components/PlayOverlay'
import DragGhost from '../components/browse/DragGhost'
import * as toast from '../services/toast'
import * as remoteFS from '../services/remoteFS'

const MERGERFS_MSG = 'This directory is a mergerfs union mount — files cannot be uploaded or created here. Navigate into a share folder.'

// The parent folder of a remote path: everything before the last '/', or
// the root when the path has nothing before its last segment.
function parentFolder(remotePath) {
  const lastSlash = remotePath.lastIndexOf('/')
  return lastSlash > 0 ? remotePath.slice(0, lastSlash) : '/'
}

// Joins a folder path and a child name the way every remote path in this
// view is built — root ('/') never doubles its separator.
function joinPath(base, name) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

export default function BrowseView({
  onHistoryPush, browseRestore, onBrowseRestoreConsumed, connections: connectionsProp, connectionId,
  style, favorites, favoritesByConnection, onToggleFavorite, onOpenEditor, onNavigate, onOpenTab,
  onNavigateFavorite,
  onSelectConnection, onBack, canGoBack = false, onForward, canGoForward = false,
  defaultConnectionId = null, onSetDefault, trashByConnection = {},
  // Whether this tab is the one currently on screen. Tabs stay mounted while
  // hidden, so anything that describes what is in front of the user has to
  // know the difference.
  active = true,
}) {
  const browse = useBrowse({ onHistoryPush, browseRestore, onBrowseRestoreConsumed, connectionsProp, connectionId })
  const {
    connections, selectedId, path, entries, loading, error,
    confirmTarget, deleteTarget, moveTarget,
    viewMode, selectedFile, showQuickLook,
    dragSource, dragPos, dragSourcePaths, moveInFlight, downloadProgress,
    selected, bulkAction,
    searchQuery, setSearchQuery,
    cursorEntry, setCursorEntry,
    sortMode, setSortMode,
    setViewMode, setNewFolderName, setConfirmTarget,
    setDeleteTarget, setMoveTarget, setBulkAction,
    setSelectedFile, setShowQuickLook, setHighlightFile,
    cfgRemotePath, localFolder, crumbs,
    fileEntries, selectedEntries, dirCount, fileCount, busy, noConfig,
    fetchDir, navigate, copyPath,
    handleCheckout, handleConfirm,
    handleDownload,
    handleDelete, handleMove,
    handleBulkDelete,
    handlePasteImage, handlePasteUrl, handleConfirmPaste, handleDiscardPaste, pendingPaste,
    handleDragOverFolder, handleDragLeaveFolder, handleDrop,
    handleItemPointer, toggleSelectAll,
    handleRubberBandStart, handleRubberBandMove, handleRubberBandEnd, rubberBand,
    externalDropActive,
    mergerfsWarning,
    handleExternalDragEnter,
    handleExternalDragOver,
    handleExternalDragLeave,
    handleExternalDrop,
  } = browse

  // Activating an editable file (click) opens it in an editor tab; media/PDF
  // still use QuickLook. The 3-dot Edit action routes to the same editor tab.
  const activateFile = (entry, entryPath) =>
    isEditableFile(entry.name) ? onOpenEditor?.(entryPath) : browse.openQuickLook(entry, entryPath)
  const editFile = (entryPath) => onOpenEditor?.(entryPath)

  // Play performs its own deletes/moves and reports the remote paths it
  // touched. Drop the cached listing of every folder those paths sit in so
  // stale entries never resurface, and refetch the one currently shown
  // behind Play so its listing catches up immediately.
  const handlePlayMutated = ({ paths }) => {
    const folders = new Set(paths.map(parentFolder))
    for (const folder of folders) {
      remoteFS.invalidate(selectedId, folder)
      if (folder === path) fetchDir(path)
    }
  }

  // "Reveal in Explorer" for mirrored connections: map a remote entry to its
  // local mirror copy, gate on existence, and open it in the OS file manager.
  // Middle click on a folder opens it in a background tab of the same
  // connection, without disturbing the tab in front.
  const handleMiddleClickFolder = (entryPath) => {
    onOpenTab?.(selectedId, 'browse', { path: entryPath, newTab: true, background: true })
  }

  // Properties reachable from a row's own "..."/right-click menu — always
  // just that one entry, independent of any broader multi-selection.
  const openPropertiesForRow = (entry) => {
    setPropertiesEntries([{
      name: entry.name, path: entry.path, size: entry.size, modified: entry.modified,
      type: entry.isDir ? 'dir' : 'file',
    }])
  }

  const localMirrorOf  = (entryPath) => localMirrorPath(browse.selectedConn, entryPath)
  // Optional-call (?.()) so a preload that predates this surface (dev restart,
  // version skew) degrades to "no reveal item" instead of throwing.
  const checkLocalExists = (p) => window.winraid?.local?.exists?.(p)
  const revealLocal = async (p) => {
    const res = await window.winraid?.local?.reveal?.(p)
    if (!res?.ok) toast.show({ msg: res?.error || 'Local copy no longer exists.', type: 'error' })
  }

  const sftpCfg = (connections ?? []).find((c) => c.id === selectedId)?.sftp ?? null
  const trashed = Boolean(trashByConnection?.[selectedId]?.folder)

  const [diskUsage, setDiskUsage]             = useState(null)
  const [showPlay, setShowPlay]               = useState(false)
  // Non-null while the Properties dialog is open: an array of one entry
  // (single selection or a per-row "..."/right-click Properties) or several
  // (an overflow-menu "Properties" opened over a multi-selection).
  const [propertiesEntries, setPropertiesEntries] = useState(null)
  const [optionsOpen, setOptionsOpen]         = useState(false)
  const [breadcrumbOverflow, setBreadcrumbOverflow] = useState(false)
  const [sortDropOpen, setSortDropOpen]       = useState(false)
  const [viewDropOpen, setViewDropOpen]       = useState(false)
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false)
  const [crumbMenuOpen, setCrumbMenuOpen]     = useState(false)
  // Where to draw the breadcrumb overflow menu. The trail clips its own
  // overflow, so a menu nested inside it is invisible however it is
  // positioned — it is drawn at the document level instead, anchored to the
  // marker.
  const [crumbMenuAt, setCrumbMenuAt]         = useState(null)
  const breadcrumbRef = useRef(null)
  const crumbMenuRef    = useRef(null)
  const crumbMarkerRef  = useRef(null)
  const sortDropRef   = useRef(null)
  const viewDropRef   = useRef(null)
  const overflowMenuRef = useRef(null)

  // Contextual notices now live in the toast stack as sticky toasts (no inline
  // banner shifting the layout). They clear when the condition clears or the
  // tab unmounts.
  // These two describe the folder in front of you, so they are gated on this
  // tab being the one on screen. A browse tab stays mounted while hidden to
  // keep its place, which is why a warning about a mergerfs mount used to
  // follow you to Settings and to other tabs, describing a folder none of
  // them were showing. Ordinary toasts are announcements and are untouched:
  // they sit out their few seconds wherever you go.
  useEffect(() => {
    if (active && mergerfsWarning) toast.show({ id: `mergerfs:${selectedId}`, sticky: true, type: 'warning', msg: MERGERFS_MSG })
    else toast.dismiss(`mergerfs:${selectedId}`)
    return () => toast.dismiss(`mergerfs:${selectedId}`)
  }, [active, mergerfsWarning, selectedId])

  useEffect(() => {
    if (active && error) toast.show({ id: `dir-error:${selectedId}`, sticky: true, type: 'error', msg: error })
    else toast.dismiss(`dir-error:${selectedId}`)
    return () => toast.dismiss(`dir-error:${selectedId}`)
  }, [active, error, selectedId])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setDiskUsage(null)
    window.winraid?.remote.diskUsage?.(selectedId)
      ?.then((res) => { if (!cancelled) setDiskUsage(res) })
      ?.catch(() => {})
    return () => { cancelled = true }
  }, [selectedId])

  // Pin the trail to its trailing (current-folder) crumb. The ellipsis
  // indicator only mounts once overflow is known, which changes scrollWidth
  // on the very next render — re-running this after that happens (the
  // breadcrumbOverflow dependency) keeps the pin accurate instead of
  // leaving the last crumb clipped by the width the indicator just added.
  useEffect(() => {
    const el = breadcrumbRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
    setBreadcrumbOverflow(el.scrollWidth > el.clientWidth)
  }, [path, breadcrumbOverflow])

  useEffect(() => {
    if (!sortDropOpen) return
    function onDown(e) {
      if (!sortDropRef.current?.contains(e.target)) setSortDropOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sortDropOpen])

  useEffect(() => {
    if (!viewDropOpen) return
    function onDown(e) {
      if (!viewDropRef.current?.contains(e.target)) setViewDropOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [viewDropOpen])

  useEffect(() => {
    if (!overflowMenuOpen) return
    function onDown(e) {
      if (!overflowMenuRef.current?.contains(e.target)) setOverflowMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [overflowMenuOpen])

  useEffect(() => {
    if (!crumbMenuOpen) return
    function onDown(e) {
      // The menu is drawn at the document level, so "outside" means outside
      // both it and the marker that opened it.
      if (crumbMenuRef.current?.contains(e.target)) return
      if (crumbMarkerRef.current?.contains(e.target)) return
      setCrumbMenuOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setCrumbMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [crumbMenuOpen])

  // The trail scrolls and pins to the folder you are in, so everything above
  // it slides out of sight behind the overflow marker. Those are exactly the
  // folders the marker's menu offers.
  const hiddenCrumbs = crumbs.slice(0, -1)

  const SORT_OPTIONS = [
    { value: 'nameAsc',  label: 'Name A-Z' },
    { value: 'nameDesc', label: 'Name Z-A' },
    { value: 'recent',   label: 'Recent' },
    { value: 'oldest',   label: 'Oldest' },
  ]

  // Ctrl+V / Cmd+V to paste clipboard content into the current directory.
  // Image bytes go through handlePasteImage; a URL string triggers an
  // http(s) fetch via handlePasteUrl. Skipped when an input/textarea is
  // focused so it doesn't interfere with text input.
  useEffect(() => {
    function onPaste(e) {
      const tag = (e.target?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return

      const items = e.clipboardData?.items ?? []
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            e.preventDefault()
            handlePasteImage(blob)
            return
          }
        }
      }

      const text = (e.clipboardData?.getData('text/uri-list') || e.clipboardData?.getData('text/plain') || '').trim()
      if (/^https?:\/\/\S+$/i.test(text)) {
        e.preventDefault()
        handlePasteUrl(text)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [handlePasteImage, handlePasteUrl])

  // ── Type-to-jump (Explorer-style) ─────────────────────────────────────────
  // While focus is in the browse view (no input/textarea focused, no modal
  // open), typing letters builds a buffer and moves the cursor to the
  // first entry whose name starts with it. Buffer resets after a short
  // pause; the visible cursor lingers a bit longer so the user can see
  // where they landed.
  const typeAheadBufRef     = useRef('')
  const bufResetTimerRef    = useRef(null)
  const cursorClearTimerRef = useRef(null)
  useEffect(() => {
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      // Ignore non-printable keys (Arrow, Escape, F-keys, etc.). Single
      // character `key` values cover letters/digits/punctuation.
      if (e.key.length !== 1) return
      const active = document.activeElement
      const tag = active?.tagName
      // Don't steal keys from the search input, modals, editors, etc.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable) return
      // Bail if any modal is open — those should own keyboard input.
      if (showQuickLook || showPlay || confirmTarget || deleteTarget || moveTarget || bulkAction || pendingPaste || propertiesEntries || optionsOpen) return
      if (browse.entriesWithPaths.length === 0) return

      typeAheadBufRef.current += normalizeForSearch(e.key)
      clearTimeout(bufResetTimerRef.current)
      bufResetTimerRef.current = setTimeout(() => { typeAheadBufRef.current = '' }, 700)

      const buf = typeAheadBufRef.current
      // Search the same filtered+sorted list the view renders — jumping
      // against the raw `entries` array could land the cursor on a row
      // hidden by the active search filter.
      const match = browse.entriesWithPaths.find((entry) => normalizeForSearch(entry.name).startsWith(buf))
      if (match) {
        e.preventDefault()
        setCursorEntry(match.name)
        clearTimeout(cursorClearTimerRef.current)
        cursorClearTimerRef.current = setTimeout(() => setCursorEntry(null), 1500)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      clearTimeout(bufResetTimerRef.current)
      clearTimeout(cursorClearTimerRef.current)
    }
  }, [browse.entriesWithPaths, setCursorEntry, showQuickLook, showPlay, confirmTarget, deleteTarget, moveTarget, bulkAction, pendingPaste, propertiesEntries, optionsOpen])

  // `favoritesByConnection` is the map of every connection's saved folders.
  // `favorites` is the legacy single-connection array a caller can pass
  // instead, scoped to whichever connection is open. The overflow menu's
  // "Add/Remove favourite" only ever acts on the open connection's folder —
  // browsing every connection's saved folders is not part of this toolbar.
  const favoritesMap  = favoritesByConnection ?? (selectedId ? { [selectedId]: favorites ?? [] } : {})
  const openFavorites = favoritesMap[selectedId] ?? []
  const faved          = isFavorite(openFavorites, path)
  // Cross-connection favourites list for the connection picker menu — the
  // open connection's own favourites first, every other connection's
  // favourites following in map order. Each entry keeps the connection id
  // it belongs to so picking one can jump there.
  const favoriteEntries = [
    ...openFavorites.map((favPath) => ({ connectionId: selectedId, path: favPath })),
    ...Object.entries(favoritesMap)
      .filter(([favConnId]) => favConnId !== selectedId)
      .flatMap(([favConnId, paths]) => (paths ?? []).map((favPath) => ({ connectionId: favConnId, path: favPath }))),
  ]

  return (
    <div
      className={styles.container}
      style={style}
      data-testid="browse-container"
      onDragEnter={handleExternalDragEnter}
      onDragOver={handleExternalDragOver}
      onDragLeave={handleExternalDragLeave}
      onDrop={handleExternalDrop}
    >


      {showQuickLook && selectedFile && (
        <QuickLookOverlay
          file={selectedFile}
          connectionId={selectedId}
          remoteBasePath={cfgRemotePath}
          files={fileEntries}
          onNavigate={(f) => setSelectedFile(f)}
          onClose={() => {
            setShowQuickLook(false)
            setSelectedFile(null)
          }}
          onDelete={(target) => {
            setShowQuickLook(false)
            setSelectedFile(null)
            setDeleteTarget(target)
          }}
          onOpenFolder={(folderPath) => {
            setShowQuickLook(false)
            setSelectedFile(null)
            onHistoryPush?.({ kind: 'browse', path: folderPath, quickLookFile: null, connectionId: selectedId })
            navigate(folderPath)
          }}
          canServerEdit={browse.selectedConn?.type === 'sftp'}
        />
      )}
      {crumbMenuOpen && crumbMenuAt && createPortal(
        <div
          ref={crumbMenuRef}
          className={styles.crumbMenu}
          role="menu"
          aria-label="Hidden folders"
          style={{ top: crumbMenuAt.top, left: crumbMenuAt.left }}
        >
          {hiddenCrumbs.map((c) => (
            <button
              key={c.path}
              type="button"
              role="menuitem"
              className={styles.crumbMenuItem}
              onClick={() => { setCrumbMenuOpen(false); navigate(c.path) }}
              onDragOver={(e) => handleDragOverFolder(e, c.path)}
              onDragLeave={handleDragLeaveFolder}
              onDrop={(e) => { setCrumbMenuOpen(false); handleDrop(e, c.path) }}
            >
              {c.label}
            </button>
          ))}
        </div>,
        document.body,
      )}

      {showPlay && (
        <PlayOverlay
          covering
          connectionId={selectedId}
          path={path}
          onClose={() => setShowPlay(false)}
          remoteBasePath={cfgRemotePath}
          canServerEdit={browse.selectedConn?.type === 'sftp'}
          onMutated={handlePlayMutated}
          sftpCfg={sftpCfg}
          trashByConnection={trashByConnection}
        />
      )}
      <DragGhost
        dragSource={dragSource}
        dragPos={dragPos}
        connectionId={selectedId}
        viewMode={viewMode}
      />

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
          trashed={trashed}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {moveTarget && (
        <MoveModal
          target={moveTarget}
          sftpCfg={sftpCfg}
          onConfirm={handleMove}
          onCancel={() => setMoveTarget(null)}
        />
      )}
      {pendingPaste && (
        <PasteImageModal
          pending={pendingPaste}
          onConfirm={handleConfirmPaste}
          onDiscard={handleDiscardPaste}
        />
      )}
      {propertiesEntries && (
        <PropertiesModal
          entries={propertiesEntries}
          connectionId={selectedId}
          connection={browse.selectedConn}
          copyPath={copyPath}
          onClose={() => setPropertiesEntries(null)}
        />
      )}
      {bulkAction === 'delete' && (
        <BulkDeleteModal
          count={selected.size}
          names={selectedEntries.map((e) => e.name)}
          trashed={trashed}
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkAction(null)}
        />
      )}
      {moveInFlight && (
        <div className={styles.moveOverlay} data-theme="dark">
          <Loader size={24} className={styles.spinning} />
          <span className={styles.moveOverlayText}>Moving {moveInFlight}</span>
        </div>
      )}

      {downloadProgress && (
        <div className={styles.moveOverlay} data-theme="dark">
          <Loader size={24} className={styles.spinning} />
          <span className={styles.moveOverlayText}>
            {downloadProgress.totalFiles > 1
              ? `Downloading ${downloadProgress.name}... ${downloadProgress.filesProcessed} / ${downloadProgress.totalFiles} files`
              : `Downloading ${downloadProgress.name}...${downloadProgress.totalBytes > 0 ? ` ${Math.round((downloadProgress.bytesTransferred / downloadProgress.totalBytes) * 100)}%` : ''}`
            }
          </span>
        </div>
      )}

      {/* Toolbar — two 40px rows, Explorer-style: navigation, then commands. */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarRow} role="toolbar" aria-label="Browser navigation">
          <Tooltip tip="Back" side="bottom">
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Back"
              onClick={onBack}
              disabled={!canGoBack}
            >
              <ArrowLeft size={15} />
            </button>
          </Tooltip>

          <Tooltip tip="Forward" side="bottom">
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Forward"
              onClick={onForward}
              disabled={!canGoForward}
            >
              <ArrowRight size={15} />
            </button>
          </Tooltip>

          {/* Up walks one path segment above the current directory — distinct
              from "Jump to sync root" (the overflow menu's Home-equivalent),
              which always lands on the connection's configured root however
              deep the current folder is. Disabled once path has no parent
              left to climb to. */}
          <Tooltip tip="Up one level" side="bottom">
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Up one level"
              onClick={() => navigate(parentFolder(path))}
              disabled={path === '/'}
            >
              <ArrowUp size={15} />
            </button>
          </Tooltip>

          <Tooltip tip="Refresh" side="bottom">
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Refresh"
              onClick={() => fetchDir(path)}
            >
              <RefreshCw size={15} />
            </button>
          </Tooltip>

          <ConnectionPicker
            connections={connections}
            connectionId={selectedId}
            onSelect={(connId) => {
              if (onSelectConnection) onSelectConnection(connId)
              else if (onOpenTab) onOpenTab(connId, 'browse')
              else onNavigate?.('connections')
            }}
            defaultConnectionId={defaultConnectionId}
            onSetDefault={onSetDefault}
            favorites={favoriteEntries}
            onSelectFavorite={onNavigateFavorite}
          />

          <div className={styles.breadcrumbWrap}>
            {breadcrumbOverflow && (
              <button
                type="button"
                ref={crumbMarkerRef}
                className={styles.crumbEllipsis}
                aria-label="Hidden folders"
                aria-haspopup="menu"
                aria-expanded={crumbMenuOpen}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setCrumbMenuAt({ top: Math.round(rect.bottom + 6), left: Math.round(rect.left) })
                  setCrumbMenuOpen((v) => !v)
                }}
              >
                ...
              </button>
            )}
            <div className={styles.breadcrumb} ref={breadcrumbRef}>
              {crumbs.map((c, i) => (
                <span key={c.path} className={styles.crumbGroup}>
                  {i > 0 && <ChevronRight size={11} className={styles.crumbSep} />}
                  <button
                    type="button"
                    className={[
                      styles.crumb,
                      c.path === path ? styles.crumbActive : '',
                    ].join(' ')}
                    title={c.path === path ? 'Copy full path' : undefined}
                    onClick={() => (c.path === path ? copyPath(c.path) : navigate(c.path))}
                    onDragOver={(e) => handleDragOverFolder(e, c.path)}
                    onDragLeave={handleDragLeaveFolder}
                    onDrop={(e) => handleDrop(e, c.path)}
                  >
                    {i === 0 ? <HardDrive size={11} /> : c.label}
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className={styles.toolbarSpacer} />

          <SearchInput value={searchQuery} onChange={setSearchQuery} />
        </div>

        <div className={styles.toolbarRow} role="toolbar" aria-label="Browser commands">
          <button
            type="button"
            className={styles.newFolderBtn}
            onClick={() => setNewFolderName('')}
            disabled={busy || loading || noConfig || mergerfsWarning}
          >
            <CirclePlus size={15} />
            <span>New Folder</span>
          </button>

          <span className={styles.rowPipe} data-testid="toolbar-pipe" aria-hidden="true" />

          <Tooltip tip="Cut" side="bottom">
            <button type="button" className={styles.fileActionBtn} aria-label="Cut" disabled>
              <Scissors size={14} />
            </button>
          </Tooltip>
          <Tooltip tip="Copy" side="bottom">
            <button type="button" className={styles.fileActionBtn} aria-label="Copy" disabled>
              <Copy size={14} />
            </button>
          </Tooltip>
          <Tooltip tip="Paste" side="bottom">
            <button type="button" className={styles.fileActionBtn} aria-label="Paste" disabled>
              <ClipboardPaste size={14} />
            </button>
          </Tooltip>
          <Tooltip tip="Rename" side="bottom">
            <button
              type="button"
              className={styles.fileActionBtn}
              aria-label="Rename"
              disabled={busy || selected.size !== 1}
              onClick={() => {
                const entry = selectedEntries[0]
                if (!entry) return
                setMoveTarget({
                  name:  entry.name,
                  path:  joinPath(path, entry.name),
                  isDir: entry.type === 'dir',
                })
              }}
            >
              <Pencil size={14} />
            </button>
          </Tooltip>
          <Tooltip tip="Delete" side="bottom">
            <button
              type="button"
              className={styles.fileActionBtn}
              aria-label="Delete selected"
              disabled={busy || selected.size === 0}
              onClick={() => setBulkAction('delete')}
            >
              <Trash2 size={14} />
            </button>
          </Tooltip>

          <span className={styles.rowPipe} data-testid="toolbar-pipe" aria-hidden="true" />

          <div className={styles.sortWrap} ref={sortDropRef}>
            <Tooltip tip="Sort order" side="bottom">
              <button
                className={styles.sortBtn}
                onClick={() => setSortDropOpen((v) => !v)}
                aria-label="Sort order"
              >
                <ArrowUpDown size={13} />
                <span className={styles.sortLabel}>
                  {SORT_OPTIONS.find((o) => o.value === sortMode)?.label ?? 'Sort'}
                </span>
                <ChevronDown size={12} />
              </button>
            </Tooltip>
            {sortDropOpen && (
              <div className={styles.sortDrop}>
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={[styles.sortOption, sortMode === opt.value ? styles.sortOptionActive : ''].join(' ')}
                    onClick={() => { setSortMode(opt.value); setSortDropOpen(false) }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={styles.viewWrap} ref={viewDropRef}>
            <Tooltip tip="View" side="bottom">
              <button
                type="button"
                className={styles.viewBtn}
                aria-label="View"
                onClick={() => setViewDropOpen((v) => !v)}
              >
                {viewMode === 'grid' ? <LayoutGrid size={14} /> : <List size={14} />}
                <span className={styles.viewLabel}>View</span>
                <ChevronDown size={12} />
              </button>
            </Tooltip>
            {viewDropOpen && (
              <div className={styles.viewDrop}>
                <button
                  type="button"
                  role="menuitem"
                  aria-current={viewMode === 'grid' ? 'true' : undefined}
                  className={[styles.viewOption, viewMode === 'grid' ? styles.viewOptionActive : ''].join(' ')}
                  onClick={() => { setViewMode('grid'); setViewDropOpen(false) }}
                >
                  <LayoutGrid size={14} />
                  <span>Grid view</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-current={viewMode === 'list' ? 'true' : undefined}
                  className={[styles.viewOption, viewMode === 'list' ? styles.viewOptionActive : ''].join(' ')}
                  onClick={() => { setViewMode('list'); setViewDropOpen(false) }}
                >
                  <List size={14} />
                  <span>List view</span>
                </button>
              </div>
            )}
          </div>

          <span className={styles.rowPipe} data-testid="toolbar-pipe" aria-hidden="true" />

          <div className={styles.overflowWrap} ref={overflowMenuRef}>
            <Tooltip tip="More options" side="bottom">
              <button
                type="button"
                className={styles.iconBtn}
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={overflowMenuOpen}
                onClick={() => { setOverflowMenuOpen((v) => !v); setOptionsOpen(false) }}
              >
                <MoreHorizontal size={15} />
              </button>
            </Tooltip>
            {overflowMenuOpen && (
              <div className={styles.overflowDrop} role="menu">
                <div>
                  <button
                    type="button"
                    role="menuitem"
                    className={[
                      entryMenuStyles.menuItem,
                      (!cfgRemotePath || path === cfgRemotePath || noConfig) ? styles.menuItemDisabled : '',
                    ].join(' ')}
                    disabled={!cfgRemotePath || path === cfgRemotePath || noConfig}
                    onClick={() => { setOverflowMenuOpen(false); navigate(cfgRemotePath) }}
                  >
                    Jump to sync root
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={entryMenuStyles.menuItem}
                    onClick={() => { setOverflowMenuOpen(false); setShowPlay(true) }}
                  >
                    Play slideshow
                  </button>
                </div>

                <div className={entryMenuStyles.menuDivider} />

                <div>
                  <button
                    type="button"
                    role="menuitem"
                    className={[entryMenuStyles.menuItem, noConfig ? styles.menuItemDisabled : ''].join(' ')}
                    disabled={noConfig}
                    onClick={() => { setOverflowMenuOpen(false); onToggleFavorite?.(path) }}
                  >
                    {faved ? 'Remove from favourites' : 'Add to favourites'}
                  </button>
                </div>

                <div className={entryMenuStyles.menuDivider} />

                <div>
                  <button
                    type="button"
                    role="menuitem"
                    className={[entryMenuStyles.menuItem, browse.entriesWithPaths.length === 0 ? styles.menuItemDisabled : ''].join(' ')}
                    disabled={browse.entriesWithPaths.length === 0}
                    onClick={() => { setOverflowMenuOpen(false); toggleSelectAll() }}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={entryMenuStyles.menuItem}
                    onClick={() => { setOverflowMenuOpen(false); browse.clearSelection() }}
                  >
                    Select none
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={entryMenuStyles.menuItem}
                    onClick={() => { setOverflowMenuOpen(false); browse.invertSelection() }}
                  >
                    Invert selection
                  </button>
                </div>

                <div className={entryMenuStyles.menuDivider} />

                <div data-testid="overflow-group-properties">
                  <button
                    type="button"
                    role="menuitem"
                    className={[entryMenuStyles.menuItem, selected.size === 0 ? styles.menuItemDisabled : ''].join(' ')}
                    disabled={selected.size === 0}
                    onClick={() => {
                      setOverflowMenuOpen(false)
                      setPropertiesEntries(selectedEntries.map((e) => ({
                        name: e.name, type: e.type, size: e.size, modified: e.modified,
                        path: joinPath(path, e.name),
                      })))
                    }}
                  >
                    Properties
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={entryMenuStyles.menuItem}
                    onClick={() => { setOverflowMenuOpen(false); setOptionsOpen(true) }}
                  >
                    Options
                  </button>
                </div>
              </div>
            )}
            <OptionsPopover
              anchorRef={overflowMenuRef}
              open={optionsOpen}
              onClose={() => setOptionsOpen(false)}
              browseOptions={browse.browseOptions}
              onSetThumbnails={browse.setThumbnailsEnabled}
              onSetColumn={browse.setColumnVisible}
              onSetDensity={browse.setDensity}
              onSetShowHidden={browse.setShowHiddenFiles}
              sortPersistence={browse.sortPersistence}
              onSetSortPersistence={browse.setSortPersistence}
              onOpenSettings={() => { setOptionsOpen(false); onNavigate?.('settings') }}
            />
          </div>
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
          <div className={styles.listArea}>
            {externalDropActive && (
              <div className={styles.dropOverlay}>
                <div className={styles.dropStack}>
                  <div className={styles.dropCard} />
                  <div className={styles.dropCard} />
                  <div className={styles.dropCard} />
                </div>
                <span className={styles.dropOverlayLabel}>Drop to upload to {path}</span>
              </div>
            )}
          {viewMode === 'list' && (
            <BrowseList
              entriesWithPaths={browse.entriesWithPaths}
              loading={browse.loading}
              error={browse.error}
              newFolderName={browse.newFolderName}
              setNewFolderName={browse.setNewFolderName}
              handleCreateFolder={browse.handleCreateFolder}
              path={browse.path}
              selectedId={browse.selectedId}
              busy={browse.busy}
              selected={browse.selected}
              dragSourcePaths={dragSourcePaths}
              lastVisitedDir={browse.lastVisitedDir}
              highlightFile={browse.highlightFile}
              highlightRef={browse.highlightRef}
              cursorEntry={cursorEntry}
              scrollAnchor={browse.scrollAnchor}
              setScrollAnchor={browse.setScrollAnchor}
              handleDragStart={browse.handleDragStart}
              handleDragEnd={browse.handleDragEnd}
              handleDragOverFolder={browse.handleDragOverFolder}
              handleDragLeaveFolder={browse.handleDragLeaveFolder}
              handleDrop={browse.handleDrop}
              navigate={browse.navigate}
              openQuickLook={activateFile}
              handleItemPointer={handleItemPointer}
              toggleSelectAll={toggleSelectAll}
              handleRubberBandStart={handleRubberBandStart}
              handleRubberBandMove={handleRubberBandMove}
              handleRubberBandEnd={handleRubberBandEnd}
              rubberBand={rubberBand}
              handleDownload={handleDownload}
              setEditingFile={editFile}
              setMoveTarget={browse.setMoveTarget}
              setDeleteTarget={browse.setDeleteTarget}
              localMirrorOf={localMirrorOf}
              checkLocalExists={checkLocalExists}
              onRevealLocal={revealLocal}
              onMiddleClickFolder={handleMiddleClickFolder}
              onProperties={openPropertiesForRow}
              visibleColumns={browse.browseOptions.columns}
              thumbnailsEnabled={browse.browseOptions.thumbnails}
              density={browse.browseOptions.density}
            />
          )}
          {viewMode === 'grid' && (
            <BrowseGrid
              entriesWithPaths={browse.entriesWithPaths}
              loading={browse.loading}
              error={browse.error}
              newFolderName={browse.newFolderName}
              setNewFolderName={browse.setNewFolderName}
              handleCreateFolder={browse.handleCreateFolder}
              path={browse.path}
              selectedId={browse.selectedId}
              busy={browse.busy}
              selected={browse.selected}
              dragSourcePaths={dragSourcePaths}
              lastVisitedDir={browse.lastVisitedDir}
              highlightFile={browse.highlightFile}
              highlightRef={browse.highlightRef}
              cursorEntry={cursorEntry}
              scrollAnchor={browse.scrollAnchor}
              setScrollAnchor={browse.setScrollAnchor}
              handleDragStart={browse.handleDragStart}
              handleDragEnd={browse.handleDragEnd}
              handleDragOverFolder={browse.handleDragOverFolder}
              handleDragLeaveFolder={browse.handleDragLeaveFolder}
              handleDrop={browse.handleDrop}
              navigate={browse.navigate}
              openQuickLook={activateFile}
              handleItemPointer={handleItemPointer}
              toggleSelectAll={toggleSelectAll}
              handleRubberBandStart={handleRubberBandStart}
              handleRubberBandMove={handleRubberBandMove}
              handleRubberBandEnd={handleRubberBandEnd}
              rubberBand={rubberBand}
              handleDownload={handleDownload}
              setEditingFile={editFile}
              setMoveTarget={browse.setMoveTarget}
              setDeleteTarget={browse.setDeleteTarget}
              localMirrorOf={localMirrorOf}
              checkLocalExists={checkLocalExists}
              onRevealLocal={revealLocal}
              onMiddleClickFolder={handleMiddleClickFolder}
              onProperties={openPropertiesForRow}
              thumbnailsEnabled={browse.browseOptions.thumbnails}
            />
          )}
          </div>

          {/* Footer */}
          <footer className={styles.footer}>
            <span className={styles.footerCount}>
              {dirCount} {dirCount === 1 ? 'folder' : 'folders'} · {fileCount} {fileCount === 1 ? 'file' : 'files'}
              {diskUsage?.ok && ` · ${formatSize(diskUsage.free)} free of ${formatSize(diskUsage.total)}`}
            </span>
            <span className={styles.footerSpacer} />
            <span className={styles.footerHint}>Drop files from Explorer or paste an image / URL to upload here</span>
            {localFolder && (
              <button
                type="button"
                className={styles.footerCheckout}
                onClick={() => handleCheckout(path)}
                disabled={busy || loading}
              >
                Check out to local mirror
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  )
}

// Compact search box for filtering the current directory's entries.
// Ctrl/Cmd+F focuses the input; ESC clears the query (and blurs).
function SearchInput({ value, onChange }) {
  const inputRef = useRef(null)

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={styles.searchWrap}>
      <Search size={12} className={styles.searchIcon} />
      <input
        ref={inputRef}
        className={styles.searchInput}
        type="text"
        placeholder="Search this folder"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onChange('')
            inputRef.current?.blur()
          }
        }}
      />
      {value && (
        <button
          type="button"
          className={styles.searchClear}
          onClick={() => { onChange(''); inputRef.current?.focus() }}
          aria-label="Clear search"
        >
          <XIcon size={11} />
        </button>
      )}
    </div>
  )
}
