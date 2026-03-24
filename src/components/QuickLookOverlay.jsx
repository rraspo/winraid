import { useEffect, useState, useCallback, useRef } from 'react'
import { X, ChevronLeft, ChevronRight, File, Music, MoreHorizontal, Check } from 'lucide-react'
import Tooltip from './ui/Tooltip'
import styles from './QuickLookOverlay.module.css'
import { formatSize, formatDate } from '../utils/format'
import { fileType, getExt } from '../utils/fileTypes'

function nasStreamUrl(connectionId, remotePath) {
  // nas-stream://{connectionId}{/remote/path}
  // The path already starts with '/', so we append it directly to the origin.
  return `nas-stream://${connectionId}${remotePath}`
}

// ---------------------------------------------------------------------------
// Preview sub-components
// ---------------------------------------------------------------------------
function panStyle(zoom, pan) {
  if (zoom === 1 && pan.x === 0 && pan.y === 0) return undefined
  return { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }
}

/**
 * SVG arc progress ring.
 * progress: 0-1. Arc starts empty and fills clockwise as bytes arrive.
 * Only rendered while loading (parent hides it when done).
 */
function ProgressRing({ progress }) {
  const r          = 16
  const stroke     = 3
  const size       = (r + stroke) * 2
  const cx         = size / 2
  const cy         = size / 2
  const circ       = 2 * Math.PI * r
  const dashOffset = circ * (1 - Math.min(progress, 1))

  return (
    <svg
      className={styles.progressRing}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        className={styles.progressRingTrack}
        cx={cx} cy={cy} r={r}
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        className={styles.progressRingArc}
        cx={cx} cy={cy} r={r}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        style={{ transition: 'stroke-dashoffset 0.1s linear' }}
      />
    </svg>
  )
}

function ImagePreview({ src, size, zoom, pan, mediaRef }) {
  const [activeSrc, setActiveSrc] = useState(src + '?thumb=1')
  const [progress,  setProgress]  = useState(0)   // 0-1
  const [done,      setDone]      = useState(false)

  useEffect(() => {
    let cancelled = false
    let blobUrl   = null
    let reader    = null

    // Browser cache hit — show full-res immediately, no ring
    const probe = new window.Image()
    probe.src = src
    if (probe.complete && probe.naturalWidth > 0) {
      setActiveSrc(src)
      setProgress(1)
      setDone(true)
      return
    }

    // Show thumb while full-res downloads
    setActiveSrc(src + '?thumb=1')
    setProgress(0)
    setDone(false)

    const ac = new AbortController()

    ;(async () => {
      try {
        const response = await fetch(src, { signal: ac.signal })
        if (!response.ok || !response.body) throw new Error('bad response')

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
          if (total > 0) setProgress(received / total)
        }

        if (cancelled) return

        // Production CSP allows blob: (img-src includes blob:), so createObjectURL
        // is safe in both dev and packaged builds.
        blobUrl = URL.createObjectURL(new Blob(chunks, { type: mime }))
        setActiveSrc(blobUrl)
        setProgress(1)
        setDone(true)
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return
        // Fetch failed — fall back to letting the browser load natively
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
  }, [src, size])

  return (
    <div className={styles.mediaWrap}>
      <img
        ref={mediaRef}
        className={styles.previewImage}
        src={activeSrc}
        alt=""
        draggable={false}
        style={panStyle(zoom, pan)}
      />
      {!done && size > 0 && <ProgressRing progress={progress} />}
    </div>
  )
}

function VideoPreview({ src, loop, zoom, pan, mediaRef }) {
  const videoRef = useRef(null)

  // Restore saved volume/muted on mount
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const vol   = localStorage.getItem('ql-video-volume')
    const muted = localStorage.getItem('ql-video-muted')
    if (vol   !== null) v.volume = parseFloat(vol)
    if (muted !== null) v.muted  = muted === 'true'
  }, [])

  function handleVolumeChange() {
    const v = videoRef.current
    if (!v) return
    localStorage.setItem('ql-video-volume', String(v.volume))
    localStorage.setItem('ql-video-muted',  String(v.muted))
  }

  return (
    <div className={styles.mediaWrap}>
      <video
        ref={(el) => { videoRef.current = el; if (mediaRef) mediaRef.current = el }}
        className={styles.previewVideo}
        src={src}
        controls
        autoPlay
        loop={loop}
        onVolumeChange={handleVolumeChange}
        style={panStyle(zoom, pan)}
      />
    </div>
  )
}

