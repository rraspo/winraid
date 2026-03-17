import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import StatusBar from './components/StatusBar'
import ConnectionModal from './components/ConnectionModal'
import DashboardView from './views/DashboardView'
import QueueView from './views/QueueView'
import BrowseView from './views/BrowseView'
import BackupView from './views/BackupView'
import SettingsView from './views/SettingsView'
import LogView from './views/LogView'
import styles from './App.module.css'

// ---------------------------------------------------------------------------
// View registry
// ---------------------------------------------------------------------------
const VIEW_COMPONENTS = {
  dashboard: DashboardView,
  queue:     QueueView,
  browse:    BrowseView,
  backup:    BackupView,
  settings:  SettingsView,
  logs:      LogView,
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function App() {
  const [activeView, setActiveView]       = useState('dashboard')
  const [watcherStatus, setWatcherStatus] = useState({ watching: false, folder: null })
  const [activeTransfers, setActiveTransfers] = useState(0)
  const [backupRun, setBackupRun] = useState({
    runStatus:   'idle',
    stats:       null,
    currentFile: null,
    lastRun:     null,
  })

  // --- Theme management -------------------------------------------------------
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('winraid-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      localStorage.setItem('winraid-theme', next)
      return next
    })
  }

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

  // --- Connection modal (shared between sidebar + dashboard) ----------------
  const [connModal,   setConnModal]   = useState({ open: false, conn: null })
  const [connVersion, setConnVersion] = useState(0)

  function openConnModal(conn) {
    // Legacy synthesized entry: treat as new connection pre-filled with flat data
    const normalised = conn?.id === '__legacy__'
      ? { ...conn, id: crypto.randomUUID() }
      : conn ?? null
    setConnModal({ open: true, conn: normalised })
  }

  function handleConnSave() {
    setConnModal({ open: false, conn: null })
    setConnVersion((v) => v + 1)
  }

  // --- Watcher toggle -------------------------------------------------------
  async function handleWatcherToggle() {
    if (watcherStatus.watching) {
      await window.winraid?.watcher.stop()
    } else {
      const cfg = await window.winraid?.config.get()
      if (cfg?.localFolder) await window.winraid?.watcher.start(cfg.localFolder)
    }
  }

  // --- Render ----------------------------------------------------------------
  const ActiveView = VIEW_COMPONENTS[activeView] ?? DashboardView
  const activeViewProps =
    activeView === 'backup'    ? { backupRun, setBackupRun } :
    activeView === 'dashboard' ? { watcherStatus, onNavigate: setActiveView, onEditConnection: openConnModal, connVersion } :
    {}

  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <Sidebar
          activeView={activeView}
          onNavigate={setActiveView}
          theme={theme}
          onThemeToggle={toggleTheme}
          onEditConnection={openConnModal}
          connVersion={connVersion}
        />
        <div className={styles.main}>
          <Header
            watcherStatus={watcherStatus}
            activeTransfers={activeTransfers}
            onWatcherToggle={handleWatcherToggle}
          />
          <main className={styles.content}>
            <ActiveView {...activeViewProps} />
          </main>
          <StatusBar watcherStatus={watcherStatus} activeTransfers={activeTransfers} />
        </div>
      </div>

      {connModal.open && (
        <ConnectionModal
          existing={connModal.conn}
          onSave={handleConnSave}
          onClose={() => setConnModal({ open: false, conn: null })}
        />
      )}
    </div>
  )
}
