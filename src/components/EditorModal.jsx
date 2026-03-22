import { useState, useEffect, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { X } from 'lucide-react'
import Tooltip from './ui/Tooltip'
import styles from './EditorModal.module.css'

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------
function getExtension(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.json':                    return [json()]
    case '.yml': case '.yaml':       return [yaml()]
    case '.sh': case '.bash': case '.zsh':
      return [StreamLanguage.define(shell)]
    case '.conf': case '.nginx':
      return [StreamLanguage.define(nginx)]
    case '.ini': case '.env':
      return [StreamLanguage.define(properties)]
    case '.toml':
      return [StreamLanguage.define(toml)]
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// EditorModal
// ---------------------------------------------------------------------------
export default function EditorModal({ connectionId, filePath, onClose }) {
  const [content,  setContent]  = useState('')
  const [draft,    setDraft]    = useState('')
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const isDirty = draft !== content
  const filename = filePath.split('/').pop()

  // Load file on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      const res = await window.winraid?.remote.readFile(connectionId, filePath)
      if (cancelled) return
      setLoading(false)
      if (res?.ok) {
        setContent(res.content)
        setDraft(res.content)
      } else {
        setError(res?.error || 'Failed to read file')
      }
    }
    load()
    return () => { cancelled = true }
  }, [connectionId, filePath])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError('')
    const res = await window.winraid?.remote.writeFile(connectionId, filePath, draft)
    setSaving(false)
    if (res?.ok) {
      setContent(draft)
    } else {
      setError(res?.error || 'Failed to save file')
    }
  }, [connectionId, filePath, draft])

  // Ctrl+S to save
  useEffect(() => {
    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty && !saving && !loading) handleSave()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  })

  function handleDiscard() {
    setDraft(content)
  }

  function handleClose() {
    if (isDirty && !window.confirm('You have unsaved changes. Close anyway?')) return
    onClose()
  }

  const extensions = getExtension(filename)

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className={styles.modal}>

        {/* Header */}
        <div className={styles.header}>
          <Tooltip tip={filePath} side="bottom">
            <span className={styles.filePath}>
              {filePath}
              {isDirty && <Tooltip tip="Unsaved changes" side="bottom"><span className={styles.dirtyDot}>●</span></Tooltip>}
            </span>
          </Tooltip>
          <Tooltip tip="Close" side="bottom">
            <button className={styles.closeBtn} onClick={handleClose}>
              <X size={15} />
            </button>
          </Tooltip>
        </div>

        {/* Body */}
        <div className={styles.editorWrap}>
          {loading ? (
            <div className={styles.loadingMsg}>Loading…</div>
          ) : (
            <CodeMirror
              value={draft}
              height="100%"
              theme={oneDark}
              extensions={extensions}
              onChange={(val) => setDraft(val)}
              className={styles.cm}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLine: true,
                foldGutter: true,
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {error && <span className={styles.footerError}>{error}</span>}
          <div className={styles.footerActions}>
            <button
              className={styles.discardBtn}
              onClick={handleDiscard}
              disabled={!isDirty || saving || loading}
            >
              Discard
            </button>
            <button
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={!isDirty || saving || loading}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
