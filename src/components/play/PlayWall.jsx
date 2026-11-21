import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, List, Loader, Maximize2, Play, Shuffle, Square, CheckSquare, ZoomIn, ZoomOut } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import ConnectionPicker from '../ConnectionPicker'
import BulkSelectionBar from '../BulkSelectionBar'
import WallVideo from './WallVideo'
import { nasStreamUrl } from '../../utils/nasStream'
import { layoutJustifiedRows } from '../../utils/justifiedRows'
import { probeMediaRatio } from './probeMediaRatio'
import { withThumb } from './playShared'
import { buildPathSegments } from '../../utils/pathSegments'
import overlayStyles from '../PlayOverlay.module.css'
import styles from './PlayWall.module.css'

// Justified rows: tiles share a row height near the chosen tile size, and a
// row may stretch or shrink by ROW_STRETCH_LIMIT to span the wall exactly.
// The size is the person's choice (the Tile size slider), saved under
// `playWall` once the slider settles.
const ROW_HEIGHT_DEFAULT  = 360
const ROW_HEIGHT_MIN      = 180
const ROW_HEIGHT_MAX      = 640
const ROW_HEIGHT_STEP     = 20
const ROW_HEIGHT_SAVE_MS  = 400
const ROW_STRETCH_LIMIT   = 0.25
const TILE_GAP            = 12
// Lays the wall out before it has been measured (first paint).
const FALLBACK_WALL_WIDTH = 996
// Shape probes in flight at once; each one is a request to the NAS.
const PROBE_CONCURRENCY   = 4

// Shape used when a file's own cannot be read.
function fallbackRatio(file) {
  return file.type === 'video' ? 16 / 9 : 1
}

function isAnimatedGif(remotePath) {
  return /\.gif$/i.test(remotePath)
}

// Appends a cache-busting version, when one is known, so a tile whose file
// was just edited in place picks up the new bytes instead of the stale
// browser cache entry.
function withVersion(url, version) {
  if (!version) return url
  return url + (url.includes('?') ? '&' : '?') + 'v=' + version
}

