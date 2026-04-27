import { useEffect, useRef, useState } from 'react'
import { X, List, Shuffle, Maximize2, Loader } from 'lucide-react'
import Tooltip from './ui/Tooltip'
import styles from './PlayOverlay.module.css'
import { usePlayIndex } from '../hooks/usePlayIndex'
import { nasStreamUrl } from '../utils/nasStream'

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
  const [pinnedFile, setPinnedFile] = useState(null)

  const {
    files, index, scanning,
    recursive, toggleRecursive,
    shuffle, toggleShuffle,
    next, prev, error, retry,
  } = usePlayIndex(connectionId, scanRoot)

  function handleSegmentClick(segPath) {
    if (segPath === scanRoot) return
    if (files[index]) setPinnedFile(files[index])
    setScanRoot(segPath)
  }

  function handleNext() {
    if (pinnedFile) { setPinnedFile(null); return }
    next()
  }
  function handlePrev() {
    if (pinnedFile) { setPinnedFile(null); return }
    prev()
  }

  const overlayRef = useRef(null)

  const currentFile = pinnedFile ?? files[index] ?? null
  const isAtEnd     = !pinnedFile && !scanning && files.length > 0 && index === files.length - 1
  const isEmpty     = !pinnedFile && !scanning && files.length === 0

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); handleNext() }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); handlePrev() }
      if (e.key === 'Escape')     { e.preventDefault(); onClose() }
    }
    function onWheel(e) {
      if (e.deltaY > 0) handleNext()
      else if (e.deltaY < 0) handlePrev()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('wheel', onWheel)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('wheel', onWheel)
    }
  }, [pinnedFile, next, prev, onClose])

  useEffect(() => { overlayRef.current?.focus() }, [])

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
      return <img className={styles.media} src={src} alt={currentFile.path.split('/').pop()} draggable={false} />
    }
    if (currentFile.type === 'video') {
      return <video key={src} className={styles.media} src={src} controls autoPlay />
    }
    return null
  }

  return (
    <div ref={overlayRef} className={styles.overlay} role="dialog" aria-modal="true" aria-label="Play" tabIndex={-1}>
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
                onClick={handlePrev}
                disabled={!pinnedFile && index === 0}
                aria-label="Previous"
              />
              <button
                type="button"
                className={[styles.tapZone, styles.tapZoneRight].join(' ')}
                onClick={handleNext}
                disabled={isAtEnd}
                aria-label="Next"
              />
            </>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className={styles.counter}>
          {index + 1}&thinsp;/&thinsp;{files.length}{scanning ? '+' : ''}
          {isAtEnd && <span className={styles.endLabel}>End</span>}
        </div>
      )}
    </div>
  )
}
