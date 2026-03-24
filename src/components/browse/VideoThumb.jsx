import { useState, useEffect, useRef } from 'react'
import styles from './VideoThumb.module.css'

export default function VideoThumb({ url, className, onError }) {
  const wrapRef  = useRef(null)
  const [active, setActive] = useState(false)

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

  return (
    <div ref={wrapRef} className={className}>
      {active && (
        <video
          src={url}
          preload="metadata"
          muted
          className={styles.thumbFill}
          onError={onError}
        />
      )}
    </div>
  )
}
