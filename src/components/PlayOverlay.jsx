import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './PlayOverlay.module.css'
import { usePlayIndex } from '../hooks/usePlayIndex'
import { useWallSelection } from '../hooks/useWallSelection'
import { usePlayMutations, joinRemote } from '../hooks/usePlayMutations'
import { nasStreamUrl } from '../utils/nasStream'
import PlayWall from './play/PlayWall'
import QuickLookOverlay from './QuickLookOverlay'
import DeleteModal from './modals/DeleteModal'
import BulkDeleteModal from './modals/BulkDeleteModal'
import BulkMoveModal from './modals/BulkMoveModal'
import MoveModal from './modals/MoveModal'
import * as toast from '../services/toast'

// The wall keeps itself topped up to at least this many walked files
// whenever the pool still has more to offer, and pulls another page of
// this size whenever the bottom sentinel comes into view.
export const WALL_PAGE_SIZE = 24

// Maps a walked play-index entry ({ path, size, mtime, type }) to the shape
// Quick Look expects ({ name, path, size, modified }). A version bumped by
// an in-place save (fileVersions) stands in for mtime so Quick Look's own
// cache-busting query param picks up the edit.
function toQuickLookFile(playFile, fileVersions) {
  return {
    name:     playFile.path.split('/').pop(),
    path:     playFile.path,
    size:     playFile.size,
    modified: fileVersions.get(playFile.path) ?? playFile.mtime,
  }
}

