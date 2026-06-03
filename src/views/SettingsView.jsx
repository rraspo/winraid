import { useState, useEffect } from 'react'
import { RefreshCw, Download, ChevronRight } from 'lucide-react'

import Tooltip from '../components/ui/Tooltip'
import Button from '../components/ui/Button'
import SegmentedControl from '../components/ui/SegmentedControl'
import { formatSize } from '../utils/format'
import { SNAPSHOT_FORMATS } from '../utils/snapshotFormats'
import { readAccordionMode, setAccordionMode } from '../utils/accordionMode'
import styles from './SettingsView.module.css'

const HINTS = {
  startWatcher: 'Begin scanning each connection’s watch folder for new or changed files. Runs in the background even when the window is hidden to the tray. On restart it automatically picks up files that appeared while stopped.',
  stopWatcher:  'Pause scanning. Already-queued transfers still complete; new files are ignored until resumed.',
}

export default function SettingsView() {
  const [watching, setWatching] = useState(false)
  const [version, setVersion] = useState('')
  const [accordionsMode, setAccordionsMode] = useState(() => readAccordionMode())
  const [updateStatus, setUpdateStatus] = useState(null) // { status, version?, percent?, error? }
  const [cacheBytes, setCacheBytes] = useState(0)
  const [clearing, setClearing] = useState(false)
  const [cacheMode,     setCacheMode]     = useState('stale')
  const [cacheMutation, setCacheMutation] = useState('update')
  const [playRecursive, setPlayRecursive] = useState(true)
  const [playShuffle,   setPlayShuffle]   = useState(true)
  const [snapshotFormat, setSnapshotFormat] = useState('jpeg')
  const [thumbSeekMode,  setThumbSeekMode]  = useState('seconds')
  const [thumbSeekValue, setThumbSeekValue] = useState(2)
  const [dirsFirst,       setDirsFirst]       = useState(true)
  const [sortPersistence, setSortPersistence] = useState('default')
  const [advancedOpen, setAdvancedOpen] = useState(
    () => localStorage.getItem('settings-advanced-open') === 'true'
  )

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
      if (browse?.cacheMode)        setCacheMode(browse.cacheMode)
      if (browse?.cacheMutation)    setCacheMutation(browse.cacheMutation)
      if (browse?.dirsFirst != null) setDirsFirst(browse.dirsFirst)
      if (browse?.sortPersistence)  setSortPersistence(browse.sortPersistence)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.winraid?.config.get('playDefaults').then((defaults) => {
      if (defaults?.recursive !== undefined) setPlayRecursive(defaults.recursive)
      if (defaults?.shuffle   !== undefined) setPlayShuffle(defaults.shuffle)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.winraid?.config.get('snapshot.format').then((fmt) => {
      if (typeof fmt === 'string' && fmt in SNAPSHOT_FORMATS) setSnapshotFormat(fmt)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.winraid?.config.get('thumbSeek').then((cfg) => {
      if (cfg?.mode)  setThumbSeekMode(cfg.mode)
      if (cfg?.value != null) setThumbSeekValue(cfg.value)
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

  async function handlePlayRecursiveChange(next) {
    setPlayRecursive(next)
    await window.winraid?.config.set('playDefaults', { recursive: next, shuffle: playShuffle })
  }

  async function handlePlayShuffleChange(next) {
    setPlayShuffle(next)
    await window.winraid?.config.set('playDefaults', { recursive: playRecursive, shuffle: next })
  }

  async function handleSnapshotFormatChange(value) {
    setSnapshotFormat(value)
    await window.winraid?.config.set('snapshot.format', value)
  }

  async function handleDirsFirstChange(next) {
    setDirsFirst(next)
    await window.winraid?.config.set('browse.dirsFirst', next)
  }

  function handleAccordionsChange(next) {
    setAccordionsMode(next)
    setAccordionMode(next)
  }

  async function handleSortPersistenceChange(value) {
    setSortPersistence(value)
    await window.winraid?.config.set('browse.sortPersistence', value)
  }

  async function handleThumbSeekChange(mode, value) {
    setThumbSeekMode(mode)
    setThumbSeekValue(value)
    await window.winraid?.config.set('thumbSeek', { mode, value })
  }

  function toggleAdvanced() {
    const next = !advancedOpen
    setAdvancedOpen(next)
    localStorage.setItem('settings-advanced-open', String(next))
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
            <SegmentedControl
              label="Connections on startup"
              value={accordionsMode}
              onChange={handleAccordionsChange}
              options={[
                { value: 'expanded',  label: 'Expanded',  desc: 'Open every connection on launch.' },
                { value: 'collapsed', label: 'Collapsed', desc: 'Start with every connection closed.' },
                { value: 'remember',  label: 'Remember',  desc: 'Restore each connection’s last open or closed state.' },
              ]}
            />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Play</div>
          <div className={styles.sectionBody}>
            <SegmentedControl
              label="Default scan depth"
              value={playRecursive}
              onChange={handlePlayRecursiveChange}
              options={[
                { value: true,  label: 'Recursive' },
                { value: false, label: 'Top level' },
              ]}
            />
            <SegmentedControl
              label="Default order"
              value={playShuffle}
              onChange={handlePlayShuffleChange}
              options={[
                { value: true,  label: 'Shuffle' },
                { value: false, label: 'In order' },
              ]}
            />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Snapshot</div>
          <div className={styles.sectionBody}>
            <SegmentedControl
              label="Video snapshot format"
              value={snapshotFormat}
              onChange={handleSnapshotFormatChange}
              options={[
                { value: 'jpeg', label: 'JPEG', desc: 'Smallest files for photo-like frames. Slight quality loss.' },
                { value: 'png',  label: 'PNG',  desc: 'Lossless. Larger files, best for screenshots and graphics.' },
                { value: 'webp', label: 'WebP', desc: 'Smaller than JPEG at similar quality. Modern format.' },
              ]}
            />
          </div>
        </section>

        <section className={styles.section}>
          <button
            type="button"
            className={styles.advancedHeader}
            aria-expanded={advancedOpen}
            onClick={toggleAdvanced}
          >
            <span>Advanced settings</span>
            <ChevronRight
              size={16}
              className={`${styles.chevron} ${advancedOpen ? styles.chevronOpen : ''}`}
            />
          </button>
          {advancedOpen && (
            <div className={styles.advancedBody}>
              <div className={styles.subGroup}>
                <div className={styles.subGroupHeader}>Browse</div>
                <div className={styles.subGroupBody}>
                  <SegmentedControl
                    label="Directory cache"
                    value={cacheMode}
                    onChange={handleCacheModeChange}
                    options={[
                      { value: 'stale', label: 'Stale while revalidate', desc: 'Show cached entries immediately, then refresh in background.' },
                      { value: 'tree',  label: 'Full tree on connect',   desc: 'Fetch entire directory tree via SSH on connection, navigate from cache. SFTP only.' },
                      { value: 'none',  label: 'Always fetch',           desc: 'No cache — always fetch fresh directory listings.' },
                    ]}
                  />
                  <SegmentedControl
                    label="On folder mutation"
                    value={cacheMutation}
                    onChange={handleCacheMutationChange}
                    options={[
                      { value: 'update',  label: 'Update in place', desc: 'Directly splice entries on create, delete, and move — no re-fetch.' },
                      { value: 'refetch', label: 'Re-fetch',        desc: 'Always reload the directory listing after any change.' },
                    ]}
                  />
                  <div className={styles.stackedField}>
                    <span className={styles.stackedLabel}>Video thumbnail position</span>
                    <div className={styles.thumbSeekRow}>
                      <input
                        type="number"
                        min={0}
                        step={thumbSeekMode === 'percent' ? 1 : 0.5}
                        max={thumbSeekMode === 'percent' ? 100 : undefined}
                        className={styles.thumbSeekInput}
                        value={thumbSeekValue}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v) && v >= 0) handleThumbSeekChange(thumbSeekMode, v)
                        }}
                      />
                      <div className={styles.thumbSeekToggle}>
                        <button
                          type="button"
                          className={[styles.thumbSeekBtn, thumbSeekMode === 'seconds' ? styles.thumbSeekBtnActive : ''].join(' ')}
                          onClick={() => handleThumbSeekChange('seconds', thumbSeekValue)}
                        >s</button>
                        <button
                          type="button"
                          className={[styles.thumbSeekBtn, thumbSeekMode === 'percent' ? styles.thumbSeekBtnActive : ''].join(' ')}
                          onClick={() => handleThumbSeekChange('percent', thumbSeekValue)}
                        >%</button>
                      </div>
                    </div>
                  </div>
                  <SegmentedControl
                    label="Folder order"
                    value={dirsFirst}
                    onChange={handleDirsFirstChange}
                    options={[
                      { value: true,  label: 'Dirs first' },
                      { value: false, label: 'Files first' },
                    ]}
                  />
                  <SegmentedControl
                    label="Sort persistence"
                    value={sortPersistence}
                    onChange={handleSortPersistenceChange}
                    options={[
                      { value: 'default',  label: 'Default only', desc: 'All folders use the same sort. Changing sort applies everywhere.' },
                      { value: 'folder',   label: 'Per folder',   desc: 'Each folder remembers its own sort independently.' },
                      { value: 'siblings', label: 'Per siblings', desc: 'Changing sort in a folder applies to all siblings under the same parent.' },
                    ]}
                  />
                </div>
              </div>

              <div className={styles.subGroup}>
                <div className={styles.subGroupHeader}>Storage</div>
                <div className={styles.subGroupBody}>
                  <div className={styles.cacheRow}>
                    <span className={styles.cacheSize}>{formatSize(cacheBytes)}</span>
                    <Button size="sm" variant="ghost" onClick={handleClearCache} disabled={clearing}>
                      {clearing ? 'Clearing...' : 'Clear cache'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
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
                <Button size="sm" variant="ghost" onClick={() => window.winraid?.whatsNew?.open()}>
                  What’s new
                </Button>
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
