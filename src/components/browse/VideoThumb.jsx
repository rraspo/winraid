import { memo, useState, useEffect, useRef } from 'react'
import { acquireDecodeSlot } from '../../utils/decodeSlots'
import styles from './VideoThumb.module.css'

const DEFAULT_SEEK = { mode: 'seconds', value: 2 }

// How long a card must stay on screen before its video is decoded. A fling
// through a folder passes every card in a few frames; none of them is worth
// starting a decoder for.
export const DWELL_MS = 250

// A decode that has produced nothing by now is stuck (a stalled stream, a
// codec the platform cannot play); give its slot to someone else.
const DECODE_TIMEOUT_MS = 20_000

const STILL_WIDTH = 320
const STILL_QUALITY = 0.8

let _seekConfig = DEFAULT_SEEK
let _seekConfigLoaded = false

export function computeSeekTime(duration, config) {
  if (!duration || isNaN(duration)) return 0
  const cfg = config ?? DEFAULT_SEEK
  const cap = duration * 0.9
  if (cfg.mode === 'percent') {
    return Math.min((cfg.value / 100) * duration, cap)
  }
  return Math.min(cfg.value, cap)
}

function loadSeekConfig() {
  if (_seekConfigLoaded) return
  _seekConfigLoaded = true
  window.winraid?.config.get('thumbSeek').then((cfg) => {
    if (cfg && cfg.mode && cfg.value != null) _seekConfig = cfg
  }).catch(() => {})
}

function frameToWebp(video) {
  return new Promise((resolve) => {
    const width  = Math.min(STILL_WIDTH, video.videoWidth || STILL_WIDTH)
    const height = video.videoWidth ? Math.round((width * video.videoHeight) / video.videoWidth) : Math.round(width * 9 / 16)
    const canvas = document.createElement('canvas')
    canvas.width  = width
    canvas.height = height
    canvas.getContext('2d').drawImage(video, 0, 0, width, height)
    canvas.toBlob((blob) => resolve(blob), 'image/webp', STILL_QUALITY)
  })
}

// A video thumbnail that costs nothing until it is worth it: the cheap
// placeholder first; a still captured on an earlier visit if the cache has
// one; otherwise, once the card has stayed visible for DWELL_MS and a decoder
// slot is free, a hidden <video> that lives only long enough to capture one
// frame, which is then cached as WebP and shown as a plain image.
const VideoThumb = memo(function VideoThumb({ url, connectionId, remotePath, modified, placeholder = null, onError, onMetadata }) {
  const wrapRef = useRef(null)
  const metaRef = useRef(null)
  const slotRef = useRef(null)
  // Set once a frame is being captured: a stream error after that point (the
  // decoder reading ahead) must not throw away the frame already in hand.
  const capturingRef = useRef(false)
  const [still, setStill] = useState(null)
  const [lookupDone, setLookupDone] = useState(false)
  const [dwelled, setDwelled] = useState(false)
  const [decoding, setDecoding] = useState(false)
  const [failed, setFailed] = useState(false)

  // Callbacks from the parent change identity with its renders; the effects
  // below must not restart a lookup or a decode because of that.
  const onMetadataRef = useRef(onMetadata)
  const onErrorRef = useRef(onError)
  onMetadataRef.current = onMetadata
  onErrorRef.current = onError

  useEffect(() => { loadSeekConfig() }, [])

  useEffect(() => {
    let cancelled = false
    if (!connectionId || !remotePath) {
      setLookupDone(true)
      return undefined
    }
    Promise.resolve(window.winraid?.cache?.getVideoFrame?.(connectionId, remotePath, modified))
      .then((cached) => {
        if (cancelled) return
        if (cached?.hit && cached.bytes) {
          setStill(URL.createObjectURL(new Blob([cached.bytes], { type: 'image/webp' })))
          onMetadataRef.current?.(cached.meta ?? {})
        }
        setLookupDone(true)
      })
      .catch(() => { if (!cancelled) setLookupDone(true) })
    return () => { cancelled = true }
  }, [connectionId, remotePath, modified])

  useEffect(() => () => { if (still) URL.revokeObjectURL(still) }, [still])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || dwelled) return undefined
    let timer = null
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (!timer) timer = setTimeout(() => setDwelled(true), DWELL_MS)
      } else {
        clearTimeout(timer)
        timer = null
      }
    }, { threshold: 0.1 })
    observer.observe(el)
    return () => { clearTimeout(timer); observer.disconnect() }
  }, [dwelled])

  const wantsDecode = dwelled && lookupDone && !still && !failed
  useEffect(() => {
    if (!wantsDecode) return undefined
    const slot = acquireDecodeSlot(() => setDecoding(true))
    slotRef.current = slot
    return () => {
      slot.release()
      slotRef.current = null
      setDecoding(false)
    }
  }, [wantsDecode])

  useEffect(() => {
    if (!decoding) return undefined
    const timer = setTimeout(() => fail(), DECODE_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [decoding]) // eslint-disable-line react-hooks/exhaustive-deps -- fail only touches refs and setters

  function finishDecode() {
    slotRef.current?.release()
    slotRef.current = null
    setDecoding(false)
  }

  function fail(event) {
    if (capturingRef.current) return
    finishDecode()
    setFailed(true)
    onErrorRef.current?.(event)
  }

  function handleLoadedMetadata(e) {
    const video = e.target
    // videoWidth/videoHeight are populated once loadedmetadata fires — the
    // same element the still comes from, so this costs nothing extra.
    metaRef.current = { duration: video.duration, width: video.videoWidth, height: video.videoHeight }
    onMetadataRef.current?.(metaRef.current)
    const seekTo = computeSeekTime(video.duration, _seekConfig)
    if (seekTo > 0) video.currentTime = seekTo
    else video.dataset.captureOnData = '1'
  }

  async function capture(video) {
    if (capturingRef.current) return
    capturingRef.current = true
    const blob = await frameToWebp(video).catch(() => null)
    if (!blob) {
      finishDecode()
      setFailed(true)
      return
    }
    setStill(URL.createObjectURL(blob))
    finishDecode()
    if (connectionId && remotePath && typeof modified === 'number') {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      window.winraid?.cache?.saveVideoFrame?.(connectionId, remotePath, modified, bytes, metaRef.current ?? {})
    }
  }

  return (
    <span ref={wrapRef} className={styles.wrap}>
      {still
        ? <img src={still} className={styles.thumbFill} decoding="async" alt="" />
        : <span className={styles.placeholder}>{placeholder}</span>}
      {decoding && (
        <video
          src={url}
          preload="metadata"
          muted
          className={styles.decoder}
          onLoadedMetadata={handleLoadedMetadata}
          onSeeked={(e) => capture(e.target)}
          onLoadedData={(e) => { if (e.target.dataset.captureOnData) capture(e.target) }}
          onError={fail}
        />
      )}
    </span>
  )
})

VideoThumb.__resetSeekConfig = () => {
  _seekConfig = DEFAULT_SEEK
  _seekConfigLoaded = false
}

export default VideoThumb