export default function PlayOverlay({ connectionId, path, onClose, remoteBasePath, canServerEdit, onMutated, sftpCfg = null }) {
  const [scanRoot, setScanRoot] = useState(path)
  // When the user navigates between folders via a breadcrumb, the file
  // they were just looking at carries into the new scope as the trail seed
  // — they can walk back to it like any other walked file.
  const [startFile, setStartFile] = useState(null)
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  // Keyed by remote path, bumped whenever Quick Look saves an edit in place
  // so both the wall tile and the viewer's own file reload the new bytes.
  const [fileVersions, setFileVersions] = useState(() => new Map())
  // The file pending a delete confirmation, or null. Set by Quick Look's
  // "More actions" menu; the confirmation itself renders inside Play.
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleteInFlight, setDeleteInFlight] = useState(false)
  // Wall selection's own delete/move flow, distinct from the viewer's
  // single-file pendingDelete above: null | 'delete' | 'move'.
  const [bulkAction, setBulkAction] = useState(null)
  const [bulkMoveDest, setBulkMoveDest] = useState('')

  const {
    playlist, index, scanning, hasMore, nextPredicted, poolSize,
    recursive, toggleRecursive,
    shuffle, toggleShuffle,
    next, prev, fill, goTo,
    removePaths, relocatePaths,
    error, retry,
  } = usePlayIndex(connectionId, scanRoot, startFile)

  // Destructured so the callbacks and the keydown effect below depend on
  // the stable functions, not on a selection object rebuilt every render.
  const {
    selectedPaths,
    toggle: toggleSelected,
    selectRange,
    selectAll,
    clear: clearSelection,
    drop: dropFromSelection,
  } = useWallSelection(playlist)
  const mutations = usePlayMutations({
    connectionId,
    removePaths,
    relocatePaths,
    dropFromSelection,
    onMutated,
  })

  const overlayRef = useRef(null)

  const handleSegmentClick = useCallback((segmentPath) => {
    if (segmentPath === scanRoot) return
    setStartFile(playlist[index] ?? null)
    setScanRoot(segmentPath)
    setIsViewerOpen(false)
    clearSelection()
  }, [scanRoot, playlist, index, clearSelection])

  const handleToggleRecursive = useCallback(() => {
    toggleRecursive()
    clearSelection()
  }, [toggleRecursive, clearSelection])

  const openTile = useCallback((tileIndex) => {
    goTo(tileIndex)
    setIsViewerOpen(true)
  }, [goTo])

  const returnToWall = useCallback(() => setIsViewerOpen(false), [])

  const requestDelete = useCallback((target) => setPendingDelete(target), [])
  const cancelDelete   = useCallback(() => setPendingDelete(null), [])

  const confirmDelete = useCallback(async (target) => {
    if (deleteInFlight) return
    setDeleteInFlight(true)
    try {
      const res = await window.winraid.remote.delete(connectionId, target.path, false)
      if (res?.ok) {
        window.winraid.cache.invalidateFile(connectionId, target.path)
        removePaths([target.path])
        dropFromSelection([target.path])
        toast.show({ msg: `Deleted ${target.name}`, type: 'success' })
        setPendingDelete(null)
        onMutated?.({ paths: [target.path] })
      } else {
        toast.show({ msg: res?.error || 'Delete failed', type: 'error' })
        setPendingDelete(null)
      }
    } finally {
      setDeleteInFlight(false)
    }
  }, [connectionId, removePaths, onMutated, deleteInFlight, dropFromSelection])

  // The wall-selected files, in wall order — the basis for both the bulk
  // delete/move confirmations and the sequential loops that execute them.
  const selectedFiles = useMemo(
    () => playlist.filter((file) => selectedPaths.has(file.path)),
    [playlist, selectedPaths],
  )

  const requestBulkDelete = useCallback(() => {
    if (mutations.inFlight) return
    setBulkAction('delete')
  }, [mutations.inFlight])

  const requestBulkMove = useCallback(() => {
    if (mutations.inFlight) return
    setBulkMoveDest(scanRoot)
    setBulkAction('move')
  }, [mutations.inFlight, scanRoot])

  const cancelBulkAction = useCallback(() => setBulkAction(null), [])

  const confirmBulkDelete = useCallback(() => {
    setBulkAction(null)
    mutations.deleteFiles(selectedFiles)
  }, [mutations, selectedFiles])

  const confirmSingleMove = useCallback((sourcePath, destinationPath) => {
    setBulkAction(null)
    mutations.moveFiles([{ from: sourcePath, to: destinationPath }], {
      isSingle: true, scanRoot, recursive,
    })
  }, [mutations, scanRoot, recursive])

  const confirmBulkMove = useCallback(() => {
    const dest = bulkMoveDest.trim()
    setBulkAction(null)
    const pairs = selectedFiles
      .map((file) => ({ from: file.path, to: joinRemote(dest, file.path.split('/').pop()) }))
      .filter((pair) => pair.from !== pair.to)
    mutations.moveFiles(pairs, { isSingle: false, scanRoot, recursive, dest })
  }, [bulkMoveDest, selectedFiles, mutations, scanRoot, recursive])

  const bumpVersion = useCallback((remotePath) => {
    setFileVersions((previous) => {
      const next = new Map(previous)
      next.set(remotePath, Date.now())
      return next
    })
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  // Keep the wall topped up to at least one page while the pool still has
  // files to promote. `fill` returns the same state (and therefore causes
  // no re-render) once the pool is drained, so this settles rather than
  // looping.
  useEffect(() => {
    if (playlist.length < WALL_PAGE_SIZE && poolSize > 0) {
      fill(WALL_PAGE_SIZE - playlist.length)
    }
  }, [playlist.length, poolSize, fill])

  // The wall responds to Escape (clear selection, else close), Ctrl/Meta+A
  // (select every walked tile) and Delete (open the bulk delete confirmation)
  // on top of the selection gestures PlayWall handles itself. While the
  // viewer is open, Quick Look's own window keydown listener owns Escape,
  // the arrow keys and the wheel entirely — this listener steps aside so
  // nothing double-handles them, and none of the selection keys act either.
  useEffect(() => {
    if (isViewerOpen) return
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAll()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (selectedPaths.size > 0) {
          clearSelection()
        } else {
          onClose()
        }
        return
      }
      if (e.key === 'Delete' && selectedPaths.size > 0 && !mutations.inFlight) {
        e.preventDefault()
        setBulkAction('delete')
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isViewerOpen, onClose, selectedPaths, selectAll, clearSelection, mutations.inFlight])

  useEffect(() => { overlayRef.current?.focus() }, [])

  // A delete that empties the queue leaves nothing for the viewer to show —
  // close it so the wall's empty state is what the user sees. Play itself
  // stays open.
  useEffect(() => {
    if (isViewerOpen && playlist.length === 0) setIsViewerOpen(false)
  }, [isViewerOpen, playlist.length])

  // Prefetch the most-likely next image so pressing Right is instant, but
  // only while the viewer is open: on the wall every page pull would
  // otherwise download a full-size image nobody is looking at.
  // Browser caches the bytes; we don't need to keep the Image instance.
  // Videos are not prefetched — full-video downloads would be too costly.
  useEffect(() => {
    if (!isViewerOpen || !nextPredicted || nextPredicted.type !== 'image') return
    const img = new Image()
    img.src = nasStreamUrl(connectionId, nextPredicted.path)
  }, [isViewerOpen, nextPredicted, connectionId])

  const quickLookFiles = useMemo(
    () => playlist.map((playFile) => toQuickLookFile(playFile, fileVersions)),
    [playlist, fileVersions],
  )
  const quickLookFile = quickLookFiles[index] ?? null

  const handleQuickLookNavigate = useCallback((navigatedFile) => {
    const targetIndex = playlist.findIndex((playFile) => playFile.path === navigatedFile.path)
    if (targetIndex !== -1) goTo(targetIndex)
  }, [playlist, goTo])

  return (
    <div ref={overlayRef} className={styles.overlay} data-theme="dark" role="dialog" aria-modal="true" aria-label="Play" tabIndex={-1}>
      <PlayWall
        connectionId={connectionId}
        scanRoot={scanRoot}
        playlist={playlist}
        scanning={scanning}
        poolSize={poolSize}
        recursive={recursive}
        toggleRecursive={handleToggleRecursive}
        shuffle={shuffle}
        toggleShuffle={toggleShuffle}
        error={error}
        retry={retry}
        pageSize={WALL_PAGE_SIZE}
        fill={fill}
        onSegmentClick={handleSegmentClick}
        onOpenTile={openTile}
        onToggleFullscreen={toggleFullscreen}
        onClose={onClose}
        hiddenFromViewer={isViewerOpen}
        fileVersions={fileVersions}
        selectedPaths={selectedPaths}
        onToggleSelect={toggleSelected}
        onSelectRange={selectRange}
        onClearSelection={clearSelection}
        onRequestBulkDelete={requestBulkDelete}
        onRequestBulkMove={requestBulkMove}
        mutationInFlight={mutations.inFlight}
      />
      {isViewerOpen && quickLookFile && (
        <div
          data-testid="play-viewer"
          className={styles.viewerLayer}
          onContextMenuCapture={(e) => { e.preventDefault(); e.stopPropagation(); returnToWall() }}
        >
          <QuickLookOverlay
            file={quickLookFile}
            files={quickLookFiles}
            connectionId={connectionId}
            remoteBasePath={remoteBasePath}
            canServerEdit={canServerEdit}
            onNavigate={handleQuickLookNavigate}
            onClose={returnToWall}
            onDelete={requestDelete}
            hasMoreBeyondList={hasMore}
            onNextBeyondList={next}
            onFileChanged={bumpVersion}
            folderNavigation={{ activePath: scanRoot, onSelect: handleSegmentClick }}
          />
        </div>
      )}
      {pendingDelete && (
        <DeleteModal
          target={pendingDelete}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
      {bulkAction === 'delete' && (
        <BulkDeleteModal
          count={selectedFiles.length}
          names={selectedFiles.map((file) => file.path.split('/').pop())}
          onConfirm={confirmBulkDelete}
          onCancel={cancelBulkAction}
        />
      )}
      {bulkAction === 'move' && selectedFiles.length === 1 && (
        <MoveModal
          target={{
            name:  selectedFiles[0].path.split('/').pop(),
            path:  selectedFiles[0].path,
            isDir: false,
          }}
          sftpCfg={sftpCfg}
          onConfirm={confirmSingleMove}
          onCancel={cancelBulkAction}
        />
      )}
      {bulkAction === 'move' && selectedFiles.length > 1 && (
        <BulkMoveModal
          count={selectedFiles.length}
          names={selectedFiles.map((file) => file.path.split('/').pop())}
          dest={bulkMoveDest}
          onDestChange={setBulkMoveDest}
          onConfirm={confirmBulkMove}
          onCancel={cancelBulkAction}
          currentPath={scanRoot}
          sftpCfg={sftpCfg}
        />
      )}
    </div>
  )
}
