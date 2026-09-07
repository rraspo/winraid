import { useState, useEffect, useRef } from 'react'
import TitleBar from './components/shell/TitleBar'
import NavRail from './components/shell/NavRail'
import StatusBar from './components/shell/StatusBar'
import TabBar from './components/TabBar'
import ConnectionView from './views/ConnectionView'
import ConnectionsView from './views/ConnectionsView'
import DashboardView from './views/DashboardView'
import QueueView from './views/QueueView'
import BrowseView from './views/BrowseView'
import BackupView from './views/BackupView'
import SizeView from './views/SizeView'
import SettingsView from './views/SettingsView'
import LogView from './views/LogView'
import EditorView from './components/EditorView'
import PlayOverlay from './components/PlayOverlay'
import ToastHost from './components/ui/ToastHost'
import { useNavHistory } from './hooks/useNavHistory'
import { normalizeAppearance, resolveTheme, resolveAccentHex, onAccentTextColor } from './utils/accent'
import styles from './App.module.css'

// ---------------------------------------------------------------------------
// View registry (BrowseView, BackupView, SizeView are excluded — mounted per-tab)
// ---------------------------------------------------------------------------
const VIEW_COMPONENTS = {
  dashboard:   DashboardView,
  connections: ConnectionsView,
  queue:       QueueView,
  settings:    SettingsView,
  logs:        LogView,
}

// Global views the nav rail switches between directly, as opposed to the
// per-connection tabs (browse/size/backup) and the Play overlay.
const GLOBAL_VIEWS = new Set(['dashboard', 'connections', 'queue', 'logs', 'settings'])

// Tab identities are their own thing, independent of connection and type —
// several tabs of the same connection and kind can be open at once, the way
// a browser keeps several tabs on the same site open. A module-level counter
// mints them.
let tabIdCounter = 0
function nextTabId() {
  tabIdCounter += 1
  return `tab-${tabIdCounter}`
}

// The remote root a connection's tabs open on.
function remoteRootOf(connection) {
  return connection?.type === 'sftp' ? connection?.sftp?.remotePath : connection?.smb?.remotePath
}

