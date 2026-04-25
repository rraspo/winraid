import { useEffect, useRef } from 'react'
import { X, ChevronLeft, ChevronRight, List, Shuffle, Maximize2, Loader } from 'lucide-react'
import Tooltip from './ui/Tooltip'
import styles from './PlayOverlay.module.css'
import { usePlayIndex } from '../hooks/usePlayIndex'
import { nasStreamUrl } from '../utils/nasStream'

export default function PlayOverlay({ connectionId, path, onClose }) {
  const {
    files, index, scanning,
    recursive, toggleRecursive,
    shuffle, toggleShuffle,
    next, prev, error, retry,
  } = usePlayIndex(connectionId, path)

  const overlayRef = useRef(null)

  const currentFile = files[index] ?? null
  const isAtEnd     = !scanning && files.length > 0 && index === files.length - 1
  const isEmpty     = !scanning && files.length === 0

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); prev() }
      if (e.key === 'Escape')     { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [next, prev, onClose])

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
            <span className={styles.fileName}>
              {currentFile.path.split('/').pop()}
            </span>
          )}
          {scanning && (
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
        <button
          className={[styles.navBtn, styles.navBtnLeft].join(' ')}
          onClick={prev}
          disabled={index === 0}
          aria-label="Previous"
        >
          <ChevronLeft size={22} />
        </button>

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
        </div>

        <button
          className={[styles.navBtn, styles.navBtnRight, isAtEnd ? styles.navBtnDimmed : ''].filter(Boolean).join(' ')}
          onClick={next}
          disabled={isAtEnd}
          aria-label="Next"
        >
          <ChevronRight size={22} />
        </button>
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
