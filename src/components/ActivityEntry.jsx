import styles from './ActivityEntry.module.css'

function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)     return 'just now'
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// One row of the "Recent activity" card on the Dashboard: a fixed-width
// time column and a single-line message, after the prototype's activity
// feed row.
export default function ActivityEntry({ entry, onNavigate }) {
  const clickable = !!entry.nav

  const className = [
    styles.activityEntry,
    styles[`level_${entry.level}`],
    clickable ? styles.activityEntryClickable : '',
  ].filter(Boolean).join(' ')

  const inner = (
    <>
      <span className={styles.activityEntryTime}>{relativeTime(entry.ts)}</span>
      <span className={styles.activityEntryMsg}>
        <span className={styles.activityEntryTitle}>{entry.title}</span>
        {entry.detail && <span className={styles.activityEntryDetail}> — {entry.detail}</span>}
      </span>
    </>
  )

  return clickable
    ? <button type="button" className={className} onClick={() => onNavigate?.(entry)}>{inner}</button>
    : <div className={className}>{inner}</div>
}
