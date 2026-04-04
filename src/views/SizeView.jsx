import { useState, useEffect, useRef } from 'react'
import { HardDrive, FolderOpen } from 'lucide-react'
import SizeSunburst, { PALETTE } from '../components/size/SizeSunburst'
import { formatSize } from '../utils/format'
import styles from './SizeView.module.css'

const PHASE = { IDLE: 'idle', SCANNING: 'scanning', RESULTS: 'results' }

export default function SizeView({ connectionId, connection, onBrowsePath }) {
  const [phase,      setPhase]      = useState(PHASE.IDLE)
  const [tree,       setTree]       = useState(null)
  const [focused,    setFocused]    = useState(null)
  const [progress,   setProgress]   = useState(null)
  const [scanMeta,   setScanMeta]   = useState(null)
  const [elapsed,    setElapsed]    = useState(0)
  const [scanError,  setScanError]  = useState(null)
  const [chartSize,  setChartSize]  = useState(300)
  const treeRef            = useRef(null)
  const timerRef           = useRef(null)
  const progressDeadlineRef = useRef(null)
  const chartAreaRef       = useRef(null)

  // Reset state and load cache when connection changes
  useEffect(() => {
    setPhase(PHASE.IDLE)
    setTree(null)
    setFocused(null)
    setProgress(null)
    setScanMeta(null)
    setElapsed(0)
    treeRef.current = null

    window.winraid?.remote.sizeLoadCache?.(connectionId).then((cached) => {
      if (!cached) return
      treeRef.current = cached.tree
      setTree(cached.tree)
      setScanMeta(cached.scanMeta)
      setPhase(PHASE.RESULTS)
    }).catch(() => {})
  }, [connectionId])

  // Clear the elapsed timer and progress deadline on unmount
  useEffect(() => () => {
    clearInterval(timerRef.current)
    clearTimeout(progressDeadlineRef.current)
  }, [])

  // Measure chartArea and keep sunburst sized to fill it.
  // Must re-run when phase changes to RESULTS because chartArea only
  // mounts in that phase — on initial render it doesn't exist yet.
  useEffect(() => {
    const el = chartAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setChartSize(Math.max(120, Math.min(width, height)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase])

  // Subscribe to IPC push events
  useEffect(() => {
    if (!window.winraid) return

    const unsubs = [
      window.winraid.remote.onSizeProgress((payload) => {
        if (payload.connectionId !== connectionId) return
        setProgress({ path: payload.path, count: payload.count, elapsedMs: payload.elapsedMs })
        clearTimeout(progressDeadlineRef.current)
        progressDeadlineRef.current = setTimeout(() => {
          clearInterval(timerRef.current)
          setPhase(PHASE.IDLE)
          setScanError('Scan timed out — no progress for 30 seconds')
        }, 30000)
      }),

      window.winraid.remote.onSizeLevel((payload) => {
        if (payload.connectionId !== connectionId) return
        if (!treeRef.current) {
          treeRef.current = {
            name: payload.parentPath.split('/').pop() || payload.parentPath,
            path: payload.parentPath,
            sizeKb: 0,
            children: [],
          }
        }
        const parent = findNodeByPath(treeRef.current, payload.parentPath)
        if (parent) {
          for (const entry of payload.entries) {
            if (!parent.children.find((c) => c.path === entry.path)) {
              parent.children.push({ ...entry, children: [] })
            }
          }
          const childSum = parent.children.reduce((s, c) => s + c.sizeKb, 0)
          if (childSum > parent.sizeKb) parent.sizeKb = childSum
          if (parent === treeRef.current) treeRef.current.sizeKb = childSum
        }
        setTree({ ...treeRef.current })
      }),

      window.winraid.remote.onSizeDone((payload) => {
        if (payload.connectionId !== connectionId) return
        clearTimeout(progressDeadlineRef.current)
        clearInterval(timerRef.current)
        const meta = { totalFolders: payload.totalFolders, elapsedMs: payload.elapsedMs, scannedAt: Date.now() }
        setScanMeta(meta)
        setPhase(PHASE.RESULTS)
        window.winraid.remote.sizeSaveCache?.(connectionId, { tree: treeRef.current, scanMeta: meta })
      }),

      window.winraid.remote.onSizeError((payload) => {
        if (payload.connectionId !== connectionId) return
        clearTimeout(progressDeadlineRef.current)
        clearInterval(timerRef.current)
        setScanError(payload.error ?? 'Scan failed')
        setPhase(PHASE.IDLE)
      }),
    ]

    return () => unsubs.forEach((u) => u())
  }, [connectionId])

  function startScan() {
    setScanError(null)
    treeRef.current = null
    setTree(null)
    setFocused(null)
    setProgress(null)
    setElapsed(0)
    setPhase(PHASE.SCANNING)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    clearTimeout(progressDeadlineRef.current)
    progressDeadlineRef.current = setTimeout(() => {
      clearInterval(timerRef.current)
      setPhase(PHASE.IDLE)
      setScanError('Scan timed out — no progress for 30 seconds')
    }, 30000)
    window.winraid?.remote.sizeScan?.(connectionId).catch(() => {
      clearInterval(timerRef.current)
      clearTimeout(progressDeadlineRef.current)
      setScanError('Failed to start scan')
      setPhase(PHASE.IDLE)
    })
  }

  function cancelScan() {
    window.winraid?.remote.sizeCancel?.(connectionId)
    clearTimeout(progressDeadlineRef.current)
    clearInterval(timerRef.current)
    setPhase(PHASE.IDLE)
  }

  function handleArcClick(nodeData) {
    if (!nodeData.children?.length) return
    setFocused(nodeData.path === focused ? null : nodeData.path)
  }

  function handleCenterClick() {
    if (!focused) return
    const parts = focused.split('/')
    const parent = parts.slice(0, -1).join('/') || null
    const rootPath = treeRef.current?.path
    setFocused(parent === rootPath ? null : parent)
  }

  const breadcrumb = buildBreadcrumb(tree?.path, focused)

  const lastScanLabel = scanMeta
    ? `Last scan: ${formatElapsed(Date.now() - scanMeta.scannedAt)} ago (${scanMeta.totalFolders} folders)`
    : 'Last scan: never'

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (phase === PHASE.IDLE) {
    return (
      <div className={styles.root}>
        <div className={styles.idleCard}>
          <div className={styles.idleIcon}>
            <HardDrive size={28} strokeWidth={1.5} />
          </div>
          <div className={styles.idleHeading}>Scan storage usage</div>
          <p className={styles.idleHint}>
            Recursively measures every folder on this connection.
            May take several minutes on large drives.
          </p>
          {scanError && (
            <p className={styles.errorBanner}>{scanError}</p>
          )}
          <button className={styles.scanBtn} onClick={startScan}>
            Scan Now
          </button>
          <span className={styles.lastScan}>{lastScanLabel}</span>
        </div>
      </div>
    )
  }

  // ── Scanning ──────────────────────────────────────────────────────────────
  if (phase === PHASE.SCANNING) {
    return (
      <div className={styles.root}>
        <div className={styles.scanningCard}>
          <div className={styles.spinnerRings}>
            <div className={`${styles.ring} ${styles.ring1}`} />
            <div className={`${styles.ring} ${styles.ring2}`} />
            <div className={`${styles.ring} ${styles.ring3}`} />
          </div>
          <div className={styles.scanningLabel}>Scanning…</div>
          {progress && (
            <div className={styles.scanningPath}>{progress.path}</div>
          )}
          <div className={styles.scanningStats}>
            {(progress?.count ?? 0).toLocaleString()} folders counted · {formatElapsed(elapsed * 1000)}
          </div>
          <button className={styles.cancelBtn} onClick={cancelScan}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Results ───────────────────────────────────────────────────────────────
  const rootPath = tree?.path ?? connection?.sftp?.remotePath ?? '/'
  const legendNode = focused ? (findNodeByPath(tree, focused) ?? tree) : tree
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.breadcrumb}>
          <button className={styles.crumb} onClick={() => setFocused(null)}>
            {rootPath}
          </button>
          {breadcrumb.map((crumb) => (
            <span key={crumb.path}>
              <span className={styles.crumbSep}>/</span>
              <button
                className={[styles.crumb, crumb.path === focused ? styles.crumbActive : ''].filter(Boolean).join(' ')}
                onClick={() => setFocused(crumb.path)}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
        {scanMeta && (() => {
          const ageMs = Date.now() - scanMeta.scannedAt
          const stale = ageMs > 60 * 60 * 1000        // > 1 hour
          const old   = ageMs > 24 * 60 * 60 * 1000  // > 24 hours
          if (!stale) return null
          return (
            <span className={old ? styles.staleBadgeOld : styles.staleBadge}>
              {old ? 'Outdated' : 'Stale'} · {formatElapsed(ageMs)} ago
            </span>
          )
        })()}
        <button className={styles.rescanBtn} onClick={startScan}>Re-scan</button>
      </div>

      <div className={styles.chartArea} ref={chartAreaRef}>
        {tree && (
          <div className={styles.sunburstWrap}>
            <SizeSunburst
              data={tree}
              width={chartSize}
              height={chartSize}
              focusedPath={focused}
              onArcClick={handleArcClick}
              onCenterClick={handleCenterClick}
            />
          </div>
        )}
        {tree && (
          <div className={styles.legend}>
            {focused && (() => {
              const parentPath = focused.split('/').slice(0, -1).join('/') || tree.path
              const parentName = parentPath.split('/').pop() || parentPath
              return (
                <div className={styles.legendParentRow} onClick={handleCenterClick}>
                  <span className={styles.legendParentLabel}>../</span>
                  <span className={styles.legendParentName}>{parentName}</span>
                  {onBrowsePath && (
                    <button
                      className={styles.browseBtn}
                      title="Browse folder"
                      onClick={(e) => { e.stopPropagation(); onBrowsePath(parentPath) }}
                    >
                      <FolderOpen size={11} />
                    </button>
                  )}
                </div>
              )
            })()}
            {(legendNode?.children ?? []).slice(0, 8).map((child, i) => {
              const drillable = (child.children?.length ?? 0) > 0
              return (
                <div
                  key={child.path}
                  className={[styles.legendRow, drillable ? styles.legendRowDrillable : ''].filter(Boolean).join(' ')}
                  onClick={() => drillable && setFocused(child.path)}
                >
                  <span className={styles.legendSwatch} style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className={styles.legendName}>{child.name}</span>
                  {onBrowsePath && (
                    <button
                      className={styles.browseBtn}
                      title="Browse folder"
                      onClick={(e) => { e.stopPropagation(); onBrowsePath(child.path) }}
                    >
                      <FolderOpen size={11} />
                    </button>
                  )}
                  <span className={styles.legendSize}>{formatSize(child.sizeKb * 1024)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {scanMeta && (
        <div className={styles.footer}>
          scanned {scanMeta.totalFolders} folders · {formatElapsed(Date.now() - scanMeta.scannedAt)} ago
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNodeByPath(node, path) {
  if (node.path === path) return node
  for (const c of node.children ?? []) {
    const found = findNodeByPath(c, path)
    if (found) return found
  }
  return null
}

function buildBreadcrumb(rootPath, focusedPath) {
  if (!focusedPath || !rootPath || focusedPath === rootPath) return []
  const rel = focusedPath.startsWith(rootPath + '/')
    ? focusedPath.slice(rootPath.length + 1)
    : focusedPath
  const parts = rel.split('/').filter(Boolean)
  const crumbs = []
  let current = rootPath
  for (const part of parts) {
    current = `${current}/${part}`
    crumbs.push({ name: part, path: current })
  }
  return crumbs
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60)  return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
