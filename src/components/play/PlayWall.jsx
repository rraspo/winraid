import { useEffect, useMemo, useRef, useState } from 'react'
import { X, List, Shuffle, Maximize2, Loader } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import VideoThumb from '../browse/VideoThumb'
import { nasStreamUrl } from '../../utils/nasStream'
import { layoutMasonry } from '../../utils/masonry'
import { withThumb, buildPathSegments } from './playShared'
import overlayStyles from '../PlayOverlay.module.css'
import styles from './PlayWall.module.css'

const TILE_COLUMN_WIDTH   = 240
const TILE_GAP            = 12
const FALLBACK_COLUMNS    = 4
const VIDEO_TILE_RATIO    = 16 / 9

/**
 * Scrollable masonry wall of every walked file. Stays mounted underneath
 * the viewer so scroll position and tiles survive opening/closing a file.
 */
export default function PlayWall({
  connectionId, scanRoot, playlist, scanning, poolSize,
  recursive, toggleRecursive, shuffle, toggleShuffle,
  error, retry, pageSize, fill,
  onSegmentClick, onOpenTile, onToggleFullscreen, onClose,
  hiddenFromViewer,
}) {
  const scrollContainerRef = useRef(null)
  const sentinelRef        = useRef(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [imageRatios,    setImageRatios]    = useState(() => new Map())

  useEffect(() => {
    const element = scrollContainerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0]?.contentRect?.width ?? 0)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = sentinelRef.current
    if (!element) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) fill(pageSize)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fill, pageSize])

  function handleThumbLoad(remotePath, event) {
    const { naturalWidth, naturalHeight } = event.target
    if (!naturalWidth || !naturalHeight) return
    const ratio = naturalWidth / naturalHeight
    setImageRatios((previous) => {
      if (previous.get(remotePath) === ratio) return previous
      const next = new Map(previous)
      next.set(remotePath, ratio)
      return next
    })
  }

  const columnCount = containerWidth > 0
    ? Math.max(1, Math.floor(containerWidth / TILE_COLUMN_WIDTH))
    : FALLBACK_COLUMNS

  const { positions, height } = useMemo(() => {
    const items = playlist.map((file) => ({
      ratio: file.type === 'video' ? VIDEO_TILE_RATIO : (imageRatios.get(file.path) || 0),
    }))
    return layoutMasonry(items, { columnCount, columnWidth: TILE_COLUMN_WIDTH, gap: TILE_GAP })
  }, [playlist, imageRatios, columnCount])

  const isEmpty     = !scanning && playlist.length === 0
  const totalKnown  = playlist.length + poolSize

  return (
    <div className={styles.wallRoot} aria-hidden={hiddenFromViewer || undefined}>
      <div className={overlayStyles.topBar}>
        <div className={overlayStyles.topBarLeft}>
          <div className={overlayStyles.fileNameRow}>
            {scanning && (
              <Loader size={14} className={overlayStyles.scanningSpinner} aria-label="Scanning" />
            )}
            <span className={overlayStyles.filePath}>
              {buildPathSegments(scanRoot).map((segment, i) => (
                <span key={segment.path} className={overlayStyles.pathCrumb}>
                  {i > 0 && <span className={overlayStyles.pathSep}>/</span>}
                  <button
                    type="button"
                    className={[overlayStyles.pathSegment, segment.path === scanRoot ? overlayStyles.pathSegmentActive : ''].filter(Boolean).join(' ')}
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
          {playlist.length > 0 && (
            <span className={styles.wallCounter}>
              {playlist.length}&thinsp;/&thinsp;{totalKnown}{scanning ? '+' : ''}
            </span>
          )}
          <Tooltip tip={recursive ? 'Flat (current folder only)' : 'Recursive (all subfolders)'} side="bottom">
            <button
              className={[overlayStyles.toggleBtn, recursive ? overlayStyles.toggleBtnOn : ''].filter(Boolean).join(' ')}
              onClick={toggleRecursive}
              aria-label="Toggle recursive scan"
              aria-pressed={recursive}
            >
              <List size={15} />
            </button>
          </Tooltip>
          <Tooltip tip={shuffle ? 'Sequential order' : 'Shuffle'} side="bottom">
            <button
              className={[overlayStyles.toggleBtn, shuffle ? overlayStyles.toggleBtnOn : ''].filter(Boolean).join(' ')}
              onClick={toggleShuffle}
              aria-label="Toggle shuffle"
              aria-pressed={shuffle}
            >
              <Shuffle size={15} />
            </button>
          </Tooltip>
          <Tooltip tip="Toggle fullscreen" side="bottom">
            <button className={overlayStyles.toggleBtn} onClick={onToggleFullscreen} aria-label="Toggle fullscreen">
              <Maximize2 size={15} />
            </button>
          </Tooltip>
          <Tooltip tip="Close (Esc)" side="bottom">
            <button className={overlayStyles.closeBtn} onClick={onClose} aria-label="Close">
              <X size={18} />
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
              const position   = positions[tileIndex]
              const name       = file.path.split('/').pop()
              const streamUrl  = nasStreamUrl(connectionId, file.path)
              const tileStyle  = position
                ? { left: position.left, top: position.top, width: position.width, height: position.height }
                : { left: 0, top: 0, width: TILE_COLUMN_WIDTH, height: TILE_COLUMN_WIDTH }
              return (
                <button
                  key={file.path}
                  type="button"
                  className={styles.tile}
                  data-type={file.type}
                  style={tileStyle}
                  onClick={() => onOpenTile(tileIndex)}
                  aria-label={`Open ${name}`}
                >
                  {file.type === 'video' ? (
                    <VideoThumb url={streamUrl} />
                  ) : (
                    <img
                      className={styles.tileImage}
                      src={withThumb(streamUrl)}
                      alt=""
                      loading="lazy"
                      onLoad={(event) => handleThumbLoad(file.path, event)}
                    />
                  )}
                </button>
              )
            })}
          </div>
        )}
        <div data-testid="play-wall-sentinel" className={styles.sentinel} ref={sentinelRef} />
      </div>
    </div>
  )
}
