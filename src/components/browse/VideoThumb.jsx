import { memo, useState, useEffect, useRef } from 'react'
import styles from './VideoThumb.module.css'

const DEFAULT_SEEK = { mode: 'seconds', value: 2 }

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

const VideoThumb = memo(function VideoThumb({ url, onError }) {
  const wrapRef  = useRef(null)
  const [active, setActive] = useState(false)
  const [ready,  setReady]  = useState(false)

  useEffect(() => {
    loadSeekConfig()
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setActive(true); obs.disconnect() } },
      { threshold: 0.1 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  function handleLoadedMetadata(e) {
    const video = e.target
    const seekTo = computeSeekTime(video.duration, _seekConfig)
    if (seekTo > 0) video.currentTime = seekTo
  }

  return (
    <span ref={wrapRef} className={styles.wrap}>
      {active && (
        <video
          src={url}
          preload="metadata"
          muted
          className={styles.thumbFill}
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={() => setReady(true)}
          onError={onError}
        />
      )}
      {/* Skeleton sits ON TOP — a <video> paints black before its first frame,
          so we cover it until onLoadedData rather than show through. */}
      {!ready && <span data-skeleton aria-hidden="true" className={`${styles.skeletonFill} skeleton-box`} />}
    </span>
  )
})

VideoThumb.__resetSeekConfig = () => {
  _seekConfig = DEFAULT_SEEK
  _seekConfigLoaded = false
}

export default VideoThumb
