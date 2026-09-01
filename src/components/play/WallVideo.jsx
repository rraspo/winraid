import { useEffect, useRef, useState } from 'react'
import { nasStreamUrl } from '../../utils/nasStream'
import styles from './PlayWall.module.css'

/**
 * Video player for a single wall tile. The player only exists in the DOM
 * while the tile intersects the viewport and the viewer is not covering
 * the wall — anything off screen or hidden decodes nothing and streams
 * nothing. The anchor node stays mounted for the tile's whole life so a
 * single IntersectionObserver can track it without re-wiring on every
 * visibility flip.
 */
export default function WallVideo({ connectionId, remotePath, onRatioKnown, playbackSuspended }) {
  const anchorRef = useRef(null)
  const videoRef  = useRef(null)
  const [isIntersecting, setIsIntersecting] = useState(false)

  useEffect(() => {
    const anchorElement = anchorRef.current
    if (!anchorElement) return
    const observer = new IntersectionObserver((entries) => {
      const latestEntry = entries[entries.length - 1]
      setIsIntersecting(latestEntry.isIntersecting)
    })
    observer.observe(anchorElement)
    return () => observer.disconnect()
  }, [])

  const shouldPlay = isIntersecting && !playbackSuspended

  useEffect(() => {
    if (!shouldPlay) return
    videoRef.current?.play()?.catch(() => {})
  }, [shouldPlay])

  function handleLoadedMetadata(event) {
    const { videoWidth, videoHeight } = event.target
    if (!videoWidth || !videoHeight) return
    onRatioKnown(remotePath, videoWidth / videoHeight)
  }

  return (
    <span ref={anchorRef} className={styles.tileVideoAnchor}>
      {shouldPlay && (
        <video
          ref={videoRef}
          className={styles.tileVideo}
          src={nasStreamUrl(connectionId, remotePath)}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
        />
      )}
    </span>
  )
}
