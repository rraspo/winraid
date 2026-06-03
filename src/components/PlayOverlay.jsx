import { useEffect, useRef, useState } from 'react'
import { X, List, Shuffle, Maximize2, Loader } from 'lucide-react'
import Tooltip from './ui/Tooltip'
import ProgressRing from './ui/ProgressRing'
import styles from './PlayOverlay.module.css'
import { usePlayIndex } from '../hooks/usePlayIndex'
import { nasStreamUrl } from '../utils/nasStream'

function withThumb(url) {
  return url + (url.includes('?') ? '&' : '?') + 'thumb=1'
}

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

    const ac = new AbortController()

    ;(async () => {
      try {
        const response = await fetch(src, { signal: ac.signal })
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
      ac.abort()
      reader?.cancel().catch(() => {})
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [src, thumbSrc, size])

  return (
    <>
      <img className={styles.media} src={activeSrc} alt={name} draggable={false} />
      {!done && size > 0 && <ProgressRing progress={progress} />}
    </>
  )
}

function buildPathSegments(fileDir) {
  const segments = [{ label: '/', path: '/' }]
  if (!fileDir || fileDir === '/') return segments
  let cumulative = ''
  for (const part of fileDir.split('/').filter(Boolean)) {
    cumulative += '/' + part
    segments.push({ label: part, path: cumulative })
  }
  return segments
}

export default function PlayOverlay({ connectionId, path, onClose }) {
  const [scanRoot, setScanRoot] = useState(path)
  // When the user navigates between folders via the breadcrumb, the file
  // they were just viewing carries into the new scope as the trail seed
  // — they can prev back to it like any other walked file.
  const [startFile, setStartFile] = useState(null)

  const {
    playlist, index, scanning, hasMore, nextPredicted,
    recursive, toggleRecursive,
    shuffle, toggleShuffle,
    next, prev, error, retry,
  } = usePlayIndex(connectionId, scanRoot, startFile)

  function handleSegmentClick(segPath) {
    if (segPath === scanRoot) return
    if (playlist[index]) setStartFile(playlist[index])
    setScanRoot(segPath)
  }

  const overlayRef = useRef(null)

  const currentFile = playlist[index] ?? null
  const isAtEnd     = !hasMore && playlist.length > 0 && index === playlist.length - 1
  const isEmpty     = !scanning && playlist.length === 0

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); prev() }
      if (e.key === 'Escape')     { e.preventDefault(); onClose() }
    }
    function onWheel(e) {
      if (e.deltaY > 0) next()
      else if (e.deltaY < 0) prev()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('wheel', onWheel)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('wheel', onWheel)
    }
  }, [next, prev, onClose])

  useEffect(() => { overlayRef.current?.focus() }, [])

  // Prefetch the most-likely next image so pressing Right is instant.
  // Browser caches the bytes; we don't need to keep the Image instance.
  // Videos are not prefetched — full-video downloads would be too costly.
  useEffect(() => {
    if (!nextPredicted || nextPredicted.type !== 'image') return
    const img = new Image()
    img.src = nasStreamUrl(connectionId, nextPredicted.path)
  }, [nextPredicted, connectionId])

  function handleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  function renderMedia() {
    if (!currentFile) return null
    const src = nasStreamUrl(connectionId, currentFile.path)
    if (currentFile.type === 'image') {
      const name = currentFile.path.split('/').pop()
      return <PlayImage key={src} src={src} name={name} size={currentFile.size ?? 0} />
    }
    if (currentFile.type === 'video') {
      return <video key={src} className={styles.media} src={src} controls autoPlay />
    }
    return null
  }

  return (
    <div ref={overlayRef} className={styles.overlay} data-theme="dark" role="dialog" aria-modal="true" aria-label="Play" tabIndex={-1}>
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          {currentFile && (
            <>
              <div className={styles.fileNameRow}>
                <span className={styles.fileName}>
                  {currentFile.path.split('/').pop()}
                </span>
                {scanning && (
                  <Loader size={14} className={styles.scanningSpinner} aria-label="Scanning" />
                )}
              </div>
              <span className={styles.filePath}>
                {buildPathSegments(
                  currentFile.path.slice(0, currentFile.path.lastIndexOf('/')) || '/'
                ).map((seg, i) => (
                  <span key={seg.path} className={styles.pathCrumb}>
                    {i > 0 && <span className={styles.pathSep}>/</span>}
                    <button
                      type="button"
                      className={[styles.pathSegment, seg.path === scanRoot ? styles.pathSegmentActive : ''].filter(Boolean).join(' ')}
                      onClick={() => handleSegmentClick(seg.path)}
                    >
                      {seg.label}
                    </button>
                  </span>
                ))}
              </span>
            </>
          )}
          {!currentFile && scanning && (
            <Loader size={14} className={styles.scanningSpinner} aria-label="Scanning" />
          )}
        </div>
        <div className={styles.topBarRight}>
          <Tooltip tip={recursive ? 'Flat (current folder only)' : 'Recursive (all subfolders)'} side="bottom">
            <button
              className={[styles.toggleBtn, recursive ? styles.toggleBtnOn : ''].filter(Boolean).join(' ')}
              onClick={toggleRecursive}
              aria-label="Toggle recursive scan"
              aria-pressed={recursive}
            >
              <List size={15} />
            </button>
          </Tooltip>
          <Tooltip tip={shuffle ? 'Sequential order' : 'Shuffle'} side="bottom">
            <button
              className={[styles.toggleBtn, shuffle ? styles.toggleBtnOn : ''].filter(Boolean).join(' ')}
              onClick={toggleShuffle}
              aria-label="Toggle shuffle"
              aria-pressed={shuffle}
            >
              <Shuffle size={15} />
            </button>
          </Tooltip>
          <Tooltip tip="Toggle fullscreen" side="bottom">
            <button className={styles.toggleBtn} onClick={handleFullscreen} aria-label="Toggle fullscreen">
              <Maximize2 size={15} />
            </button>
          </Tooltip>
          <Tooltip tip="Close (Esc)" side="bottom">
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.previewArea}>
          {isEmpty && !error && (
            <div className={styles.emptyState}>No media files found</div>
          )}
          {error && (
            <div className={styles.errorState}>
              <span>{error}</span>
              <button className={styles.retryBtn} onClick={retry}>Retry</button>
            </div>
          )}
          {renderMedia()}
          {currentFile && !error && (
            <>
              <button
                type="button"
                className={[styles.tapZone, styles.tapZoneLeft].join(' ')}
                onClick={prev}
                disabled={index === 0}
                aria-label="Previous"
              />
              <button
                type="button"
                className={[styles.tapZone, styles.tapZoneRight].join(' ')}
                onClick={next}
                disabled={isAtEnd}
                aria-label="Next"
              />
            </>
          )}
        </div>
      </div>

      {playlist.length > 0 && (
        <div className={styles.counter}>
          {index + 1}&thinsp;/&thinsp;{playlist.length}{scanning ? '+' : ''}
          {isAtEnd && <span className={styles.endLabel}>End</span>}
        </div>
      )}
    </div>
  )
}
