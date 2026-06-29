import { memo, useState, useCallback } from 'react'
import { Image, Film, File } from 'lucide-react'
import VideoThumb from './VideoThumb'
import { isImageFile, isVideoFile } from '../../utils/fileTypes'
import styles from './Thumbnail.module.css'

const Thumbnail = memo(function Thumbnail({ name, remotePath, connectionId, size, modified }) {
  const [error, setError]   = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Cached images can finish loading before React attaches onLoad; catch that
  // via the ref so the skeleton clears and we never strand a loaded image.
  const imgRef = useCallback((node) => {
    if (node && node.complete && node.naturalWidth > 0) setLoaded(true)
  }, [])
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/')
  const ver    = modified ? `&v=${modified}` : ''
  const url    = `nas-stream://${connectionId}${encodedPath}?thumb=1${ver}`
  const isGrid = size === 'grid'
  const wrapClass = isGrid ? styles.thumbWrapGrid : styles.thumbWrapList

  if (!error && isImageFile(name)) {
    return (
      <span className={wrapClass}>
        {/* Skeleton sits BEHIND the img. While loading the img has no pixels
            (transparent) so the skeleton shows through; once it paints it covers
            the skeleton — so a missed onLoad can never hide a loaded image.
            No loading="lazy": the virtualizer already gates mounting. */}
        {!loaded && <span data-skeleton aria-hidden="true" className={`${styles.skeletonFill} skeleton-box`} />}
        <img
          ref={imgRef}
          src={url}
          className={styles.thumbImg}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          decoding="async"
          alt=""
        />
      </span>
    )
  }

  if (!error && isVideoFile(name)) {
    return (
      <span className={wrapClass}>
        <VideoThumb url={url} onError={() => setError(true)} />
      </span>
    )
  }

  // Fallback icons
  if (isGrid) {
    if (isImageFile(name)) return <Image size={40} className={styles.gridIconFile} />
    if (isVideoFile(name)) return <Film size={40} className={styles.gridIconFile} />
    return <File size={40} className={styles.gridIconFile} />
  }
  if (isImageFile(name)) return <Image size={14} className={styles.iconFile} />
  if (isVideoFile(name)) return <Film  size={14} className={styles.iconFile} />
  return <File size={14} className={styles.iconFile} />
})

export default Thumbnail
