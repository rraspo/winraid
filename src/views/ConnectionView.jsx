import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Info, ShieldCheck, Check } from 'lucide-react'
import { createPortal } from 'react-dom'
import Tooltip from '../components/ui/Tooltip'
import Button from '../components/ui/Button'
import RemotePathBrowser from '../components/RemotePathBrowser'
import IconPicker from '../components/IconPicker'
import styles from './ConnectionView.module.css'

const EMPTY_SFTP = { host: '', port: 22, username: '', password: '', keyPath: '', remotePath: '' }
const EMPTY_SMB  = { host: '', share: '', username: '', password: '', remotePath: '' }

const EXTENSION_PRESETS = {
  Video:    ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.ts', '.m2ts'],
  Image:    ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.raw', '.tiff', '.bmp'],
  Audio:    ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.opus', '.wma'],
  Document: ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.csv', '.md'],
  Archive:  ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
}
const ALL_PRESET_EXTS = Object.values(EXTENSION_PRESETS).flat()

function makeDefault(existing) {
  const base = {
    id:          crypto.randomUUID(),
    name:        '',
    icon:        null,
    type:        'sftp',
    sftp:        { ...EMPTY_SFTP },
    smb:         { ...EMPTY_SMB  },
    localFolder: '',
    operation:   'copy',
    folderMode:  'flat',
    extensions:  [],
  }
  if (existing) return { ...base, ...existing }
  return base
}

const HINTS = {
  name:          'A friendly label for this connection — shown in the sidebar and dashboard.',
  sftpHost:      'Hostname or IP of your SSH server — e.g. nas.local or 192.168.1.100.',
  sftpPort:      'SSH port number. Almost always 22.',
  sftpUsername:  'The SSH account to log in as.',
  sftpPassword:  'SSH password. Leave blank if you use a private key file instead.',
  sftpKeyPath:   'Path to your private key — e.g. C:\\Users\\you\\.ssh\\id_rsa.',
  sftpRemote:    'Absolute destination path on the server — e.g. /mnt/user/media.',
  smbHost:       'Hostname or IP of the Windows / Samba server — e.g. nas.local.',
  smbShare:      'The share name — the segment after the host in the UNC path.',
  smbUsername:   'Account with write access to the share.',
  smbPassword:   'Password for the share account.',
  smbRemote:     'Subfolder within the share for uploads.',
  wizardBtn:     'Scan ~/.ssh/config (and WSL distros) to auto-fill connection details from an existing SSH host entry.',
  testConn:      'Open a live SSH connection to verify your credentials.',
  browseRemote:  'Browse the remote filesystem to pick the destination folder visually.',
  localFolder:   'The local folder WinRaid monitors for this connection. New files here are automatically queued for transfer.',
  opCopy:        'Keeps the original file on disk after upload completes.',
  opMove:        'Deletes the local file once the upload is confirmed successful.',
  modeFlat:      'Every file goes directly into the remote path — any local subfolders are ignored.',
  modeMirror:    'Recreates the local subfolder tree at the destination on the NAS.',
  modeMirrorClean: 'Same as Mirror, but also deletes the local source file after it\'s successfully copied to the NAS. Remote files are never deleted.',
  extensions:    'Restrict transfers to specific file types. Leave empty to transfer every file.',
  verifyClean:   'Walk the local watch folder and check each file against the NAS over SFTP. Results are shown in a dialog where you can enqueue missing files, delete confirmed local copies, or ignore either group.',
}

