import { useState, useEffect, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import StatusBar from './components/StatusBar'
import TabBar from './components/TabBar'
import ConnectionView from './views/ConnectionView'
import DashboardView from './views/DashboardView'
import QueueView from './views/QueueView'
import BrowseView from './views/BrowseView'
import BackupView from './views/BackupView'
import SizeView from './views/SizeView'
import SettingsView from './views/SettingsView'
import LogView from './views/LogView'
import { useNavHistory } from './hooks/useNavHistory'
import styles from './App.module.css'

// ---------------------------------------------------------------------------
// View registry (BrowseView and BackupView are excluded — mounted per-tab)
// ---------------------------------------------------------------------------
const VIEW_COMPONENTS = {
  dashboard: DashboardView,
  queue:     QueueView,
  settings:  SettingsView,
  logs:      LogView,
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------
export default function App() {
  const [activeView, setActiveView]       = useState('dashboard')
  // Map<connectionId, { watching, folder, state, file }> — per-connection watcher status
  const [watcherStatus, setWatcherStatus] = useState({})
  // Map<jobId, connectionId> of currently transferring jobs
  const [activeTransfers, setActiveTransfers] = useState(new Map())
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
  // Load initial state on mount
  useEffect(() => {
    if (!window.winraid) return
    window.winraid.watcher.list().then((states) => {
      if (states) setWatcherStatus(states)
    }).catch(() => {})
  }, [])

  // Subscribe to pushed updates — payload is always the full map
  useEffect(() => {
    if (!window.winraid) return
    return window.winraid.watcher.onStatus((states) => {
      if (states && typeof states === 'object') {
        setWatcherStatus(states)
      }
    })
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
            setActiveTransfers((prev) => new Map(prev).set(job.id, job.connectionId ?? null))
          } else if (prevStatus === 'TRANSFERRING') {
            setActiveTransfers((prev) => { const m = new Map(prev); m.delete(job.id); return m })
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
  const [connEdit,    setConnEdit]    = useState(null)  // null | { conn }
  const [connections, setConnections] = useState([])

  // --- Tab state ------------------------------------------------------------
  const [openTabs,    setOpenTabs]    = useState([])   // [{ id, connId, type }]
  const [activeTabId, setActiveTabId] = useState(null)
  const activeTabIdRef = useRef(null)
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  const [queuePaused, setQueuePaused] = useState(false)

  useEffect(() => {
    window.winraid?.config.get().then((cfg) => {
      if (!cfg) return
      setConnections(cfg.connections ?? [])
    })
  }, [])

  // --- Navigation history ---------------------------------------------------
  const { push, back, forward } = useNavHistory()
  const historyInitRef = useRef(false)
  const [browseRestore, setBrowseRestore] = useState(null)
  const [logNav, setLogNav] = useState(null)

  // Push the initial entry once on mount
  useEffect(() => {
    if (historyInitRef.current) return
    historyInitRef.current = true
    push({ kind: 'view', view: 'dashboard' })
  }, [push])

  function navigateView(view) {
    setConnEdit(null)
    setActiveView(view)
    setActiveTabId(null)
    setBrowseRestore(null)
    if (view !== 'logs') setLogNav(null)
    push({ kind: 'view', view })
  }

  function handleNavigateLogs({ filename, errorAt }) {
    setLogNav({ filename, errorAt })
    navigateView('logs')
  }

  function restoreEntry(entry) {
    if (entry.kind === 'view') {
      setConnEdit(null)
      setActiveView(entry.view)
      setActiveTabId(null)
      setBrowseRestore(null)
    } else if (entry.kind === 'conn-edit') {
      setConnEdit({ conn: entry.conn })
    } else if (entry.kind === 'tab') {
      setConnEdit(null)
      setActiveView(null)
      setOpenTabs((prev) => {
        if (prev.find((t) => t.id === entry.id)) return prev
        return [...prev, { id: entry.id, connId: entry.connId, type: entry.type }]
      })
      setActiveTabId(entry.id)
      setBrowseRestore(null)
    } else if (entry.kind === 'browse') {
      // Browse entries carry a connectionId — restore the tab and navigate within it
      const tabId = entry.connectionId ? `${entry.connectionId}:browse` : null
      if (!tabId) return
      setConnEdit(null)
      setActiveView(null)
      setOpenTabs((prev) => {
        if (prev.find((t) => t.id === tabId)) return prev
        return [...prev, { id: tabId, connId: entry.connectionId, type: 'browse' }]
      })
      setActiveTabId(tabId)
      setBrowseRestore({ path: entry.path, quickLookFile: entry.quickLookFile, connectionId: entry.connectionId, token: Date.now() })
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
    setConnEdit({ conn: conn ?? null })
    push({ kind: 'conn-edit', conn: conn ?? null })
  }

  async function handleConnSave() {
    setConnEdit(null)
    const cfg = await window.winraid?.config.get()
    setConnections(cfg?.connections ?? [])
  }

  // --- Tab helpers ----------------------------------------------------------
  function openTab(connId, type) {
    const id = `${connId}:${type}`
    setOpenTabs((prev) => {
      if (prev.find((t) => t.id === id)) return prev
      return [...prev, { id, connId, type }]
    })
    setActiveTabId(id)
    setActiveView(null)
    if (id !== activeTabId) push({ kind: 'tab', id, connId, type })
  }

  function activateTab(id) {
    if (id === activeTabId) return
    const tab = openTabs.find((t) => t.id === id)
    if (!tab) return
    setActiveTabId(id)
    setActiveView(null)
    push({ kind: 'tab', id: tab.id, connId: tab.connId, type: tab.type })
  }

  function closeTab(id) {
    setOpenTabs((prev) => {
      const idx  = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      if (activeTabIdRef.current === id) {
        const newActive = next[idx - 1] ?? null
        setActiveTabId(newActive?.id ?? null)
        if (!newActive) setActiveView('dashboard')
      }
      return next
    })
  }

  // --- Global watcher + queue toggle ----------------------------------------
  async function handleGlobalToggle() {
    if (queuePaused) {
      await window.winraid?.watcher.resumeAll()
      await window.winraid?.queue.resume()
      setQueuePaused(false)
    } else {
      await window.winraid?.watcher.pauseAll()
      await window.winraid?.queue.pause()
      setQueuePaused(true)
    }
  }

  // --- Render ----------------------------------------------------------------
  const ActiveView = VIEW_COMPONENTS[activeView] ?? DashboardView
  const activeViewProps =
    activeView === 'dashboard' ? {
      watcherStatus, onNavigate: navigateView,
      onEditConnection: openConnEdit,
      connections, onOpenTab: openTab,
    } :
    activeView === 'queue' ? {
      connections, onNavigate: navigateView,
      onNavigateLogs: handleNavigateLogs,
      onBrowsePath: (connId, remotePath, highlightFile) => {
        openTab(connId, 'browse')
        setBrowseRestore({ path: remotePath, quickLookFile: null, connectionId: connId, highlightFile: highlightFile ?? null, token: Date.now() })
      },
    } :
    activeView === 'logs' ? { logNav } :
    {}

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
          openTabs={openTabs}
          activeTabId={activeTabId}
          onOpenTab={openTab}
          editingConnId={connEdit !== null ? (connEdit.conn?.id ?? null) : null}
          watcherStatuses={watcherStatus}
        />
        <div className={styles.main}>
          <Header
            watcherStatus={watcherStatus}
            activeTransfers={activeTransfers}
            queuePaused={queuePaused}
            onGlobalToggle={handleGlobalToggle}
            connections={connections}
            onNavigate={navigateView}
          />
          <TabBar
            openTabs={openTabs}
            activeTabId={activeTabId}
            connections={connections}
            onActivate={activateTab}
            onClose={closeTab}
          />
          <main className={styles.content}>
            {/* Global views */}
            {connEdit !== null ? (
              <ConnectionView
                key={connEdit.conn?.id ?? 'new'}
                existing={connEdit.conn}
                onSave={handleConnSave}
                onClose={() => setConnEdit(null)}
              />
            ) : activeTabId === null && activeView !== null && (
              <ActiveView {...activeViewProps} />
            )}

            {/* Per-connection Browse tabs (lazy-mount, keep-alive) */}
            {openTabs.filter((t) => t.type === 'browse').map((tab) => (
              <BrowseView
                key={tab.id}
                style={{ display: activeTabId === tab.id && connEdit === null ? '' : 'none' }}
                browseRestore={activeTabId === tab.id ? browseRestore : null}
                onBrowseRestoreConsumed={() => setBrowseRestore(null)}
                onHistoryPush={onHistoryPush}
                connections={connections}
                connectionId={tab.connId}
              />
            ))}

            {/* Per-connection Backup tabs (lazy-mount, keep-alive) */}
            {openTabs.filter((t) => t.type === 'backup').map((tab) => (
              <div key={tab.id} style={{ display: activeTabId === tab.id && connEdit === null ? '' : 'none', height: '100%' }}>
                <BackupView
                  connectionId={tab.connId}
                  backupRun={backupRun}
                  setBackupRun={setBackupRun}
                />
              </div>
            ))}

            {/* Per-connection Size tabs (lazy-mount, keep-alive) */}
            {openTabs.filter((t) => t.type === 'size').map((tab) => {
              const conn = connections.find((c) => c.id === tab.connId) ?? null
              return (
                <div
                  key={tab.id}
                  style={{ display: activeTabId === tab.id && connEdit === null ? '' : 'none', height: '100%' }}
                >
                  <SizeView
                    connectionId={tab.connId}
                    connection={conn}
                    onBrowsePath={(remotePath) => {
                      openTab(tab.connId, 'browse')
                      setBrowseRestore({ path: remotePath, quickLookFile: null, connectionId: tab.connId, highlightFile: null, token: Date.now() })
                    }}
                  />
                </div>
              )
            })}
          </main>
          <StatusBar
            watcherStatus={watcherStatus}
            activeTransfers={activeTransfers}
            connections={connections}
            onNavigate={navigateView}
          />
        </div>
      </div>
    </div>
  )
}