function AudioPreview({ file, src }) {
  return (
    <div className={styles.audioWrap}>
      <Music size={48} className={styles.audioIcon} />
      <span className={styles.audioName}>{file.name}</span>
      <audio
        className={styles.previewAudio}
        src={src}
        controls
        autoPlay
      />
    </div>
  )
}

function TextPreview({ connectionId, remotePath }) {
  const [content, setContent] = useState(null)
  const [error,   setError]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setContent(null)
    setError(null)
    setLoading(true)
    window.winraid?.remote.readFile(connectionId, remotePath)
      .then((res) => {
        if (res?.ok) {
          setContent(res.content)
        } else {
          setError(res?.error ?? 'Failed to load file')
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [connectionId, remotePath])

  if (loading) {
    return <div className={styles.textLoading}>Loading...</div>
  }
  if (error) {
    return <div className={styles.textError}>{error}</div>
  }
  return (
    <div className={styles.textWrap}>
      <pre className={styles.previewText}>{content}</pre>
    </div>
  )
}

function UnknownPreview({ file }) {
  const ext = getExt(file.name)
  return (
    <div className={styles.unknownWrap}>
      <File size={56} className={styles.unknownIcon} />
      <span className={styles.unknownName}>{file.name}</span>
      {ext && <span className={styles.unknownExt}>.{ext.toUpperCase()}</span>}
      <div className={styles.unknownMeta}>
        <span className={styles.unknownMetaRow}>
          <span className={styles.unknownMetaLabel}>Size</span>
          <span className={styles.unknownMetaValue}>{formatSize(file.size)}</span>
        </span>
        <span className={styles.unknownMetaRow}>
          <span className={styles.unknownMetaLabel}>Modified</span>
          <span className={styles.unknownMetaValue}>{formatDate(file.modified)}</span>
        </span>
      </div>
      <span className={styles.unknownNote}>Preview not available for this file type</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FileMenu — three-dot dropdown for the top bar
// ---------------------------------------------------------------------------
function FileMenu({ file, onDelete, loop, onLoopChange, wheelMode, onWheelModeChange, invertPan, onInvertPanChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className={styles.fileMenuWrap}>
      <Tooltip tip="More actions" side="bottom">
      <button
        className={styles.fileMenuBtn}
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
      >
        <MoreHorizontal size={16} />
      </button>
      </Tooltip>
      {open && (
        <div className={styles.fileMenuDrop}>
          <button
            className={styles.fileMenuCheckRow}
            onClick={() => onLoopChange(!loop)}
          >
            <span className={styles.fileMenuCheckIcon}>
              {loop && <Check size={11} />}
            </span>
            Autoloop videos
          </button>
          <button
            className={styles.fileMenuCheckRow}
            onClick={() => onInvertPanChange(!invertPan)}
          >
            <span className={styles.fileMenuCheckIcon}>
              {invertPan && <Check size={11} />}
            </span>
            Invert pan direction
          </button>
          <div className={styles.fileMenuDivider} />
          <div className={styles.fileMenuLabel}>Scroll wheel</div>
          <button
            className={styles.fileMenuCheckRow}
            onClick={() => onWheelModeChange('zoom')}
          >
            <span className={styles.fileMenuCheckIcon}>
              {wheelMode === 'zoom' && <Check size={11} />}
            </span>
            Zoom
          </button>
          <button
            className={styles.fileMenuCheckRow}
            onClick={() => onWheelModeChange('scroll')}
          >
            <span className={styles.fileMenuCheckIcon}>
              {wheelMode === 'scroll' && <Check size={11} />}
            </span>
            Navigate files
          </button>
          <div className={styles.fileMenuDivider} />
          <button
            className={[styles.fileMenuItem, styles.fileMenuItemDanger].join(' ')}
            onClick={() => { setOpen(false); onDelete({ name: file.name, path: file.path, isDir: false }) }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main overlay
// ---------------------------------------------------------------------------
export default function QuickLookOverlay({ file, connectionId, remoteBasePath, files, onNavigate, onClose, onDelete }) {
  // Index of current file within the non-folder list
  const currentIdx = files.findIndex((f) => f.path === file.path)
  const hasPrev    = currentIdx > 0
  const hasNext    = currentIdx < files.length - 1

  const handlePrev = useCallback(() => {
    if (hasPrev) onNavigate(files[currentIdx - 1])
  }, [hasPrev, currentIdx, files, onNavigate])

  const handleNext = useCallback(() => {
    if (hasNext) onNavigate(files[currentIdx + 1])
  }, [hasNext, currentIdx, files, onNavigate])

  // Keyboard bindings
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape')      { e.preventDefault(); onClose() }
      if (e.key === 'ArrowLeft')   { e.preventDefault(); handlePrev() }
      if (e.key === 'ArrowRight')  { e.preventDefault(); handleNext() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, handlePrev, handleNext])

  const [copied,    setCopied]    = useState(false)
  const [loop,      setLoop]      = useState(() => localStorage.getItem('ql-video-loop') === 'true')
  const [wheelMode, setWheelMode] = useState(() => localStorage.getItem('ql-wheel-mode') ?? 'zoom')
  const [zoom,      setZoom]      = useState(1)
  const [pan,       setPan]       = useState({ x: 0, y: 0 })
  const [invertPan, setInvertPan] = useState(() => localStorage.getItem('ql-invert-pan') === 'true')
  const scrollThrottleRef = useRef(false)
  const previewAreaRef    = useRef(null)
  const mediaRef          = useRef(null)
  const panRef            = useRef({ x: 0, y: 0 })
  const latestRef         = useRef({})
  latestRef.current = { wheelMode, zoom, invertPan, handleNext, handlePrev }

  function handleLoopChange(v) {
    setLoop(v)
    localStorage.setItem('ql-video-loop', String(v))
  }

  function handleWheelModeChange(v) {
    setWheelMode(v)
    setZoom(1)
    const zero = { x: 0, y: 0 }
    setPan(zero)
    panRef.current = zero
    localStorage.setItem('ql-wheel-mode', v)
  }

  // Reset zoom + pan when navigating to a different file
  useEffect(() => {
    setZoom(1)
    const zero = { x: 0, y: 0 }
    setPan(zero)
    panRef.current = zero
  }, [file.path])

  function handleInvertPanChange(v) {
    setInvertPan(v)
    localStorage.setItem('ql-invert-pan', String(v))
  }

  // Wheel: zoom or scroll-navigate (passive:false so we can preventDefault)
  useEffect(() => {
    const el = previewAreaRef.current
    if (!el) return
    function onWheel(e) {
      // Horizontal tilt wheel → navigate files (always, regardless of wheel mode)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && e.deltaX !== 0) {
        e.preventDefault()
        if (e.deltaX > 0) latestRef.current.handleNext()
        else latestRef.current.handlePrev()
        return
      }

      if (latestRef.current.wheelMode === 'zoom') {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setZoom((z) => {
          const next = Math.max(1, Math.round((z + delta) * 100) / 100)
          if (next === 1) {
            const zero = { x: 0, y: 0 }
            setPan(zero)
            panRef.current = zero
          }
          return next
        })
      } else {
        if (scrollThrottleRef.current) return
        scrollThrottleRef.current = true
        setTimeout(() => { scrollThrottleRef.current = false }, 400)
        if (e.deltaY > 0) latestRef.current.handleNext()
        else latestRef.current.handlePrev()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Mouse-position panning (only active when zoomed in)
  useEffect(() => {
    const el = previewAreaRef.current
    if (!el) return
    function onMouseMove(e) {
      const { zoom: z, invertPan: ip } = latestRef.current
      if (z <= 1) return
      const rect    = el.getBoundingClientRect()
      const offsetX = e.clientX - (rect.left + rect.width  / 2)
      const offsetY = e.clientY - (rect.top  + rect.height / 2)

      const sign = ip ? 1 : -1
      let x = sign * offsetX * (z - 1)
      let y = sign * offsetY * (z - 1)

      // Clamp so the image can't pan off screen
      const media = mediaRef.current
      if (media) {
        const maxX = Math.max(0, (media.offsetWidth  * z - rect.width)  / 2)
        const maxY = Math.max(0, (media.offsetHeight * z - rect.height) / 2)

        x = Math.max(-maxX, Math.min(maxX, x))
        y = Math.max(-maxY, Math.min(maxY, y))
      }

      const next = { x, y }
      panRef.current = next
      setPan(next)
    }
    el.addEventListener('mousemove', onMouseMove)
    return () => el.removeEventListener('mousemove', onMouseMove)
  }, [])

  const base    = remoteBasePath?.replace(/\/+$/, '') ?? ''
  const relPath = file.path.startsWith(base + '/') ? file.path.slice(base.length + 1) : file.path

  function handleCopyPath() {
    navigator.clipboard.writeText(relPath)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const type = fileType(file.name)
  const src  = (type === 'image' || type === 'video' || type === 'audio')
    ? nasStreamUrl(connectionId, file.path)
    : null

  function renderPreview() {
    switch (type) {
      case 'image': return <ImagePreview src={src} size={file.size ?? 0} zoom={zoom} pan={pan} mediaRef={mediaRef} />
      case 'video': return <VideoPreview src={src} loop={loop} zoom={zoom} pan={pan} mediaRef={mediaRef} />
      case 'audio': return <AudioPreview file={file} src={src} />
      case 'text':  return <TextPreview connectionId={connectionId} remotePath={file.path} />
      default:      return <UnknownPreview file={file} />
    }
  }

  return (
    <div
      className={styles.overlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={`Quick Look: ${file.name}`}
    >
      {/* Top bar */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <Tooltip tip={relPath} side="bottom">
            <button className={styles.fileName} onClick={handleCopyPath}>
              {file.name}
              {copied && <span className={styles.copiedBadge}>Copied</span>}
            </button>
          </Tooltip>
          <span className={styles.fileMeta}>
            {type !== 'unknown' && <span className={styles.fileType}>{type.toUpperCase()}</span>}
            <span>{formatSize(file.size)}</span>
            <span className={styles.metaSep}>·</span>
            <span>{formatDate(file.modified)}</span>
          </span>
        </div>
        <FileMenu file={file} onDelete={onDelete} loop={loop} onLoopChange={handleLoopChange} wheelMode={wheelMode} onWheelModeChange={handleWheelModeChange} invertPan={invertPan} onInvertPanChange={handleInvertPanChange} />
        <Tooltip tip="Close (Esc)" side="bottom">
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
        </Tooltip>
      </div>

      {/* Content area */}
      <div className={styles.content}>
        {/* Prev arrow */}
        <Tooltip tip="Previous (Left arrow)" side="right">
          <button
            className={[styles.navBtn, styles.navBtnLeft].join(' ')}
            onClick={handlePrev}
            disabled={!hasPrev}
            aria-label="Previous file"
          >
            <ChevronLeft size={22} />
          </button>
        </Tooltip>

        {/* Preview */}
        <div
          ref={previewAreaRef}
          className={[
            styles.previewArea,
            wheelMode === 'zoom' ? styles.previewAreaZoom : styles.previewAreaScroll,
          ].join(' ')}
          style={zoom > 1 ? { cursor: 'crosshair' } : undefined}
        >
          {renderPreview()}
        </div>

        {/* Next arrow */}
        <Tooltip tip="Next (Right arrow)" side="left">
          <button
            className={[styles.navBtn, styles.navBtnRight].join(' ')}
            onClick={handleNext}
            disabled={!hasNext}
            aria-label="Next file"
          >
            <ChevronRight size={22} />
          </button>
        </Tooltip>
      </div>

      {/* File counter */}
      {files.length > 1 && (
        <div className={styles.counter}>
          {currentIdx + 1} / {files.length}
        </div>
      )}
    </div>
  )
}
