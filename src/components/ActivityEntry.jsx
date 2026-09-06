import {
  Upload, FolderInput, PenLine, Trash2, FolderPlus, Download, FileQuestion, Activity,
} from 'lucide-react'
import ConnectionIcon from './ConnectionIcon'
import styles from './ActivityEntry.module.css'

const TYPE_ICON = {
  upload:           Upload,
  move:             FolderInput,
  rename:           PenLine,
  delete:           Trash2,
  mkdir:            FolderPlus,
  checkout:         Download,
  download:         Download,
  'verify-missing': FileQuestion,
}

function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)     return 'just now'
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// One row of the activity feed — moved out of the removed Header so the
// dashboard's "Recent activity" block can render the same entries.
export default function ActivityEntry({ entry, connections, onNavigate }) {
  const Icon = TYPE_ICON[entry.type] ?? Activity
  const conn = connections.find((c) => c.id === entry.connectionId)
  const clickable = !!entry.nav

  const className = [
    styles.activityEntry,
    styles[`level_${entry.level}`],
    clickable ? styles.activityEntryClickable : '',
  ].filter(Boolean).join(' ')

  const inner = (
    <>
      <div className={styles.activityEntryIcon}><Icon size={13} /></div>
      <div className={styles.activityEntryContent}>
        <p className={styles.activityEntryMsg}>
          <span className={styles.activityEntryTitle}>{entry.title}</span>
          {entry.detail && <span className={styles.activityEntryDetail}>{entry.detail}</span>}
        </p>
        <div className={styles.activityEntryMeta}>
          {conn && (
            <span className={styles.activityPill} title={conn.name}>
              <ConnectionIcon icon={conn.icon ?? null} size={10} />
              <span className={styles.activityPillName}>{conn.name}</span>
            </span>
          )}
          <span className={styles.activityEntryTs}>{relativeTime(entry.ts)}</span>
        </div>
      </div>
    </>
  )

  return clickable
    ? <button type="button" className={className} onClick={() => onNavigate?.(entry)}>{inner}</button>
    : <div className={className}>{inner}</div>
}