// The last segment of a remote path, for a browse tab's label — e.g.
// "/mnt/user/media/photos" reads as "photos".
function lastPathSegment(remotePath) {
  if (!remotePath) return ''
  const trimmed = remotePath.length > 1 && remotePath.endsWith('/') ? remotePath.slice(0, -1) : remotePath
  const lastSlash = trimmed.lastIndexOf('/')
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed
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

  // --- Appearance (theme + accent) --------------------------------------------
  const [appearance, setAppearance] = useState(() => normalizeAppearance(undefined))
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  )
  const [systemAccentHex, setSystemAccentHex] = useState(null)
  const resolvedTheme = resolveTheme(appearance.theme, systemPrefersDark)

  // Load the persisted appearance. Installs that predate the appearance
  // setting hold the theme in localStorage under 'winraid-theme'; it wins
  // over the default exactly once and is then removed, so an explicit
  // choice in Settings can never be overridden by the stale key.
  useEffect(() => {
    let cancelled = false
    window.winraid?.config.get('appearance').then((raw) => {
      if (cancelled) return
      const legacyTheme = localStorage.getItem('winraid-theme')
      if ((legacyTheme === 'dark' || legacyTheme === 'light') && raw?.theme == null) {
        const migrated = { ...normalizeAppearance(raw), theme: legacyTheme }
        setAppearance(migrated)
        window.winraid?.config.set('appearance', migrated)
        localStorage.removeItem('winraid-theme')
      } else {
        setAppearance(normalizeAppearance(raw))
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Re-resolve a 'system' theme choice when the OS preference changes live.
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const handleChange = (e) => setSystemPrefersDark(e.matches)
    media.addEventListener?.('change', handleChange)
    return () => media.removeEventListener?.('change', handleChange)
  }, [])

  // Pick up appearance changes written by SettingsView without a reload.
  useEffect(() => {
    function handleAppearanceChanged(e) {
      if (e.detail) setAppearance(normalizeAppearance(e.detail))
    }
    window.addEventListener('winraid:appearance-changed', handleAppearanceChanged)
    return () => window.removeEventListener('winraid:appearance-changed', handleAppearanceChanged)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  // Track the live Windows system accent so a 'system' accent choice follows
  // it without requiring a restart.
  useEffect(() => {
    if (!window.winraid?.system) return
    let cancelled = false
    window.winraid.system.accentColor().then((hex) => {
      if (!cancelled) setSystemAccentHex(hex ?? null)
    }).catch(() => {})
    const unsubscribe = window.winraid.system.onAccentColorChanged((hex) => {
      setSystemAccentHex(hex ?? null)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const accentHex = resolveAccentHex(appearance.accent, systemAccentHex)
    document.documentElement.style.setProperty('--accent', accentHex)
    document.documentElement.style.setProperty('--onAccent', onAccentTextColor(accentHex))
  }, [appearance.accent, systemAccentHex])

  function toggleTheme() {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark'
    setAppearance((prev) => {
      const updated = { ...prev, theme: next }
      window.winraid?.config.set('appearance', updated)
      return updated
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

  // --- Connection state (shared between the nav rail and the views) ---------
  const [connEdit,    setConnEdit]    = useState(null)  // null | { conn }
  const [connections, setConnections] = useState([])
  // Per-connection favorite directory paths: { [connId]: string[] }
  const [favorites,   setFavorites]   = useState({})

  // --- Tab state ------------------------------------------------------------
  const [openTabs,    setOpenTabs]    = useState([])   // [{ id, connId, type, label? }]
  const [activeTabId, setActiveTabId] = useState(null)
  const activeTabIdRef = useRef(null)
  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  const [queuePaused, setQueuePaused] = useState(false)

  // The Play wall, a screen in the content column like any other — opening
  // it leaves whichever view or tab was showing untouched underneath, so
  // closing Play (without switching to another screen first) returns to it
  // without any extra bookkeeping. Null when Play is closed; { connectionId,
  // path } once its target resolves.
  const [playTarget, setPlayTarget] = useState(null)

  useEffect(() => {
    window.winraid?.config.get().then((cfg) => {
      if (!cfg) return
      setConnections(cfg.connections ?? [])
      setFavorites(cfg.favoritesByConnection ?? {})
    })
  }, [])

  // --- Activity feed (moved out of the removed Header) -----------------------
  const [activityEntries, setActivityEntries] = useState([])

  useEffect(() => {
    window.winraid?.activity?.tail?.(20)?.then((entries) => {
      if (entries?.length) setActivityEntries(entries)
    })
    const unsub = window.winraid?.activity?.onEntry?.((entry) => {
      setActivityEntries((prev) => [entry, ...prev].slice(0, 20))
    })
    return () => { unsub?.() }
  }, [])

  // --- Navigation history -----------------------------------------------------
  // History is scoped per view: a browse tab, a size/backup tab, a global
  // view or the play overlay each get their own back/forward trail, so
  // walking one never drags the mouse side buttons into another's. Only
  // browse tabs currently record entries (every real folder move); global
  // views, size/backup tabs and the play overlay have no history of their
  // own, so back/forward is a no-op while one of them is showing.
  const { push, back, forward, canGoBack, canGoForward } = useNavHistory()
  // Per-tab browse restore signal, keyed by tab id — so aiming a background
  // tab at a folder never disturbs the tab in front.
  const [browseRestoreByTab, setBrowseRestoreByTab] = useState({})
  const [logNav, setLogNav] = useState(null)

  function setTabBrowseRestore(tabId, restore) {
    setBrowseRestoreByTab((prev) => ({ ...prev, [tabId]: restore }))
  }

  function clearTabBrowseRestore(tabId) {
    setBrowseRestoreByTab((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }

  function setTabLabel(tabId, label) {
    setOpenTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, label } : t)))
  }

  function navigateView(view) {
    setConnEdit(null)
    setPlayTarget(null)
    setActiveView(view)
    setActiveTabId(null)
    if (view !== 'logs') setLogNav(null)
  }

  function handleNavigateLogs({ filename, errorAt }) {
    setLogNav({ filename, errorAt })
    navigateView('logs')
  }

  // Applies a browse-scope history entry — the only kind ever pushed —
  // jumping the tab it belongs to (identified by the caller, since a
  // connection can now have several browse tabs) to the recorded path.
  function applyBrowseHistoryEntry(entry, tabId) {
    if (!tabId) return
    setConnEdit(null)
    setPlayTarget(null)
    setActiveView(null)
    setOpenTabs((prev) => {
      if (prev.find((t) => t.id === tabId)) return prev
      return [...prev, { id: tabId, connId: entry.connectionId, type: 'browse' }]
    })
    setActiveTabId(tabId)
    setTabBrowseRestore(tabId, { path: entry.path, quickLookFile: entry.quickLookFile, connectionId: entry.connectionId, highlightFile: entry.highlightFile ?? null, token: Date.now() })
  }

  // The scope the mouse side buttons act on: whichever tab or view is
  // currently showing. A tab's scope is `${type}:${id}`, a global view's
  // scope is the view id itself, and the play overlay's is 'play'.
  const activeScopeTab = openTabs.find((t) => t.id === activeTabId) ?? null
  const activeScopeKey = playTarget ? 'play' : activeScopeTab ? `${activeScopeTab.type}:${activeScopeTab.id}` : activeView ?? null

  useEffect(() => {
    function onMouseDown(e) {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      if (!activeScopeKey) return
      const entry = e.button === 3 ? back(activeScopeKey) : forward(activeScopeKey)
      // Only a browse tab's scope ever yields an entry, so the ref's tab id
      // names the tab it belongs to.
      if (entry) applyBrowseHistoryEntry(entry, activeTabIdRef.current)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
    // applyBrowseHistoryEntry only closes over stable state setters, so it
    // can't go stale between renders — omitted to avoid resubscribing the
    // window listener on every one.
  }, [activeScopeKey, back, forward]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openConnEdit(conn) {
    setConnEdit({ conn: conn ?? null })
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
    navigateBrowseJump(connId, path)
  }

  // Activity entry click → open where the file ended up (remote browse) or
  // reveal the local folder in the OS file manager.
  function handleActivityNavigate(entry) {
    const nav = entry?.nav
    if (!nav) return
    if (nav.kind === 'reveal') {
      window.winraid?.activity.reveal(nav.localPath)
      return
    }
    if (nav.kind === 'remote') {
      navigateBrowseJump(entry.connectionId, nav.path, nav.highlight ?? null)
    }
  }

  // --- Editor tabs ----------------------------------------------------------
  // Dirty editor tabs (by tab id) so closeTab can confirm unsaved changes.
  const [dirtyTabs, setDirtyTabs] = useState(() => new Set())
  function setTabDirty(id, dirty) {
    setDirtyTabs((prev) => {
      if (dirty === prev.has(id)) return prev
      const next = new Set(prev)
      if (dirty) next.add(id); else next.delete(id)
      return next
    })
  }

  // Open a text file in its own editor tab (one per file; re-opening re-activates).
  function openEditorTab(connId, filePath) {
    const id = `${connId}:editor:${filePath}`
    setOpenTabs((prev) =>
      prev.find((t) => t.id === id)
        ? prev
        : [...prev, { id, connId, type: 'editor', filePath, name: filePath.split('/').pop() }]
    )
    setActiveTabId(id)
    setActiveView(null)
    setPlayTarget(null)
    // Intentionally not pushed to nav history — editor tabs aren't restored by back/forward.
  }

  // --- Tab helpers ----------------------------------------------------------
  // Opens a tab for a connection + type. By default an existing tab for
  // that connection and type is reused and activated, the way a single
  // click on a nav item behaves; `newTab` always mints another one, the way
  // a middle click does; `background` leaves the currently active tab in
  // place; `path` (browse tabs only) aims the tab at that folder instead of
  // the connection's remote root.
  function openTab(connId, type, options = {}) {
    const { newTab = false, background = false, path = null } = options
    const existing = newTab ? null : openTabs.find((t) => t.connId === connId && t.type === type)
    const id = existing ? existing.id : nextTabId()

    if (!existing) {
      setOpenTabs((prev) => [...prev, { id, connId, type }])
    }
    if (!background) {
      setActiveTabId(id)
      setActiveView(null)
      setPlayTarget(null)
    }
    if (type === 'browse' && path) {
      setTabBrowseRestore(id, { path, quickLookFile: null, connectionId: connId, highlightFile: null, token: Date.now() })
    }
    return id
  }

  // Jumps into browse from outside the browse view (favorites, activity
  // entries, "show in browse" from the queue/size views) bypass useBrowse's
  // navigate(), which is the only thing that normally records history for a
  // browse move. Without this, those jumps never enter the tab's own nav
  // scope and back walks straight past them to the tab's initial directory.
  // This is the single place that opens the tab and records the jump
  // together, directly into that tab's own browse scope.
  function navigateBrowseJump(connId, path, highlightFile = null) {
    const tabId = openTab(connId, 'browse')
    push(`browse:${tabId}`, { kind: 'browse', path, connectionId: connId, quickLookFile: null, highlightFile })
    setTabBrowseRestore(tabId, { path, quickLookFile: null, connectionId: connId, highlightFile, token: Date.now() })
  }

  function activateTab(id) {
    if (id === activeTabId) return
    const tab = openTabs.find((t) => t.id === id)
    if (!tab) return
    setActiveTabId(id)
    setActiveView(null)
    setPlayTarget(null)
  }

  function closeTab(id) {
    if (dirtyTabs.has(id) && !window.confirm('This file has unsaved changes. Close anyway?')) return
    setTabDirty(id, false)
    clearTabBrowseRestore(id)
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

  // --- Nav rail routing -------------------------------------------------------
  // Reads config fresh rather than off React state — the nav rail can be
  // clicked before the initial connections load settles, and a config read
  // is cheap and always current.
  async function resolveActiveConnection() {
    const cfg   = await window.winraid?.config.get()
    const conns = cfg?.connections ?? []
    return conns.find((c) => c.id === cfg?.activeConnectionId) ?? conns[0] ?? null
  }

  // Records `connectionId` as the switcher's default so the next per-
  // connection screen — and a fresh start — opens on it. Called only from
  // an explicit connection choice, never from incidental navigation such as
  // activating an already-open tab.
  function rememberActiveConnection(connectionId) {
    window.winraid?.config.set('activeConnectionId', connectionId)
  }

  // Opens (or activates) the Browse/Size/Backup tab for the active connection.
  async function openConnectionTab(type, options) {
    const conn = await resolveActiveConnection()
    if (conn) openTab(conn.id, type, options)
  }

  // Opens the Play wall as the current screen for the active connection,
  // becoming exclusive with whatever view or tab was showing the way any
  // other screen switch is — so onClose restores it.
  async function openPlayWall() {
    const conn = await resolveActiveConnection()
    if (!conn) return
    setConnEdit(null)
    setActiveTabId(null)
    setPlayTarget({ connectionId: conn.id, path: remoteRootOf(conn) })
  }

  // "Open folder" from the play wall's viewer: a recursive wall walks files
  // from all over the tree, so the folder a file lives in is often nowhere
  // near what the browser last showed. Opens (or activates) a browse tab
  // for the wall's connection pointed at that folder and leaves the wall —
  // the same explicit choice of connection as the Connections screen or the
  // tray flyout, so it becomes the switcher's remembered default too.
  function handlePlayOpenFolder(folderPath) {
    if (!playTarget) return
    rememberActiveConnection(playTarget.connectionId)
    openTab(playTarget.connectionId, 'browse', { path: folderPath })
  }

  // Single router for every nav rail click: global views switch activeView,
  // the per-connection screens open (or activate) that tab for the active
  // connection, and Play opens as the current screen. `options.newTab` (a
  // middle click) is passed through to the tab-backed views; a global view
  // or Play has no notion of multiple tabs, so a middle click behaves like
  // a click.
  function navigate(viewId, options) {
    if (GLOBAL_VIEWS.has(viewId)) {
      navigateView(viewId)
      return
    }
    if (viewId === 'browse' || viewId === 'size' || viewId === 'backup') {
      openConnectionTab(viewId, options)
      return
    }
    if (viewId === 'play') {
      openPlayWall()
    }
  }

  // Opening a connection's tab from the Connections screen is an explicit
  // choice of connection, so it remembers it as the default too.
  function openConnectionTabExplicit(connId, type) {
    rememberActiveConnection(connId)
    return openTab(connId, type)
  }

  // --- Tray flyout shortcuts --------------------------------------------------
  // "Browse <name>" in the tray flyout raises the main window on that
  // connection's browse tab — the same explicit choice as picking it from
  // the Connections screen, so it becomes the switcher's remembered default.
  useEffect(() => {
    return window.winraid?.tray?.onOpenConnection?.((connectionId) => {
      openConnectionTabExplicit(connectionId, 'browse')
    })
  }, [openTabs]) // eslint-disable-line react-hooks/exhaustive-deps

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
      watcherStatus, onNavigate: navigate,
      onEditConnection: openConnEdit,
      // Opening a connection from a dashboard card names that connection as
      // deliberately as choosing it on the Connections screen does, so it
      // becomes the switcher's default too.
      connections, onOpenTab: openConnectionTabExplicit,
      queuePaused, onGlobalToggle: handleGlobalToggle,
      activityEntries, onActivityNavigate: handleActivityNavigate,
    } :
    activeView === 'connections' ? {
      connections, watcherStatuses: watcherStatus,
      onEditConnection: openConnEdit, onOpenTab: openConnectionTabExplicit,
    } :
    activeView === 'queue' ? {
      connections, onNavigate: navigate,
      onNavigateLogs: handleNavigateLogs,
      onBrowsePath: (connId, remotePath, highlightFile) => {
        navigateBrowseJump(connId, remotePath, highlightFile ?? null)
      },
    } :
    activeView === 'logs' ? { logNav } :
    {}

  // The active tab's type stands in for the global view when a tab (rather
  // than a global screen) is what's showing — editor tabs read as Browse
  // since that's where they're opened from.
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null
  const navActiveView = playTarget
    ? 'play'
    : connEdit !== null
      ? null
      : activeView !== null
        ? activeView
        : activeTab
          ? (activeTab.type === 'editor' ? 'browse' : activeTab.type)
          : null

  return (
    <div className={styles.shell}>
      <TitleBar />
      <div className={styles.body}>
        <NavRail
          activeView={navActiveView}
          onNavigate={navigate}
          theme={resolvedTheme}
          onThemeToggle={toggleTheme}
          onOpenTray={window.winraid?.tray ? () => window.winraid?.tray?.openFlyout?.() : undefined}
        />
        <div className={styles.main}>
          <TabBar
            openTabs={openTabs}
            activeTabId={activeTabId}
            connections={connections}
            dirtyTabs={dirtyTabs}
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
            ) : playTarget ? (
              <PlayOverlay
                connectionId={playTarget.connectionId}
                path={playTarget.path}
                connections={connections}
                onSelectConnection={(connId) => {
                  const conn = connections.find((c) => c.id === connId)
                  if (!conn) return
                  rememberActiveConnection(connId)
                  setPlayTarget({ connectionId: connId, path: remoteRootOf(conn) })
                }}
                onClose={() => setPlayTarget(null)}
                onOpenFolder={handlePlayOpenFolder}
              />
            ) : activeTabId === null && activeView !== null && (
              <ActiveView {...activeViewProps} />
            )}

            {/* Per-connection Browse tabs (lazy-mount, keep-alive) */}
            {openTabs.filter((t) => t.type === 'browse').map((tab) => {
              const scopeKey = `browse:${tab.id}`
              return (
                <BrowseView
                  key={tab.id}
                  style={{ display: activeTabId === tab.id && connEdit === null ? '' : 'none' }}
                  browseRestore={browseRestoreByTab[tab.id] ?? null}
                  onBrowseRestoreConsumed={() => clearTabBrowseRestore(tab.id)}
                  onHistoryPush={(entry) => {
                    push(scopeKey, entry)
                    if (entry.kind === 'browse' && entry.path) {
                      const conn = connections.find((c) => c.id === tab.connId)
                      const atRoot = entry.path === remoteRootOf(conn)
                      setTabLabel(tab.id, atRoot ? null : lastPathSegment(entry.path))
                    }
                  }}
                  onBack={() => { const entry = back(scopeKey); if (entry) applyBrowseHistoryEntry(entry, tab.id) }}
                  onForward={() => { const entry = forward(scopeKey); if (entry) applyBrowseHistoryEntry(entry, tab.id) }}
                  canGoBack={canGoBack(scopeKey)}
                  canGoForward={canGoForward(scopeKey)}
                  connections={connections}
                  connectionId={tab.connId}
                  favoritesByConnection={favorites}
                  onToggleFavorite={(path) => toggleFavoriteDir(tab.connId, path)}
                  onOpenEditor={(filePath) => openEditorTab(tab.connId, filePath)}
                  onNavigateFavorite={navigateFavorite}
                  onNavigate={navigate}
                  onOpenTab={openTab}
                  onSelectConnection={(connId) => { rememberActiveConnection(connId); openTab(connId, 'browse') }}
                />
              )
            })}

            {/* Per-file editor tabs (lazy-mount, keep-alive) */}
            {openTabs.filter((t) => t.type === 'editor').map((tab) => (
              <div
                key={tab.id}
                style={{ display: activeTabId === tab.id && connEdit === null ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}
              >
                <EditorView
                  connectionId={tab.connId}
                  filePath={tab.filePath}
                  active={activeTabId === tab.id && connEdit === null}
                  onDirtyChange={(dirty) => setTabDirty(tab.id, dirty)}
                />
              </div>
            ))}

            {/* Per-connection Backup tabs (lazy-mount, keep-alive) */}
            {openTabs.filter((t) => t.type === 'backup').map((tab) => (
              <div key={tab.id} style={{ display: activeTabId === tab.id && connEdit === null ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
                <BackupView
                  connectionId={tab.connId}
                  connections={connections}
                  onSelectConnection={(connId) => { rememberActiveConnection(connId); openTab(connId, 'backup') }}
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
                    connections={connections}
                    onSelectConnection={(connId) => { rememberActiveConnection(connId); openTab(connId, 'size') }}
                    onBrowsePath={(remotePath) => {
                      navigateBrowseJump(tab.connId, remotePath)
                    }}
                  />
                </div>
              )
            })}
          </main>
        </div>
      </div>
      <StatusBar
        watcherStatus={watcherStatus}
        activeTransfers={activeTransfers}
        queueDepth={queueDepth}
        batchTotal={batchTotal}
        batchConnections={batchConnections}
        connections={connections}
        onNavigate={navigate}
      />
      <ToastHost />
    </div>
  )
}
