import { useState, useEffect } from 'react'
import { RefreshCw, Download } from 'lucide-react'

import Tooltip from '../components/ui/Tooltip'
import Button from '../components/ui/Button'
import { formatSize } from '../utils/format'
import styles from './SettingsView.module.css'

const HINTS = {
  startWatcher:  'Begin scanning the watch folder for new files. Runs in the background even when the window is hidden to the tray.',
  stopWatcher:   'Pause scanning. Already-queued transfers still complete; new files are ignored until resumed.',
}

export default function SettingsView() {
  const [watching, setWatching] = useState(false)
  const [version, setVersion] = useState('')
  const [accordionsOpen, setAccordionsOpen] = useState(
    () => localStorage.getItem('sidebar-accordions-default-open') !== 'false'
  )
  const [updateStatus, setUpdateStatus] = useState(null) // { status, version?, percent?, error? }
  const [cacheBytes, setCacheBytes] = useState(0)
  const [clearing, setClearing] = useState(false)
  const [cacheMode,     setCacheMode]     = useState('stale')
  const [cacheMutation, setCacheMutation] = useState('update')
  const [playRecursive, setPlayRecursive] = useState(true)
  const [playShuffle,   setPlayShuffle]   = useState(true)

  useEffect(() => {
    window.winraid?.getVersion().then(setVersion).catch(() => {})
  }, [])

  useEffect(() => {
    window.winraid?.cache.thumbSize().then((res) => setCacheBytes(res.bytes)).catch(() => {})
  }, [])

  // Listen for update status events from the main process
  useEffect(() => {
    const unsub = window.winraid?.update?.onStatus((payload) => {
      setUpdateStatus(payload)
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    window.winraid?.config.get('browse').then((browse) => {
      if (browse?.cacheMode)     setCacheMode(browse.cacheMode)
      if (browse?.cacheMutation) setCacheMutation(browse.cacheMutation)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.winraid?.config.get('playDefaults').then((defaults) => {
      if (defaults?.recursive !== undefined) setPlayRecursive(defaults.recursive)
      if (defaults?.shuffle   !== undefined) setPlayShuffle(defaults.shuffle)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    // s is Record<connectionId, { watching, folder, state, file }>
    const unsub = window.winraid?.watcher.onStatus((s) => {
      setWatching(Object.values(s).some((v) => v.watching))
    })
    return () => unsub?.()
  }, [])

  async function handleClearCache() {
    setClearing(true)
    await window.winraid?.cache.clearThumbs()
    const res = await window.winraid?.cache.thumbSize().catch(() => ({ bytes: 0 }))
    setCacheBytes(res?.bytes ?? 0)
    setClearing(false)
  }

  async function handleWatcherToggle() {
    if (watching) {
      await window.winraid?.watcher.pauseAll()
    } else {
      const cfg = await window.winraid?.config.get()
      const conns = cfg?.connections ?? []
      const watchable = conns.filter((c) => c.localFolder)
      if (watchable.length === 0) return
      // Start watchers for all connections with a localFolder
      for (const conn of watchable) {
        await window.winraid?.watcher.start(conn.id)
      }
    }
  }

  async function handleCheckUpdate() {
    setUpdateStatus({ status: 'checking' })
    const result = await window.winraid?.update?.check()
    if (result && !result.ok) {
      setUpdateStatus({ status: 'error', error: result.error })
    }
  }

  function handleInstall() {
    window.winraid?.update?.install()
  }

  async function handleCacheModeChange(value) {
    setCacheMode(value)
    await window.winraid?.config.set('browse.cacheMode', value)
  }

  async function handleCacheMutationChange(value) {
    setCacheMutation(value)
    await window.winraid?.config.set('browse.cacheMutation', value)
  }

  async function handlePlayRecursiveChange() {
    const next = !playRecursive
    setPlayRecursive(next)
    await window.winraid?.config.set('playDefaults', { recursive: next, shuffle: playShuffle })
  }

  async function handlePlayShuffleChange() {
    const next = !playShuffle
    setPlayShuffle(next)
    await window.winraid?.config.set('playDefaults', { recursive: playRecursive, shuffle: next })
  }

  const status = updateStatus?.status
  const isChecking    = status === 'checking'
  const isDownloading = status === 'downloading'
  const isReady       = status === 'ready'
  const isUpToDate    = status === 'up-to-date'
  const isError       = status === 'error'
  const isBusy        = isChecking || isDownloading

  function renderUpdateInfo() {
    if (!updateStatus) return null
    if (isChecking)    return <span className={styles.updateMsg}>Checking for updates...</span>
    if (isDownloading) return <span className={styles.updateMsg}>Downloading update... {updateStatus.percent ?? 0}%</span>
    if (isReady)       return <span className={`${styles.updateMsg} ${styles.updateReady}`}>v{updateStatus.version} ready to install</span>
    if (isUpToDate)    return <span className={`${styles.updateMsg} ${styles.updateOk}`}>Up to date</span>
    if (isError)       return <span className={`${styles.updateMsg} ${styles.updateError}`}>{updateStatus.error}</span>
    if (status === 'available') return <span className={styles.updateMsg}>Downloading v{updateStatus.version}...</span>
    return null
  }

  return (
    <div className={styles.container}>
      <div className={styles.scrollBody}>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Interface</div>
          <div className={styles.sectionBody}>
            <div className={styles.field}>
              <span className={styles.label}>Expand connections by default</span>
              <div
                role="switch"
                aria-checked={accordionsOpen}
                className={[styles.switch, accordionsOpen ? styles.switchOn : ''].filter(Boolean).join(' ')}
                onClick={() => {
                  const next = !accordionsOpen
                  setAccordionsOpen(next)
                  localStorage.setItem('sidebar-accordions-default-open', String(next))
                }}
              />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Scanner</div>
          <div className={styles.sectionBody}>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', margin: 0 }}>
              The scanner watches each connection's local folder and queues new or changed files for transfer.
              On restart it automatically picks up files that appeared while stopped.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Browse</div>
          <div className={styles.sectionBody}>
            <div className={styles.radioGroup}>
              <div className={styles.radioGroupLabel}>Directory cache</div>
              {[
                { value: 'stale', label: 'Stale while revalidate', desc: 'Show cached entries immediately, then refresh in background.' },
                { value: 'tree',  label: 'Full tree on connect',   desc: 'Fetch entire directory tree via SSH on connection, navigate from cache. SFTP only.' },
                { value: 'none',  label: 'Always fetch',           desc: 'No cache — always fetch fresh directory listings.' },
              ].map(({ value, label, desc }) => (
                <label key={value} className={styles.radioOption}>
                  <input
                    type="radio"
                    name="cacheMode"
                    value={value}
                    checked={cacheMode === value}
                    onChange={() => handleCacheModeChange(value)}
                  />
                  <span className={styles.radioOptionText}>
                    <span className={styles.radioOptionLabel}>{label}</span>
                    <span className={styles.radioOptionDesc}>{desc}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className={styles.radioGroup}>
              <div className={styles.radioGroupLabel}>On folder mutation</div>
              {[
                { value: 'update',  label: 'Update in place', desc: 'Directly splice entries on create, delete, and move — no re-fetch.' },
                { value: 'refetch', label: 'Re-fetch',        desc: 'Always reload the directory listing after any change.' },
              ].map(({ value, label, desc }) => (
                <label key={value} className={styles.radioOption}>
                  <input
                    type="radio"
                    name="cacheMutation"
                    value={value}
                    checked={cacheMutation === value}
                    onChange={() => handleCacheMutationChange(value)}
                  />
                  <span className={styles.radioOptionText}>
                    <span className={styles.radioOptionLabel}>{label}</span>
                    <span className={styles.radioOptionDesc}>{desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Play</div>
          <div className={styles.sectionBody}>
            <div className={styles.field}>
              <span className={styles.label}>Default to recursive scan</span>
              <div
                role="switch"
                aria-checked={playRecursive}
                aria-label="Default to recursive scan"
                className={[styles.switch, playRecursive ? styles.switchOn : ''].filter(Boolean).join(' ')}
                onClick={handlePlayRecursiveChange}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Default to shuffle</span>
              <div
                role="switch"
                aria-checked={playShuffle}
                aria-label="Default to shuffle"
                className={[styles.switch, playShuffle ? styles.switchOn : ''].filter(Boolean).join(' ')}
                onClick={handlePlayShuffleChange}
              />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Thumbnail cache</div>
          <div className={styles.sectionBody}>
            <div className={styles.cacheRow}>
              <span className={styles.cacheSize}>{formatSize(cacheBytes)}</span>
              <Button size="sm" variant="ghost" onClick={handleClearCache} disabled={clearing}>
                {clearing ? 'Clearing...' : 'Clear cache'}
              </Button>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>About</div>
          <div className={styles.sectionBody}>
            <div className={styles.aboutRow}>
              <div className={styles.aboutVersion}>
                <span className={styles.aboutLabel}>WinRaid</span>
                {version && <span className={styles.aboutTag}>v{version}</span>}
              </div>
              <div className={styles.aboutActions}>
                {isReady ? (
                  <Button size="sm" onClick={handleInstall}>
                    <Download size={14} strokeWidth={1.75} />
                    Install & restart
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={handleCheckUpdate} disabled={isBusy}>
                    <RefreshCw size={14} strokeWidth={1.75} className={isChecking ? styles.spinning : undefined} />
                    {isBusy ? 'Checking...' : 'Check for updates'}
                  </Button>
                )}
              </div>
            </div>
            {renderUpdateInfo()}
          </div>
        </section>

      </div>

      <div className={styles.footer}>
        <Tooltip tip={watching ? HINTS.stopWatcher : HINTS.startWatcher} side="left">
          <Button variant={watching ? 'danger' : 'secondary'} onClick={handleWatcherToggle}>
            {watching ? 'Stop scanner' : 'Start scanner'}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
