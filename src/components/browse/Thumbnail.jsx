import { memo, useState } from 'react'
import { Image, Film, File } from 'lucide-react'
import VideoThumb from './VideoThumb'
import { isImageFile, isVideoFile } from '../../utils/fileTypes'
import styles from './Thumbnail.module.css'

const Thumbnail = memo(function Thumbnail({ name, remotePath, connectionId, size }) {
  const [error, setError] = useState(false)
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/')
  const url    = `nas-stream://${connectionId}${encodedPath}?thumb=1`
  const isGrid = size === 'grid'

  if (!error && isImageFile(name)) {
    return (
      <img
        src={url}
        loading="lazy"
        className={isGrid ? styles.thumbGrid : styles.thumbList}
        onError={() => setError(true)}
        decoding="async"
        alt=""
      />
    )
  }

  if (!error && isVideoFile(name)) {
    return (
      <VideoThumb
        url={url}
        className={isGrid ? styles.thumbGrid : styles.thumbList}
        onError={() => setError(true)}
      />
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
