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
import Tooltip from './ui/Tooltip'
import styles from './EditorView.module.css'

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------
function getLanguageExtensions(filename) {
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase()
  switch (ext) {
    case '.json':                          return [json()]
    case '.yml': case '.yaml':             return [yaml()]
    case '.sh': case '.bash': case '.zsh': return [StreamLanguage.define(shell)]
    case '.conf': case '.nginx':           return [StreamLanguage.define(nginx)]
    case '.ini': case '.env':              return [StreamLanguage.define(properties)]
    case '.toml':                          return [StreamLanguage.define(toml)]
    default:                               return []
  }
}

// ---------------------------------------------------------------------------
// EditorView — CodeMirror remote-file editor, hosted in a tab.
// ---------------------------------------------------------------------------
export default function EditorView({ connectionId, filePath, active = true, onDirtyChange }) {
  const [content, setContent] = useState('')
  const [draft,   setDraft]   = useState('')
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const isDirty  = draft !== content
  const filename = filePath.split('/').pop()

  // Load on mount / when the file changes.
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

  // Report dirty state up so App can guard tab close.
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError('')
    const res = await window.winraid?.remote.writeFile(connectionId, filePath, draft)
    setSaving(false)
    if (res?.ok) setContent(draft)
    else setError(res?.error || 'Failed to save file')
  }, [connectionId, filePath, draft])

  // Ctrl+S — only the active tab responds (editor tabs are kept alive).
  useEffect(() => {
    if (!active) return
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty && !saving && !loading) handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, isDirty, saving, loading, handleSave])

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Tooltip tip={filePath} side="bottom">
          <span className={styles.filePath}>
            {filePath}
            {isDirty && <span className={styles.dirtyDot}>●</span>}
          </span>
        </Tooltip>
      </div>

      <div className={styles.editorWrap}>
        {loading ? (
          <div className={styles.loadingMsg}>Loading…</div>
        ) : (
          <CodeMirror
            value={draft}
            height="100%"
            theme={oneDark}
            extensions={getLanguageExtensions(filename)}
            onChange={(val) => setDraft(val)}
            className={styles.cm}
            basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true }}
          />
        )}
      </div>

      <div className={styles.footer}>
        {error && <span className={styles.footerError}>{error}</span>}
        <div className={styles.footerActions}>
          <button className={styles.discardBtn} onClick={() => setDraft(content)} disabled={!isDirty || saving || loading}>
            Discard
          </button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={!isDirty || saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
