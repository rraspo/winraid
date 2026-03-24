import { useState, useEffect } from 'react'
import { RefreshCw, Download } from 'lucide-react'

import Tooltip from '../components/ui/Tooltip'
import Button from '../components/ui/Button'
import { formatSize } from '../utils/format'
import styles from './SettingsView.module.css'

const HINTS = {
  startWatcher:  'Begin scanning the watch folder for new files. Runs in the background even when the window is hidden to the tray.',
  stopWatcher:   'Pause scanning. Already-queued transfers still complete; new files are ignored until resumed.',
}

export default function SettingsView() {
  const [watching, setWatching] = useState(false)
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState(null) // { status, version?, percent?, error? }
  const [cacheBytes, setCacheBytes] = useState(0)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  useEffect(() => {
    window.winraid?.cache.thumbSize().then((res) => setCacheBytes(res.bytes)).catch(() => {})
  }, [])

  // Listen for update status events from the main process
  useEffect(() => {
    const unsub = window.winraid?.update?.onStatus((payload) => {
      setUpdateStatus(payload)
    })
    return () => unsub?.()
  }, [])

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

  async function handleClearCache() {
    setClearing(true)
    await window.winraid?.cache.clearThumbs()
    const res = await window.winraid?.cache.thumbSize().catch(() => ({ bytes: 0 }))
    setCacheBytes(res?.bytes ?? 0)
    setClearing(false)
  }

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

  async function handleCheckUpdate() {
    setUpdateStatus({ status: 'checking' })
    const result = await window.winraid?.update?.check()
    if (result && !result.ok) {
      setUpdateStatus({ status: 'error', error: result.error })
    }
  }

  function handleInstall() {
    window.winraid?.update?.install()
  }

  const status = updateStatus?.status
  const isChecking    = status === 'checking'
  const isDownloading = status === 'downloading'
  const isReady       = status === 'ready'
  const isUpToDate    = status === 'up-to-date'
  const isError       = status === 'error'
  const isBusy        = isChecking || isDownloading

  function renderUpdateInfo() {
    if (!updateStatus) return null
    if (isChecking)    return <span className={styles.updateMsg}>Checking for updates...</span>
    if (isDownloading) return <span className={styles.updateMsg}>Downloading update... {updateStatus.percent ?? 0}%</span>
    if (isReady)       return <span className={`${styles.updateMsg} ${styles.updateReady}`}>v{updateStatus.version} ready to install</span>
    if (isUpToDate)    return <span className={`${styles.updateMsg} ${styles.updateOk}`}>Up to date</span>
    if (isError)       return <span className={`${styles.updateMsg} ${styles.updateError}`}>{updateStatus.error}</span>
    if (status === 'available') return <span className={styles.updateMsg}>Downloading v{updateStatus.version}...</span>
    return null
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

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Thumbnail cache</div>
          <div className={styles.sectionBody}>
            <div className={styles.cacheRow}>
              <span className={styles.cacheSize}>{formatSize(cacheBytes)}</span>
              <Button size="sm" variant="ghost" onClick={handleClearCache} disabled={clearing}>
                {clearing ? 'Clearing...' : 'Clear cache'}
              </Button>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>About</div>
          <div className={styles.sectionBody}>
            <div className={styles.aboutRow}>
              <div className={styles.aboutVersion}>
                <span className={styles.aboutLabel}>WinRaid</span>
                {version && <span className={styles.aboutTag}>v{version}</span>}
              </div>
              <div className={styles.aboutActions}>
                {isReady ? (
                  <Button size="sm" onClick={handleInstall}>
                    <Download size={14} strokeWidth={1.75} />
                    Install & restart
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={handleCheckUpdate} disabled={isBusy}>
                    <RefreshCw size={14} strokeWidth={1.75} className={isChecking ? styles.spinning : undefined} />
                    {isBusy ? 'Checking...' : 'Check for updates'}
                  </Button>
                )}
              </div>
            </div>
            {renderUpdateInfo()}
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
