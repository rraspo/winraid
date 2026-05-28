import { memo, useState } from 'react'
import { Folder, File, Image, Film } from 'lucide-react'
import { isImageFile, isVideoFile } from '../../utils/fileTypes'
import { formatSize } from '../../utils/format'
import styles from './DragGhost.module.css'

function thumbSrc(connectionId, entryPath) {
  if (!connectionId || !entryPath) return null
  const encoded = entryPath.split('/').map(encodeURIComponent).join('/')
  return `nas-stream://${connectionId}${encoded}?thumb=1`
}

// Picks the icon to use as the fallback when no thumbnail is rendered
// (directories, non-media files, video files, or images whose thumb
// failed to load).
function fallbackIcon(entry, sizePx) {
  const cls = entry.type === 'dir' ? styles.iconDir : styles.iconFile
  if (entry.type === 'dir')        return <Folder size={sizePx} className={cls} />
  if (isImageFile(entry.name))     return <Image  size={sizePx} className={cls} />
  if (isVideoFile(entry.name))     return <Film   size={sizePx} className={cls} />
  return <File size={sizePx} className={cls} />
}

function GridContent({ entry, connectionId }) {
  const [imgError, setImgError] = useState(false)
  const showImg = entry.type !== 'dir' && !imgError && isImageFile(entry.name)
  const src     = showImg ? thumbSrc(connectionId, entry.entryPath) : null
  return (
    <>
      <div className={styles.gridThumb}>
        {src
          ? <img src={src} className={styles.thumbImg} alt="" draggable={false} onError={() => setImgError(true)} />
          : fallbackIcon(entry, 36)
        }
      </div>
      <div className={styles.gridMeta}>
        <span className={styles.gridName}>{entry.name}</span>
        {entry.type !== 'dir' && entry.size > 0 && (
          <span className={styles.gridSize}>{formatSize(entry.size)}</span>
        )}
      </div>
    </>
  )
}

function ListContent({ entry, connectionId }) {
  const [imgError, setImgError] = useState(false)
  const showImg = entry.type !== 'dir' && !imgError && isImageFile(entry.name)
  const src     = showImg ? thumbSrc(connectionId, entry.entryPath) : null
  return (
    <>
      <div className={styles.listThumb}>
        {src
          ? <img src={src} className={styles.listThumbImg} alt="" draggable={false} onError={() => setImgError(true)} />
          : fallbackIcon(entry, 14)
        }
      </div>
      <span className={styles.listName}>{entry.name}</span>
    </>
  )
}

const DragGhost = memo(function DragGhost({ dragSource, dragPos, connectionId, viewMode }) {
  if (!dragSource || !dragPos) return null

  const { entries, cardSize, clickOffset } = dragSource
  const count = entries.length
  const top   = entries[0]
  const extra = count - 1

  const w    = cardSize?.width  ?? 140
  const h    = cardSize?.height ?? 40
  const left = dragPos.x - (clickOffset?.x ?? 0)
  const top_ = dragPos.y - (clickOffset?.y ?? 0)

  const isGrid = viewMode !== 'list'

  return (
    <div className={styles.wrapper} style={{ left, top: top_ }}>
      {/* Background stubs — no content, fan-animate out from cursor on mount */}
      {count >= 3 && <div className={[styles.stub, styles.stub2].join(' ')} style={{ width: w, height: h }} />}
      {count >= 2 && <div className={[styles.stub, styles.stub1].join(' ')} style={{ width: w, height: h }} />}

      {/* Top card — full content, always rendered */}
      <div
        className={[styles.card, isGrid ? styles.cardGrid : styles.cardList].join(' ')}
        style={{ width: w, height: h }}
      >
        {isGrid
          ? <GridContent entry={top} connectionId={connectionId} />
          : <ListContent entry={top} connectionId={connectionId} />
        }
        {extra > 0 && <div className={styles.badge}>+{extra}</div>}
      </div>
    </div>
  )
})

export default DragGhost
