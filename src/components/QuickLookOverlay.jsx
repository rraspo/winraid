import { useEffect, useState, useCallback, useRef } from 'react'
import { X, ChevronLeft, ChevronRight, File, Music, MoreHorizontal, Check, Crop, RotateCw, Loader, Camera, Scissors, Play, Pause } from 'lucide-react'
import ReactCrop from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import Tooltip from './ui/Tooltip'
import ProgressRing from './ui/ProgressRing'
import PdfPreview from './PdfPreview'
import styles from './QuickLookOverlay.module.css'
import { formatSize, formatDate } from '../utils/format'
import { fileType, getExt } from '../utils/fileTypes'
import { nasStreamUrl } from '../utils/nasStream'
import { computePan } from '../utils/panMath'
import * as remoteFS from '../services/remoteFS'
import * as toast from '../services/toast'
import {
  cropMimeType,
  cropCopyPath,
  nextAvailableCopyPath,
  fullImageCrop,
  centeredAspectCrop,
  rotateCropImage,
  applyCropToImage,
} from '../utils/cropHelpers'
import { resolveSnapshotFormat } from '../utils/snapshotFormats'
// Removed: ImageCropModal — crop is now inline in this overlay

const CROP_ASPECTS = [
  { label: 'Free',   value: undefined },
  { label: '1:1',    value: 1 },
  { label: '4:3',    value: 4 / 3 },
  { label: '3:2',    value: 3 / 2 },
  { label: '16:9',   value: 16 / 9 },
]

// Format a duration in seconds as HH-MM-SS for filenames (no colons).
function formatVideoTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}-${pad(m)}-${pad(s)}`
}

// Format seconds as clock time for the trim UI (HH:MM:SS, or MM:SS under 1h).
function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`
}

// Capture the current frame of a <video> element to a Blob in the given format.
// fmt is a SNAPSHOT_FORMATS triple: { mime, ext, quality }.
function captureVideoFrame(videoEl, fmt) {
  return new Promise((resolve, reject) => {
    if (!videoEl?.videoWidth || !videoEl?.videoHeight) {
      reject(new Error('Video not ready'))
      return
    }
    const canvas  = document.createElement('canvas')
    canvas.width  = videoEl.videoWidth
    canvas.height = videoEl.videoHeight
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')),
      fmt.mime,
      fmt.quality,
    )
  })
}

// ---------------------------------------------------------------------------
// Preview sub-components
// ---------------------------------------------------------------------------
function panStyle(zoom, pan) {
  if (zoom === 1 && pan.x === 0 && pan.y === 0) return undefined
  return { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }
}

function withThumb(url) {
  return url + (url.includes('?') ? '&' : '?') + 'thumb=1'
}

function ImagePreview({ src, size, zoom, pan, mediaRef, onContextMenu }) {
  const [activeSrc, setActiveSrc] = useState(withThumb(src))
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
    setActiveSrc(withThumb(src))
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

        // Production CSP allows blob: (img-src includes blob:), so createObjectURL
        // is safe in both dev and packaged builds.
        // Synchronous from here to setDone(true) — no await points, so the
        // cleanup function cannot interleave and revoke blobUrl prematurely.
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
        onContextMenu={onContextMenu}
      />
      {!done && size > 0 && <ProgressRing progress={progress} />}
    </div>
  )
}

