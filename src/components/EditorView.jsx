import { useState, useEffect, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView as CodeMirrorView } from '@codemirror/view'
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
// Editor chrome theme — reads the design tokens so CodeMirror follows the
// app's dark/light theme and accent color instead of a fixed palette.
// ---------------------------------------------------------------------------
const codeMirrorTheme = CodeMirrorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--card)',
    color: 'var(--text)',
  },
  '.cm-content': {
    caretColor: 'var(--text)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--text)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--active)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--hover)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface2)',
    color: 'var(--text3)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--hover)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface2)',
    borderColor: 'var(--stroke)',
    color: 'var(--text3)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--active)',
  },
})

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

  const saveState = saving ? 'Saving…' : isDirty ? 'Unsaved changes' : 'Saved'

  return (
    <div className={styles.root}>
      <div className={styles.topRow}>
        <Tooltip tip={filePath} side="bottom">
          <span className={styles.filename}>
            {filename}
            {isDirty && <span className={styles.dirtyDot}>●</span>}
          </span>
        </Tooltip>
        <div className={styles.topActions}>
          <button className={styles.discardBtn} onClick={() => setDraft(content)} disabled={!isDirty || saving || loading}>
            Discard
          </button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={!isDirty || saving || loading}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className={styles.editorWrap}>
        {loading ? (
          <div className={styles.loadingMsg}>Loading…</div>
        ) : (
          <CodeMirror
            value={draft}
            height="100%"
            theme={codeMirrorTheme}
            extensions={getLanguageExtensions(filename)}
            onChange={(val) => setDraft(val)}
            className={styles.cm}
            basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: true }}
          />
        )}
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerPath}>{filePath}</span>
        <span className={styles.footerSpacer} />
        <span className={styles.footerEncoding}>UTF-8 · LF</span>
        <span className={styles.footerStatus}>{saveState}</span>
        {error && <span className={styles.footerError}>{error}</span>}
      </footer>
    </div>
  )
}
