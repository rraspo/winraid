import { useState, useEffect } from 'react'
import { RefreshCw, Download, Check } from 'lucide-react'

import Tooltip from '../components/ui/Tooltip'
import Button from '../components/ui/Button'
import SegmentedControl from '../components/ui/SegmentedControl'
import { formatSize } from '../utils/format'
import { SNAPSHOT_FORMATS } from '../utils/snapshotFormats'
import { ACCENT_PALETTE, normalizeAppearance, resolveAccentHex } from '../utils/accent'
import styles from './SettingsView.module.css'

const HINTS = {
  startWatcher: 'Begin scanning each connection’s watch folder for new or changed files. Runs in the background even when the window is hidden to the tray. On restart it automatically picks up files that appeared while stopped.',
  stopWatcher:  'Pause scanning. Already-queued transfers still complete; new files are ignored until resumed.',
}

const DIRECTORY_CACHE_OPTIONS = [
  { value: 'stale', label: 'Stale while revalidate', desc: 'Show cached entries immediately, then refresh in background.' },
  { value: 'tree',  label: 'Full tree on connect',   desc: 'Fetch entire directory tree via SSH on connection, navigate from cache. SFTP only.' },
  { value: 'none',  label: 'Always fetch',           desc: 'No cache — always fetch fresh directory listings.' },
]

