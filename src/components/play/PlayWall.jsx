import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, List, Loader, Maximize2, Play, Shuffle, Square, CheckSquare, FolderInput, Trash2, X } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import ConnectionPicker from '../ConnectionPicker'
import WallVideo from './WallVideo'
import { nasStreamUrl } from '../../utils/nasStream'
import { layoutMasonry } from '../../utils/masonry'
import { withThumb } from './playShared'
import { buildPathSegments } from '../../utils/pathSegments'
import overlayStyles from '../PlayOverlay.module.css'
import styles from './PlayWall.module.css'

// Target column width; the real width stretches so the columns span the
// container edge to edge instead of leaving a margin on the right.
const TILE_TARGET_WIDTH   = 240
const TILE_GAP            = 12
const FALLBACK_COLUMNS    = 4
const VIDEO_TILE_RATIO    = 16 / 9

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

function columnGeometry(containerWidth) {
  if (containerWidth <= 0) {
    return { columnCount: FALLBACK_COLUMNS, columnWidth: TILE_TARGET_WIDTH }
  }
  const columnCount = Math.max(1, Math.floor(containerWidth / TILE_TARGET_WIDTH))
  const columnWidth = Math.floor((containerWidth - (columnCount - 1) * TILE_GAP) / columnCount)
  return { columnCount, columnWidth }
}

/**
 * Scrollable masonry wall of every walked file. Stays mounted underneath
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
  useEffect(() => {
    const element = sentinelRef.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) fill(pageSize)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fill, pageSize, playlist.length])

  function setMediaRatio(remotePath, ratio) {
    if (!ratio) return
    setMediaRatios((previous) => {
      if (previous.get(remotePath) === ratio) return previous
      const next = new Map(previous)
      next.set(remotePath, ratio)
      return next
    })
  }

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

  const { columnCount, columnWidth } = columnGeometry(containerWidth)

  const { positions, height } = useMemo(() => {
    const items = playlist.map((file) => ({
      ratio: mediaRatios.get(file.path) || (file.type === 'video' ? VIDEO_TILE_RATIO : 0),
    }))
    return layoutMasonry(items, { columnCount, columnWidth, gap: TILE_GAP })
  }, [playlist, mediaRatios, columnCount, columnWidth])

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
        {playlist.length > 0 && (
          <div className={styles.wallGrid} style={{ height }}>
            {playlist.map((file, tileIndex) => {
              const position    = positions[tileIndex]
              const name        = file.path.split('/').pop()
              const streamUrl   = nasStreamUrl(connectionId, file.path)
              const version     = fileVersions?.get(file.path)
              const isSelected  = selectedPaths.has(file.path)
              const isGif       = file.type !== 'video' && isAnimatedGif(file.path)
              const isPlaying   = playingPaths.has(file.path)
              const duration    = videoDurations.get(file.path)
              const tileStyle   = position
                ? { left: position.left, top: position.top, width: position.width, height: position.height }
                : { left: 0, top: 0, width: columnWidth, height: columnWidth }
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
                        src={isGif ? withVersion(streamUrl, version) : withVersion(withThumb(streamUrl), version)}
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
      {(selectedPaths.size > 0 || mutationInFlight) && (
        <div className={styles.bulkBar} role="toolbar" aria-label="Selection">
          {mutationInFlight ? (
            <span className={styles.bulkCount}>
              {mutationInFlight.kind === 'delete' ? 'Deleting' : 'Moving'} {mutationInFlight.done + 1} of {mutationInFlight.total}
            </span>
          ) : (
            <span className={styles.bulkCount}>{selectedPaths.size} selected</span>
          )}
          <div className={styles.bulkActions}>
            <Tooltip tip="Move selected" side="top">
              <button
                type="button"
                className={styles.bulkBtn}
                aria-label="Move selected"
                onClick={onRequestBulkMove}
                disabled={Boolean(mutationInFlight)}
              >
                <FolderInput size={14} />
              </button>
            </Tooltip>
            <Tooltip tip="Delete selected" side="top">
              <button
                type="button"
                className={[styles.bulkBtn, styles.bulkBtnDanger].join(' ')}
                aria-label="Delete selected"
                onClick={onRequestBulkDelete}
                disabled={Boolean(mutationInFlight)}
              >
                <Trash2 size={14} />
              </button>
            </Tooltip>
            <Tooltip tip="Clear selection" side="top">
              <button
                type="button"
                className={styles.bulkBtn}
                aria-label="Clear selection"
                onClick={onClearSelection}
              >
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  )
}
