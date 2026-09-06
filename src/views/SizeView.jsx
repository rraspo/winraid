import { useState, useEffect, useRef } from 'react'
import { HardDrive, FolderOpen } from 'lucide-react'
import SizeSunburst, { PALETTE } from '../components/size/SizeSunburst'
import ConnectionPicker from '../components/ConnectionPicker'
import Tooltip from '../components/ui/Tooltip'
import { formatSize } from '../utils/format'
import { findNodeByPath, upsertLevel } from '../utils/sizeTree'
import styles from './SizeView.module.css'

const PHASE = { IDLE: 'idle', SCANNING: 'scanning', RESULTS: 'results' }

export default function SizeView({ connectionId, connection, connections, onSelectConnection, onBrowsePath }) {
  const [phase,      setPhase]      = useState(PHASE.IDLE)
  const [tree,       setTree]       = useState(null)
  const [focused,    setFocused]    = useState(null)
  const [progress,   setProgress]   = useState(null)
  const [scanMeta,   setScanMeta]   = useState(null)
  const [elapsed,    setElapsed]    = useState(0)
  const [scanError,  setScanError]  = useState(null)
  const [chartSize,  setChartSize]  = useState(300)
  const [legendExpanded, setLegendExpanded] = useState(false)
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
  // Must re-run once the chart card mounts (results phase with a tree) —
  // on initial render, and while the tree is still empty, it doesn't exist yet.
  const hasTree = Boolean(tree)
  useEffect(() => {
    const el = chartAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setChartSize(Math.max(120, Math.min(width, height)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase, hasTree])

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
        upsertLevel(treeRef.current, payload.parentPath, payload.entries)
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
    // If children are already loaded, just focus.
    if (nodeData.children?.length) {
      setFocused(nodeData.path === focused ? null : nodeData.path)
      return
    }
    // Drill on demand — the initial scan only walks MAX_DEPTH levels;
    // beyond that, leaves have no children scanned. Kick off a subtree
    // scan and focus pre-emptively so the user sees the new arcs appear
    // as size:level events arrive.
    if (nodeData.path && window.winraid?.remote.sizeScanSubtree) {
      window.winraid.remote.sizeScanSubtree(connectionId, nodeData.path)
      setFocused(nodeData.path)
    }
  }

  function handleCenterClick() {
    if (!focused) return
    const parts = focused.split('/')
    const parent = parts.slice(0, -1).join('/') || null
    const rootPath = treeRef.current?.path
    setFocused(parent === rootPath ? null : parent)
  }

  const rootPath = tree?.path
    ?? connection?.sftp?.remotePath
    ?? connection?.smb?.remotePath
    ?? '/'

  const lastScanLabel = scanMeta
    ? `Last scan: ${formatElapsed(Date.now() - scanMeta.scannedAt)} ago (${scanMeta.totalFolders} folders)`
    : 'Last scan: never'

  const legendNode = focused ? (findNodeByPath(tree, focused) ?? tree) : tree

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Size map</h1>
            {connections && (
              <ConnectionPicker
                connections={connections}
                connectionId={connectionId}
                onSelect={onSelectConnection}
              />
            )}
          </div>
          <p className={styles.subtitle}>
            Where the space on {rootPath} goes — click a slice to inspect it · {lastScanLabel}
          </p>
        </div>
        {phase === PHASE.SCANNING ? (
          <button className={[styles.headerButton, styles.headerButtonDanger].join(' ')} onClick={cancelScan}>
            Cancel
          </button>
        ) : (
          <button className={styles.headerButton} onClick={startScan}>
            {phase === PHASE.RESULTS ? 'Re-scan' : 'Scan Now'}
          </button>
        )}
      </div>

      {/* ── Idle ────────────────────────────────────────────────────────── */}
      {phase === PHASE.IDLE && (
        <div className={styles.centeredBody}>
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
          </div>
        </div>
      )}

      {/* ── Scanning ────────────────────────────────────────────────────── */}
      {phase === PHASE.SCANNING && (
        <div className={styles.centeredBody}>
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
          </div>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {phase === PHASE.RESULTS && tree && (
        <div className={styles.resultsBody}>
          <section aria-label="Size chart" className={styles.chartCard}>
            <div className={styles.chartArea} ref={chartAreaRef}>
              <SizeSunburst
                data={tree}
                width={chartSize}
                height={chartSize}
                focusedPath={focused}
                onArcClick={handleArcClick}
                onCenterClick={handleCenterClick}
              />
            </div>
          </section>

          <section aria-label="Folders" className={styles.foldersCard}>
            <div className={styles.rows}>
              {focused && (() => {
                const parentPath = focused.split('/').slice(0, -1).join('/') || tree.path
                const parentName = parentPath.split('/').pop() || parentPath
                return (
                  <div className={styles.parentRow} onClick={handleCenterClick}>
                    <span className={styles.parentLabel}>../</span>
                    <span className={styles.parentName}>{parentName}</span>
                    {onBrowsePath && (
                      <Tooltip tip="Open in browser" side="top">
                        <button
                          className={styles.browseBtn}
                          aria-label="Open in browser"
                          onClick={(e) => { e.stopPropagation(); onBrowsePath(parentPath) }}
                        >
                          <FolderOpen size={13} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                )
              })()}
              {(() => {
                // Sort the rows by size descending so the biggest items are
                // shown first — matches the sunburst's own sort order
                // (SizeSunburst calls .sort((a,b) => b.value - a.value)).
                const all = (legendNode?.children ?? []).slice().sort((a, b) => b.sizeKb - a.sizeKb)
                const parentTotal = legendNode?.sizeKb ?? 0
                const TRUNCATE = 8
                const visible = legendExpanded ? all : all.slice(0, TRUNCATE)
                const remaining = all.length - TRUNCATE
                return (
                  <>
                    {visible.map((child, i) => {
                      const pct = parentTotal > 0 ? Math.round((child.sizeKb / parentTotal) * 100) : 0
                      const color = PALETTE[i % PALETTE.length]
                      return (
                        <div key={child.path} className={styles.row} onClick={() => handleArcClick(child)}>
                          <span className={styles.swatch} style={{ background: color }} />
                          <span className={styles.name}>{child.name}</span>
                          <span className={styles.barTrack}>
                            <span className={styles.barFill} style={{ width: `${pct}%`, background: color }} />
                          </span>
                          <span className={styles.size}>{formatSize(child.sizeKb * 1024)}</span>
                          <span className={styles.pct}>{pct}%</span>
                          {onBrowsePath && (
                            <Tooltip tip="Open in browser" side="top">
                              <button
                                className={styles.browseBtn}
                                aria-label="Open in browser"
                                onClick={(e) => { e.stopPropagation(); onBrowsePath(child.path) }}
                              >
                                <FolderOpen size={13} />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      )
                    })}
                    {remaining > 0 && (
                      <button
                        type="button"
                        className={styles.more}
                        onClick={() => setLegendExpanded((v) => !v)}
                      >
                        {legendExpanded ? 'Show less' : `+${remaining} more`}
                      </button>
                    )}
                  </>
                )
              })()}
            </div>
            <p className={styles.hint}>
              Click a slice or row to jump to that folder in the browser and deal with it.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60)  return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
