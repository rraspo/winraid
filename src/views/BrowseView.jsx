import { useState, useEffect, useRef } from 'react'
import {
  ChevronRight, HardDrive, Download,
  AlertCircle, Loader, FolderPlus, List, LayoutGrid,
  Trash2, FolderInput, X as XIcon, Play, Search, ArrowUpDown, Star,
  ArrowLeft, ArrowRight, Home, Clock, CheckSquare, Plus, RefreshCw,
} from 'lucide-react'
import { isFavorite, favName } from '../utils/favorites'
import { normalizeForSearch } from '../utils/normalizeForSearch'
import { isEditableFile } from '../utils/fileTypes'
import { localMirrorPath } from '../utils/mirrorPath'
import styles from './BrowseView.module.css'
import { formatSize } from '../utils/format'
import QuickLookOverlay from '../components/QuickLookOverlay'
import DeleteModal from '../components/modals/DeleteModal'
import MoveModal from '../components/modals/MoveModal'
import ConfirmModal from '../components/modals/ConfirmModal'
import BulkDeleteModal from '../components/modals/BulkDeleteModal'
import BulkMoveModal from '../components/modals/BulkMoveModal'
import PasteImageModal from '../components/modals/PasteImageModal'
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

export default function BrowseView({
  onHistoryPush, browseRestore, onBrowseRestoreConsumed, connections: connectionsProp, connectionId,
  style, favorites, favoritesByConnection, onToggleFavorite, onOpenEditor, onNavigateFavorite, onNavigate, onOpenTab,
  onBack, onForward, canGoBack = false, canGoForward = false,
}) {
  const browse = useBrowse({ onHistoryPush, browseRestore, onBrowseRestoreConsumed, connectionsProp, connectionId })
  const {
    connections, selectedId, path, entries, loading, error,
    confirmTarget, deleteTarget, moveTarget,
    viewMode, selectedFile, showQuickLook,
    dragSource, dragPos, dragSourcePaths, moveInFlight, downloadProgress,
    selected, bulkAction, bulkMoveDest,
    searchQuery, setSearchQuery,
    cursorEntry, setCursorEntry,
    sortMode, setSortMode,
    setViewMode, setNewFolderName, setConfirmTarget,
    setDeleteTarget, setMoveTarget, setBulkAction, setBulkMoveDest,
    setSelectedFile, setShowQuickLook, setHighlightFile,
    cfgRemotePath, localFolder, crumbs,
    fileEntries, selectedEntries, dirCount, fileCount, busy, noConfig,
    fetchDir, navigate, copyPath,
    handleCheckout, handleConfirm,
    handleDownload,
    handleDelete, handleMove,
    handleBulkDelete, handleBulkMove, handleBulkCheckout, clearSelection,
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
  const localMirrorOf  = (entryPath) => localMirrorPath(browse.selectedConn, entryPath)
  // Optional-call (?.()) so a preload that predates this surface (dev restart,
  // version skew) degrades to "no reveal item" instead of throwing.
  const checkLocalExists = (p) => window.winraid?.local?.exists?.(p)
  const revealLocal = async (p) => {
    const res = await window.winraid?.local?.reveal?.(p)
    if (!res?.ok) toast.show({ msg: res?.error || 'Local copy no longer exists.', type: 'error' })
  }

  const sftpCfg = (connections ?? []).find((c) => c.id === selectedId)?.sftp ?? null

  const [diskUsage, setDiskUsage]             = useState(null)
  const [showPlay, setShowPlay]               = useState(false)
  const [breadcrumbOverflow, setBreadcrumbOverflow] = useState(false)
  const [sortDropOpen, setSortDropOpen]       = useState(false)
  const [favMenuOpen, setFavMenuOpen]         = useState(false)
  const [selectionMode, setSelectionMode]     = useState(false)
  const breadcrumbRef = useRef(null)
  const sortDropRef   = useRef(null)
  const favDropRef    = useRef(null)

  // Contextual notices now live in the toast stack as sticky toasts (no inline
  // banner shifting the layout). They clear when the condition clears or the
  // tab unmounts.
  useEffect(() => {
    if (mergerfsWarning) toast.show({ id: `mergerfs:${selectedId}`, sticky: true, type: 'warning', msg: MERGERFS_MSG })
    else toast.dismiss(`mergerfs:${selectedId}`)
    return () => toast.dismiss(`mergerfs:${selectedId}`)
  }, [mergerfsWarning, selectedId])

  useEffect(() => {
    if (error) toast.show({ id: `dir-error:${selectedId}`, sticky: true, type: 'error', msg: error })
    else toast.dismiss(`dir-error:${selectedId}`)
    return () => toast.dismiss(`dir-error:${selectedId}`)
  }, [error, selectedId])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    setDiskUsage(null)
    window.winraid?.remote.diskUsage?.(selectedId)
      ?.then((res) => { if (!cancelled) setDiskUsage(res) })
      ?.catch(() => {})
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    const el = breadcrumbRef.current
    if (!el) return
    el.scrollLeft = el.scrollWidth
    setBreadcrumbOverflow(el.scrollWidth > el.clientWidth)
  }, [path])

  useEffect(() => {
    if (!sortDropOpen) return
    function onDown(e) {
      if (!sortDropRef.current?.contains(e.target)) setSortDropOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sortDropOpen])

  useEffect(() => {
    if (!favMenuOpen) return
    function onDown(e) {
      if (!favDropRef.current?.contains(e.target)) setFavMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [favMenuOpen])

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
      if (showQuickLook || showPlay || confirmTarget || deleteTarget || moveTarget || bulkAction || pendingPaste) return
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
  }, [browse.entriesWithPaths, setCursorEntry, showQuickLook, showPlay, confirmTarget, deleteTarget, moveTarget, bulkAction, pendingPaste])

  // `favoritesByConnection` is the map the redesign favorites menu lists
  // from — every connection's saved folders. `favorites` is the legacy
  // single-connection array a caller can pass instead, scoped to whichever
  // connection is open.
  const favoritesMap    = favoritesByConnection ?? (selectedId ? { [selectedId]: favorites ?? [] } : {})
  const openFavorites   = favoritesMap[selectedId] ?? []
  const faved           = isFavorite(openFavorites, path)
  // The open connection's favorites come first, every other connection's
  // favorites follow in map order — each entry keeps the connection id it
  // belongs to so picking one can jump there.
  const favoriteEntries = [
    ...openFavorites.map((favPath) => ({ connectionId: selectedId, path: favPath })),
    ...Object.entries(favoritesMap)
      .filter(([favConnId]) => favConnId !== selectedId)
      .flatMap(([favConnId, paths]) => (paths ?? []).map((favPath) => ({ connectionId: favConnId, path: favPath }))),
  ]
  const showSelectionBar = selectionMode || selected.size > 0

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
          onNavigate={(f) => {
            setSelectedFile(f)
            onHistoryPush?.({ kind: 'browse', path, quickLookFile: f, connectionId: selectedId })
          }}
          onClose={() => {
            setShowQuickLook(false)
            setSelectedFile(null)
            onHistoryPush?.({ kind: 'browse', path, quickLookFile: null, connectionId: selectedId })
          }}
          onDelete={(target) => {
            setShowQuickLook(false)
            setSelectedFile(null)
            onHistoryPush?.({ kind: 'browse', path, quickLookFile: null, connectionId: selectedId })
            setDeleteTarget(target)
          }}
          canServerEdit={browse.selectedConn?.type === 'sftp'}
        />
      )}
      {showPlay && (
        <PlayOverlay
          connectionId={selectedId}
          path={path}
          onClose={() => setShowPlay(false)}
          remoteBasePath={cfgRemotePath}
          canServerEdit={browse.selectedConn?.type === 'sftp'}
          onMutated={handlePlayMutated}
          sftpCfg={sftpCfg}
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
      {bulkAction === 'delete' && (
        <BulkDeleteModal
          count={selected.size}
          names={selectedEntries.map((e) => e.name)}
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkAction(null)}
        />
      )}
      {bulkAction === 'move' && selectedEntries.length === 1 && (
        <MoveModal
          target={{
            name:  selectedEntries[0].name,
            path:  path === '/' ? `/${selectedEntries[0].name}` : `${path}/${selectedEntries[0].name}`,
            isDir: selectedEntries[0].type === 'dir',
          }}
          sftpCfg={sftpCfg}
          onConfirm={(src, dst) => { handleMove(src, dst); setBulkAction(null); clearSelection() }}
          onCancel={() => setBulkAction(null)}
        />
      )}
      {bulkAction === 'move' && selectedEntries.length !== 1 && (
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

      {/* Toolbar */}
      <div className={styles.toolbar} role="toolbar" aria-label="Browser">
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

        <ConnectionPicker
          connections={connections}
          connectionId={selectedId}
          onSelect={(connId) => {
            if (onOpenTab) onOpenTab(connId, 'browse')
            else onNavigate?.('connections')
          }}
        />

        <div className={styles.breadcrumb} ref={breadcrumbRef}>
          {breadcrumbOverflow && <span className={styles.crumbEllipsis}>...</span>}
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

        <div className={styles.favWrap} ref={favDropRef}>
          <Tooltip tip="Favorites" side="bottom">
            <button
              type="button"
              className={[styles.iconBtn, faved ? styles.favBtnActive : ''].join(' ')}
              aria-label="Favorites"
              onClick={() => setFavMenuOpen((v) => !v)}
              disabled={noConfig}
            >
              <Star size={14} fill={faved ? 'currentColor' : 'none'} />
            </button>
          </Tooltip>
          {favMenuOpen && (
            <div className={styles.favDrop} role="menu">
              <div className={styles.favSectionLabel}>FAVORITES</div>
              {favoriteEntries.length === 0 && <div className={styles.favEmpty}>No favorites yet</div>}
              {favoriteEntries.map(({ connectionId: favConnId, path: favPath }) => (
                <button
                  key={`${favConnId}:${favPath}`}
                  type="button"
                  role="menuitem"
                  className={styles.favItem}
                  onClick={() => { setFavMenuOpen(false); onNavigateFavorite?.(favConnId, favPath) }}
                >
                  <Star size={13} className={styles.favItemStar} fill="currentColor" />
                  <span className={styles.favItemLabel}>
                    <span className={styles.favItemName}>{favName(favPath)}</span>{' '}
                    <span className={styles.favItemConn}>{connections.find((c) => c.id === favConnId)?.name ?? favConnId}</span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className={styles.favPinItem}
                onClick={() => { setFavMenuOpen(false); onToggleFavorite?.(path) }}
              >
                <Plus size={13} />
                <span>{faved ? 'Remove current folder' : 'Add current folder'}</span>
              </button>
            </div>
          )}
        </div>

        <Tooltip tip="Jump to sync root" side="bottom">
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Jump to sync root"
            onClick={() => navigate(cfgRemotePath)}
            disabled={!cfgRemotePath || path === cfgRemotePath || noConfig}
          >
            <Home size={15} />
          </button>
        </Tooltip>

        <div className={styles.toolbarSpacer} />

        <SearchInput value={searchQuery} onChange={setSearchQuery} />

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

        <Tooltip tip="Toggle selection mode" side="bottom">
          <button
            type="button"
            className={[styles.selectBtn, selectionMode ? styles.selectBtnActive : ''].join(' ')}
            aria-label="Select"
            aria-pressed={selectionMode}
            onClick={() => setSelectionMode((v) => !v)}
          >
            <CheckSquare size={13} />
            <span>Select</span>
          </button>
        </Tooltip>

        <Tooltip tip="Play media slideshow" side="bottom">
          <button
            className={styles.iconBtn}
            onClick={() => setShowPlay(true)}
            aria-label="Play media slideshow"
          >
            <Play size={14} />
          </button>
        </Tooltip>

        <Tooltip tip="New folder" side="bottom">
          <button
            className={styles.iconBtn}
            aria-label="New folder"
            onClick={() => setNewFolderName('')}
            disabled={busy || loading || noConfig || mergerfsWarning}
          >
            <FolderPlus size={15} />
          </button>
        </Tooltip>

        <Tooltip tip="Activity" side="bottom">
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Activity"
            onClick={() => onNavigate?.('dashboard')}
          >
            <Clock size={15} />
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

        <div className={styles.viewToggleGroup}>
          <Tooltip tip="Grid view" side="bottom">
            <button
              type="button"
              className={[styles.viewToggleBtn, viewMode === 'grid' ? styles.viewToggleBtnActive : ''].join(' ')}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid size={14} />
            </button>
          </Tooltip>
          <Tooltip tip="List view" side="bottom">
            <button
              type="button"
              className={[styles.viewToggleBtn, viewMode === 'list' ? styles.viewToggleBtnActive : ''].join(' ')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            >
              <List size={14} />
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
              selectionMode={selectionMode}
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
              selectionMode={selectionMode}
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
            />
          )}
          </div>

          {/* Selection bar */}
          {showSelectionBar && (
            <div className={styles.bulkBar} role="toolbar" aria-label="Selection">
              <span className={styles.bulkCount}>{selected.size} selected</span>
              <div className={styles.bulkActions}>
                <button type="button" className={styles.bulkBtn} onClick={handleBulkCheckout} disabled={busy}>
                  <Download size={13} />
                  Download
                </button>
                <button
                  type="button"
                  className={styles.bulkBtn}
                  onClick={() => { setBulkAction('move'); setBulkMoveDest(path) }}
                  disabled={busy}
                >
                  <FolderInput size={13} />
                  Move…
                </button>
                <button
                  type="button"
                  className={[styles.bulkBtn, styles.bulkBtnDanger].join(' ')}
                  onClick={() => setBulkAction('delete')}
                  disabled={busy}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
                <button
                  type="button"
                  className={styles.bulkBtn}
                  onClick={() => { clearSelection(); setSelectionMode(false) }}
                >
                  <XIcon size={13} />
                  Done
                </button>
              </div>
            </div>
          )}

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
