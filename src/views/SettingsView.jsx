import { useState, useEffect } from 'react'
import { Info } from 'lucide-react'
import Tooltip from '../components/ui/Tooltip'
import Button from '../components/ui/Button'
import styles from './SettingsView.module.css'

const HINTS = {
  queueExisting: 'When the scanner starts, scan the watch folder for files that appeared while it was stopped. Files already in the queue (pending or done) are skipped — only genuinely new arrivals are queued. Takes effect on next scanner start.',
  startWatcher:  'Begin scanning the watch folder for new files. Runs in the background even when the window is hidden to the tray.',
  stopWatcher:   'Pause scanning. Already-queued transfers still complete; new files are ignored until resumed.',
  save:          'Write all settings to disk.',
}

const DEFAULT_FORM = {
  watcher: { queueExisting: true },
}

export default function SettingsView() {
  const [form,    setForm]    = useState(DEFAULT_FORM)
  const [loaded,  setLoaded]  = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)
  const [watching, setWatching] = useState(false)

  useEffect(() => {
    async function load() {
      const cfg = await window.winraid?.config.get()
      if (!cfg) return
      setForm({
        watcher: { ...DEFAULT_FORM.watcher, ...cfg.watcher },
      })
      setLoaded(true)
    }
    load()
    const unsub = window.winraid?.watcher.onStatus((s) => setWatching(s.watching))
    return () => unsub?.()
  }, [])

  function setNested(section, key, value) {
    setForm((f) => ({ ...f, [section]: { ...f[section], [key]: value } }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      await window.winraid.config.set('watcher', form.watcher)
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
      const cfg = await window.winraid?.config.get()
      // localFolder lives on the active connection; fall back to legacy top-level key
      const activeConn = (cfg?.connections ?? []).find((c) => c.id === cfg?.activeConnectionId)
      const folder = activeConn?.localFolder ?? cfg?.localFolder ?? ''
      if (!folder) {
        setSaveMsg({ type: 'error', text: 'Configure a watch folder in the active connection settings first.' })
        return
      }
      await window.winraid?.watcher.start(folder)
    }
  }

  if (!loaded) {
    return (
      <div className={styles.container} style={{ color: 'var(--text-muted)', padding: 'var(--space-6)' }}>
        Loading…
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.scrollBody}>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>Scanner</div>
          <div className={styles.sectionBody}>
            <Field label="Queue existing files" hint={HINTS.queueExisting}>
              <Switch
                checked={form.watcher.queueExisting}
                onChange={(v) => setNested('watcher', 'queueExisting', v)}
              />
            </Field>
          </div>
        </section>

      </div>

      <div className={styles.footer}>
        <Tooltip tip={watching ? HINTS.stopWatcher : HINTS.startWatcher} side="left">
          <Button variant={watching ? 'danger' : 'secondary'} onClick={handleWatcherToggle}>
            {watching ? 'Stop scanner' : 'Start scanner'}
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
    </div>
  )
}

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

function Field({ label, hint, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
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
