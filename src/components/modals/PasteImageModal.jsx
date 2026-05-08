import { useEffect, useState } from 'react'
import { Loader, X, Check, File as FileIcon } from 'lucide-react'
import { formatSize } from '../../utils/format'
import ql from '../QuickLookOverlay.module.css'
import styles from './PasteImageModal.module.css'

function kindOf(mime) {
  if (!mime) return 'file'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

export default function PasteImageModal({ pending, onConfirm, onDiscard }) {
  const [dims,   setDims]   = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function onKey(e) {
      if (saving) return
      if (e.key === 'Escape') { e.preventDefault(); onDiscard() }
      if (e.key === 'Enter')  { e.preventDefault(); handleSave() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function handleImageLoad(e) {
    setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
  }
  function handleVideoLoad(e) {
    const v = e.currentTarget
    setDims({ w: v.videoWidth, h: v.videoHeight })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      await onConfirm()
    } finally {
      setSaving(false)
    }
  }

  const kind   = kindOf(pending.mime)
  const format = (pending.mime || 'application/octet-stream').replace(/^[a-z]+\//, '').toUpperCase()
  const title  = pending.sourceUrl
    ? (kind === 'file' ? 'Fetched file' : `Fetched ${kind}`)
    : 'Pasted image'

  function renderPreview() {
    if (kind === 'image') {
      return (
        <img
          src={pending.previewUrl}
          alt=""
          className={ql.previewImage}
          draggable={false}
          onLoad={handleImageLoad}
        />
      )
    }
    if (kind === 'video') {
      return (
        <video
          src={pending.previewUrl}
          className={ql.previewImage}
          controls
          onLoadedMetadata={handleVideoLoad}
        />
      )
    }
    if (kind === 'audio') {
      return <audio src={pending.previewUrl} controls className={styles.audio} />
    }
    return (
      <div className={styles.genericFile}>
        <FileIcon size={64} strokeWidth={1.25} />
        <span className={styles.genericName}>
          {pending.suggestedName || 'untitled'}
        </span>
        <span className={styles.genericMeta}>
          {format} · {formatSize(pending.size)}
        </span>
      </div>
    )
  }

  const dimsLabel = dims ? `${dims.w} × ${dims.h}` : null

  return (
    <div
      className={ql.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onDiscard() }}
    >
      <div className={ql.topBar}>
        <div className={ql.topBarLeft}>
          <span className={ql.fileName}>{title}</span>
          <span className={ql.fileMeta}>
            <span className={ql.fileType}>{format}</span>
            <span>{formatSize(pending.size)}</span>
            {dimsLabel && (
              <>
                <span className={ql.metaSep}>·</span>
                <span>{dimsLabel}</span>
              </>
            )}
            <span className={ql.metaSep}>·</span>
            <span>{pending.dir}</span>
            {pending.sourceUrl && (
              <>
                <span className={ql.metaSep}>·</span>
                <span className={styles.sourceUrl} title={pending.sourceUrl}>{pending.sourceUrl}</span>
              </>
            )}
          </span>
        </div>

        <button
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving}
          aria-label="Save"
        >
          {saving ? <Loader size={14} className={styles.spinner} /> : <Check size={14} />}
          Save
        </button>

        <button
          className={ql.closeBtn}
          onClick={onDiscard}
          disabled={saving}
          aria-label="Discard"
        >
          <X size={18} />
        </button>
      </div>

      <div className={ql.content}>
        <div className={ql.previewArea}>
          <div className={ql.mediaWrap}>
            {renderPreview()}
          </div>
        </div>
      </div>
    </div>
  )
}
