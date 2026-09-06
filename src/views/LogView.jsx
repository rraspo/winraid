import { useState, useEffect, useRef, useMemo } from 'react'
import { FolderOpen, Search, Trash2 } from 'lucide-react'
import Tooltip from '../components/ui/Tooltip'
import styles from './LogView.module.css'

const MAX_LIVE = 500

export default function LogView({ logNav = null }) {
  const [entries, setEntries] = useState([])
  const bottomRef    = useRef(null)
  const isNearBottom = useRef(true)
  const [confirmClear, setConfirmClear] = useState(false)
  const clearTimer = useRef(null)
  const [filter, setFilter] = useState('')
  const [logPath, setLogPath] = useState('')

  // Pre-fill filter when navigated from queue error
  useEffect(() => {
    if (logNav?.filename) setFilter(logNav.filename)
  }, [logNav])

  // Resolve the current log file's path for the "<name> · tailing" marker
  useEffect(() => {
    window.winraid?.log.getPath?.()?.then((path) => {
      if (path) setLogPath(path)
    })
  }, [])

  // Load history then subscribe to live entries
  useEffect(() => {
    window.winraid?.log.tail(MAX_LIVE).then((lines) => {
      if (lines?.length) setEntries(lines)
    })

    return window.winraid?.log.onEntry((entry) => {
      setEntries((prev) => {
        const next = [...prev, { ...entry, key: `${entry.ts}-${Math.random()}` }]
        return next.length > MAX_LIVE ? next.slice(next.length - MAX_LIVE) : next
      })
    })
  }, [])

  const logFileName = useMemo(() => logPath.split(/[\\/]/).pop() ?? '', [logPath])

  // Auto-scroll when new entries arrive, only if near bottom and no filter active
  useEffect(() => {
    if (isNearBottom.current && !filter) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [entries, filter])

  function handleScroll(e) {
    const el = e.currentTarget
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  const filtered = useMemo(() => {
    if (!filter) return entries
    const lower = filter.toLowerCase()
    return entries.filter((e) => e.message.toLowerCase().includes(lower))
  }, [entries, filter])

  // Find the ts of the entry nearest to logNav.errorAt within filtered entries
  const highlightTs = useMemo(() => {
    if (!logNav?.errorAt || filtered.length === 0) return null
    return filtered.reduce((best, e) =>
      Math.abs(e.ts - logNav.errorAt) < Math.abs(best.ts - logNav.errorAt) ? e : best
    ).ts
  }, [logNav, filtered])

  // Scroll highlighted entry into view after render
  useEffect(() => {
    if (!highlightTs) return
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-ts="${highlightTs}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => cancelAnimationFrame(raf)
  }, [highlightTs])

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Logs</h1>
        <div className={styles.searchWrap}>
          <Search size={12} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Filter logs…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className={styles.spacer} />
        <Tooltip tip="Open log file in Explorer" side="bottom">
          <button
            className={styles.iconBtn}
            onClick={() => window.winraid?.log.reveal()}
          >
            <FolderOpen size={13} />
            Open file
          </button>
        </Tooltip>
        <button
          className={`${styles.iconBtn} ${confirmClear ? styles.clearConfirm : ''}`}
          onClick={() => {
            if (confirmClear) {
              setEntries([])
              window.winraid?.log.clear()
              setConfirmClear(false)
              clearTimeout(clearTimer.current)
            } else {
              setConfirmClear(true)
              clearTimer.current = setTimeout(() => setConfirmClear(false), 3000)
            }
          }}
          disabled={entries.length === 0}
        >
          <Trash2 size={13} />
          {confirmClear ? 'Clear file?' : 'Clear'}
        </button>
        {logFileName && (
          <span className={styles.tailMarker}>{logFileName} · tailing</span>
        )}
      </div>

      <div className={styles.logCard}>
        <div className={styles.log} onScroll={handleScroll}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {filter ? 'No entries match filter.' : 'Log is empty.'}
            </div>
          ) : (
            <ol className={styles.entries} aria-label="Log entries">
              {filtered.map((entry) => {
                const isHighlighted = entry.ts === highlightTs
                return (
                  <li
                    key={entry.key ?? entry.ts}
                    data-ts={entry.ts}
                    data-level={entry.level}
                    className={[
                      styles.entry,
                      isHighlighted ? styles.highlighted : '',
                      isHighlighted ? 'shimmer shimmer-border shimmer-once' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className={styles.ts}>
                      {new Date(entry.ts).toLocaleTimeString([], {
                        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                      })}
                    </span>
                    <span className={styles.lvl}>{entry.level?.toUpperCase()}</span>
                    <span className={styles.msg}>{entry.message}</span>
                  </li>
                )
              })}
            </ol>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
