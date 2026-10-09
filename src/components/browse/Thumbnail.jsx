import { memo, useState, useCallback } from 'react'
import { Image, Film, File } from 'lucide-react'
import VideoThumb from './VideoThumb'
import { isImageFile, isVideoFile } from '../../utils/fileTypes'
import { formatDuration, formatVideoResolution } from '../../utils/format'
import styles from './Thumbnail.module.css'

const Thumbnail = memo(function Thumbnail({ name, remotePath, connectionId, size, modified, thumbnailsEnabled = true, onMetadata }) {
  const [error, setError]   = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [videoMeta, setVideoMeta] = useState(null)
  // Cached images can finish loading before React attaches onLoad; catch that
  // via the ref so the skeleton clears and we never strand a loaded image.
  // The same race applies to reporting metadata, so it's read here too.
  const imgRef = useCallback((node) => {
    if (node && node.complete && node.naturalWidth > 0) {
      setLoaded(true)
      onMetadata?.({ kind: 'image', width: node.naturalWidth, height: node.naturalHeight })
    }
    // onMetadata is a fresh callback per render from the parent's lookup by
    // path — depending on it here would refire this ref callback on every
    // render instead of only on mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/')
  const ver    = modified ? `&v=${modified}` : ''
  const url    = `nas-stream://${connectionId}${encodedPath}?thumb=1${ver}`
  const isGrid = size === 'grid'
  const wrapClass = isGrid ? styles.thumbWrapGrid : styles.thumbWrapList

  if (thumbnailsEnabled && !error && isImageFile(name)) {
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
          onLoad={(e) => {
            setLoaded(true)
            onMetadata?.({ kind: 'image', width: e.target.naturalWidth, height: e.target.naturalHeight })
          }}
          onError={() => setError(true)}
          decoding="async"
          alt=""
        />
      </span>
    )
  }

  if (thumbnailsEnabled && !error && isVideoFile(name)) {
    return (
      <span className={wrapClass}>
        <VideoThumb
          url={url}
          connectionId={connectionId}
          remotePath={remotePath}
          modified={modified}
          placeholder={isGrid ? <Film size={40} className={styles.gridIconFile} /> : <Film size={14} className={styles.iconFile} />}
          onError={() => setError(true)}
          onMetadata={(meta) => {
            setVideoMeta(meta)
            onMetadata?.({ kind: 'video', ...meta })
          }}
        />
        {/* Grid only — list surfaces the same metadata through its own Media
            column instead of overlaying the (much smaller) list thumbnail. */}
        {isGrid && videoMeta && (
          <span className={styles.metaBar}>
            <span className={styles.metaDuration}>{formatDuration(videoMeta.duration)}</span>
            <span className={styles.metaResolution}>{formatVideoResolution(videoMeta.width, videoMeta.height)}</span>
          </span>
        )}
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
