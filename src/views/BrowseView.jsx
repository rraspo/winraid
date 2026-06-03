import { useState, useEffect, useRef } from 'react'
import {
  ChevronRight, HardDrive, Download, RefreshCw,
  AlertCircle, AlertTriangle, Loader, FolderPlus, List, LayoutGrid,
  Trash2, FolderInput, X as XIcon, Play, Search, ArrowUpDown, Star,
} from 'lucide-react'
import { isFavorite } from '../utils/favorites'
import styles from './BrowseView.module.css'
import { formatSize } from '../utils/format'
import EditorModal from '../components/EditorModal'
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
import { useBrowse } from '../hooks/useBrowse'
import PlayOverlay from '../components/PlayOverlay'
import DragGhost from '../components/browse/DragGhost'

export default function BrowseView({ onHistoryPush, browseRestore, onBrowseRestoreConsumed, connections: connectionsProp, connectionId, style, favorites = [], onToggleFavorite }) {
  const browse = useBrowse({ onHistoryPush, browseRestore, onBrowseRestoreConsumed, connectionsProp, connectionId })
  const {
    connections, selectedId, path, entries, loading, error, status,
    confirmTarget, editingFile, deleteTarget, moveTarget,
    viewMode, selectedFile, showQuickLook,
    dragSource, dragPos, dragSourcePaths, moveInFlight, downloadProgress,
    selected, bulkAction, bulkMoveDest,
    searchQuery, setSearchQuery,
    cursorEntry, setCursorEntry,
    sortMode, setSortMode,
    setEditingFile, setViewMode, setNewFolderName, setConfirmTarget,
    setDeleteTarget, setMoveTarget, setBulkAction, setBulkMoveDest,
    setSelectedFile, setShowQuickLook, setHighlightFile,
    cfgRemotePath, localFolder, crumbs,
    fileEntries, selectedEntries, dirCount, fileCount, busy, noConfig,
    fetchDir, navigate,
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

  const sftpCfg = (connections ?? []).find((c) => c.id === selectedId)?.sftp ?? null

  const [diskUsage, setDiskUsage]             = useState(null)
  const [showPlay, setShowPlay]               = useState(false)
  const [breadcrumbOverflow, setBreadcrumbOverflow] = useState(false)
  const [sortDropOpen, setSortDropOpen]       = useState(false)
  const breadcrumbRef = useRef(null)
  const sortDropRef   = useRef(null)

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
      if (editingFile || showQuickLook || showPlay || confirmTarget || deleteTarget || moveTarget || bulkAction || pendingPaste) return
      if (entries.length === 0) return

      typeAheadBufRef.current += e.key.toLowerCase()
      clearTimeout(bufResetTimerRef.current)
      bufResetTimerRef.current = setTimeout(() => { typeAheadBufRef.current = '' }, 700)

      const buf = typeAheadBufRef.current
      const match = entries.find((entry) => entry.name.toLowerCase().startsWith(buf))
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
  }, [entries, setCursorEntry, editingFile, showQuickLook, showPlay, confirmTarget, deleteTarget, moveTarget, bulkAction, pendingPaste])

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
        />
      )}
      {showPlay && (
        <PlayOverlay
          connectionId={selectedId}
          path={path}
          onClose={() => setShowPlay(false)}
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

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            className={styles.newFolderBtn}
            onClick={() => setNewFolderName('')}
            disabled={busy || loading || noConfig || mergerfsWarning}
          >
            <FolderPlus size={13} />
            New Folder
          </button>
          <Tooltip tip={viewMode === 'list' ? 'Switch to grid view' : 'Switch to list view'} side="bottom">
            <button
              className={styles.viewToggleBtn}
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            >
              {viewMode === 'list' ? <LayoutGrid size={14} /> : <List size={14} />}
            </button>
          </Tooltip>
          <Tooltip tip="Refresh" side="bottom">
            <button
              className={styles.refreshBtn}
              onClick={() => fetchDir(path)}
              disabled={loading || noConfig}
            >
              <RefreshCw size={13} className={loading ? styles.spinning : ''} />
            </button>
          </Tooltip>
          <Tooltip tip="Play media slideshow" side="bottom">
            <button
              className={styles.playBtn}
              onClick={() => setShowPlay(true)}
              aria-label="Play media slideshow"
            >
              <Play size={14} />
            </button>
          </Tooltip>
          {(() => {
            const faved = isFavorite(favorites, path)
            return (
              <Tooltip tip={faved ? 'Remove from favorites' : 'Add folder to favorites'} side="bottom">
                <button
                  className={[styles.favBtn, faved ? styles.favBtnActive : ''].filter(Boolean).join(' ')}
                  onClick={() => onToggleFavorite?.(path)}
                  disabled={noConfig}
                  aria-label={faved ? 'Remove from favorites' : 'Add folder to favorites'}
                  aria-pressed={faved}
                >
                  <Star size={14} fill={faved ? 'currentColor' : 'none'} />
                </button>
              </Tooltip>
            )
          })()}
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
          <SearchInput value={searchQuery} onChange={setSearchQuery} />
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
                    &uarr; Go to root
                  </button>
                </Tooltip>
              )}
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
          <div className={styles.breadcrumb} ref={breadcrumbRef}>
            {breadcrumbOverflow && <span className={styles.crumbEllipsis}>...</span>}
            {crumbs.map((c, i) => (
              <span key={c.path} className={styles.crumbGroup}>
                {i > 0 && <ChevronRight size={11} className={styles.crumbSep} />}
                <button
                  className={[
                    styles.crumb,
                    c.path === path ? styles.crumbActive : '',
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

          {mergerfsWarning && (
            <div className={styles.mergerfsWarning}>
              <AlertTriangle size={13} />
              This directory is a mergerfs union mount — files cannot be uploaded or created here. Navigate into a share folder.
            </div>
          )}

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
              openQuickLook={browse.openQuickLook}
              handleItemPointer={handleItemPointer}
              toggleSelectAll={toggleSelectAll}
              handleRubberBandStart={handleRubberBandStart}
              handleRubberBandMove={handleRubberBandMove}
              handleRubberBandEnd={handleRubberBandEnd}
              rubberBand={rubberBand}
              handleDownload={handleDownload}
              setEditingFile={browse.setEditingFile}
              setMoveTarget={browse.setMoveTarget}
              setDeleteTarget={browse.setDeleteTarget}
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
              openQuickLook={browse.openQuickLook}
              handleItemPointer={handleItemPointer}
              toggleSelectAll={toggleSelectAll}
              handleRubberBandStart={handleRubberBandStart}
              handleRubberBandMove={handleRubberBandMove}
              handleRubberBandEnd={handleRubberBandEnd}
              rubberBand={rubberBand}
              handleDownload={handleDownload}
              setEditingFile={browse.setEditingFile}
              setMoveTarget={browse.setMoveTarget}
              setDeleteTarget={browse.setDeleteTarget}
            />
          )}
          </div>

          {/* Entry count bar */}
          {!loading && !error && entries.length > 0 && (
            <div className={styles.countBar}>
              {dirCount  > 0 && <span>{dirCount}  {dirCount  === 1 ? 'folder' : 'folders'}</span>}
              {fileCount > 0 && <span>{fileCount} {fileCount === 1 ? 'file'   : 'files'}</span>}
              {dirCount  > 0 && fileCount > 0 && <span className={styles.countTotal}>{entries.length} total</span>}
              {diskUsage?.ok && (
                <span className={styles.diskPill}>
                  {formatSize(diskUsage.free)} free of {formatSize(diskUsage.total)}
                </span>
              )}
            </div>
          )}

          {/* Bulk action drawer */}
          <div className={[styles.bulkBar, selected.size > 0 ? styles.bulkBarOpen : ''].join(' ')}>
            <label className={styles.bulkSelectToggle}>
              <span className={styles.bulkCheckbox}>
                <input
                  type="checkbox"
                  checked={entries.length > 0 && selected.size === entries.length}
                  ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < entries.length }}
                  onChange={toggleSelectAll}
                />
                <span className={styles.bulkCheckmark} />
              </span>
              <span className={styles.bulkCount}>
                {selected.size} selected
              </span>
            </label>
            <div className={styles.bulkActions}>
              <Tooltip tip="Download selected" side="top">
                <button className={styles.bulkBtn} onClick={handleBulkCheckout} disabled={busy}>
                  <Download size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Move selected" side="top">
                <button
                  className={styles.bulkBtn}
                  onClick={() => { setBulkAction('move'); setBulkMoveDest(path) }}
                  disabled={busy}
                >
                  <FolderInput size={13} />
                </button>
              </Tooltip>
              <Tooltip tip="Delete selected" side="top">
                <button
                  className={[styles.bulkBtn, styles.bulkBtnDanger].join(' ')}
                  onClick={() => setBulkAction('delete')}
                  disabled={busy}
                >
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
