import { useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ConnectionModal.module.css'

const EMPTY_SFTP = { host: '', port: 22, username: '', password: '', keyPath: '', remotePath: '' }
const EMPTY_SMB  = { host: '', share: '', username: '', password: '', remotePath: '' }

function makeDefault(existing) {
  if (existing) return existing
  return {
    id:   crypto.randomUUID(),
    name: '',
    type: 'sftp',
    sftp: { ...EMPTY_SFTP },
    smb:  { ...EMPTY_SMB  },
  }
}

// ---------------------------------------------------------------------------
// ConnectionModal
// Props:
//   existing  — connection object to edit, or null for a new one
//   onSave(conn) — called with the saved connection object
//   onClose() — called to dismiss
// ---------------------------------------------------------------------------
export default function ConnectionModal({ existing, onSave, onClose }) {
  const [conn,       setConn]       = useState(() => makeDefault(existing))
  const [testStatus, setTestStatus] = useState(null) // null | 'testing' | 'ok' | { error }
  const [saving,     setSaving]     = useState(false)
  const [deleting,   setDeleting]   = useState(false)

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
    setSaving(true)

    // Normalise port
    const toSave = {
      ...conn,
      name: conn.name.trim(),
      sftp: { ...conn.sftp, port: Number(conn.sftp.port) || 22 },
    }

    // Persist into connections array
    const existing_list = await window.winraid?.config.get('connections') ?? []
    const idx = existing_list.findIndex((c) => c.id === toSave.id)
    const updated = idx === -1
      ? [...existing_list, toSave]
      : existing_list.map((c) => c.id === toSave.id ? toSave : c)

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
    const activeId = await window.winraid?.config.get('activeConnectionId')
    if (activeId === conn.id) {
      await window.winraid?.config.set('activeConnectionId', null)
    }
    setDeleting(false)
    onSave(null)  // signal refresh; null indicates deletion
  }

  const canSave = conn.name.trim().length > 0 && (
    conn.type === 'sftp' ? conn.sftp.host.trim().length > 0
                         : conn.smb.host.trim().length > 0
  )

  return createPortal(
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>

        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title}>
            {existing ? 'Edit connection' : 'New connection'}
          </span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className={styles.body}>

          {/* Name */}
          <Field label="Name" required>
            <input
              className={styles.input}
              value={conn.name}
              onChange={(e) => setTop('name', e.target.value)}
              placeholder="Home NAS"
              autoFocus
            />
          </Field>

          {/* Type tabs */}
          <Field label="Protocol">
            <div className={styles.tabs}>
              {[['sftp', 'SSH / SFTP'], ['smb', 'SMB']].map(([v, l]) => (
                <button
                  key={v}
                  className={[styles.tab, conn.type === v ? styles.tabActive : ''].join(' ')}
                  onClick={() => setTop('type', v)}
                >
                  {l}
                </button>
              ))}
            </div>
          </Field>

          {/* SFTP fields */}
          {conn.type === 'sftp' && <>
            <Field label="Host" required>
              <input className={styles.input} value={conn.sftp.host}
                onChange={(e) => setSftp('host', e.target.value)}
                placeholder="192.168.1.100" />
            </Field>
            <Field label="Port">
              <input className={`${styles.input} ${styles.short}`} type="number"
                value={conn.sftp.port}
                onChange={(e) => setSftp('port', e.target.value)} />
            </Field>
            <Field label="Username" required>
              <input className={styles.input} value={conn.sftp.username}
                onChange={(e) => setSftp('username', e.target.value)}
                autoComplete="off" />
            </Field>
            <Field label="Password">
              <input className={styles.input} type="password" value={conn.sftp.password}
                onChange={(e) => setSftp('password', e.target.value)}
                autoComplete="new-password" />
            </Field>
            <Field label="Key path">
              <input className={styles.input} value={conn.sftp.keyPath}
                onChange={(e) => setSftp('keyPath', e.target.value)}
                placeholder="C:\Users\you\.ssh\id_rsa" spellCheck={false} />
            </Field>
            <Field label="Remote path">
              <input className={styles.input} value={conn.sftp.remotePath}
                onChange={(e) => setSftp('remotePath', e.target.value)}
                placeholder="/mnt/user/share" spellCheck={false} />
            </Field>
            <div className={styles.testRow}>
              <button
                className={styles.testBtn}
                onClick={handleTest}
                disabled={testStatus === 'testing' || !conn.sftp.host || !conn.sftp.username}
              >
                {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
              </button>
              {testStatus === 'ok' && <span className={styles.testOk}>Connected</span>}
              {testStatus?.error && <span className={styles.testErr}>{testStatus.error}</span>}
            </div>
          </>}

          {/* SMB fields */}
          {conn.type === 'smb' && <>
            <Field label="Host" required>
              <input className={styles.input} value={conn.smb.host}
                onChange={(e) => setSmb('host', e.target.value)}
                placeholder="nas.local" />
            </Field>
            <Field label="Share" required>
              <input className={styles.input} value={conn.smb.share}
                onChange={(e) => setSmb('share', e.target.value)}
                placeholder="media" />
            </Field>
            <Field label="Username">
              <input className={styles.input} value={conn.smb.username}
                onChange={(e) => setSmb('username', e.target.value)} />
            </Field>
            <Field label="Password">
              <input className={styles.input} type="password" value={conn.smb.password}
                onChange={(e) => setSmb('password', e.target.value)} />
            </Field>
            <Field label="Remote path">
              <input className={styles.input} value={conn.smb.remotePath}
                onChange={(e) => setSmb('remotePath', e.target.value)}
                placeholder="\videos" spellCheck={false} />
            </Field>
          </>}

        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {existing && (
            <button
              className={styles.deleteBtn}
              onClick={handleDelete}
              disabled={deleting || saving}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!canSave || saving}
          >
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Add connection'}
          </button>
        </div>

      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------------------
// Field — label + control row
// ---------------------------------------------------------------------------
function Field({ label, required, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
        {required && <span className={styles.req}>*</span>}
      </label>
      <div>{children}</div>
    </div>
  )
}
