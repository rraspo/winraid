import { useState, useEffect } from 'react'

import Tooltip from '../components/ui/Tooltip'
import Button from '../components/ui/Button'
import styles from './SettingsView.module.css'

const HINTS = {
  startWatcher:  'Begin scanning the watch folder for new files. Runs in the background even when the window is hidden to the tray.',
  stopWatcher:   'Pause scanning. Already-queued transfers still complete; new files are ignored until resumed.',
}

export default function SettingsView() {
  const [watching, setWatching] = useState(false)

  useEffect(() => {
    // Track per-connection watcher state; derive aggregate `watching` flag
    const watchMap = {}
    const unsub = window.winraid?.watcher.onStatus((s) => {
      if (s.connectionId) {
        watchMap[s.connectionId] = s.watching
      } else {
        // Bulk update (pause/resume all)
        for (const id of Object.keys(watchMap)) watchMap[id] = s.watching
      }
      setWatching(Object.values(watchMap).some(Boolean))
    })
    return () => unsub?.()
  }, [])

  async function handleWatcherToggle() {
    if (watching) {
      // Stop all watchers
      await window.winraid?.watcher.stop()
    } else {
      const cfg = await window.winraid?.config.get()
      const conns = cfg?.connections ?? []
      const watchable = conns.filter((c) => c.localFolder)
      if (watchable.length === 0) return
      // Start watchers for all connections with a localFolder
      for (const conn of watchable) {
        await window.winraid?.watcher.start(conn.id)
      }
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.scrollBody}>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Scanner</div>
          <div className={styles.sectionBody}>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
              The scanner watches each connection's local folder and queues new or changed files for transfer.
              On restart it automatically picks up files that appeared while stopped.
            </p>
          </div>
        </section>

      </div>

      <div className={styles.footer}>
        <Tooltip tip={watching ? HINTS.stopWatcher : HINTS.startWatcher} side="left">
          <Button variant={watching ? 'danger' : 'secondary'} onClick={handleWatcherToggle}>
            {watching ? 'Stop scanner' : 'Start scanner'}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
