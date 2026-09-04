import { useEffect, useState } from 'react'
import { X, List, Shuffle, Maximize2, Loader } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import ProgressRing from '../ui/ProgressRing'
import { nasStreamUrl } from '../../utils/nasStream'
import { withThumb, buildPathSegments } from './playShared'
import overlayStyles from '../PlayOverlay.module.css'

/**
 * Image pane with thumbnail-first display + progress ring.
 *
 * Initial src is the cached disk thumbnail (sharp but pixelated when
 * scaled to viewport — that pixelation is the loading-state visual).
 * Then a streaming fetch downloads the full-res, ProgressRing tracks
 * received bytes, and on completion the img swaps to the blob URL.
 *
 * On a browser-cache hit the full-res appears immediately and no ring
 * is shown.
 */
function PlayImage({ src, name, size }) {
  const thumbSrc = withThumb(src)
  const [activeSrc, setActiveSrc] = useState(thumbSrc)
  const [progress,  setProgress]  = useState(0)
  const [done,      setDone]      = useState(false)

  useEffect(() => {
    let cancelled = false
    let blobUrl   = null
    let reader    = null

    // Cache probe: if the browser already has the bytes, skip the dance.
    const probe = new window.Image()
    probe.src = src
    if (probe.complete && probe.naturalWidth > 0) {
      setActiveSrc(src)
      setProgress(1)
      setDone(true)
      return
    }

    setActiveSrc(thumbSrc)
    setProgress(0)
    setDone(false)

    const abortController = new AbortController()

    ;(async () => {
      try {
        const response = await fetch(src, { signal: abortController.signal })
        if (!response.ok || !response.body) {
          setActiveSrc(src)
          setDone(true)
          return
        }
        const mime = response.headers.get('content-type') || 'image/jpeg'
        reader = response.body.getReader()
        const chunks = []
        let received = 0
        const total  = size > 0 ? size : 0
        for (;;) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone) break
          if (cancelled) return
          chunks.push(value)
          received += value.byteLength
          if (total > 0) setProgress(Math.min(received / total, 1))
        }
        if (cancelled) return
        blobUrl = URL.createObjectURL(new Blob(chunks, { type: mime }))
        setActiveSrc(blobUrl)
        setProgress(1)
        setDone(true)
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return
        setActiveSrc(src)
        setDone(true)
      }
    })()

    return () => {
      cancelled = true
      abortController.abort()
      reader?.cancel().catch(() => {})
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [src, thumbSrc, size])

  return (
    <>
      <img className={overlayStyles.media} src={activeSrc} alt={name} draggable={false} />
      {!done && size > 0 && <ProgressRing progress={progress} />}
    </>
  )
}

/**
 * Full-file viewer over the wall — opens one file whole and walks the
 * same trail/pool queue via `next`/`prev`. Escape and right-click both
 * return to the wall (handled by the caller); the Close button here
 * closes the whole overlay.
 */
export default function PlayViewer({
  connectionId, scanRoot, file, index, total, hasMore,
  recursive, toggleRecursive, shuffle, toggleShuffle, scanning,
  error, retry, next, prev,
  onSegmentClick, onReturnToWall, onToggleFullscreen, onClose,
}) {
  const isAtEnd = !hasMore && total > 0 && index === total - 1

  function renderMedia() {
    if (!file) return null
    const src = nasStreamUrl(connectionId, file.path)
    if (file.type === 'image') {
      const name = file.path.split('/').pop()
      return <PlayImage key={src} src={src} name={name} size={file.size ?? 0} />
    }
    if (file.type === 'video') {
      return <video key={src} className={overlayStyles.media} src={src} controls autoPlay />
    }
    return null
  }

  return (
    <div
      className={overlayStyles.viewerLayer}
      data-testid="play-viewer"
      onContextMenu={(e) => { e.preventDefault(); onReturnToWall() }}
    >
      <div className={overlayStyles.topBar}>
        <div className={overlayStyles.topBarLeft}>
          {file && (
            <>
              <div className={overlayStyles.fileNameRow}>
                <span className={overlayStyles.fileName}>
                  {file.path.split('/').pop()}
                </span>
                {scanning && (
                  <Loader size={14} className={overlayStyles.scanningSpinner} aria-label="Scanning" />
                )}
              </div>
              <span className={overlayStyles.filePath}>
                {buildPathSegments(
                  file.path.slice(0, file.path.lastIndexOf('/')) || '/'
                ).map((segment, i) => (
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
            </>
          )}
          {!file && scanning && (
            <Loader size={14} className={overlayStyles.scanningSpinner} aria-label="Scanning" />
          )}
        </div>
        <div className={overlayStyles.topBarRight}>
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
          <Tooltip tip="Close" side="bottom">
            <button className={overlayStyles.closeBtn} onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className={overlayStyles.content}>
        <div className={overlayStyles.previewArea}>
          {error && (
            <div className={overlayStyles.errorState}>
              <span>{error}</span>
              <button className={overlayStyles.retryBtn} onClick={retry}>Retry</button>
            </div>
          )}
          {renderMedia()}
          {file && !error && (
            <>
              <button
                type="button"
                className={[overlayStyles.tapZone, overlayStyles.tapZoneLeft].join(' ')}
                onClick={prev}
                disabled={index === 0}
                aria-label="Previous"
              />
              <button
                type="button"
                className={[overlayStyles.tapZone, overlayStyles.tapZoneRight].join(' ')}
                onClick={next}
                disabled={isAtEnd}
                aria-label="Next"
              />
            </>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className={overlayStyles.counter}>
          {index + 1}&thinsp;/&thinsp;{total}{scanning ? '+' : ''}
          {isAtEnd && <span className={overlayStyles.endLabel}>End</span>}
        </div>
      )}
    </div>
  )
}
