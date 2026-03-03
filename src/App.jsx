import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import QueueView from './views/QueueView'
import BrowseView from './views/BrowseView'
import BackupView from './views/BackupView'
import SettingsView from './views/SettingsView'
import LogView from './views/LogView'
import styles from './App.module.css'

// ---------------------------------------------------------------------------
// View registry — add new top-level views here
// ---------------------------------------------------------------------------
const VIEW_COMPONENTS = {
  queue:    QueueView,
  browse:   BrowseView,
  backup:   BackupView,
  settings: SettingsView,
  logs:     LogView,
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function App() {
  const [activeView, setActiveView]   = useState('queue')
  const [watcherStatus, setWatcherStatus] = useState({ watching: false, folder: null })
  const [activeTransfers, setActiveTransfers] = useState(0)
  const [backupRun, setBackupRun] = useState({
    runStatus:   'idle',
    stats:       null,
    currentFile: null,
    lastRun:     null,
  })

  // --- Theme detection -------------------------------------------------------
  // Applies [data-theme] to <html> so CSS variables cascade everywhere.
  // Falls back to dark if matchMedia is unsupported.
  useEffect(() => {
    const apply = (prefersDark) => {
      document.documentElement.setAttribute(
        'data-theme',
        prefersDark ? 'dark' : 'light'
      )
    }

    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) {
      apply(true)  // fallback: dark
      return
    }

    apply(mq.matches)
    const handler = (e) => apply(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // --- IPC: watcher status ---------------------------------------------------
  useEffect(() => {
    if (!window.winraid) return
    return window.winraid.watcher.onStatus(setWatcherStatus)
  }, [])

  // --- IPC: backup progress --------------------------------------------------
  useEffect(() => {
    if (!window.winraid) return
    return window.winraid.backup.onProgress((payload) => {
      setBackupRun((prev) => ({
        ...prev,
        currentFile: payload.file ?? null,
        stats:       { ...payload.stats },
      }))
    })
  }, [])

  // --- IPC: active transfer count -------------------------------------------
  // Tracks how many jobs are currently in-flight for the status bar.
  useEffect(() => {
    if (!window.winraid) return

    const unsubProgress = window.winraid.queue.onProgress(({ percent }) => {
      if (percent < 100) setActiveTransfers((n) => Math.max(n, 1))
    })

    const unsubUpdated = window.winraid.queue.onUpdated(({ job }) => {
      if (job?.status && job.status !== 'TRANSFERRING') {
        setActiveTransfers(0)
      }
    })

    return () => {
      unsubProgress()
      unsubUpdated()
    }
  }, [])

  // --- Watcher toggle (from status bar click) --------------------------------
  async function handleWatcherToggle() {
    if (watcherStatus.watching) {
      await window.winraid?.watcher.stop()
    } else {
      const cfg = await window.winraid?.config.get()
      if (cfg?.localFolder) await window.winraid?.watcher.start(cfg.localFolder)
    }
  }

  // --- Render ----------------------------------------------------------------
  const ActiveView = VIEW_COMPONENTS[activeView] ?? QueueView
  const activeViewProps = activeView === 'backup' ? { backupRun, setBackupRun } : {}

  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <Sidebar activeView={activeView} onNavigate={setActiveView} />
        <main className={styles.content}>
          <ActiveView {...activeViewProps} />
        </main>
      </div>
      <StatusBar watcherStatus={watcherStatus} activeTransfers={activeTransfers} onToggle={handleWatcherToggle} />
    </div>
  )
}
