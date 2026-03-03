import { useState, useEffect, useRef } from 'react'
import { FolderOpen } from 'lucide-react'
import styles from './LogView.module.css'

const MAX_LIVE = 500

export default function LogView() {
  const [entries, setEntries] = useState([])
  const bottomRef    = useRef(null)
  const isNearBottom = useRef(true)

  // Load history from the log file, then subscribe to live entries
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

  // Auto-scroll when new entries arrive, only if already near the bottom
  useEffect(() => {
    if (isNearBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [entries])

  function handleScroll(e) {
    const el = e.currentTarget
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Logs</span>
        {entries.length > 0 && (
          <span className={styles.entryCount}>{entries.length} entries</span>
        )}
        <div className={styles.spacer} />
        <button
          className={styles.openBtn}
          onClick={() => window.winraid?.log.reveal()}
          title="Open log file in Explorer"
        >
          <FolderOpen size={13} />
          Open file
        </button>
        <button
          className={styles.clearBtn}
          onClick={() => setEntries([])}
          disabled={entries.length === 0}
        >
          Clear
        </button>
      </div>

      <div className={styles.log} onScroll={handleScroll}>
        {entries.length === 0 ? (
          <div className={styles.empty}>Log is empty.</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.key}
              className={`${styles.entry} ${styles[entry.level] ?? ''}`}
            >
              <span className={styles.ts}>
                {new Date(entry.ts).toLocaleTimeString([], {
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })}
              </span>
              <span className={styles.lvl}>{entry.level?.toUpperCase()}</span>
              <span className={styles.msg}>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