// Renders a video's duration, in whole seconds, as the wall badge's m:ss.
function formatDuration(totalSeconds) {
  const wholeSeconds = Math.round(totalSeconds)
  const minutes = Math.floor(wholeSeconds / 60)
  const seconds = wholeSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// What an image tile shows: the full file for an animated GIF, otherwise
// its thumbnail. The shape probe loads the same URL, so the tile's own
// load is a cache hit.
function tileImageSrc(connectionId, file, version) {
  const streamUrl = nasStreamUrl(connectionId, file.path)
  return isAnimatedGif(file.path) ? withVersion(streamUrl, version) : withVersion(withThumb(streamUrl), version)
}

/**
 * Scrollable wall of every walked file, in justified rows. Stays mounted underneath
 * the viewer so scroll position and tiles survive opening/closing a file.
 */
export default function PlayWall({
  connectionId, scanRoot, playlist, scanning, poolSize,
  recursive, toggleRecursive, shuffle, toggleShuffle,
  error, retry, pageSize, fill,
  onSegmentClick, onOpenTile, onToggleFullscreen, onClose,
  hiddenFromViewer, fileVersions,
  selectedPaths, onToggleSelect, onSelectRange, onClearSelection,
  onRequestBulkDelete, onRequestBulkMove, mutationInFlight,
  connections, onSelectConnection, defaultConnectionId = null, onSetDefault,
}) {
  const scrollContainerRef = useRef(null)
  const sentinelRef        = useRef(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [rowHeight,      setRowHeight]      = useState(ROW_HEIGHT_DEFAULT)
  const rowHeightChangedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    window.winraid?.config.get('playWall')
      .then((saved) => {
        const height = Number(saved?.rowHeight)
        if (cancelled || rowHeightChangedRef.current || !Number.isFinite(height)) return
        setRowHeight(Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, height)))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Saved once the slider stops moving, not on every step of a drag.
  useEffect(() => {
    if (!rowHeightChangedRef.current) return undefined
    const timer = setTimeout(() => {
      window.winraid?.config.set('playWall', { rowHeight })
    }, ROW_HEIGHT_SAVE_MS)
    return () => clearTimeout(timer)
  }, [rowHeight])

  function handleRowHeightChange(event) {
    rowHeightChangedRef.current = true
    setRowHeight(Number(event.target.value))
  }
  // Keyed by remote path, shared between image thumbnails and video
  // players so either kind of tile can report the real proportions of
  // its media once known; the ratio survives a video player being
  // dropped when its tile leaves view.
  const [mediaRatios,    setMediaRatios]    = useState(() => new Map())
  // Keyed by remote path, the duration a wall video player reported
  // through its loadedmetadata event, shown on the video badge as m:ss.
  const [videoDurations, setVideoDurations] = useState(() => new Map())
  // Remote paths whose wall player is actually playing right now, driving
  // the playing indicator independently of whether a player is merely
  // mounted (autoplay can still be pending or fail silently).
  const [playingPaths,   setPlayingPaths]   = useState(() => new Set())

  // A tile joins the wall once its shape is known and every tile before it
  // is placed, so rows are laid out once and never jump as files load.
  // Before the wall is measured nothing waits: tiles take fallback shapes.
  const isMeasured = containerWidth > 0
  const firstUnshaped = isMeasured ? playlist.findIndex((file) => !mediaRatios.has(file.path)) : -1
  const placedCount = firstUnshaped === -1 ? playlist.length : firstUnshaped
  const waitingForShapes = placedCount < playlist.length

  const probingPaths = useRef(new Set())
  const isMountedRef = useRef(true)
  // Bumped when a probe settles, so the next waiting tile starts probing
  // even when the shape it reported was already known.
  const [probesSettled, setProbesSettled] = useState(0)

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect?.width ?? 0)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Re-armed whenever the wall grows: a fresh observer reports the current
  // intersection immediately, so a page that was too short to push the
  // sentinel out of view still triggers the next page instead of stalling.
  // While tiles wait for their shapes the wall has not grown yet, so asking
  // for more would promote the whole queue; the next page waits for them.
  useEffect(() => {
    if (waitingForShapes) return
    const element = sentinelRef.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) fill(pageSize)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fill, pageSize, playlist.length, waitingForShapes])

  const setMediaRatio = useCallback((remotePath, ratio) => {
    if (!ratio) return
    setMediaRatios((previous) => {
      if (previous.get(remotePath) === ratio) return previous
      const next = new Map(previous)
      next.set(remotePath, ratio)
      return next
    })
  }, [])

  // Probes the shapes of tiles still waiting, in wall order, a few at a
  // time. A file that cannot be read takes its fallback shape so it never
  // holds back the tiles after it.
  useEffect(() => {
    if (!isMeasured) return
    for (const file of playlist) {
      if (probingPaths.current.size >= PROBE_CONCURRENCY) break
      if (mediaRatios.has(file.path) || probingPaths.current.has(file.path)) continue
      probingPaths.current.add(file.path)
      const src = file.type === 'video'
        ? nasStreamUrl(connectionId, file.path)
        : tileImageSrc(connectionId, file, fileVersions?.get(file.path))
      probeMediaRatio({ src, type: file.type }).then((ratio) => {
        probingPaths.current.delete(file.path)
        if (!isMountedRef.current) return
        setMediaRatio(file.path, ratio || fallbackRatio(file))
        setProbesSettled((count) => count + 1)
      })
    }
  }, [isMeasured, playlist, mediaRatios, connectionId, fileVersions, setMediaRatio, probesSettled])

  function setVideoDuration(remotePath, duration) {
    if (!Number.isFinite(duration)) return
    setVideoDurations((previous) => {
      if (previous.get(remotePath) === duration) return previous
      const next = new Map(previous)
      next.set(remotePath, duration)
      return next
    })
  }

  function setTilePlaying(remotePath, isPlaying) {
    setPlayingPaths((previous) => {
      if (previous.has(remotePath) === isPlaying) return previous
      const next = new Set(previous)
      if (isPlaying) next.add(remotePath); else next.delete(remotePath)
      return next
    })
  }

  function handleThumbLoad(remotePath, event) {
    const { naturalWidth, naturalHeight } = event.target
    if (!naturalWidth || !naturalHeight) return
    setMediaRatio(remotePath, naturalWidth / naturalHeight)
  }

  // Ctrl/Meta+click toggles the tile, Shift+click extends the range from
  // the selection anchor, and a plain click still opens the viewer.
  function handleTileClick(tileIndex, filePath, event) {
    if (event.ctrlKey || event.metaKey) {
      onToggleSelect(filePath)
      return
    }
    if (event.shiftKey) {
      onSelectRange(filePath)
      return
    }
    onOpenTile(tileIndex)
  }

  const placedFiles = useMemo(() => playlist.slice(0, placedCount), [playlist, placedCount])

  const { positions, height } = useMemo(() => {
    const items = placedFiles.map((file) => ({ ratio: mediaRatios.get(file.path) || fallbackRatio(file) }))
    return layoutJustifiedRows(items, {
      width:        isMeasured ? containerWidth : FALLBACK_WALL_WIDTH,
      targetHeight: rowHeight,
      tolerance:    ROW_STRETCH_LIMIT,
      gap:          TILE_GAP,
    })
  }, [placedFiles, mediaRatios, isMeasured, containerWidth, rowHeight])

  const isEmpty    = !scanning && playlist.length === 0
  const totalKnown = playlist.length + poolSize

  return (
    <div className={styles.wallRoot} aria-hidden={hiddenFromViewer || undefined}>
      <div className={overlayStyles.topBar}>
        <div className={overlayStyles.topBarLeft}>
          <h1 className={overlayStyles.title}>Play wall</h1>
          <div className={overlayStyles.subtitleRow}>
            {scanning && (
              <Loader size={12} className={overlayStyles.scanningSpinner} aria-label="Scanning" />
            )}
            <span className={overlayStyles.subtitleCount}>{totalKnown} files</span>
            <span className={overlayStyles.subtitleDot}>&middot;</span>
            <span className={overlayStyles.filePath}>
              {buildPathSegments(scanRoot).map((segment, i) => (
                <span key={segment.path} className={overlayStyles.pathCrumb}>
                  {i > 0 && <span className={overlayStyles.pathSep}>/</span>}
                  <button
                    type="button"
                    className={[overlayStyles.pathSegment, segment.path === scanRoot ? overlayStyles.pathSegmentActive : ''].filter(Boolean).join(' ')}
                    aria-current={segment.path === scanRoot ? 'true' : undefined}
                    onClick={() => onSegmentClick(segment.path)}
                  >
                    {segment.label}
                  </button>
                </span>
              ))}
            </span>
          </div>
        </div>
        <div className={overlayStyles.topBarRight}>
          {connections && (
            <ConnectionPicker
              connections={connections}
              connectionId={connectionId}
              onSelect={onSelectConnection}
              defaultConnectionId={defaultConnectionId}
              onSetDefault={onSetDefault}
            />
          )}
          <Tooltip tip="Tile size" side="bottom">
            <div className={styles.sizeControl}>
              <ZoomOut size={13} aria-hidden="true" />
              <input
                type="range"
                className={styles.sizeSlider}
                aria-label="Tile size"
                min={ROW_HEIGHT_MIN}
                max={ROW_HEIGHT_MAX}
                step={ROW_HEIGHT_STEP}
                value={rowHeight}
                onChange={handleRowHeightChange}
              />
              <ZoomIn size={13} aria-hidden="true" />
            </div>
          </Tooltip>
          <Tooltip tip={shuffle ? 'Sequential order' : 'Shuffle'} side="bottom">
            <button
              type="button"
              className={[overlayStyles.controlBtn, shuffle ? overlayStyles.controlBtnOn : ''].filter(Boolean).join(' ')}
              onClick={toggleShuffle}
              aria-label="Toggle shuffle"
              aria-pressed={shuffle}
            >
              <Shuffle size={13} />
              <span>Shuffle</span>
            </button>
          </Tooltip>
          <Tooltip tip={recursive ? 'Flat (current folder only)' : 'Recursive (all subfolders)'} side="bottom">
            <button
              type="button"
              className={[overlayStyles.controlBtn, recursive ? overlayStyles.controlBtnOn : ''].filter(Boolean).join(' ')}
              onClick={toggleRecursive}
              aria-label="Toggle recursive scan"
              aria-pressed={recursive}
            >
              <List size={13} />
              <span>Recursive</span>
            </button>
          </Tooltip>
          <Tooltip tip="Toggle fullscreen" side="bottom">
            <button
              type="button"
              className={overlayStyles.controlBtn}
              onClick={onToggleFullscreen}
              aria-label="Toggle fullscreen"
            >
              <Maximize2 size={13} />
              <span>Fullscreen</span>
            </button>
          </Tooltip>
          <Tooltip tip="Back to browser" side="bottom">
            <button
              type="button"
              className={overlayStyles.controlBtn}
              onClick={onClose}
              aria-label="Close"
            >
              <ArrowLeft size={13} />
              <span>Back to browser</span>
            </button>
          </Tooltip>
        </div>
      </div>

      <div className={styles.wallScroll} data-testid="play-wall" ref={scrollContainerRef}>
        {isEmpty && !error && (
          <div className={overlayStyles.emptyState}>No media files found</div>
        )}
        {error && (
          <div className={overlayStyles.errorState}>
            <span>{error}</span>
            <button className={overlayStyles.retryBtn} onClick={retry}>Retry</button>
          </div>
        )}
        {placedFiles.length > 0 && (
          <div className={styles.wallGrid} style={{ height }}>
            {placedFiles.map((file, tileIndex) => {
              const position    = positions[tileIndex]
              const name        = file.path.split('/').pop()
              const version     = fileVersions?.get(file.path)
              const isSelected  = selectedPaths.has(file.path)
              const isGif       = file.type !== 'video' && isAnimatedGif(file.path)
              const isPlaying   = playingPaths.has(file.path)
              const duration    = videoDurations.get(file.path)
              const tileStyle   = { left: position.left, top: position.top, width: position.width, height: position.height }
              return (
                <div
                  key={file.path}
                  className={styles.tileWrap}
                  style={tileStyle}
                  data-playing={isPlaying ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className={styles.tile}
                    data-type={file.type}
                    data-selected={isSelected ? 'true' : undefined}
                    style={{ width: tileStyle.width, height: tileStyle.height }}
                    onClick={(event) => handleTileClick(tileIndex, file.path, event)}
                    aria-label={`Open ${name}`}
                  >
                    {file.type === 'video' ? (
                      <WallVideo
                        connectionId={connectionId}
                        remotePath={file.path}
                        onRatioKnown={setMediaRatio}
                        onDurationKnown={setVideoDuration}
                        onPlayingChange={setTilePlaying}
                        playbackSuspended={hiddenFromViewer}
                      />
                    ) : (
                      <img
                        className={styles.tileImage}
                        src={tileImageSrc(connectionId, file, version)}
                        alt=""
                        loading="lazy"
                        onLoad={(event) => handleThumbLoad(file.path, event)}
                      />
                    )}
                    {file.type === 'video' && (
                      <span className={styles.badge} data-badge="video">
                        <Play size={9} fill="currentColor" />
                        {duration != null && <span>{formatDuration(duration)}</span>}
                      </span>
                    )}
                    {isGif && (
                      <span className={[styles.badge, styles.badgeGif].join(' ')} data-badge="gif">GIF</span>
                    )}
                    {isPlaying && (
                      <span className={styles.playingBadge} aria-hidden="true">
                        <span className={styles.playingBar} />
                        <span className={styles.playingBar} />
                        <span className={styles.playingBar} />
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.selectBtn}
                    aria-label={`Select ${name}`}
                    aria-pressed={isSelected}
                    onClick={() => onToggleSelect(file.path)}
                  >
                    {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div data-testid="play-wall-sentinel" className={styles.sentinel} ref={sentinelRef} />
      </div>
      <BulkSelectionBar
        count={selectedPaths.size}
        mutationInFlight={mutationInFlight}
        onRequestMove={onRequestBulkMove}
        onRequestDelete={onRequestBulkDelete}
        onClearSelection={onClearSelection}
        disableClearDuringMutation={false}
      />
    </div>
  )
}