export default function ConnectionView({ existing, onSave, onClose }) {
  const [conn,               setConn]               = useState(() => makeDefault(existing))
  const [testStatus,         setTestStatus]         = useState(null)
  const [saving,             setSaving]             = useState(false)
  const [deleting,           setDeleting]           = useState(false)
  const [showWizard,         setShowWizard]         = useState(false)
  const [showBrowser,        setShowBrowser]        = useState(false)
  const [verifying,          setVerifying]          = useState(false)
  const [verifyCheckResult,  setVerifyCheckResult]  = useState(null)
  const [verifyError,        setVerifyError]        = useState(null)
  const [showVerifyConfirm,  setShowVerifyConfirm]  = useState(false)
  const [folderOverlapError, setFolderOverlapError] = useState(null)

  function setTop(key, value) {
    setConn((c) => ({ ...c, [key]: value }))
    if (key === 'type') setTestStatus(null)
  }

  function setSftp(key, value) {
    setConn((c) => ({ ...c, sftp: { ...c.sftp, [key]: value } }))
    setTestStatus(null)
  }

  function setSmb(key, value) {
    setConn((c) => ({ ...c, smb: { ...c.smb, [key]: value } }))
  }

  function applyWizardEntry(entry) {
    setConn((c) => ({
      ...c,
      sftp: {
        ...c.sftp,
        host:     entry.host,
        port:     entry.port,
        username: entry.username || c.sftp.username,
        keyPath:  entry.keyPath  || c.sftp.keyPath,
      },
    }))
    setTestStatus(null)
  }

  async function handleBrowseLocal() {
    const folder = await window.winraid?.selectFolder()
    if (folder) {
      setTop('localFolder', folder)
      setFolderOverlapError(null)
    }
  }

  async function handleTest() {
    setTestStatus('testing')
    try {
      const result = await window.winraid?.ssh.test({
        host:     conn.sftp.host,
        port:     Number(conn.sftp.port) || 22,
        username: conn.sftp.username,
        password: conn.sftp.password || undefined,
        keyPath:  conn.sftp.keyPath  || undefined,
      })
      setTestStatus(result?.ok ? 'ok' : { error: result?.error ?? 'Connection failed' })
    } catch (err) {
      setTestStatus({ error: err.message })
    }
  }

  async function handleSave() {
    if (!conn.name.trim()) return
    setFolderOverlapError(null)

    // Validate that this connection's local folder doesn't overlap with any other
    // connection's local folder (no parent/child relationships allowed).
    if (conn.localFolder) {
      const allConns = await window.winraid?.config.get('connections') ?? []
      const others   = allConns.filter((c) => c.id !== conn.id && c.localFolder)
      const sep      = '\\'  // Windows path separator; also handle forward slash below

      const normalise = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '')
      const thisFolder = normalise(conn.localFolder)

      for (const other of others) {
        const otherFolder = normalise(other.localFolder)
        // Check if thisFolder is a parent of otherFolder or vice versa
        if (
          thisFolder === otherFolder ||
          otherFolder.startsWith(thisFolder + sep) ||
          thisFolder.startsWith(otherFolder + sep)
        ) {
          setFolderOverlapError(
            `Watch folder overlaps with "${other.name}" (${other.localFolder}). Each connection must watch a unique, non-nested folder.`
          )
          return
        }
      }
    }

    setSaving(true)
    const toSave = {
      ...conn,
      name: conn.name.trim(),
      sftp: { ...conn.sftp, port: Number(conn.sftp.port) || 22 },
    }
    const list    = await window.winraid?.config.get('connections') ?? []
    const idx     = list.findIndex((c) => c.id === toSave.id)
    const updated = idx === -1
      ? [...list, toSave]
      : list.map((c) => c.id === toSave.id ? toSave : c)
    await window.winraid?.config.set('connections', updated)
    setSaving(false)
    onSave(toSave)
  }

  async function handleDelete() {
    if (!existing) return
    setDeleting(true)
    const list    = await window.winraid?.config.get('connections') ?? []
    const updated = list.filter((c) => c.id !== conn.id)
    await window.winraid?.config.set('connections', updated)
    setDeleting(false)
    onSave(null)
  }

  async function handleVerifyClean() {
    setShowVerifyConfirm(false)
    setVerifying(true)
    setVerifyError(null)
    const res = await window.winraid?.remote.verifyClean(conn.id, conn.localFolder)
    setVerifying(false)
    if (!res?.ok) {
      setVerifyError(res?.error || 'Verify & Clean failed')
      return
    }
    setVerifyCheckResult(res)
  }

  const canSave = conn.name.trim().length > 0 && (
    conn.type === 'sftp' ? conn.sftp.host.trim().length > 0
                         : conn.smb.host.trim().length > 0
  )

  const sftpCfg = {
    host:     conn.sftp.host,
    port:     Number(conn.sftp.port) || 22,
    username: conn.sftp.username,
    password: conn.sftp.password || undefined,
    keyPath:  conn.sftp.keyPath  || undefined,
  }

  return (
    <div className={styles.container}>

      {/* Page header */}
      <div className={styles.pageHeader}>
        <button className={styles.backBtn} onClick={onClose}>
          <ArrowLeft size={16} strokeWidth={1.75} />
          <span>Back</span>
        </button>
        <h2 className={styles.pageTitle}>
          {existing ? conn.name || 'Edit Connection' : 'New Connection'}
        </h2>
      </div>

      <div className={styles.scrollBody}>

        {/* Identity */}
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Identity</h3>
          <div className={styles.fields}>
            <Field label="Name" required hint={HINTS.name}>
              <div className={styles.inputRow}>
                <IconPicker value={conn.icon ?? null} onChange={(icon) => setTop('icon', icon)} />
                <input
                  className={styles.input}
                  value={conn.name}
                  onChange={(e) => setTop('name', e.target.value)}
                  placeholder="Home NAS"
                  autoFocus
                />
              </div>
            </Field>
          </div>
        </div>

        {/* Protocol + credentials */}
        <div className={styles.block}>
          <div className={styles.blockTitleRow}>
            <h3 className={styles.blockTitle}>Connection</h3>
            {conn.type === 'sftp' && (
              <Tooltip tip={HINTS.wizardBtn} side="left">
                <Button variant="ghost" size="sm" onClick={() => setShowWizard(true)}>
                  Import from SSH config…
                </Button>
              </Tooltip>
            )}
          </div>
          <div className={styles.fields}>

            <Field label="Protocol">
              <div className={styles.tabs}>
                {[['sftp', 'SSH / SFTP'], ['smb', 'SMB']].map(([v, l]) => (
                  <button
                    key={v}
                    className={[styles.tab, conn.type === v ? styles.active : ''].join(' ')}
                    onClick={() => setTop('type', v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>

            {conn.type === 'sftp' && <>
              <Field label="Host" required hint={HINTS.sftpHost}>
                <input className={styles.input} value={conn.sftp.host}
                  onChange={(e) => setSftp('host', e.target.value)} />
              </Field>
              <Field label="Port" hint={HINTS.sftpPort}>
                <input className={`${styles.input} ${styles.short}`} type="number"
                  value={conn.sftp.port}
                  onChange={(e) => setSftp('port', e.target.value)} />
              </Field>
              <Field label="Username" required hint={HINTS.sftpUsername}>
                <input className={styles.input} value={conn.sftp.username}
                  onChange={(e) => setSftp('username', e.target.value)}
                  autoComplete="off" />
              </Field>
              <Field label="Password" hint={HINTS.sftpPassword}>
                <input className={styles.input} type="password" value={conn.sftp.password}
                  onChange={(e) => setSftp('password', e.target.value)}
                  autoComplete="new-password" />
              </Field>
              <Field label="Key path" hint={HINTS.sftpKeyPath}>
                <input className={styles.input} value={conn.sftp.keyPath}
                  onChange={(e) => setSftp('keyPath', e.target.value)}
                  placeholder="C:\Users\you\.ssh\id_rsa" spellCheck={false} />
              </Field>
              <Field label="Remote path" hint={HINTS.sftpRemote}>
                <div className={styles.inputRow}>
                  <input className={styles.input} value={conn.sftp.remotePath}
                    onChange={(e) => setSftp('remotePath', e.target.value)}
                    placeholder="/mnt/user/share" spellCheck={false} />
                  <Tooltip tip={HINTS.browseRemote} side="left">
                    <Button variant="ghost" size="compact"
                      onClick={() => setShowBrowser(true)}
                      disabled={!conn.sftp.host || !conn.sftp.username}
                    >
                      Browse
                    </Button>
                  </Tooltip>
                </div>
              </Field>
              <div className={styles.testRow}>
                <Tooltip tip={HINTS.testConn} side="left">
                  <Button
                    variant="secondary" size="sm"
                    onClick={handleTest}
                    disabled={testStatus === 'testing' || !conn.sftp.host || !conn.sftp.username}
                  >
                    {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
                  </Button>
                </Tooltip>
                {testStatus === 'ok'  && <span className={styles.testOk}>Connected</span>}
                {testStatus?.error    && <span className={styles.testError}>{testStatus.error}</span>}
              </div>
            </>}

            {conn.type === 'smb' && <>
              <Field label="Host" required hint={HINTS.smbHost}>
                <input className={styles.input} value={conn.smb.host}
                  onChange={(e) => setSmb('host', e.target.value)} placeholder="nas.local" />
              </Field>
              <Field label="Share" required hint={HINTS.smbShare}>
                <input className={styles.input} value={conn.smb.share}
                  onChange={(e) => setSmb('share', e.target.value)} placeholder="media" />
              </Field>
              <Field label="Username" hint={HINTS.smbUsername}>
                <input className={styles.input} value={conn.smb.username}
                  onChange={(e) => setSmb('username', e.target.value)} />
              </Field>
              <Field label="Password" hint={HINTS.smbPassword}>
                <input className={styles.input} type="password" value={conn.smb.password}
                  onChange={(e) => setSmb('password', e.target.value)} />
              </Field>
              <Field label="Remote path" hint={HINTS.smbRemote}>
                <input className={styles.input} value={conn.smb.remotePath}
                  onChange={(e) => setSmb('remotePath', e.target.value)}
                  placeholder="\videos" spellCheck={false} />
              </Field>
            </>}

          </div>
        </div>

        {/* Source */}
        <div className={styles.block}>
          <h3 className={styles.blockTitle}>Source</h3>
          <div className={styles.fields}>

            <Field label="Watch folder" hint={HINTS.localFolder}>
              <div className={styles.inputRow}>
                <input
                  className={styles.input}
                  value={conn.localFolder}
                  onChange={(e) => { setTop('localFolder', e.target.value); setFolderOverlapError(null) }}
                  placeholder="Optional — leave blank to browse only"
                  spellCheck={false}
                />
                <Tooltip tip="Open a folder picker dialog." side="left">
                  <Button variant="ghost" size="compact" onClick={handleBrowseLocal}>Browse</Button>
                </Tooltip>
              </div>
            </Field>

            {conn.localFolder && (
              <>
                <Field label="Operation">
                  <ToggleGroup
                    value={conn.operation}
                    onChange={(v) => setTop('operation', v)}
                    options={[
                      { value: 'copy', label: 'Copy', tip: HINTS.opCopy },
                      { value: 'move', label: 'Move', tip: HINTS.opMove },
                    ]}
                  />
                </Field>

                <Field label="Folder structure">
                  <div className={styles.folderModeRow}>
                    <ToggleGroup
                      value={conn.folderMode}
                      onChange={(v) => setTop('folderMode', v)}
                      options={[
                        { value: 'flat',         label: 'Flat',           tip: HINTS.modeFlat },
                        { value: 'mirror',       label: 'Mirror',         tip: HINTS.modeMirror },
                        { value: 'mirror_clean', label: 'Mirror + clean', tip: HINTS.modeMirrorClean },
                      ]}
                    />
                    {conn.type === 'sftp' && (
                      <Tooltip tip={HINTS.verifyClean} side="left">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setShowVerifyConfirm(true)}
                          disabled={verifying || !conn.localFolder || !conn.sftp.host}
                        >
                          <ShieldCheck size={13} />
                          {verifying ? 'Verifying…' : 'Verify & Clean'}
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                </Field>

                <Field label="Extensions" hint={HINTS.extensions}>
                  <ExtensionPicker
                    value={conn.extensions}
                    onChange={(v) => setTop('extensions', v)}
                  />
                </Field>
              </>
            )}

            {verifyError && (
              <div className={styles.testRow}>
                <span className={styles.testError}>{verifyError}</span>
              </div>
            )}

            {folderOverlapError && (
              <div className={styles.testRow}>
                <span className={styles.testError}>{folderOverlapError}</span>
              </div>
            )}

          </div>
        </div>

      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {existing && (
          <Button variant="danger" onClick={handleDelete} disabled={deleting || saving}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        )}
        <div className={styles.footerRight}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Add connection'}
          </Button>
        </div>
      </div>

      {showWizard && (
        <SSHWizardDialog onApply={applyWizardEntry} onClose={() => setShowWizard(false)} />
      )}
      {showBrowser && (
        <RemotePathBrowser
          sftpCfg={sftpCfg}
          initialPath={conn.sftp.remotePath || '/mnt/user'}
          onSelect={(path) => setSftp('remotePath', path)}
          onClose={() => setShowBrowser(false)}
        />
      )}
      {showVerifyConfirm && (
        <VerifyConfirmDialog
          localFolder={conn.localFolder}
          onConfirm={handleVerifyClean}
          onClose={() => setShowVerifyConfirm(false)}
        />
      )}
      {verifyCheckResult && (
        <VerifyResultDialog
          result={verifyCheckResult}
          onEnqueue={(paths) => window.winraid?.queue.enqueueBatch(conn.id, conn.localFolder, paths)}
          onDelete={(paths) => window.winraid?.remote.verifyDelete(conn.localFolder, paths)}
          onClose={() => setVerifyCheckResult(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field
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
// ToggleGroup
// ---------------------------------------------------------------------------
function ToggleGroup({ options, value, onChange }) {
  return (
    <div className={styles.toggleGroup}>
      {options.map(({ value: v, label, tip }) => {
        const btn = (
          <button
            key={v}
            type="button"
            className={[styles.toggleOption, value === v ? styles.toggleActive : '']
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
// ExtensionPicker
// ---------------------------------------------------------------------------
function ExtensionPicker({ value, onChange }) {
  const [open,     setOpen]    = useState(false)
  const [query,    setQuery]   = useState('')
  const containerRef = useRef(null)
  const inputRef     = useRef(null)
  const dropRef      = useRef(null)
  const [dropRect,   setDropRect] = useState(null)
  const chipRowRef   = useRef(null)

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

  useEffect(() => {
    if (!open || !chipRowRef.current) return
    const el = chipRowRef.current
    const update = () => {
      const r = el.getBoundingClientRect()
      setDropRect({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    const obs = new ResizeObserver(update)
    obs.observe(el)
    update()
    return () => obs.disconnect()
  }, [open])

  function openDrop() { setOpen(true); inputRef.current?.focus() }

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
    if (e.key === 'Enter')    { e.preventDefault(); addCustom() }
    if (e.key === 'Escape')   setOpen(false)
    if (e.key === 'Backspace' && !query && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const q     = query.trim().toLowerCase()
  const qNorm = q ? (q.startsWith('.') ? q : '.' + q) : ''

  const filteredGroups = Object.entries(EXTENSION_PRESETS)
    .map(([group, exts]) => [group, exts.filter((e) => !qNorm || e.includes(qNorm))])
    .filter(([, exts]) => exts.length > 0)

  const isCustom = qNorm && qNorm !== '.' && !ALL_PRESET_EXTS.includes(qNorm)

  return (
    <div ref={containerRef} className={styles.extPicker}>
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

      {open && dropRect && createPortal(
        <div
          ref={dropRef}
          className={styles.extDropdown}
          style={{ top: dropRect.top, left: dropRect.left, width: dropRect.width }}
          onMouseDown={(e) => e.preventDefault()}
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
  const [entries,  setEntries]  = useState(null)
  const [selected, setSelected] = useState(0)
  const [err,      setErr]      = useState(null)

  useEffect(() => {
    window.winraid?.ssh.scanConfigs()
      .then((list) => setEntries(list ?? []))
      .catch((e) => setErr(e.message))
  }, [])

  const sel = entries?.[selected]

  return createPortal(
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
                  key={`${e.host}:${e.port}:${e.username}`}
                  role="option"
                  aria-selected={selected === i}
                  className={[styles.wizardEntry, selected === i ? styles.wizardEntrySelected : '']
                    .filter(Boolean).join(' ')}
                  onClick={() => setSelected(i)}
                >
                  <div className={styles.wizardRadio}>
                    {selected === i && <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>}
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
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// VerifyConfirmDialog
// ---------------------------------------------------------------------------
function VerifyConfirmDialog({ localFolder, onConfirm, onClose }) {
  return createPortal(
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Verify &amp; Clean</span>
          <button className={styles.dialogCloseBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.dialogBody}>
          <div className={styles.verifyConfirmText}>
            Each file inside
            <div className={styles.verifyPathRow}>
              <span className={styles.verifyPathValue}>{localFolder || '(not set)'}</span>
            </div>
            will be checked against the remote path via SFTP. Results are shown in a dialog where you can enqueue missing files, delete confirmed local copies, or ignore either group.
          </div>
        </div>
        <div className={styles.dialogFooter}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm}>Run</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// VerifyResultDialog — shows check results with per-group action buttons
// ---------------------------------------------------------------------------
function VerifyResultDialog({ result, onEnqueue, onDelete, onClose }) {
  const [enqueueing,   setEnqueueing]   = useState(false)
  const [enqueued,     setEnqueued]     = useState(false)
  const [notFoundDone, setNotFoundDone] = useState(false)
  const [deleting,     setDeleting]     = useState(false)
  const [deleted,      setDeleted]      = useState(null)   // { count, errors[] } once done
  const [confirmedDone, setConfirmedDone] = useState(false)

  async function handleEnqueue() {
    setEnqueueing(true)
    await onEnqueue(result.notFound)
    setEnqueueing(false)
    setEnqueued(true)
  }

  async function handleDelete() {
    setDeleting(true)
    const res = await onDelete(result.confirmed)
    setDeleting(false)
    setDeleted({ count: res?.deleted ?? 0, errors: res?.errors ?? [] })
  }

  const showNotFound  = result.notFound.length  > 0 && !notFoundDone
  const showConfirmed = result.confirmed.length > 0 && !confirmedDone

  return createPortal(
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>Verify &amp; Clean — Results</span>
          <button className={styles.dialogCloseBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.dialogBody}>
          <div className={styles.verifySummaryRow}>
            {result.total} file{result.total !== 1 ? 's' : ''} checked
            {' · '}
            <span className={result.notFound.length ? styles.verifyStatWarn : ''}>
              {result.notFound.length} not on NAS
            </span>
            {' · '}
            {result.confirmed.length} confirmed
          </div>

          {showNotFound && (
            <div className={styles.verifySection}>
              <div className={styles.verifySectionTitle}>
                Not on NAS — {result.notFound.length} file{result.notFound.length !== 1 ? 's' : ''}
              </div>
              <div className={styles.verifyListItems}>
                {result.notFound.slice(0, 20).map((f) => (
                  <div key={f} className={`${styles.verifyListItem} ${styles.verifyListItemWarn}`}>{f}</div>
                ))}
                {result.notFound.length > 20 && (
                  <div className={styles.verifyListMore}>+{result.notFound.length - 20} more</div>
                )}
              </div>
              <div className={styles.verifySectionActions}>
                <Button variant="secondary" size="sm" onClick={() => setNotFoundDone(true)} disabled={enqueueing || enqueued}>
                  Ignore
                </Button>
                <Button variant="primary" size="sm" onClick={handleEnqueue} disabled={enqueueing || enqueued}>
                  {enqueued ? 'Enqueued' : enqueueing ? 'Enqueueing…' : `Enqueue ${result.notFound.length} file${result.notFound.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </div>
          )}
          {!showNotFound && result.notFound.length > 0 && (
            <div className={styles.verifySectionDone}>
              {enqueued
                ? `${result.notFound.length} file${result.notFound.length !== 1 ? 's' : ''} enqueued for upload.`
                : `${result.notFound.length} missing file${result.notFound.length !== 1 ? 's' : ''} ignored.`}
            </div>
          )}

          {showConfirmed && (
            <div className={styles.verifySection}>
              <div className={styles.verifySectionTitle}>
                Confirmed on NAS — {result.confirmed.length} file{result.confirmed.length !== 1 ? 's' : ''}
              </div>
              <div className={styles.verifyListItems}>
                {result.confirmed.slice(0, 20).map((f) => (
                  <div key={f} className={styles.verifyListItem}>{f}</div>
                ))}
                {result.confirmed.length > 20 && (
                  <div className={styles.verifyListMore}>+{result.confirmed.length - 20} more</div>
                )}
              </div>
              <div className={styles.verifySectionActions}>
                <Button variant="secondary" size="sm" onClick={() => setConfirmedDone(true)} disabled={deleting || deleted !== null}>
                  Ignore
                </Button>
                <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting || deleted !== null}>
                  {deleted !== null ? `Deleted ${deleted.count}` : deleting ? 'Deleting…' : `Delete ${result.confirmed.length} local file${result.confirmed.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
              {deleted?.errors?.length > 0 && (
                <div className={styles.verifyErrors}>
                  {deleted.errors.map((e) => (
                    <div key={e.file} className={styles.verifyErrorItem}>{e.file}: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!showConfirmed && result.confirmed.length > 0 && (
            <div className={styles.verifySectionDone}>
              {deleted !== null
                ? `${deleted.count} local file${deleted.count !== 1 ? 's' : ''} deleted.${deleted.errors.length ? ` ${deleted.errors.length} error(s).` : ''}`
                : `${result.confirmed.length} confirmed file${result.confirmed.length !== 1 ? 's' : ''} ignored.`}
            </div>
          )}

          {result.notFound.length === 0 && result.confirmed.length === 0 && (
            <div className={styles.verifySectionDone}>Nothing to action — all files match.</div>
          )}
        </div>

        <div className={styles.dialogFooter}>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
