import { useMemo } from 'react'
import ProgressRing from './ui/ProgressRing'
import styles from './StatusBar.module.css'

const EMPTY_CONN_SET = new Set()

export default function StatusBar({ watcherStatus, activeTransfers, queueDepth = 0, batchTotal = 0, batchConnections = EMPTY_CONN_SET, currentFileProgress = 0, connections = [], onNavigate }) {
  // watcherStatus is now a Map<connectionId, { watching, state, file }>
  const entries = Object.values(watcherStatus ?? {})
  const anyWatching = entries.some((s) => s.watching)
  const enqueueing = entries.find((s) => s.state === 'enqueueing')
  const watchingCount = entries.filter((s) => s.watching).length

  // activeTransfers is Map<jobId, connectionId>
  const transferCount = activeTransfers.size

  // Files finished (DONE/ERROR/removed) plus what's currently in flight.
  const progressed = Math.max(0, batchTotal - queueDepth) + transferCount

  const transferLabel = useMemo(() => {
    // Stay visible while the queue still has work, even between files
    // when transferCount briefly hits 0 \u2014 prevents the bottom-corner
    // label from blinking off and back on between every transfer.
    if (transferCount === 0 && queueDepth === 0) return null
    const connMap = {}
    for (const c of connections) connMap[c.id] = c.name
    // Use the batch-level connection set (accumulated across the whole
    // batch, only cleared on drain) so the "\u00b7 ConnectionName" suffix
    // doesn't blink in/out between files.
    const names = [...batchConnections].map((id) => connMap[id]).filter(Boolean)
    // Show progress through the current batch as "n/total" where total
    // is fixed for the lifetime of the batch.
    const prefix = batchTotal > 1
      ? `${progressed}/${batchTotal} transferring`
      : (transferCount === 1 ? 'Transferring' : `${transferCount} transferring`)
    if (names.length === 0) return prefix
    return `${prefix} \u00b7 ${names.join(', ')}`
  }, [transferCount, queueDepth, batchTotal, progressed, batchConnections, connections])

  let label
  if (!anyWatching) {
    label = 'All scanners stopped'
  } else if (enqueueing) {
    label = enqueueing.file ? `Detecting \u00b7 ${enqueueing.file}` : 'Detecting file\u2026'
  } else {
    label = watchingCount === 1 ? 'Scanning for changes' : `${watchingCount} scanners active`
  }

  return (
    <div className={styles.bar}>
      <span className={styles.label}>{label}</span>
      <div className={styles.spacer} />
      {transferLabel && (
        <button className={styles.transfers} onClick={() => onNavigate?.('queue')}>
          <ProgressRing progress={currentFileProgress} size={12} inline />
          {transferLabel}
        </button>
      )}
    </div>
  )
}
