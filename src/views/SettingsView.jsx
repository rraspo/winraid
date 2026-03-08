import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Info, Check, ShieldCheck } from 'lucide-react'
import Tooltip from '../components/ui/Tooltip'
import Button from '../components/ui/Button'
import RemotePathBrowser from '../components/RemotePathBrowser'
import styles from './SettingsView.module.css'

// ---------------------------------------------------------------------------
// Extension presets — shown in the picker dropdown
// ---------------------------------------------------------------------------
const EXTENSION_PRESETS = {
  Video:    ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.ts', '.m2ts'],
  Image:    ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.raw', '.tiff', '.bmp'],
  Audio:    ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.opus', '.wma'],
  Document: ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.csv', '.md'],
  Archive:  ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
}
const ALL_PRESET_EXTS = Object.values(EXTENSION_PRESETS).flat()

// ---------------------------------------------------------------------------
// Tooltip text — one object so they're easy to audit / translate
// ---------------------------------------------------------------------------
const HINTS = {
  localFolder:  'The local folder WinRaid monitors. New files dropped or saved here are automatically queued for transfer to your NAS.',
  extensions:   'Restrict transfers to specific file types. Select from common presets or type a custom extension. Leave empty to transfer every file.',

  // Per-option hints — shown on hover of each toggle button
  opCopy:    'Keeps the original file on disk after upload completes.',
  opMove:    'Deletes the local file once the upload is confirmed successful.',
  modeFlat:   'Every file goes directly into the remote path — any local subfolders are ignored.',
  modeMirror: 'Recreates the local subfolder tree at the destination on the NAS.',
  // mirror_clean: deletes LOCAL files after copy — never touches remote
  modeMirrorClean: 'Same as Mirror, but also deletes the local source file after it\'s successfully copied to the NAS — works with both Copy and Move. Remote files are never deleted.',

  sftpHost:     'Hostname or IP of your SSH server — e.g. nas.local or 192.168.1.100.',
  sftpPort:     'SSH port number. Almost always 22. Only change if your server uses a non-standard port.',
  sftpUsername: 'The SSH account to log in as — e.g. root or your personal username.',
  sftpPassword: 'SSH password. Leave blank if you use a private key file instead.',
  sftpKeyPath:  'Path to your private key — e.g. C:\\Users\\you\\.ssh\\id_rsa. Used instead of (or in addition to) a password.',
  sftpRemote:   'Absolute destination path on the server — e.g. /mnt/user/media. Use Browse after a successful connection test to pick it visually.',

  smbHost:      'Hostname or IP of the Windows / Samba server — e.g. nas.local.',
  smbShare:     'The share name — the segment after the host in the UNC path (e.g. for \\\\nas\\media, enter "media").',
  smbUsername:  'Account with write access to the share. Leave blank for anonymous access.',
  smbPassword:  'Password for the share account.',
  smbRemote:    'Subfolder within the share for uploads — e.g. \\videos\\incoming. Leave blank to use the share root.',

  wizardBtn:    'Scan ~/.ssh/config (and WSL distros) to auto-fill connection details from an existing SSH host entry.',
  testConn:     'Open a live SSH connection to verify your credentials.',
  browseRemote: 'Browse the remote filesystem to pick the destination folder visually.',
  verifyClean:  'Walk the local watch folder and check each file against the NAS over SFTP. Files confirmed on the NAS are deleted locally.',
  queueExisting: 'When the watcher starts, scan the watch folder for files that appeared while it was stopped. Files already in the queue (pending or done) are skipped — only genuinely new arrivals are queued. Takes effect on next watcher start.',
  startWatcher: 'Begin monitoring the watch folder for new files. Runs in the background even when the window is hidden to the tray.',
  stopWatcher:  'Pause file monitoring. Already-queued transfers still complete; new files are ignored until resumed.',
  save:         'Write all settings to disk. If the watch folder changed, the watcher restarts automatically.',
}

