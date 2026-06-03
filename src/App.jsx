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
  // Number of jobs currently in PENDING or TRANSFERRING status — finished
  // (DONE) or failed (ERROR) jobs are excluded.
  const [queueDepth, setQueueDepth] = useState(0)
  // Total jobs entered into the *current* batch. Set when the queue is
  // empty and a new active job arrives; grows as additional jobs land in
  // the same batch; stays put while the batch drains, so the status bar
  // can show "n/total" with a stable denominator. The next new job after
  // queueDepth hits 0 starts a fresh batch.
  const [batchTotal, setBatchTotal] = useState(0)
  // Set of connectionIds that have had a TRANSFERRING job during the
  // current batch. Accumulates across files so the status bar's
  // "· ConnectionName" suffix doesn't blink in/out between transfers.
  // Cleared alongside batchTotal when the batch drains.
  const [batchConnections, setBatchConnections] = useState(() => new Set())
  // Progress (0–1) of the file currently being transferred. Resets to 0
  // when a new file enters TRANSFERRING, climbs as bytes arrive, and
  // hits 1 just before the file transitions to DONE. Held at the last
  // value between files (worker is serial; brief gap reads as "done").
  const [currentFileProgress, setCurrentFileProgress] = useState(0)
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
  // Synchronous mirror of queueDepth — needed inside the event handler to
  // detect "was queue drained?" before a new active job is counted.
  const queueDepthRef   = useRef(0)

  useEffect(() => {
    if (!window.winraid) return

    const isActive = (s) => s === 'PENDING' || s === 'TRANSFERRING'

    // Update queueDepth state AND ref together. Returns the new depth so
    // the caller can react to drained state in the same tick.
    function bumpDepth(delta) {
      const next = Math.max(0, queueDepthRef.current + delta)
      queueDepthRef.current = next
      setQueueDepth(next)
      return next
    }

    // A new job has entered the active set. Either we're starting a fresh
    // batch (queue was drained → set total to 1) or growing an in-progress
    // batch (total++).
    function recordNewActive() {
      if (queueDepthRef.current === 0) {
        setBatchTotal(1)
      } else {
        setBatchTotal((t) => t + 1)
      }
      bumpDepth(+1)
    }

    function recordExitActive() {
      bumpDepth(-1)
    }

    // Seed counters on mount so the status bar shows real numbers even
    // before any 'updated' events arrive (app restart with pending jobs).
    window.winraid.queue.list?.().then?.((jobs) => {
      if (!Array.isArray(jobs)) return
      let depth = 0
      const seedConns = new Set()
      for (const job of jobs) {
        jobStatusMapRef.current.set(job.id, job.status)
        if (isActive(job.status)) depth++
        if (job.status === 'TRANSFERRING') {
          setActiveTransfers((prev) => new Map(prev).set(job.id, job.connectionId ?? null))
          if (job.connectionId) seedConns.add(job.connectionId)
        }
      }
      queueDepthRef.current = depth
      setQueueDepth(depth)
      // Treat anything already pending/transferring on startup as one batch
      // in progress — the user can read "n/depth" while it drains.
      setBatchTotal(depth)
      if (seedConns.size > 0) setBatchConnections(seedConns)
    }).catch?.(() => {})

    const unsubUpdated = window.winraid.queue.onUpdated((payload) => {
      if (payload?.type === 'updated' && payload.job) {
        const { job } = payload
        const prevStatus = jobStatusMapRef.current.get(job.id)
        const nextStatus = job.status

        if (prevStatus !== nextStatus) {
          jobStatusMapRef.current.set(job.id, nextStatus)
          const wasActive = isActive(prevStatus)
          const nowActive = isActive(nextStatus)
          if (nowActive && !wasActive)      recordNewActive()
          else if (wasActive && !nowActive) recordExitActive()

          if (nextStatus === 'TRANSFERRING') {
            setActiveTransfers((prev) => new Map(prev).set(job.id, job.connectionId ?? null))
            // A new file is starting — reset the per-file ring to empty.
            setCurrentFileProgress(0)
            // Accumulate the connection into the batch-level set so the
            // status bar suffix stays put between files.
            if (job.connectionId) {
              setBatchConnections((prev) => {
                if (prev.has(job.connectionId)) return prev
                const next = new Set(prev)
                next.add(job.connectionId)
                return next
              })
            }
          } else if (prevStatus === 'TRANSFERRING') {
            setActiveTransfers((prev) => { const m = new Map(prev); m.delete(job.id); return m })
          }
        }
      } else if (payload?.type === 'added' && payload.jobId) {
        const prevStatus = jobStatusMapRef.current.get(payload.jobId)
        if (!isActive(prevStatus)) {
          jobStatusMapRef.current.set(payload.jobId, 'PENDING')
          recordNewActive()
        }
      } else if (payload?.type === 'retry' && payload.jobId) {
        const prevStatus = jobStatusMapRef.current.get(payload.jobId)
        if (!isActive(prevStatus)) {
          jobStatusMapRef.current.set(payload.jobId, 'PENDING')
          recordNewActive()
        }
      } else if (payload?.type === 'cleared') {
        jobStatusMapRef.current.forEach((status, id) => {
          if (status === 'DONE') jobStatusMapRef.current.delete(id)
        })
      } else if (payload?.type === 'removed' && payload.jobId) {
        const prevStatus = jobStatusMapRef.current.get(payload.jobId)
        jobStatusMapRef.current.delete(payload.jobId)
        if (isActive(prevStatus)) recordExitActive()
      }
    })

    return () => {
      unsubUpdated()
    }
  }, [])

  // When the queue drains, also clear any stale activeTransfers entries,
  // the batch counter, and the batch connection set. Without this, a
  // missed TRANSFERRING→DONE event could leave the status bar stuck
  // showing "Transferring" forever, and stale conn names could carry
  // into the next batch.
  useEffect(() => {
    if (queueDepth === 0) {
      setActiveTransfers((prev) => (prev.size > 0 ? new Map() : prev))
      setBatchTotal((t) => (t > 0 ? 0 : t))
      setBatchConnections((s) => (s.size > 0 ? new Set() : s))
      setCurrentFileProgress(0)
    }
  }, [queueDepth])

  // Live byte-level progress for the file currently being transferred.
  // Worker is serial so only one file is in flight at a time.
  useEffect(() => {
    if (!window.winraid) return
    return window.winraid.queue.onProgress((payload) => {
      if (typeof payload?.percent === 'number') {
        setCurrentFileProgress(payload.percent / 100)
      }
    })
  }, [])

  // --- Connection state (shared between sidebar + dashboard) ----------------
  const [connEdit,    setConnEdit]    = useState(null)  // null | { conn }
  const [connections, setConnections] = useState([])
  // Per-connection favorite directory paths: { [connId]: string[] }
  const [favorites,   setFavorites]   = useState({})

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
      setFavorites(cfg.favoritesByConnection ?? {})
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

  // --- Favorites ------------------------------------------------------------
  async function toggleFavoriteDir(connId, path) {
    const { toggleFavorite } = await import('./utils/favorites')
    setFavorites((prev) => {
      const next = { ...prev, [connId]: toggleFavorite(prev[connId], path) }
      window.winraid?.config.set('favoritesByConnection', next)
      return next
    })
  }

  function navigateFavorite(connId, path) {
    openTab(connId, 'browse')
    setBrowseRestore({ path, quickLookFile: null, connectionId: connId, highlightFile: null, token: Date.now() })
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
          favorites={favorites}
          onNavigateFavorite={navigateFavorite}
          onRemoveFavorite={toggleFavoriteDir}
        />
        <div className={styles.main}>
          <Header
            watcherStatus={watcherStatus}
            activeTransfers={activeTransfers}
            queueDepth={queueDepth}
            batchTotal={batchTotal}
            batchConnections={batchConnections}
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
                favorites={favorites[tab.connId] ?? []}
                onToggleFavorite={(path) => toggleFavoriteDir(tab.connId, path)}
              />
            ))}

            {/* Per-connection Backup tabs (lazy-mount, keep-alive) */}
            {openTabs.filter((t) => t.type === 'backup').map((tab) => (
              <div key={tab.id} style={{ display: activeTabId === tab.id && connEdit === null ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
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
                  style={{ display: activeTabId === tab.id && connEdit === null ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}
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
            queueDepth={queueDepth}
            batchTotal={batchTotal}
            batchConnections={batchConnections}
            currentFileProgress={currentFileProgress}
            connections={connections}
            onNavigate={navigateView}
          />
        </div>
      </div>
    </div>
  )
}
