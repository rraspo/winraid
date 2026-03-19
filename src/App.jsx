import { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import StatusBar from './components/StatusBar'
import ConnectionView from './views/ConnectionView'
import DashboardView from './views/DashboardView'
import QueueView from './views/QueueView'
import BrowseView from './views/BrowseView'
import BackupView from './views/BackupView'
import SettingsView from './views/SettingsView'
import LogView from './views/LogView'
import { useNavHistory } from './hooks/useNavHistory'
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
  // Track the last known status per job so we can detect transitions into and
  // out of TRANSFERRING without relying on a prevStatus field in the payload.
  const jobStatusMapRef = useRef(new Map())

  useEffect(() => {
    if (!window.winraid) return

    const unsubUpdated = window.winraid.queue.onUpdated((payload) => {
      if (payload?.type === 'updated' && payload.job) {
        const { job } = payload
        const prevStatus = jobStatusMapRef.current.get(job.id)
        const nextStatus = job.status

        if (prevStatus !== nextStatus) {
          jobStatusMapRef.current.set(job.id, nextStatus)
          if (nextStatus === 'TRANSFERRING') {
            setActiveTransfers((n) => n + 1)
          } else if (prevStatus === 'TRANSFERRING') {
            setActiveTransfers((n) => Math.max(0, n - 1))
          }
        }
      } else if (payload?.type === 'cleared') {
        // All DONE jobs removed — no active transfers affected, but reset map entries
        jobStatusMapRef.current.forEach((status, id) => {
          if (status === 'DONE') jobStatusMapRef.current.delete(id)
        })
      } else if (payload?.type === 'removed' && payload.jobId) {
        jobStatusMapRef.current.delete(payload.jobId)
      }
    })

    return () => {
      unsubUpdated()
    }
  }, [])

  // --- Connection state (shared between sidebar + dashboard) ----------------
  const [connEdit,      setConnEdit]      = useState(null)  // null | { conn }
  const [connections,   setConnections]   = useState([])
  const [activeConnId,  setActiveConnId]  = useState(null)

  useEffect(() => {
    window.winraid?.config.get().then((cfg) => {
      if (!cfg) return
      setConnections(cfg.connections ?? [])
      setActiveConnId(cfg.activeConnectionId ?? null)
    })
  }, [])

  // --- Navigation history ---------------------------------------------------
  const { push, back, forward } = useNavHistory()
  const historyInitRef = useRef(false)
  const [browseRestore, setBrowseRestore] = useState(null)

  // Push the initial entry once on mount
  useEffect(() => {
    if (historyInitRef.current) return
    historyInitRef.current = true
    push({ kind: 'view', view: 'dashboard' })
  }, [push])

  function navigateView(view) {
    setConnEdit(null)
    setActiveView(view)
    // Browse owns its own initial history entry — pushed the first time the
    // user navigates inside BrowseView, so the starting path is recorded.
    if (view !== 'browse') push({ kind: 'view', view })
  }

  function restoreEntry(entry) {
    if (entry.kind === 'view') {
      setConnEdit(null)
      setActiveView(entry.view)
      setBrowseRestore(null)
    } else if (entry.kind === 'conn-edit') {
      setConnEdit({ conn: entry.conn })
    } else if (entry.kind === 'browse') {
      setConnEdit(null)
      setActiveView('browse')
      setBrowseRestore({ path: entry.path, quickLookFile: entry.quickLookFile, token: Date.now() })
    }
  }

  const onHistoryPush = useCallback((entry) => push(entry), [push])

  useEffect(() => {
    function onMouseDown(e) {
      if (e.button === 3) { e.preventDefault(); const entry = back();    if (entry) restoreEntry(entry) }
      if (e.button === 4) { e.preventDefault(); const entry = forward(); if (entry) restoreEntry(entry) }
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [back, forward]) // restoreEntry uses only setters so it is stable

  async function openConnEdit(conn) {
    // Immediately mark the clicked connection as active in config and state,
    // so the sidebar highlights it without waiting for the save action.
    if (conn && conn.id !== activeConnId) {
      await window.winraid?.config.set('activeConnectionId', conn.id)
      setActiveConnId(conn.id)
    }
    setConnEdit({ conn: conn ?? null })
    push({ kind: 'conn-edit', conn: conn ?? null })
  }

  async function handleConnSave(saved) {
    setConnEdit(null)
    const cfg = await window.winraid?.config.get()
    setConnections(cfg?.connections ?? [])
    setActiveConnId(cfg?.activeConnectionId ?? null)
  }

  // --- Watcher toggle -------------------------------------------------------
  async function handleWatcherToggle() {
    if (watcherStatus.watching) {
      await window.winraid?.watcher.stop()
    } else {
      const cfg = await window.winraid?.config.get()
      // localFolder lives on the active connection, not the top-level config
      const activeConn = (cfg?.connections ?? []).find((c) => c.id === cfg?.activeConnectionId)
      const folder = activeConn?.localFolder ?? cfg?.localFolder ?? ''
      if (folder) await window.winraid?.watcher.start(folder)
    }
  }

  // --- Render ----------------------------------------------------------------
  const ActiveView = VIEW_COMPONENTS[activeView] ?? DashboardView
  const activeViewProps =
    activeView === 'backup'    ? { backupRun, setBackupRun } :
    activeView === 'dashboard' ? { watcherStatus, onNavigate: navigateView, onEditConnection: openConnEdit, connections, activeConnId } :
    activeView === 'browse'    ? { browseRestore, onHistoryPush } :
    {}

  // ID of the connection whose form is currently open — used by Sidebar to
  // highlight the editing row independently of activeConnId.
  const editingConnId = connEdit !== null ? (connEdit.conn?.id ?? null) : null

  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <Sidebar
          activeView={connEdit !== null ? null : activeView}
          onNavigate={navigateView}
          theme={theme}
          onThemeToggle={toggleTheme}
          onEditConnection={openConnEdit}
          connections={connections}
          activeConnId={activeConnId}
          editingConnId={editingConnId}
        />
        <div className={styles.main}>
          <Header
            watcherStatus={watcherStatus}
            activeTransfers={activeTransfers}
            onWatcherToggle={handleWatcherToggle}
          />
          <main className={styles.content}>
            {connEdit !== null
              ? <ConnectionView
                  key={connEdit.conn?.id ?? 'new'}
                  existing={connEdit.conn}
                  onSave={handleConnSave}
                  onClose={() => setConnEdit(null)}
                />
              : <ActiveView {...activeViewProps} />
            }
          </main>
          <StatusBar watcherStatus={watcherStatus} activeTransfers={activeTransfers} />
        </div>
      </div>

    </div>
  )
}