function CropImagePreview({ src, crop, onChange, onComplete, aspect, imgRef, onLoad, onContextMenu }) {
  const wrapRef = useRef(null)
  const [bounds, setBounds] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setBounds({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const imgStyle = bounds.w > 0
    ? { maxWidth: bounds.w, maxHeight: bounds.h }
    : { visibility: 'hidden' }

  return (
    <div className={styles.mediaWrap} ref={wrapRef}>
      <ReactCrop
        crop={crop}
        onChange={onChange}
        onComplete={onComplete}
        {...(aspect !== undefined ? { aspect } : {})}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          className={styles.cropImage}
          draggable={false}
          onLoad={onLoad}
          style={imgStyle}
          onContextMenu={onContextMenu}
        />
      </ReactCrop>
    </div>
  )
}

function VideoPreview({ src, loop, zoom, pan, mediaRef, trimming, trimBar }) {
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
      <div className={styles.videoCol}>
        <video
          ref={(el) => { videoRef.current = el; if (mediaRef) mediaRef.current = el }}
          className={[styles.previewVideo, trimming ? styles.previewVideoTrimming : ''].filter(Boolean).join(' ')}
          src={src}
          controls={!trimming}
          autoPlay
          loop={loop}
          onVolumeChange={handleVolumeChange}
          style={panStyle(zoom, pan)}
        />
        {trimBar}
      </div>
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
export default function QuickLookOverlay({ file, connectionId, remoteBasePath, files, onNavigate, onClose, onDelete, canServerEdit }) {
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

  // Arrow key navigation + spacebar play/pause (Escape is handled in useBrowse)
  useEffect(() => {
    function onKeyDown(e) {
      // While trimming, lock everything except Escape (exits trim mode) and
      // space (previews the selection)
      if (latestRef.current.trimming) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exitTrimMode(); return }
        if (e.key === ' ')      { e.preventDefault(); e.stopPropagation(); toggleTrimPlay(); return }
        return
      }
      // While cropping, lock everything except Escape (which exits crop mode)
      if (latestRef.current.cropping) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exitCropMode() }
        return
      }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); handlePrev(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); handleNext(); return }
      if (e.key === ' ' && mediaRef.current?.tagName === 'VIDEO') {
        e.preventDefault()
        const v = mediaRef.current
        v.paused ? v.play() : v.pause()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handlePrev, handleNext])

  const [copied,    setCopied]    = useState(false)
  const [loop,      setLoop]      = useState(() => localStorage.getItem('ql-video-loop') === 'true')
  const [wheelMode, setWheelMode] = useState(() => localStorage.getItem('ql-wheel-mode') ?? 'zoom')
  const [zoom,      setZoom]      = useState(1)
  const [pan,       setPan]       = useState({ x: 0, y: 0 })
  const [invertPan, setInvertPan] = useState(() => localStorage.getItem('ql-invert-pan') === 'true')
  const [cacheBust, setCacheBust] = useState(0)

  // Crop mode (inline — no modal). Snapshot the file at entry so that a stray
  // navigation cannot retarget the save to a different path.
  const [cropping,    setCropping]    = useState(false)
  const [cropFile,    setCropFile]    = useState(null)
  const [crop,        setCrop]        = useState()
  const [compCrop,    setCompCrop]    = useState(null)
  const [cropAspect,  setCropAspect]  = useState(0)
  const [cropSrc,     setCropSrc]     = useState(null)
  const [cropSaving,  setCropSaving]  = useState(false)
  const [cropError,   setCropError]   = useState(null)
  const [cropRotating, setCropRotating] = useState(false)
  const [trimming,   setTrimming]   = useState(false)
  const [trimFile,   setTrimFile]   = useState(null)
  const [trimIn,     setTrimIn]     = useState(0)
  const [trimOut,    setTrimOut]    = useState(0)
  const [trimDur,    setTrimDur]    = useState(0)
  const [trimSaving, setTrimSaving] = useState(false)
  const [trimPos,     setTrimPos]     = useState(0)
  const [trimPlaying, setTrimPlaying] = useState(false)
  const [snapMsg, setSnapMsg] = useState(null)
  const snapMsgTimerRef = useRef(null)
  const cropImgRef     = useRef(null)
  const rotatedUrlsRef = useRef([])
  const scrollThrottleRef = useRef(false)
  const overlayRef        = useRef(null)
  const previewAreaRef    = useRef(null)
  const mediaRef          = useRef(null)
  const panRef            = useRef({ x: 0, y: 0 })
  const latestRef         = useRef({})
  const trimTrackRef      = useRef(null)
  const trimDragRef       = useRef(null)   // 'start' | 'end' | null while dragging a handle
  const trimRangeRef      = useRef({ in: 0, out: 0 })  // current selection for stable listeners
  const type = file ? fileType(file.name) : 'unknown'
  latestRef.current = { wheelMode, zoom, invertPan, handleNext, handlePrev, cropping, trimming, type }


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

  // ── Trim handlers ──────────────────────────────────────────────────────────
  function enterTrimMode() {
    const v = mediaRef.current
    const dur = v?.duration
    const safe = Number.isFinite(dur) ? dur : 0
    v?.pause?.()
    setTrimFile(file)
    setTrimIn(0)
    setTrimOut(safe)
    setTrimDur(safe)
    setTrimPos(Number.isFinite(v?.currentTime) ? v.currentTime : 0)
    setTrimPlaying(false)
    setTrimming(true)
  }

  function exitTrimMode() {
    setTrimming(false)
    setTrimFile(null)
    setTrimSaving(false)
    setTrimPlaying(false)
  }

  trimRangeRef.current = { in: trimIn, out: trimOut }

  // Track the playhead and clamp the preview to the selection: reaching the
  // out-point pauses, so play shows exactly what would be saved.
  useEffect(() => {
    if (!trimming) return undefined
    const v = mediaRef.current
    if (!v) return undefined
    const onTime = () => {
      const t = v.currentTime
      setTrimPos(Number.isFinite(t) ? t : 0)
      if (!v.paused && t >= trimRangeRef.current.out) v.pause()
    }
    const onPlay  = () => setTrimPlaying(true)
    const onPause = () => setTrimPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [trimming, mediaRef])

  function toggleTrimPlay() {
    const v = mediaRef.current
    if (!v) return
    if (v.paused) {
      const { in: start, out: end } = trimRangeRef.current
      if (!Number.isFinite(v.currentTime) || v.currentTime < start || v.currentTime >= end) {
        try { v.currentTime = start } catch { /* not seekable yet */ }
        setTrimPos(start)
      }
      const p = v.play()
      p?.catch?.(() => {})
    } else {
      v.pause()
    }
  }

  // Seek the preview so the user sees the exact frame at the handle they move.
  function seekPreview(t) {
    if (mediaRef.current && Number.isFinite(t)) {
      try { mediaRef.current.currentTime = t } catch { /* not seekable yet */ }
      setTrimPos(t)
    }
  }

  // Clicking the bare track (not a handle) scrubs the preview to that time.
  function handleTrackPointerDown(e) {
    if (e.target !== trimTrackRef.current || trimSaving) return
    seekPreview(timeFromClientX(e.clientX))
  }

  // Map a pointer x-coordinate to a time on the trim track.
  function timeFromClientX(clientX) {
    const el = trimTrackRef.current
    if (!el || !trimDur) return 0
    const rect = el.getBoundingClientRect()
    if (!rect.width) return 0
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return pct * trimDur
  }

  // Drag handles. start clamps to [0, trimOut]; end clamps to [trimIn, trimDur].
  // No window listeners — pointer capture keeps events on the handle even when
  // the cursor leaves it.
  function handleDragDown(which) {
    return (e) => {
      if (trimSaving) return
      e.preventDefault()
      trimDragRef.current = which
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
  }

  function handleDragMove(which) {
    return (e) => {
      if (trimDragRef.current !== which) return
      const t = timeFromClientX(e.clientX)
      if (which === 'start') {
        const v = Math.max(0, Math.min(t, trimOut))
        setTrimIn(v)
        seekPreview(v)
      } else {
        const v = Math.min(trimDur, Math.max(t, trimIn))
        setTrimOut(v)
        seekPreview(v)
      }
    }
  }

  function handleDragUp(e) {
    trimDragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // Keyboard accessibility: arrow keys nudge the focused handle (Shift = 5s).
  function handleHandleKey(which) {
    return (e) => {
      const step = e.shiftKey ? 5 : 1
      let delta = 0
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step
      else return
      e.preventDefault()
      if (which === 'start') {
        const v = Math.max(0, Math.min(trimIn + delta, trimOut))
        setTrimIn(v)
        seekPreview(v)
      } else {
        const v = Math.min(trimDur, Math.max(trimOut + delta, trimIn))
        setTrimOut(v)
        seekPreview(v)
      }
    }
  }

  const trimPct = (t) => (trimDur ? (t / trimDur) * 100 : 0)

  async function handleTrimSave(overwrite) {
    if (!trimFile || trimOut <= trimIn) return
    setTrimSaving(true)
    try {
      let dest
      if (overwrite) {
        dest = trimFile.path
      } else {
        const slash = trimFile.path.lastIndexOf('/')
        const dir   = slash > 0 ? trimFile.path.slice(0, slash) : '/'
        const list  = await window.winraid?.remote.list(connectionId, dir)
        const names = list?.ok ? new Set((list.entries ?? []).map((e) => e.name)) : new Set()
        dest = nextAvailableCopyPath(trimFile.path, names, '_trimmed')
      }

      const res = await window.winraid?.remote.trimVideo(connectionId, {
        path: trimFile.path, outPath: dest, start: trimIn, end: trimOut,
      })
      if (!res?.ok) throw new Error(res?.error ?? 'Trim failed')

      await window.winraid?.cache.invalidateFile(connectionId, dest)
      const slash   = dest.lastIndexOf('/')
      const destDir = slash > 0 ? dest.slice(0, slash) : '/'
      remoteFS.invalidate(connectionId, destDir)
      const refreshed = await remoteFS.list(connectionId, destDir).catch(() => null)

      toast.show({ msg: overwrite ? 'Video trimmed' : 'Trimmed clip saved', type: 'success' })

      if (overwrite) {
        setCacheBust(Date.now())
        exitTrimMode()
      } else {
        const destName = dest.slice(slash + 1)
        const entry    = refreshed?.find((e) => e.name === destName)
        const newFile  = entry ? { ...entry, path: dest } : { name: destName, path: dest, size: 0, modified: Date.now(), type: 'file' }
        exitTrimMode()
        onNavigate?.(newFile)
      }
    } catch (err) {
      toast.show({ msg: err.message, type: 'error' })
      setTrimSaving(false)
    }
  }

  // ── Crop handlers ──────────────────────────────────────────────────────────
  function enterCropMode() {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    panRef.current = { x: 0, y: 0 }
    setCropFile(file)
    setCropSrc(nasStreamUrl(connectionId, file.path))
    setCrop(undefined)
    setCompCrop(null)
    setCropError(null)
    setCropping(true)
  }

  function exitCropMode() {
    rotatedUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    rotatedUrlsRef.current = []
    setCropping(false)
    setCropFile(null)
    setCropSrc(null)
    setCrop(undefined)
    setCompCrop(null)
    setCropError(null)
  }

  // Reset crop selection to fit the loaded image
  function handleCropImageLoad(e) {
    const { width, height } = e.currentTarget
    const aspect = CROP_ASPECTS[cropAspect].value
    const c = aspect ? centeredAspectCrop(width, height, aspect) : fullImageCrop(width, height)
    setCrop(c)
    setCompCrop(c)
  }

  // Recompute crop selection when aspect changes
  useEffect(() => {
    if (!cropping) return
    const img = cropImgRef.current
    if (!img || !img.width) return
    const aspect = CROP_ASPECTS[cropAspect].value
    const c = aspect ? centeredAspectCrop(img.width, img.height, aspect) : fullImageCrop(img.width, img.height)
    setCrop(c)
    setCompCrop(c)
  }, [cropAspect, cropping])

  // Clean up rotation blob URLs on unmount or when leaving crop
  useEffect(() => () => rotatedUrlsRef.current.forEach((u) => URL.revokeObjectURL(u)), [])

  async function handleCropRotate() {
    const img = cropImgRef.current
    if (!img || cropRotating || cropSaving || !cropFile) return
    setCropRotating(true)
    try {
      const blob = await rotateCropImage(img, cropMimeType(cropFile.name))
      const url  = URL.createObjectURL(blob)
      rotatedUrlsRef.current.push(url)
      setCropSrc(url)
      setCrop(undefined)
      setCompCrop(null)
    } finally {
      setCropRotating(false)
    }
  }

  // Capture the current video frame and save it next to the video, in the
  // user-configured format (jpeg, png, or webp; default jpeg).
  async function handleSnapshot() {
    const video = mediaRef.current
    if (!video || video.tagName !== 'VIDEO') return

    try {
      const fmtKey = await window.winraid?.config.get('snapshot.format')
      const fmt    = resolveSnapshotFormat(fmtKey)

      const blob = await captureVideoFrame(video, fmt)
      const buf  = await blob.arrayBuffer()

      const slash    = file.path.lastIndexOf('/')
      const dir      = slash > 0 ? file.path.slice(0, slash) : '/'
      const dot      = file.name.lastIndexOf('.')
      const stem     = dot > 0 ? file.name.slice(0, dot) : file.name
      const ts       = formatVideoTimestamp(video.currentTime)

      // Find a non-colliding filename: <stem>_snap_HH-MM-SS.<ext>, then _2, _3, ...
      const list = await window.winraid?.remote.list(connectionId, dir)
      const taken = list?.ok ? new Set((list.entries ?? []).map((e) => e.name)) : new Set()
      let name = `${stem}_snap_${ts}.${fmt.ext}`
      for (let i = 2; taken.has(name) && i < 1000; i++) name = `${stem}_snap_${ts}_${i}.${fmt.ext}`
      const dest = dir === '/' ? `/${name}` : `${dir}/${name}`

      const res = await window.winraid?.remote.writeFileBinary(connectionId, dest, buf)
      if (!res?.ok) throw new Error(res?.error ?? 'Write failed')

      await window.winraid?.cache.invalidateFile(connectionId, dest)
      remoteFS.invalidate(connectionId, dir)
      remoteFS.list(connectionId, dir).catch(() => {})

      clearTimeout(snapMsgTimerRef.current)
      setSnapMsg(`Saved ${name}`)
      snapMsgTimerRef.current = setTimeout(() => setSnapMsg(null), 2200)
    } catch (err) {
      clearTimeout(snapMsgTimerRef.current)
      setSnapMsg(err.message || 'Snapshot failed')
      snapMsgTimerRef.current = setTimeout(() => setSnapMsg(null), 2200)
    }
  }

  // Cleanup the snap-toast timer on unmount.
  useEffect(() => () => clearTimeout(snapMsgTimerRef.current), [])

  async function handleCropSave(overwrite) {
    const img = cropImgRef.current
    const c   = compCrop
    if (!img || !c || c.width < 1 || c.height < 1 || !cropFile) return
    setCropSaving(true)
    setCropError(null)
    try {
      const mime = cropMimeType(cropFile.name)
      const blob = await applyCropToImage(img, c, mime)
      const buf  = await blob.arrayBuffer()

      let dest
      if (overwrite) {
        dest = cropFile.path
      } else {
        // Pick the next free _cropped / _cropped_2 / _cropped_3 ... name in the
        // parent directory so saving never clobbers an existing copy.
        const slash = cropFile.path.lastIndexOf('/')
        const dir   = slash > 0 ? cropFile.path.slice(0, slash) : '/'
        const list  = await window.winraid?.remote.list(connectionId, dir)
        const names = list?.ok ? new Set((list.entries ?? []).map((e) => e.name)) : new Set()
        dest = nextAvailableCopyPath(cropFile.path, names)
      }

      const res = await window.winraid?.remote.writeFileBinary(connectionId, dest, buf, { atomic: overwrite })
      if (!res?.ok) throw new Error(res?.error ?? 'Write failed')

      // Invalidate the on-disk full+thumb cache for any path that was just
      // mutated. For overwrite that's the original file; for copy it's the
      // new dest (in case a stale cache entry exists from a prior copy with
      // the same name that was deleted).
      await window.winraid?.cache.invalidateFile(connectionId, dest)

      // Refresh the directory listing so the BrowseView shows the new file
      // (for copies) and so thumbnail URLs pick up the new mtime.
      // invalidate() alone only clears the cache — list() then re-fetches
      // and notifies subscribers so the listing updates immediately.
      const slash    = dest.lastIndexOf('/')
      const destDir  = slash > 0 ? dest.slice(0, slash) : '/'
      remoteFS.invalidate(connectionId, destDir)
      const refreshed = await remoteFS.list(connectionId, destDir).catch(() => null)

      if (overwrite) {
        setCacheBust(Date.now())
        exitCropMode()
      } else {
        // Navigate to the new copy so the user immediately sees the result
        // (mirroring how Overwrite shows the cropped image right away).
        const destName = dest.slice(slash + 1)
        const entry    = refreshed?.find((e) => e.name === destName)
        const newFile  = entry
          ? { ...entry, path: dest }
          : { name: destName, path: dest, size: buf.byteLength, modified: Date.now(), type: 'file' }
        exitCropMode()
        onNavigate?.(newFile)
      }
    } catch (err) {
      setCropError(err.message)
    } finally {
      setCropSaving(false)
    }
  }

  // Wheel: zoom or scroll-navigate (passive:false so we can preventDefault)
  useEffect(() => {
    const el = previewAreaRef.current
    if (!el) return
    function onWheel(e) {
      // While cropping, no wheel-based navigation or zoom
      if (latestRef.current.cropping) return
      // PDFs scroll their own page list — don't hijack the wheel for zoom/nav.
      if (latestRef.current.type === 'pdf') return
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
      const rect  = el.getBoundingClientRect()
      const media = mediaRef.current
      if (!media) return
      const next = computePan({
        offsetX:   e.clientX - (rect.left + rect.width  / 2),
        offsetY:   e.clientY - (rect.top  + rect.height / 2),
        viewportW: rect.width,
        viewportH: rect.height,
        mediaW:    media.offsetWidth,
        mediaH:    media.offsetHeight,
        zoom:      z,
        invertPan: ip,
      })
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

  const rawSrc = (type === 'image' || type === 'video' || type === 'audio' || type === 'pdf')
    ? nasStreamUrl(connectionId, file.path)
    : null
  // Bake the file's mtime into the URL so the browser cache key changes when
  // the remote file is mutated. cacheBust is a one-shot bump after a save in
  // this same QuickLook lifetime — the protocol handler treats `bust=` as a
  // signal to also delete the on-disk cache file.
  const baseSrc = rawSrc && file.modified
    ? `${rawSrc}?v=${file.modified}`
    : rawSrc
  const src = baseSrc && cacheBust > 0
    ? `${baseSrc}${baseSrc.includes('?') ? '&' : '?'}bust=${cacheBust}`
    : baseSrc

  function handleImageContextMenu(e) {
    e.preventDefault()
    const target = cropping && cropFile ? cropFile : file
    window.winraid?.showImageContextMenu?.(connectionId, target.path)
  }

  // Single trim timeline, rendered directly below the video where the native
  // seekbar would be (native controls are hidden while trimming).
  const trimBar = trimming ? (
    <div className={styles.trimBar} data-testid="trim-bar">
      <button
        type="button"
        className={styles.trimPlayBtn}
        onClick={toggleTrimPlay}
        disabled={trimSaving}
        aria-label={trimPlaying ? 'Pause preview' : 'Play selection'}
      >
        {trimPlaying ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <span className={styles.trimTime}>In <b data-testid="trim-in">{fmtClock(trimIn)}</b></span>
      <div
        className={styles.trimTrack}
        data-testid="trim-track"
        ref={trimTrackRef}
        onPointerDown={handleTrackPointerDown}
      >
        <div
          className={styles.trimSelected}
          style={{ left: `${trimPct(trimIn)}%`, right: `${100 - trimPct(trimOut)}%` }}
        />
        <div
          className={styles.trimPlayhead}
          data-testid="trim-playhead"
          style={{ left: `${trimPct(Math.min(trimPos, trimDur))}%` }}
        />
        <button
          type="button"
          className={`${styles.trimHandle} ${styles.trimHandleStart}`}
          style={{ left: `${trimPct(trimIn)}%` }}
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={Math.round(trimDur)}
          aria-valuenow={Math.round(trimIn)}
          aria-valuetext={fmtClock(trimIn)}
          disabled={trimSaving}
          onPointerDown={handleDragDown('start')}
          onPointerMove={handleDragMove('start')}
          onPointerUp={handleDragUp}
          onKeyDown={handleHandleKey('start')}
        />
        <button
          type="button"
          className={`${styles.trimHandle} ${styles.trimHandleEnd}`}
          style={{ left: `${trimPct(trimOut)}%` }}
          role="slider"
          aria-label="Trim end"
          aria-valuemin={0}
          aria-valuemax={Math.round(trimDur)}
          aria-valuenow={Math.round(trimOut)}
          aria-valuetext={fmtClock(trimOut)}
          disabled={trimSaving}
          onPointerDown={handleDragDown('end')}
          onPointerMove={handleDragMove('end')}
          onPointerUp={handleDragUp}
          onKeyDown={handleHandleKey('end')}
        />
      </div>
      <span className={styles.trimTime}>Out <b data-testid="trim-out">{fmtClock(trimOut)}</b></span>
    </div>
  ) : null

  function renderPreview() {
    if (cropping && type === 'image') {
      return (
        <CropImagePreview
          src={cropSrc}
          crop={crop}
          onChange={(c) => setCrop(c)}
          onComplete={(c) => setCompCrop(c)}
          aspect={CROP_ASPECTS[cropAspect].value}
          imgRef={cropImgRef}
          onLoad={handleCropImageLoad}
          onContextMenu={handleImageContextMenu}
        />
      )
    }
    switch (type) {
      case 'image': return <ImagePreview src={src} size={file.size ?? 0} zoom={zoom} pan={pan} mediaRef={mediaRef} onContextMenu={handleImageContextMenu} />
      case 'video': return <VideoPreview src={src} loop={loop && !trimming} zoom={zoom} pan={pan} mediaRef={mediaRef} trimming={trimming} trimBar={trimBar} />
      case 'audio': return <AudioPreview file={file} src={src} />
      case 'pdf':   return <PdfPreview src={src} />
      case 'text':  return <TextPreview connectionId={connectionId} remotePath={file.path} />
      default:      return <UnknownPreview file={file} />
    }
  }

  useEffect(() => { overlayRef.current?.focus() }, [])

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-theme="dark"
      tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget && !cropping) onClose() }}
      onPointerUp={() => overlayRef.current?.focus()}
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
        {type === 'image' && !cropping && (
          <Tooltip tip="Crop" side="bottom">
            <button
              className={styles.fileMenuBtn}
              onClick={enterCropMode}
              aria-label="Crop image"
            >
              <Crop size={16} />
            </button>
          </Tooltip>
        )}
        {type === 'video' && (
          <Tooltip tip="Save snapshot of current frame" side="bottom">
            <button
              className={styles.fileMenuBtn}
              onClick={handleSnapshot}
              aria-label="Save video snapshot"
            >
              <Camera size={16} />
            </button>
          </Tooltip>
        )}
        {type === 'video' && canServerEdit && !trimming && (
          <Tooltip tip="Trim" side="bottom">
            <button
              className={styles.fileMenuBtn}
              onClick={enterTrimMode}
              aria-label="Trim video"
            >
              <Scissors size={16} />
            </button>
          </Tooltip>
        )}
        {cropping && (
          <div className={styles.cropToolbar}>
            <span className={styles.cropToolbarLabel}>Aspect</span>
            {CROP_ASPECTS.map((a, i) => (
              <button
                key={a.label}
                className={[styles.cropAspectBtn, i === cropAspect ? styles.cropAspectBtnActive : ''].filter(Boolean).join(' ')}
                onClick={() => setCropAspect(i)}
                disabled={cropSaving || cropRotating}
              >
                {a.label}
              </button>
            ))}
            <Tooltip tip="Rotate 90°" side="bottom">
              <button
                className={styles.fileMenuBtn}
                onClick={handleCropRotate}
                disabled={cropSaving || cropRotating}
                aria-label="Rotate 90 degrees"
              >
                {cropRotating ? <Loader size={14} /> : <RotateCw size={14} />}
              </button>
            </Tooltip>
            {cropError && <span className={styles.cropError}>{cropError}</span>}
            <button className={styles.cropCancelBtn} onClick={exitCropMode} disabled={cropSaving}>
              Cancel
            </button>
            <button className={styles.cropSaveBtn} onClick={() => handleCropSave(false)} disabled={cropSaving || cropRotating || !compCrop}>
              {cropSaving ? <Loader size={13} /> : null}
              Save copy
            </button>
            <button className={styles.cropOverwriteBtn} onClick={() => handleCropSave(true)} disabled={cropSaving || cropRotating || !compCrop}>
              {cropSaving ? <Loader size={13} /> : null}
              Overwrite
            </button>
          </div>
        )}
        {trimming && (
          <div className={styles.trimToolbar}>
            <button className={styles.cropCancelBtn} onClick={exitTrimMode} disabled={trimSaving}>Cancel</button>
            <button className={styles.cropSaveBtn} onClick={() => handleTrimSave(false)} disabled={trimSaving || trimOut <= trimIn}>Save as new</button>
            <button className={styles.cropOverwriteBtn} onClick={() => handleTrimSave(true)} disabled={trimSaving || trimOut <= trimIn}>Overwrite</button>
          </div>
        )}
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
            disabled={!hasPrev || cropping || trimming}
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
            disabled={!hasNext || cropping || trimming}
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

      {snapMsg && <div className={styles.snapToast}>{snapMsg}</div>}

    </div>
  )
}
