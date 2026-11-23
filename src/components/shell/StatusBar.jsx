import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import * as moveProgress from '../../services/moveProgress'
import styles from './StatusBar.module.css'

const EMPTY_CONN_SET = new Set()

// The shell's bottom bar: watcher/transfer status on the left, the update
// pill and version on the right. Label logic ported from the pre-redesign
// StatusBar and Header (they computed the same watcher/transfer text).
export default function StatusBar({
  watcherStatus, activeTransfers, queueDepth = 0, batchTotal = 0,
  batchConnections = EMPTY_CONN_SET, connections = [], onNavigate,
}) {
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState(null)

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  useEffect(() => {
    return window.winraid?.update.onStatus((payload) => setUpdateStatus(payload))
  }, [])

  const entries       = Object.values(watcherStatus ?? {})
  const anyWatching   = entries.some((s) => s.watching)
  const enqueueing    = entries.find((s) => s.state === 'enqueueing')
  const watchingCount = entries.filter((s) => s.watching).length

  const transferCount = activeTransfers.size
  const progressed    = Math.max(0, batchTotal - queueDepth) + transferCount

  const transferLabel = useMemo(() => {
    // Stay visible while the queue still has work, even between files when
    // transferCount briefly hits 0 — prevents the label from blinking off
    // and back on between every transfer.
    if (transferCount === 0 && queueDepth === 0) return null
    const connMap = {}
    for (const c of connections) connMap[c.id] = c.name
    const names = [...batchConnections].map((id) => connMap[id]).filter(Boolean)
    const prefix = batchTotal > 1
      ? `${progressed}/${batchTotal} transferring`
      : (transferCount === 1 ? 'Transferring' : `${transferCount} transferring`)
    if (names.length === 0) return prefix
    return `${prefix} · ${names.join(', ')}`
  }, [transferCount, queueDepth, batchTotal, progressed, batchConnections, connections])

  // Moves of files on the NAS, from any screen or tab, added up: they are
  // renames on the server, not queue jobs, so they have no queue to link to.
  const moves = useSyncExternalStore(moveProgress.subscribe, moveProgress.getSnapshot)
  const moveLabel = useMemo(() => {
    if (moves.length === 0) return null
    const total = moves.reduce((sum, move) => sum + move.total, 0)
    const done  = moves.reduce((sum, move) => sum + move.done, 0)
    const connMap = {}
    for (const c of connections) connMap[c.id] = c.name
    const names = [...new Set(moves.map((move) => connMap[move.connectionId]).filter(Boolean))]
    const prefix = `Moving ${Math.min(done + 1, total)} of ${total}`
    return names.length === 0 ? prefix : `${prefix} · ${names.join(', ')}`
  }, [moves, connections])

  let label
  if (!anyWatching) {
    label = 'All scanners stopped'
  } else if (enqueueing) {
    label = enqueueing.file ? `Detecting · ${enqueueing.file}` : 'Detecting file…'
  } else {
    label = watchingCount === 1 ? 'Scanning for changes' : `${watchingCount} scanners active`
  }

  // Busy while a transfer or a move is in flight or a watcher is enqueueing — otherwise
  // reflect whether anything is watching at all.
  const dotStatus = (enqueueing || transferCount > 0 || moveLabel) ? 'busy' : anyWatching ? 'watching' : 'stopped'

  const updateReady = updateStatus?.status === 'ready' ? updateStatus : null

  return (
    <footer className={styles.bar} role="status">
      <span className={styles.dot} data-status={dotStatus} />
      <span className={styles.label}>{label}</span>
      {transferLabel && (
        <button type="button" className={styles.transferLink} onClick={() => onNavigate?.('queue')}>
          {` · ${transferLabel}`}
        </button>
      )}
      {moveLabel && <span className={styles.label}>{` · ${moveLabel}`}</span>}
      <div className={styles.spacer} />
      {updateReady && (
        <button
          type="button"
          className={styles.updatePill}
          onClick={() => window.winraid?.whatsNew.open()}
        >
          {`Update ${updateReady.version} ready — see what's new`}
        </button>
      )}
      {version && <span className={styles.version}>{`v${version}`}</span>}
    </footer>
  )
}