export default function SettingsView() {
  const [watching, setWatching] = useState(false)
  const [version, setVersion] = useState('')
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
  const [appearance, setAppearance] = useState(() => normalizeAppearance(undefined))
  const [systemAccentHex, setSystemAccentHex] = useState(null)
  const [connections, setConnections] = useState([])
  // null means "last used" — see resolveActiveConnection in App.
  const [defaultConnection, setDefaultConnection] = useState(null)

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
    window.winraid?.config.get('connections').then((list) => {
      if (Array.isArray(list)) setConnections(list)
    }).catch(() => {})
    window.winraid?.config.get('defaultConnection').then((id) => {
      setDefaultConnection(id ?? null)
    }).catch(() => {})
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

  useEffect(() => {
    window.winraid?.config.get('appearance').then((raw) => {
      setAppearance(normalizeAppearance(raw))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!window.winraid?.system) return
    window.winraid.system.accentColor().then((hex) => {
      setSystemAccentHex(hex ?? null)
    }).catch(() => {})
    const unsub = window.winraid.system.onAccentColorChanged((hex) => {
      setSystemAccentHex(hex ?? null)
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

  async function handleSortPersistenceChange(value) {
    setSortPersistence(value)
    await window.winraid?.config.set('browse.sortPersistence', value)
  }

  async function handleAppearanceChange(partial) {
    const next = { ...appearance, ...partial }
    setAppearance(next)
    await window.winraid?.config.set('appearance', next)
    window.dispatchEvent(new CustomEvent('winraid:appearance-changed', { detail: next }))
  }

  async function handleThumbSeekChange(mode, value) {
    setThumbSeekMode(mode)
    setThumbSeekValue(value)
    await window.winraid?.config.set('thumbSeek', { mode, value })
  }

  function handleDirectoryCacheKeyDown(e) {
    const currentIndex = DIRECTORY_CACHE_OPTIONS.findIndex((o) => o.value === cacheMode)
    if (currentIndex < 0) return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const direction = e.key === 'ArrowDown' ? 1 : -1
    const next = (currentIndex + direction + DIRECTORY_CACHE_OPTIONS.length) % DIRECTORY_CACHE_OPTIONS.length
    handleCacheModeChange(DIRECTORY_CACHE_OPTIONS[next].value)
  }

  // "Last used" plus one row per connection. The value is the connection id,
  // or null for "last used", which is exactly what the config field holds.
  const defaultConnectionOptions = [
    { value: null, label: 'Last used', desc: 'Whichever connection you were in last.' },
    ...connections.map((conn) => ({
      value: conn.id,
      label: conn.name,
      desc: (conn.type === 'sftp' ? conn.sftp?.remotePath : conn.smb?.remotePath) ?? '',
    })),
  ]

  async function handleDefaultConnectionChange(value) {
    setDefaultConnection(value)
    await window.winraid?.config.set('defaultConnection', value)
  }

  function handleDefaultConnectionKeyDown(e) {
    const currentIndex = defaultConnectionOptions.findIndex((o) => o.value === defaultConnection)
    if (currentIndex < 0) return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const direction = e.key === 'ArrowDown' ? 1 : -1
    const next = (currentIndex + direction + defaultConnectionOptions.length) % defaultConnectionOptions.length
    handleDefaultConnectionChange(defaultConnectionOptions[next].value)
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
        <h1 className={styles.title}>Settings</h1>

        <div className={styles.grid}>

          <section className={styles.card} aria-label="Startup & background">
            <h2 className={styles.cardTitle}>Startup & background</h2>
            <div className={styles.cardBody}>
              <Tooltip tip={watching ? HINTS.stopWatcher : HINTS.startWatcher}>
                <Button variant={watching ? 'danger' : 'secondary'} onClick={handleWatcherToggle}>
                  {watching ? 'Stop scanner' : 'Start scanner'}
                </Button>
              </Tooltip>
              <p className={styles.hint}>Closing the window keeps WinRaid running in the tray — watchers stay armed.</p>
            </div>
          </section>

          <section className={styles.card} aria-label="Appearance">
            <h2 className={styles.cardTitle}>Appearance</h2>
            <div className={styles.cardBody}>
              <SegmentedControl
                label="Theme"
                value={appearance.theme}
                onChange={(value) => handleAppearanceChange({ theme: value })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'dark',   label: 'Dark' },
                  { value: 'light',  label: 'Light' },
                ]}
              />
              <div className={styles.accentField}>
                <span className={styles.fieldLabel}>Accent</span>
                <div className={styles.accentSwatches}>
                  <button
                    type="button"
                    className={styles.swatch}
                    aria-label="System accent"
                    aria-pressed={appearance.accent === 'system'}
                    data-accent={resolveAccentHex('system', systemAccentHex)}
                    disabled={systemAccentHex == null}
                    title={systemAccentHex == null ? 'System accent is not available on this platform' : undefined}
                    onClick={() => handleAppearanceChange({ accent: 'system' })}
                  >
                    <span
                      className={styles.swatchColor}
                      style={{ background: resolveAccentHex('system', systemAccentHex) }}
                    />
                    {appearance.accent === 'system' && <Check size={14} className={styles.swatchCheck} />}
                  </button>
                  {ACCENT_PALETTE.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={styles.swatch}
                      aria-label={`${entry.label} accent`}
                      aria-pressed={appearance.accent === entry.id}
                      data-accent={entry.hex}
                      onClick={() => handleAppearanceChange({ accent: entry.id })}
                    >
                      <span className={styles.swatchColor} style={{ background: entry.hex }} />
                      {appearance.accent === entry.id && <Check size={14} className={styles.swatchCheck} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {connections.length > 1 && (
            <section className={styles.card} aria-label="Connections">
              <h2 className={styles.cardTitle}>Connections</h2>
              <div className={styles.cardBody}>
                <div className={styles.stackedField}>
                  <span className={styles.fieldLabel}>Default connection</span>
                  <div
                    className={styles.radioList}
                    role="radiogroup"
                    aria-label="Default connection"
                    onKeyDown={handleDefaultConnectionKeyDown}
                  >
                    {defaultConnectionOptions.map((option) => {
                      const isActive = option.value === defaultConnection
                      return (
                        <button
                          key={option.value ?? 'last-used'}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          aria-label={option.label}
                          tabIndex={isActive ? 0 : -1}
                          className={styles.radioRow}
                          onClick={() => { if (!isActive) handleDefaultConnectionChange(option.value) }}
                        >
                          <span className={styles.radioDot} aria-hidden="true">
                            {isActive && <span className={styles.radioDotFill} />}
                          </span>
                          <span className={styles.radioRowText}>
                            <span className={styles.radioRowLabel}>{option.label}</span>
                            <span className={styles.radioRowDesc}>{option.desc}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className={styles.card} aria-label="Play">
            <h2 className={styles.cardTitle}>Play</h2>
            <div className={styles.cardBody}>
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

          <section className={styles.card} aria-label="Snapshot">
            <h2 className={styles.cardTitle}>Snapshot</h2>
            <div className={styles.cardBody}>
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

          <section className={styles.card} aria-label="Thumbnails">
            <h2 className={styles.cardTitle}>Thumbnails</h2>
            <div className={styles.cardBody}>
              <div className={styles.stackedField}>
                <span className={styles.fieldLabel}>Video thumbnail frame</span>
                <div className={styles.thumbSeekRow}>
                  <SegmentedControl
                    aria-label="Video thumbnail frame"
                    value={thumbSeekMode}
                    onChange={(mode) => handleThumbSeekChange(mode, thumbSeekValue)}
                    options={[
                      { value: 'seconds', label: 'Seconds' },
                      { value: 'percent', label: 'Percent' },
                    ]}
                  />
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
                  <span className={styles.thumbSeekUnit}>{thumbSeekMode === 'percent' ? '%' : 's'}</span>
                </div>
              </div>
              <div className={styles.cacheRow}>
                <span className={styles.fieldLabel}>Cache — {formatSize(cacheBytes)}</span>
                <Button size="sm" variant="ghost" onClick={handleClearCache} disabled={clearing}>
                  {clearing ? 'Clearing...' : 'Clear'}
                </Button>
              </div>
            </div>
          </section>

          <section className={styles.card} aria-label="Remote browser">
            <h2 className={styles.cardTitle}>Remote browser</h2>
            <div className={styles.cardBody}>
              <div className={styles.stackedField}>
                <span className={styles.fieldLabel}>Directory cache</span>
                <div
                  className={styles.radioList}
                  role="radiogroup"
                  aria-label="Directory cache"
                  onKeyDown={handleDirectoryCacheKeyDown}
                >
                  {DIRECTORY_CACHE_OPTIONS.map((option) => {
                    const isActive = option.value === cacheMode
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        aria-label={option.label}
                        tabIndex={isActive ? 0 : -1}
                        className={styles.radioRow}
                        onClick={() => { if (!isActive) handleCacheModeChange(option.value) }}
                      >
                        <span className={styles.radioDot} aria-hidden="true">
                          {isActive && <span className={styles.radioDotFill} />}
                        </span>
                        <span className={styles.radioRowText}>
                          <span className={styles.radioRowLabel}>{option.label}</span>
                          <span className={styles.radioRowDesc}>{option.desc}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <SegmentedControl
                label="On folder mutation"
                value={cacheMutation}
                onChange={handleCacheMutationChange}
                options={[
                  { value: 'update',  label: 'Update in place', desc: 'Directly splice entries on create, delete, and move — no re-fetch.' },
                  { value: 'refetch', label: 'Re-fetch',        desc: 'Always reload the directory listing after any change.' },
                ]}
              />
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
          </section>

          <section className={styles.card} aria-label="Updates">
            <h2 className={styles.cardTitle}>Updates</h2>
            <div className={styles.cardBody}>
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
              <Button size="sm" variant="ghost" onClick={() => window.winraid?.whatsNew?.open()}>
                What’s new
              </Button>
            </div>
          </section>

          <section className={styles.card} aria-label="Security">
            <h2 className={styles.cardTitle}>Security</h2>
            <div className={styles.cardBody}>
              <p className={styles.hint}>Passwords and key passphrases are encrypted with Windows credential protection (DPAPI) — never stored in plain text.</p>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
