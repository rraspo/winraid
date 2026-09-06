import { useState, useEffect, useRef } from 'react'
import { X, Plus, Download, Info } from 'lucide-react'
import Button from '../components/ui/Button'
import Tooltip from '../components/ui/Tooltip'
import RemotePathBrowser from '../components/RemotePathBrowser'
import styles from './BackupView.module.css'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUN_STATUS = { IDLE: 'idle', RUNNING: 'running', DONE: 'done', CANCELLED: 'cancelled', ERROR: 'error' }

const STATUS_PILL = {
  [RUN_STATUS.IDLE]:      { text: 'Idle',      className: 'pillIdle' },
  [RUN_STATUS.RUNNING]:   { text: 'Running',   className: 'pillRunning' },
  [RUN_STATUS.DONE]:      { text: 'Done',      className: 'pillDone' },
  [RUN_STATUS.CANCELLED]: { text: 'Cancelled', className: 'pillCancelled' },
  [RUN_STATUS.ERROR]:     { text: 'Error',     className: 'pillError' },
}

const DEFAULT_FORM = {
  sources:   [],
  localDest: '',
}

const HINTS = {
  sources:   'Remote paths on the NAS to pull down. Each one is downloaded recursively, preserving its folder structure under the local destination.',
  localDest: 'Local folder where backups land. Each source is saved as a sub-folder here.',
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function BackupView({ connectionId, backupRun, setBackupRun }) {
  const [form, setForm]           = useState(DEFAULT_FORM)
  const [loaded, setLoaded]       = useState(false)
  const [saving, setSaving]       = useState(false)
  const [saveMsg, setSaveMsg]     = useState(null)
  const [connectionName, setConnectionName] = useState('Backup')
  const [sftpHost, setSftpHost]   = useState(null)
  const [sftpCfg, setSftpCfg]     = useState(null)
  const [browsingIndex, setBrowsingIndex] = useState(null)
  const runningRef = useRef(false)

  const runStatus  = backupRun?.runStatus   ?? RUN_STATUS.IDLE
  const stats      = backupRun?.stats       ?? null
  const currentFile = backupRun?.currentFile ?? null
  const lastRun    = backupRun?.lastRun     ?? null

  useEffect(() => {
    setLoaded(false)
    async function load() {
      const cfg = await window.winraid?.config.get()
      if (!cfg) return
      const byConn = cfg.backupByConnection?.[connectionId] ?? {}
      setForm({
        sources:   byConn.sources   ?? [],
        localDest: byConn.localDest ?? '',
      })
      const conn   = (cfg.connections ?? []).find((c) => c.id === connectionId) ?? null
      const isSftp = conn?.type === 'sftp'
      setConnectionName(conn?.name ?? 'Backup')
      setSftpHost(isSftp ? conn?.sftp?.host ?? null : null)
      setSftpCfg(isSftp ? conn?.sftp ?? null : null)
      setLoaded(true)
    }
    load()
  }, [connectionId])

  // -- form helpers ----------------------------------------------------------

  function addSource() {
    setForm((f) => ({ ...f, sources: [...f.sources, ''] }))
  }

  function setSource(i, value) {
    setForm((f) => {
      const sources = [...f.sources]
      sources[i] = value
      return { ...f, sources }
    })
  }

  function removeSource(i) {
    setForm((f) => ({ ...f, sources: f.sources.filter((_, j) => j !== i) }))
  }

  // -- actions ---------------------------------------------------------------

  async function handleBrowseLocal() {
    const folder = await window.winraid?.selectFolder()
    if (folder) setForm((f) => ({ ...f, localDest: folder }))
  }

  async function handleSave() {
    if (!connectionId) {
      setSaveMsg({ type: 'error', text: 'No connection selected.' })
      return
    }
    setSaving(true)
    setSaveMsg(null)
    try {
      const cfg        = await window.winraid?.config.get()
      const byConn     = { ...(cfg?.backupByConnection ?? {}) }
      byConn[connectionId] = { sources: form.sources.filter(Boolean), localDest: form.localDest }
      await window.winraid.config.set('backupByConnection', byConn)
      setSaveMsg({ type: 'ok', text: 'Backup settings saved.' })
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setSaveMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  async function handleRun() {
    if (runningRef.current) return
    runningRef.current = true
    setBackupRun((s) => ({ ...s, runStatus: RUN_STATUS.RUNNING, stats: null, currentFile: null }))
    setSaveMsg(null)
    try {
      const result = await window.winraid?.backup.run({
        sources:      form.sources.filter(Boolean),
        localDest:    form.localDest,
        connectionId,
      })
      setBackupRun((s) => ({
        ...s,
        runStatus: result?.ok ? RUN_STATUS.DONE : RUN_STATUS.ERROR,
        stats:     result?.stats ?? s.stats,
        lastRun:   Date.now(),
      }))
      if (!result?.ok) setSaveMsg({ type: 'error', text: result?.error ?? 'Backup failed.' })
    } catch (err) {
      setBackupRun((s) => ({ ...s, runStatus: RUN_STATUS.ERROR }))
      setSaveMsg({ type: 'error', text: err.message })
    } finally {
      runningRef.current = false
    }
  }

  async function handleCancel() {
    await window.winraid?.backup.cancel()
    runningRef.current = false
    setBackupRun((s) => ({ ...s, runStatus: RUN_STATUS.CANCELLED }))
  }

  // -- render ----------------------------------------------------------------

  if (!loaded) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading…</div>
      </div>
    )
  }

  const isRunning    = runStatus === RUN_STATUS.RUNNING
  const hasRun       = runStatus !== RUN_STATUS.IDLE
  const validSources = form.sources.filter(Boolean)
  const pill         = STATUS_PILL[runStatus]

  return (
    <div className={styles.container}>
      <div className={styles.scrollBody}>

        <header className={styles.header}>
          <h1 className={styles.title}>Incremental backup</h1>
          <p className={styles.subtitle}>Pull NAS folders back to this PC — only what changed gets copied</p>
        </header>

        {/* Backup card */}
        <div className={styles.card}>
          <div className={styles.cardTitleRow}>
            <span className={styles.cardTitle}>{connectionName}</span>
            <span className={`${styles.statusPill} ${styles[pill.className]}`}>{pill.text}</span>
          </div>

          {validSources.length === 0 ? (
            <span className={styles.emptyHint}>No sources configured — add a remote path to back up.</span>
          ) : (
            <div className={styles.sourceLines}>
              {validSources.map((src, i) => (
                <div key={i} className={styles.sourceLine}>
                  {form.localDest ? `${src} \u2192 ${form.localDest}` : src}
                </div>
              ))}
            </div>
          )}

          {isRunning && (
            <div className={styles.progress}>
              <div className={styles.progressText}>{runProgressText(stats, currentFile)}</div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} />
              </div>
            </div>
          )}

          {hasRun && !isRunning && (
            <div className={styles.lastRunBody}>
              {stats && (
                <div className={styles.statsRow}>
                  <StatBox label="Downloaded" value={stats.files} />
                  <StatBox label="Skipped"    value={stats.skipped} />
                  <StatBox label="Errors"     value={stats.errors.length} warn={stats.errors.length > 0} />
                  <StatBox label="Size"       value={fmtBytes(stats.bytes)} />
                  <StatBox label="Total Backup Size" value={fmtBytes(stats.totalBytes ?? 0)} />
                </div>
              )}

              {stats?.errors?.length > 0 && (
                <div className={styles.errorList}>
                  <div className={styles.errorListTitle}>Errors</div>
                  {stats.errors.slice(0, 12).map((e, i) => (
                    <div key={i} className={styles.errorItem}>
                      <code>{e.file ?? e.source}</code>
                      <span className={styles.errorMsg}>{e.error}</span>
                    </div>
                  ))}
                  {stats.errors.length > 12 && (
                    <div className={styles.errorMore}>+{stats.errors.length - 12} more</div>
                  )}
                </div>
              )}

              {lastRun && (
                <div className={styles.lastRunTs}>
                  Completed at {new Date(lastRun).toLocaleTimeString()}
                </div>
              )}
            </div>
          )}

          <div className={styles.actionsRow}>
            {isRunning ? (
              <Button variant="danger" onClick={handleCancel}>Cancel</Button>
            ) : (
              <Tooltip side="left" tip={!form.localDest ? 'Set a destination folder first.' : validSources.length === 0 ? 'Add at least one remote source.' : 'Pull all configured sources from the NAS to your local destination.'}>
                <Button variant="primary" onClick={handleRun}
                  disabled={!form.localDest || validSources.length === 0}
                >
                  <Download size={13} />
                  Run backup
                </Button>
              </Tooltip>
            )}

            <Button variant="secondary" onClick={handleSave} disabled={saving || isRunning}>
              {saving ? 'Saving…' : 'Save'}
            </Button>

            {saveMsg && (
              <span className={`${styles.saveMsg} ${styles[saveMsg.type]}`}>{saveMsg.text}</span>
            )}
          </div>
        </div>

        {/* Sources and destination card */}
        <div className={styles.card}>
          <div className={styles.cardTitleRow}>
            <span className={styles.cardTitle}>Sources and destination</span>
          </div>

          <div className={styles.formBody}>

            <div className={styles.connNotice}>
              <Info size={13} className={styles.connNoticeIcon} />
              <span>
                Uses the active SFTP connection
                {sftpHost ? <> — <code className={styles.connNoticeHost}>{sftpHost}</code></> : '. No active SFTP connection configured.'}
              </span>
            </div>

            <div className={styles.fieldGroup}>
              <div className={styles.fieldGroupLabel}>
                Remote sources
                <Tooltip tip={HINTS.sources}>
                  <span className={styles.hintTrigger}>?</span>
                </Tooltip>
              </div>

              {form.sources.length === 0 && (
                <span className={styles.emptyHint}>No sources configured — add a remote path to back up.</span>
              )}

              {form.sources.map((src, i) => (
                <div key={i} className={styles.sourceRow}>
                  <input
                    className={styles.input}
                    value={src}
                    onChange={(e) => setSource(i, e.target.value)}
                    placeholder="/mnt/user/appdata"
                    spellCheck={false}
                  />
                  <Tooltip tip="Browse the NAS filesystem to pick this source path." side="left">
                    <Button variant="ghost" size="compact" onClick={() => setBrowsingIndex(i)}>
                      Browse
                    </Button>
                  </Tooltip>
                  <Tooltip tip="Remove source" side="left">
                    <button className={styles.removeBtn} onClick={() => removeSource(i)}>
                      <X size={13} />
                    </button>
                  </Tooltip>
                </div>
              ))}

              <div>
                <Button variant="ghost" size="sm" onClick={addSource}>
                  <Plus size={13} />
                  Add source
                </Button>
              </div>
            </div>

            <Field label="Local destination" required hint={HINTS.localDest}>
              <div className={styles.inputRow}>
                <input className={styles.input} value={form.localDest}
                  onChange={(e) => setForm((f) => ({ ...f, localDest: e.target.value }))}
                  placeholder="D:\Backup" spellCheck={false} />
                <Tooltip tip="Open a folder picker dialog.">
                  <Button variant="ghost" size="compact" onClick={handleBrowseLocal}>Browse</Button>
                </Tooltip>
              </div>
            </Field>

          </div>
        </div>

        <p className={styles.footerNote}>
          Files are compared by modified time and size. Nothing on the NAS is ever touched — backup only reads from the server and writes locally.
        </p>

      </div>{/* end scrollBody */}

      {browsingIndex !== null && sftpCfg && (
        <RemotePathBrowser
          sftpCfg={sftpCfg}
          initialPath={form.sources[browsingIndex] || '/mnt/user'}
          multiSelect
          onSelect={(pathOrPaths) => {
            if (Array.isArray(pathOrPaths)) {
              const [first, ...rest] = pathOrPaths
              setForm((f) => {
                const sources = [...f.sources]
                sources[browsingIndex] = first
                return { ...f, sources: [...sources, ...rest] }
              })
            } else {
              setSource(browsingIndex, pathOrPaths)
            }
          }}
          onClose={() => setBrowsingIndex(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field — label + hint + control
// ---------------------------------------------------------------------------

function Field({ label, required, hint, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
        {required && <span className={styles.req}>*</span>}
        {hint && (
          <Tooltip tip={hint}>
            <span className={styles.hintTrigger}>?</span>
          </Tooltip>
        )}
      </label>
      <div>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StatBox — single numeric stat in the run status panel
// ---------------------------------------------------------------------------

function StatBox({ label, value, warn }) {
  return (
    <div className={styles.statBox}>
      <span className={`${styles.statValue} ${warn ? styles.statWarn : ''}`}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The transfer engine reports files downloaded/skipped and bytes moved so
// far, but never a remote file count to compare against — so the running
// line reads as a moving count rather than "X of Y". Before the first
// progress event lands, currentFile is the only signal available.
function runProgressText(stats, currentFile) {
  if (stats) {
    const processed = (stats.files ?? 0) + (stats.skipped ?? 0)
    return `Copying ${processed} file${processed === 1 ? '' : 's'} \u00b7 ${fmtBytes(stats.bytes ?? 0)}`
  }
  if (currentFile) return currentFile
  return 'Starting backup…'
}

function fmtBytes(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}
