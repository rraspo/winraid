import { useCallback, useEffect, useState } from 'react'
import { Folder, FolderOpen } from 'lucide-react'
import iconSrc from '../../assets/winraid_icon_32x32.png'
import styles from './TrayFlyout.module.css'

// Job statuses that count as "syncing is doing something right now", used
// alongside a running watcher to decide whether the toggle offers to pause
// or to resume.
const ACTIVE_JOB_STATUSES = new Set(['PENDING', 'TRANSFERRING'])

function isToday(timestamp) {
  const then = new Date(timestamp)
  const now = new Date()
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  )
}

// The tray flyout — a small always-on-top window opened from the tray icon
// (or the nav rail's Tray item) that replaces the tray's right-click context
// menu. It stays mounted while hidden between opens, so every read here is
// re-run on `tray.onOpened` as well as on mount.
export default function TrayFlyout() {
  const [version, setVersion] = useState('')
  const [connections, setConnections] = useState([])
  const [watcherStates, setWatcherStates] = useState({})
  const [jobs, setJobs] = useState([])

  // Gathers all four reads together and commits them as one state update,
  // so a reopen re-renders once instead of up to four times — and so the
  // rows already on screen stay put while the new data is still in flight,
  // rather than the list state being cleared out from under them. Each read
  // fails independently: one connection erroring doesn't discard the
  // others, it just leaves that piece of state as it was.
  const refresh = useCallback(() => {
    const nextVersion     = window.winraid?.getVersion().catch(() => undefined) ?? Promise.resolve(undefined)
    const nextConnections = window.winraid?.config.get('connections').catch(() => undefined) ?? Promise.resolve(undefined)
    const nextWatcher     = window.winraid?.watcher.list().catch(() => undefined) ?? Promise.resolve(undefined)
    const nextJobs        = window.winraid?.queue.list().catch(() => undefined) ?? Promise.resolve(undefined)

    Promise.all([nextVersion, nextConnections, nextWatcher, nextJobs]).then(
      ([version, connections, watcherStates, jobs]) => {
        if (version !== undefined) setVersion(version)
        if (Array.isArray(connections)) setConnections(connections)
        if (watcherStates !== undefined) setWatcherStates(watcherStates)
        if (jobs !== undefined) setJobs(jobs)
      }
    )
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => window.winraid?.watcher.onStatus((states) => setWatcherStates(states)), [])

  useEffect(() => window.winraid?.queue.onUpdated(() => {
    window.winraid?.queue.list().then(setJobs).catch(() => {})
  }), [])

  useEffect(() => window.winraid?.tray?.onOpened?.(refresh), [refresh])

  const anyWatching = Object.values(watcherStates).some((state) => state?.watching)
  const anyJobActive = jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))
  const syncing = anyWatching || anyJobActive

  function handleToggle() {
    if (syncing) window.winraid?.watcher.pauseAll()
    else window.winraid?.watcher.resumeAll()
  }

  function todayCount(connectionId) {
    return jobs.filter((job) => (
      job.status === 'DONE' && job.connectionId === connectionId && isToday(job.createdAt)
    )).length
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <img src={iconSrc} className={styles.icon} alt="" />
        <span className={styles.appName}>WinRaid</span>
        <span className={styles.spacer} />
        <span className={styles.version}>v{version}</span>
      </div>

      <button type="button" className={styles.toggleRow} onClick={handleToggle}>
        <span className={`${styles.switchTrack} ${syncing ? styles.switchOn : ''}`}>
          <span className={styles.switchKnob} />
        </span>
        <span className={styles.toggleLabel}>{syncing ? 'Pause syncing' : 'Resume syncing'}</span>
      </button>

      <ul className={styles.list}>
        {connections.map((connection) => {
          const watching = !!watcherStates[connection.id]?.watching
          return (
            <li key={connection.id} aria-label={connection.name} className={styles.row}>
              <span className={`${styles.dot} ${watching ? styles.dotOn : ''}`} />
              <span className={styles.name}>{connection.name}</span>
              <span className={styles.spacer} />
              <span className={styles.today}>{todayCount(connection.id)} today</span>
              <button
                type="button"
                className={styles.rowBtn}
                aria-label={`Browse ${connection.name}`}
                onClick={() => window.winraid?.tray?.openConnection?.(connection.id)}
              >
                <Folder size={14} />
              </button>
              {connection.localFolder && (
                <button
                  type="button"
                  className={styles.rowBtn}
                  aria-label={`Open ${connection.name} folder`}
                  onClick={() => window.winraid?.local?.reveal?.(connection.localFolder)}
                >
                  <FolderOpen size={14} />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <div className={styles.footer}>
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnAccent}`}
          onClick={() => window.winraid?.tray?.showMain?.()}
        >
          Open WinRaid
        </button>
        <button
          type="button"
          className={styles.footerBtn}
          onClick={() => window.winraid?.tray?.quit?.()}
        >
          Quit
        </button>
      </div>
    </div>
  )
}
