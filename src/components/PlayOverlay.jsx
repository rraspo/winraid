import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './PlayOverlay.module.css'
import { usePlayIndex } from '../hooks/usePlayIndex'
import { nasStreamUrl } from '../utils/nasStream'
import PlayWall from './play/PlayWall'
import PlayViewer from './play/PlayViewer'

// The wall keeps itself topped up to at least this many walked files
// whenever the pool still has more to offer, and pulls another page of
// this size whenever the bottom sentinel comes into view.
export const WALL_PAGE_SIZE = 24

export default function PlayOverlay({ connectionId, path, onClose }) {
  const [scanRoot, setScanRoot] = useState(path)
  // When the user navigates between folders via a breadcrumb, the file
  // they were just looking at carries into the new scope as the trail seed
  // — they can walk back to it like any other walked file.
  const [startFile, setStartFile] = useState(null)
  const [isViewerOpen, setIsViewerOpen] = useState(false)

  const {
    playlist, index, scanning, hasMore, nextPredicted, poolSize,
    recursive, toggleRecursive,
    shuffle, toggleShuffle,
    next, prev, fill, goTo,
    error, retry,
  } = usePlayIndex(connectionId, scanRoot, startFile)

  const overlayRef = useRef(null)

  const handleSegmentClick = useCallback((segmentPath) => {
    if (segmentPath === scanRoot) return
    setStartFile(playlist[index] ?? null)
    setScanRoot(segmentPath)
  }, [scanRoot, playlist, index])

  const openTile = useCallback((tileIndex) => {
    goTo(tileIndex)
    setIsViewerOpen(true)
  }, [goTo])

  const returnToWall = useCallback(() => setIsViewerOpen(false), [])

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

  // A single always-on capture-phase listener, branching on whether the
  // viewer is open — the wall only ever responds to Escape (close), while
  // the viewer also walks the queue and returns to the wall on Escape.
  useEffect(() => {
    function onKeyDown(e) {
      if (isViewerOpen) {
        if (e.key === 'ArrowRight') { e.preventDefault(); next() }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); prev() }
        if (e.key === 'Escape')     { e.preventDefault(); returnToWall() }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isViewerOpen, next, prev, returnToWall, onClose])

  // The wheel only walks the queue while the viewer is open — on the wall
  // it must scroll the tile grid natively.
  useEffect(() => {
    if (!isViewerOpen) return
    function onWheel(e) {
      if (e.deltaY > 0) next()
      else if (e.deltaY < 0) prev()
    }
    window.addEventListener('wheel', onWheel)
    return () => window.removeEventListener('wheel', onWheel)
  }, [isViewerOpen, next, prev])

  useEffect(() => { overlayRef.current?.focus() }, [])

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

  return (
    <div ref={overlayRef} className={styles.overlay} data-theme="dark" role="dialog" aria-modal="true" aria-label="Play" tabIndex={-1}>
      <PlayWall
        connectionId={connectionId}
        scanRoot={scanRoot}
        playlist={playlist}
        scanning={scanning}
        poolSize={poolSize}
        recursive={recursive}
        toggleRecursive={toggleRecursive}
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
      />
      {isViewerOpen && (
        <PlayViewer
          connectionId={connectionId}
          scanRoot={scanRoot}
          file={playlist[index] ?? null}
          index={index}
          total={playlist.length}
          hasMore={hasMore}
          recursive={recursive}
          toggleRecursive={toggleRecursive}
          shuffle={shuffle}
          toggleShuffle={toggleShuffle}
          scanning={scanning}
          error={error}
          retry={retry}
          next={next}
          prev={prev}
          onSegmentClick={handleSegmentClick}
          onReturnToWall={returnToWall}
          onToggleFullscreen={toggleFullscreen}
          onClose={onClose}
        />
      )}
    </div>
  )
}
