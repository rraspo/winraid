import { useEffect, useRef, useState } from 'react'
import styles from './PlayWall.module.css'

// How long a tile must stay on screen before its full image is requested,
// so a fast scroll does not start a download for every tile it passes.
export const FULL_IMAGE_DWELL_MS = 150

/**
 * Still image for a single wall tile. The cached thumbnail shows at once;
 * while the tile stays on screen and the viewer is not covering the wall,
 * the full-resolution image loads over it and takes over once decoded.
 * Leaving the screen drops the full image again, so only the tiles in view
 * hold full-size bitmaps.
 */
export default function WallImage({ thumbSrc, fullSrc, onThumbLoad, suspended }) {
  const anchorRef = useRef(null)
  const [isIntersecting, setIsIntersecting] = useState(false)
  const [dwelled, setDwelled] = useState(false)
  const [fullState, setFullState] = useState({ src: null, status: 'loading' })

  useEffect(() => {
    const anchorElement = anchorRef.current
    if (!anchorElement) return
    const observer = new IntersectionObserver((entries) => {
      setIsIntersecting(entries[entries.length - 1].isIntersecting)
    })
    observer.observe(anchorElement)
    return () => observer.disconnect()
  }, [])

  const wantsFull = isIntersecting && !suspended

  useEffect(() => {
    if (!wantsFull) {
      setDwelled(false)
      return undefined
    }
    const timer = setTimeout(() => setDwelled(true), FULL_IMAGE_DWELL_MS)
    return () => clearTimeout(timer)
  }, [wantsFull])

  // A failure is remembered per source so the tile does not retry in a loop.
  const status = fullState.src === fullSrc ? fullState.status : 'loading'
  const showFull = wantsFull && dwelled && status !== 'failed'

  return (
    <span ref={anchorRef} className={styles.tileImageStack}>
      <img
        className={styles.tileImage}
        src={thumbSrc}
        alt=""
        loading="lazy"
        onLoad={onThumbLoad}
      />
      {showFull && (
        <img
          className={styles.tileImageFull}
          src={fullSrc}
          alt=""
          decoding="async"
          data-full=""
          data-loaded={status === 'loaded' ? 'true' : 'false'}
          onLoad={() => setFullState({ src: fullSrc, status: 'loaded' })}
          onError={() => setFullState({ src: fullSrc, status: 'failed' })}
        />
      )}
    </span>
  )
}