// ---------------------------------------------------------------------------
// Form defaults
// ---------------------------------------------------------------------------
const DEFAULT_FORM = {
  localFolder:    '',
  connectionType: 'sftp',
  operation:      'copy',
  folderMode:     'flat',
  extensions:     [],   // string[]
  watcher: { queueExisting: true },
  sftp: { host: '', port: 22, username: '', password: '', keyPath: '', remotePath: '' },
  smb:  { host: '', share: '', username: '', password: '', remotePath: '' },
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------
export default function SettingsView() {
  const [form, setForm]               = useState(DEFAULT_FORM)
  const [loaded, setLoaded]           = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saveMsg, setSaveMsg]         = useState(null)
  const [watching, setWatching]       = useState(false)
  const [testStatus, setTestStatus]   = useState(null)
  const [showWizard, setShowWizard]   = useState(false)
  const [showBrowser, setShowBrowser] = useState(false)
  const [verifying, setVerifying]           = useState(false)
  const [verifyResult, setVerifyResult]     = useState(null)
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false)

  useEffect(() => {
    async function load() {
      const cfg = await window.winraid?.config.get()
      if (!cfg) return
      setForm({
        localFolder:    cfg.localFolder    ?? '',
        connectionType: cfg.connectionType ?? 'sftp',
        operation:      cfg.operation      ?? 'copy',
        folderMode:     cfg.folderMode     ?? 'flat',
        extensions:     cfg.extensions     ?? [],
        watcher: { ...DEFAULT_FORM.watcher, ...cfg.watcher },
        sftp: { ...DEFAULT_FORM.sftp, ...cfg.sftp },
        smb:  { ...DEFAULT_FORM.smb,  ...cfg.smb  },
      })
      setLoaded(true)
    }
    load()
    const unsub = window.winraid?.watcher.onStatus((s) => setWatching(s.watching))
    return () => unsub?.()
  }, [])

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === 'connectionType') setTestStatus(null)
  }

  function setNested(section, key, value) {
    setForm((f) => ({ ...f, [section]: { ...f[section], [key]: value } }))
  }

  async function handleBrowse() {
    const folder = await window.winraid?.selectFolder()
    if (folder) set('localFolder', folder)
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      await window.winraid.config.set('localFolder',    form.localFolder)
      await window.winraid.config.set('connectionType', form.connectionType)
      await window.winraid.config.set('operation',      form.operation)
      await window.winraid.config.set('folderMode',     form.folderMode)
      await window.winraid.config.set('extensions',     form.extensions)
      await window.winraid.config.set('watcher',        form.watcher)
      await window.winraid.config.set('sftp', { ...form.sftp, port: Number(form.sftp.port) || 22 })
      await window.winraid.config.set('smb',  form.smb)
      setSaveMsg({ type: 'ok', text: 'Settings saved.' })
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setSaveMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  async function handleWatcherToggle() {
    if (watching) {
      await window.winraid?.watcher.stop()
    } else {
      if (!form.localFolder) {
        setSaveMsg({ type: 'error', text: 'Set a watch folder before starting.' })
        return
      }
      await window.winraid?.watcher.start(form.localFolder)
    }
  }

  async function handleVerifyClean() {
    setShowVerifyConfirm(false)
    setVerifying(true)
    setSaveMsg(null)
    const cfg = {
      host:       form.sftp.host,
      port:       Number(form.sftp.port) || 22,
      username:   form.sftp.username,
      password:   form.sftp.password || undefined,
      keyPath:    form.sftp.keyPath  || undefined,
      remotePath: form.sftp.remotePath,
    }
    const res = await window.winraid?.remote.verifyClean(cfg, form.localFolder)
    setVerifying(false)
    if (res?.ok) {
      setVerifyResult(res)
    } else {
      setSaveMsg({ type: 'error', text: res?.error || 'Verify & Clean failed' })
    }
  }

  async function handleTestConnection() {
    setTestStatus('testing')
    try {
      const result = await window.winraid?.ssh.test({
        host:     form.sftp.host,
        port:     Number(form.sftp.port) || 22,
        username: form.sftp.username,
        password: form.sftp.password || undefined,
        keyPath:  form.sftp.keyPath  || undefined,
      })
      setTestStatus(result?.ok ? 'ok' : { error: result?.error ?? 'Connection failed' })
    } catch (err) {
      setTestStatus({ error: err.message })
    }
  }

  function applyWizardEntry(entry) {
    setForm((f) => ({
      ...f,
      sftp: {
        ...f.sftp,
        host:     entry.host,
        port:     entry.port,
        username: entry.username || f.sftp.username,
        keyPath:  entry.keyPath  || f.sftp.keyPath,
      },
    }))
    setTestStatus(null)
  }

  if (!loaded) {
    return (
      <div className={styles.container} style={{ color: 'var(--text-muted)', padding: 'var(--space-6)' }}>
        Loading…
      </div>
    )
  }

  const sftpCfg = {
    host:     form.sftp.host,
    port:     Number(form.sftp.port) || 22,
    username: form.sftp.username,
    password: form.sftp.password || undefined,
    keyPath:  form.sftp.keyPath  || undefined,
  }

  return (
    <div className={styles.container}>
      <div className={styles.scrollBody}>

        {/* Watcher */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>Watcher</div>
          <div className={styles.sectionBody}>
            <Field label="Queue existing files" hint={HINTS.queueExisting}>
              <Switch
                checked={form.watcher.queueExisting}
                onChange={(v) => setNested('watcher', 'queueExisting', v)}
              />
            </Field>
          </div>
        </section>

        {/* Source */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>Source</div>
          <div className={styles.sectionBody}>

            <Field label="Watch folder" required hint={HINTS.localFolder}>
              <div className={styles.inputRow}>
                <input
                  className={styles.input}
                  value={form.localFolder}
                  onChange={(e) => set('localFolder', e.target.value)}
                  placeholder="C:\Users\you\Downloads"
                  spellCheck={false}
                />
                <Tooltip tip="Open a folder picker dialog." side="left">
                  <Button variant="ghost" size="compact" onClick={handleBrowse}>Browse</Button>
                </Tooltip>
              </div>
            </Field>

            {/* Operation — each option has its own follow-mouse tooltip */}
            <Field label="Operation">
              <ToggleGroup
                value={form.operation}
                onChange={(v) => set('operation', v)}
                options={[
                  { value: 'copy', label: 'Copy', tip: HINTS.opCopy },
                  { value: 'move', label: 'Move', tip: HINTS.opMove },
                ]}
              />
            </Field>

            {/* Folder structure — each option has its own follow-mouse tooltip */}
            <Field label="Folder structure">
              <div className={styles.folderModeRow}>
                <ToggleGroup
                  value={form.folderMode}
                  onChange={(v) => set('folderMode', v)}
                  options={[
                    { value: 'flat',         label: 'Flat',           tip: HINTS.modeFlat },
                    { value: 'mirror',       label: 'Mirror',         tip: HINTS.modeMirror },
                    { value: 'mirror_clean', label: 'Mirror + clean', tip: HINTS.modeMirrorClean },
                  ]}
                />
                <Tooltip tip={HINTS.verifyClean} side="left">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowVerifyConfirm(true)}
                    disabled={verifying || !form.localFolder || !form.sftp.host}
                  >
                    <ShieldCheck size={13} />
                    {verifying ? 'Verifying…' : 'Verify & Clean'}
                  </Button>
                </Tooltip>
              </div>
            </Field>

            <Field label="Extensions" hint={HINTS.extensions}>
              <ExtensionPicker
                value={form.extensions}
                onChange={(v) => set('extensions', v)}
              />
            </Field>

          </div>
        </section>

        {/* Connection */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>Connection</div>
          <div className={styles.sectionBody}>

            <div className={styles.tabs}>
              {[['sftp', 'SSH / SFTP'], ['smb', 'SMB']].map(([v, l]) => (
                <button
                  key={v}
                  className={[styles.tab, form.connectionType === v ? styles.active : null]
                    .filter(Boolean).join(' ')}
                  onClick={() => set('connectionType', v)}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* SSH / SFTP */}
            {form.connectionType === 'sftp' && <>
              <div className={styles.sshToolbar}>
                <Tooltip tip={HINTS.wizardBtn} side="left">
                  <Button variant="ghost" size="sm" onClick={() => setShowWizard(true)}>
                    Import from SSH config…
                  </Button>
                </Tooltip>
              </div>
              <Field label="Host" required hint={HINTS.sftpHost}>
                <input className={styles.input} value={form.sftp.host}
                  onChange={(e) => setNested('sftp', 'host', e.target.value)} />
              </Field>
              <Field label="Port" required hint={HINTS.sftpPort}>
                <input className={`${styles.input} ${styles.short}`} type="number"
                  value={form.sftp.port}
                  onChange={(e) => setNested('sftp', 'port', e.target.value)} />
              </Field>
              <Field label="Username" required hint={HINTS.sftpUsername}>
                <input className={styles.input} value={form.sftp.username}
                  onChange={(e) => setNested('sftp', 'username', e.target.value)}
                  autoComplete="off" />
              </Field>
              <Field label="Password" hint={HINTS.sftpPassword}>
                <input className={styles.input} type="password" value={form.sftp.password}
                  onChange={(e) => setNested('sftp', 'password', e.target.value)}
                  autoComplete="new-password" />
              </Field>
              <Field label="Key path" hint={HINTS.sftpKeyPath}>
                <input className={styles.input} value={form.sftp.keyPath}
                  onChange={(e) => setNested('sftp', 'keyPath', e.target.value)}
                  placeholder="C:\Users\you\.ssh\id_rsa" spellCheck={false} />
              </Field>
              <Field label="Remote path" required hint={HINTS.sftpRemote}>
                <div className={styles.inputRow}>
                  <input className={styles.input} value={form.sftp.remotePath}
                    onChange={(e) => setNested('sftp', 'remotePath', e.target.value)}
                    placeholder="/mnt/user/share" spellCheck={false} />
                  <Tooltip tip={HINTS.browseRemote} side="left">
                    <Button variant="ghost" size="compact" onClick={() => setShowBrowser(true)}>
                      Browse
                    </Button>
                  </Tooltip>
                </div>
              </Field>
              <div className={styles.testRow}>
                <Tooltip tip={HINTS.testConn} side="left">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={testStatus === 'testing' || !form.sftp.host || !form.sftp.username}
                  >
                    {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
                  </Button>
                </Tooltip>
                {testStatus === 'ok' && (
                  <span className={styles.testOk}>Connected</span>
                )}
                {testStatus?.error && (
                  <span className={styles.testError}>{testStatus.error}</span>
                )}
              </div>
            </>}

            {/* SMB */}
            {form.connectionType === 'smb' && <>
              <Field label="Host" required hint={HINTS.smbHost}>
                <input className={styles.input} value={form.smb.host}
                  onChange={(e) => setNested('smb', 'host', e.target.value)} placeholder="nas.local" />
              </Field>
              <Field label="Share" required hint={HINTS.smbShare}>
                <input className={styles.input} value={form.smb.share}
                  onChange={(e) => setNested('smb', 'share', e.target.value)} placeholder="media" />
              </Field>
              <Field label="Username" hint={HINTS.smbUsername}>
                <input className={styles.input} value={form.smb.username}
                  onChange={(e) => setNested('smb', 'username', e.target.value)} />
              </Field>
              <Field label="Password" hint={HINTS.smbPassword}>
                <input className={styles.input} type="password" value={form.smb.password}
                  onChange={(e) => setNested('smb', 'password', e.target.value)} />
              </Field>
              <Field label="Remote path" hint={HINTS.smbRemote}>
                <input className={styles.input} value={form.smb.remotePath}
                  onChange={(e) => setNested('smb', 'remotePath', e.target.value)}
                  placeholder="\videos" spellCheck={false} />
              </Field>
            </>}

          </div>
        </section>

      </div>{/* end scrollBody */}

      <div className={styles.footer}>
        <Tooltip tip={watching ? HINTS.stopWatcher : HINTS.startWatcher} side="left">
          <Button variant={watching ? 'danger' : 'secondary'} onClick={handleWatcherToggle}>
            {watching ? 'Stop watcher' : 'Start watcher'}
          </Button>
        </Tooltip>
        <Tooltip tip={HINTS.save} side="left">
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </Tooltip>
        {saveMsg && (
          <span className={`${styles.saveMsg} ${styles[saveMsg.type]}`}>{saveMsg.text}</span>
        )}
      </div>

      {showWizard && (
        <SSHWizardDialog onApply={applyWizardEntry} onClose={() => setShowWizard(false)} />
      )}
      {showBrowser && (
        <RemotePathBrowser
          sftpCfg={sftpCfg}
          initialPath={form.sftp.remotePath || '/mnt/user'}
          onSelect={(path) => setNested('sftp', 'remotePath', path)}
          onClose={() => setShowBrowser(false)}
        />
      )}
      {showVerifyConfirm && (
        <VerifyConfirmDialog
          localFolder={form.localFolder}
          remotePath={form.sftp.remotePath}
          onConfirm={handleVerifyClean}
          onClose={() => setShowVerifyConfirm(false)}
        />
      )}
      {verifyResult && (
        <VerifyResultDialog
          result={verifyResult}
          localFolder={form.localFolder}
          onClose={() => setVerifyResult(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// VerifyConfirmDialog
// ---------------------------------------------------------------------------
function VerifyConfirmDialog({ localFolder, remotePath, onConfirm, onClose }) {
  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Verify &amp; Clean</span>
          <button className={styles.dialogCloseBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.dialogBody}>
          <div className={styles.verifyConfirmText}>
            Each file and folder inside
            <div className={styles.verifyPathRow}>
              <span className={styles.verifyPathValue}>{localFolder || '(not set)'}</span>
            </div>
            will be checked against
            <div className={styles.verifyPathRow}>
              <span className={styles.verifyPathValue}>{remotePath || '(not set)'}</span>
            </div>
            via SFTP. Files confirmed on the NAS will be deleted locally.
          </div>
        </div>
        <div className={styles.dialogFooter}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm}>Run</Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VerifyResultDialog
// ---------------------------------------------------------------------------
function VerifyResultDialog({ result, localFolder, onClose }) {
  const [requeued, setRequeued] = useState(false)
  const [requeueing, setRequeueing] = useState(false)

  async function handleRequeue() {
    setRequeueing(true)
    await window.winraid?.queue.enqueueBatch(localFolder, result.notFound)
    setRequeueing(false)
    setRequeued(true)
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Verify &amp; Clean — Done</span>
          <button className={styles.dialogCloseBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.verifyStats}>
          <div className={styles.verifyStat}>
            <span className={styles.verifyStatNum}>{result.cleaned}</span>
            <span className={styles.verifyStatLabel}>Cleaned locally</span>
          </div>
          <div className={styles.verifyStat}>
            <span className={[
              styles.verifyStatNum,
              result.notFound.length ? styles.verifyStatWarn : '',
            ].join(' ')}>
              {result.notFound.length}
            </span>
            <span className={styles.verifyStatLabel}>Not on NAS</span>
          </div>
          <div className={styles.verifyStat}>
            <span className={[
              styles.verifyStatNum,
              result.errors.length ? styles.verifyStatErr : '',
            ].join(' ')}>
              {result.errors.length}
            </span>
            <span className={styles.verifyStatLabel}>Errors</span>
          </div>
        </div>

        {result.notFound.length > 0 && (
          <div className={styles.verifyList}>
            <p className={styles.verifyListTitle}>
              Not found on NAS ({result.notFound.length})
            </p>
            <div className={styles.verifyListItems}>
              {result.notFound.slice(0, 20).map((f) => (
                <div key={f} className={styles.verifyListItem}>{f}</div>
              ))}
              {result.notFound.length > 20 && (
                <div className={styles.verifyListMore}>
                  +{result.notFound.length - 20} more
                </div>
              )}
            </div>
          </div>
        )}

        <div className={styles.dialogFooter}>
          <span className={styles.verifySummary}>
            {result.total} file{result.total !== 1 ? 's' : ''} checked
          </span>
          {result.notFound.length > 0 && (
            <Button
              variant={requeued ? 'secondary' : 'primary'}
              onClick={handleRequeue}
              disabled={requeueing || requeued}
            >
              {requeued
                ? `Queued ${result.notFound.length} file${result.notFound.length !== 1 ? 's' : ''}`
                : requeueing
                  ? 'Queuing…'
                  : `Re-queue ${result.notFound.length} missing`}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Switch — pill toggle for boolean settings
// ---------------------------------------------------------------------------
function Switch({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={[styles.switch, checked ? styles.switchOn : null].filter(Boolean).join(' ')}
      onClick={() => onChange(!checked)}
    />
  )
}

// ---------------------------------------------------------------------------
// ToggleGroup — segmented buttons; each option can carry its own follow-mouse tooltip
// options: [{ value, label, tip? }]
// ---------------------------------------------------------------------------
function ToggleGroup({ options, value, onChange }) {
  return (
    <div className={styles.toggleGroup}>
      {options.map(({ value: v, label, tip }) => {
        const btn = (
          <button
            key={v}
            type="button"
            className={[styles.toggleOption, value === v ? styles.toggleActive : null]
              .filter(Boolean).join(' ')}
            onClick={() => onChange(v)}
          >
            {label}
          </button>
        )
        return tip
          ? <Tooltip key={v} tip={tip} followMouse>{btn}</Tooltip>
          : btn
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field — label + optional hint icon + control
// ---------------------------------------------------------------------------
function Field({ label, required, hint, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
        {required && <span className={styles.req}>*</span>}
        {hint && (
          <Tooltip tip={hint}>
            <Info size={12} className={styles.hintIcon} />
          </Tooltip>
        )}
      </label>
      <div>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExtensionPicker — multi-select with preset groups + custom entry
// ---------------------------------------------------------------------------
function ExtensionPicker({ value, onChange }) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)
  const inputRef     = useRef(null)
  const dropRef      = useRef(null)
  const [dropRect, setDropRect] = useState(null)
  const chipRowRef = useRef(null)

  // Close on outside click — must check both the anchor and the portal div
  useEffect(() => {
    function onDown(e) {
      if (
        !containerRef.current?.contains(e.target) &&
        !dropRef.current?.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Recompute dropdown position whenever the chip row resizes (chips wrapping to new lines)
  useEffect(() => {
    if (!open || !chipRowRef.current) return
    const el = chipRowRef.current
    const update = () => {
      const r = el.getBoundingClientRect()
      setDropRect({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    const obs = new ResizeObserver(update)
    obs.observe(el)
    update() // sync immediately in case it already changed before this effect ran
    return () => obs.disconnect()
  }, [open])

  function openDrop() {
    setOpen(true)
    inputRef.current?.focus()
  }

  function toggle(ext) {
    onChange(value.includes(ext) ? value.filter((e) => e !== ext) : [...value, ext])
  }

  function remove(ext, e) {
    e.stopPropagation()
    onChange(value.filter((e2) => e2 !== ext))
  }

  function addCustom() {
    let ext = query.trim()
    if (!ext) return
    if (!ext.startsWith('.')) ext = '.' + ext
    if (ext === '.' || value.includes(ext)) { setQuery(''); return }
    onChange([...value, ext])
    setQuery('')
  }

  function handleKey(e) {
    if (e.key === 'Enter')     { e.preventDefault(); addCustom() }
    if (e.key === 'Escape')    setOpen(false)
    if (e.key === 'Backspace' && !query && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  // Normalize query for matching (allow "mp4" to match ".mp4")
  const q     = query.trim().toLowerCase()
  const qNorm = q ? (q.startsWith('.') ? q : '.' + q) : ''

  const filteredGroups = Object.entries(EXTENSION_PRESETS)
    .map(([group, exts]) => [group, exts.filter((e) => !qNorm || e.includes(qNorm))])
    .filter(([, exts]) => exts.length > 0)

  const isCustom = qNorm && qNorm !== '.' && !ALL_PRESET_EXTS.includes(qNorm)

  return (
    <div ref={containerRef} className={styles.extPicker}>
      {/* Chip row — acts as the "input" */}
      <div ref={chipRowRef} className={styles.extChipRow} onClick={openDrop}>
        {value.length === 0 && !open && (
          <span className={styles.extAllLabel}>All files</span>
        )}
        {value.map((ext) => (
          <span key={ext} className={styles.extChip}>
            {ext}
            <button className={styles.extChipX} onMouseDown={(e) => remove(ext, e)}>×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className={styles.extInput}
          value={query}
          onChange={(e) => { setQuery(e.target.value); openDrop() }}
          onFocus={openDrop}
          onKeyDown={handleKey}
          placeholder={value.length === 0 && !open ? '' : '+add'}
        />
      </div>

      {/* Dropdown — portal so it's never clipped by overflow */}
      {open && dropRect && createPortal(
        <div
          ref={dropRef}
          className={styles.extDropdown}
          style={{ top: dropRect.top, left: dropRect.left, width: dropRect.width }}
          onMouseDown={(e) => e.preventDefault()} // prevent input blur on click
        >
          {filteredGroups.map(([group, exts]) => (
            <div key={group} className={styles.extGroup}>
              <div className={styles.extGroupLabel}>{group}</div>
              <div className={styles.extGroupItems}>
                {exts.map((ext) => (
                  <button
                    key={ext}
                    className={[styles.extOption, value.includes(ext) ? styles.extOptionOn : '']
                      .filter(Boolean).join(' ')}
                    onClick={() => toggle(ext)}
                  >
                    {value.includes(ext) && <Check size={10} />}
                    {ext}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {isCustom && (
            <div className={styles.extCustomRow}>
              <button className={styles.extAddBtn} onClick={addCustom}>
                + Add &quot;{qNorm}&quot;
              </button>
            </div>
          )}

          {filteredGroups.length === 0 && !isCustom && (
            <div className={styles.extEmpty}>No matches</div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SSHWizardDialog
// ---------------------------------------------------------------------------
function SSHWizardDialog({ onApply, onClose }) {
  const [entries, setEntries] = useState(null)
  const [selected, setSelected] = useState(0)
  const [err, setErr] = useState(null)

  useEffect(() => {
    window.winraid?.ssh.scanConfigs()
      .then((list) => setEntries(list ?? []))
      .catch((e) => setErr(e.message))
  }, [])

  const sel = entries?.[selected]

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Import from SSH config</span>
          <button className={styles.dialogCloseBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.dialogBody}>
          {err ? (
            <span className={styles.testError}>{err}</span>
          ) : entries === null ? (
            <span className={styles.dialogMuted}>Scanning ~/.ssh/config…</span>
          ) : entries.length === 0 ? (
            <span className={styles.dialogMuted}>No hosts found in ~/.ssh/config.</span>
          ) : (
            <>
              {entries.map((e, i) => (
                <div
                  key={i}
                  role="option"
                  aria-selected={selected === i}
                  className={[styles.wizardEntry, selected === i ? styles.wizardEntrySelected : '']
                    .filter(Boolean).join(' ')}
                  onClick={() => setSelected(i)}
                >
                  <div className={styles.wizardRadio}>
                    {selected === i && <Check size={10} />}
                  </div>
                  <span className={styles.wizardEntryLabel}>{e.label}</span>
                </div>
              ))}
              {sel && (
                <div className={styles.wizardPreview}>
                  <span className={styles.wizardPreviewTitle}>Will import</span>
                  <div className={styles.wizardPreviewRow}>
                    <span className={styles.wizardPreviewKey}>Host</span>
                    <code className={styles.wizardPreviewVal}>{sel.host}:{sel.port}</code>
                  </div>
                  {sel.username && (
                    <div className={styles.wizardPreviewRow}>
                      <span className={styles.wizardPreviewKey}>User</span>
                      <code className={styles.wizardPreviewVal}>{sel.username}</code>
                    </div>
                  )}
                  {sel.keyPath && (
                    <div className={styles.wizardPreviewRow}>
                      <span className={styles.wizardPreviewKey}>Key</span>
                      <code className={styles.wizardPreviewVal}>{sel.keyPath.split(/[/\\]/).pop()}</code>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className={styles.dialogFooter}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {entries?.length > 0 && (
            <Button variant="primary" onClick={() => { onApply(entries[selected]); onClose() }}>
              Apply
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

