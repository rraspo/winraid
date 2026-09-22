import { useEffect, useRef, useState, useId } from 'react'
import { Info, Loader } from 'lucide-react'
import * as remoteFS from '../../services/remoteFS'
import { localMirrorPath } from '../../utils/mirrorPath'
import { formatSize, formatDate } from '../../utils/format'
import { formatMode } from '../../utils/formatMode'
import styles from './modals.module.css'

function PropRow({ label, value }) {
  return (
    <div className={styles.propRow}>
      <span className={styles.propLabel}>{label}</span>
      <span className={styles.propValue}>{value}</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className={styles.propSection}>
      <h3 className={styles.propSectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

// Recursive size of a single folder, computed only when asked (never on
// open) by reusing the same tool the Size map view drills subtrees with:
// list the folder's immediate children for their types, sum files directly
// from the listing, and stream each subdirectory's own recursive size from
// remote:size-scan-subtree. Knowing which children are directories up front
// (from the listing, not the size-scan payload) is what lets this tell "done"
// from "still waiting" without an explicit completion event.
function useFolderSizeScan(connectionId, folderPath) {
  const [phase, setPhase]         = useState('idle') // idle | scanning | done | error
  const [sizeBytes, setSizeBytes] = useState(null)
  const [error, setError]         = useState(null)
  const pendingDirs = useRef(new Set())
  const dirBytes    = useRef(new Map())
  const fileBytes   = useRef(0)
  const cancelledRef = useRef(false)

  useEffect(() => () => { cancelledRef.current = true }, [])

  useEffect(() => {
    if (!window.winraid?.remote?.onSizeLevel) return undefined
    return window.winraid.remote.onSizeLevel((payload) => {
      if (payload.connectionId !== connectionId || payload.parentPath !== folderPath) return
      for (const item of payload.entries ?? []) {
        if (!pendingDirs.current.has(item.name)) continue
        dirBytes.current.set(item.name, (item.sizeKb || 0) * 1024)
        pendingDirs.current.delete(item.name)
      }
      if (pendingDirs.current.size === 0) finish()
    })
  }, [connectionId, folderPath])

  function finish() {
    if (cancelledRef.current) return
    const dirTotal = [...dirBytes.current.values()].reduce((a, b) => a + b, 0)
    setSizeBytes(fileBytes.current + dirTotal)
    setPhase('done')
  }

  async function start() {
    setPhase('scanning')
    setError(null)
    fileBytes.current   = 0
    dirBytes.current    = new Map()
    pendingDirs.current = new Set()
    try {
      const children = await remoteFS.list(connectionId, folderPath)
      fileBytes.current = children.filter((c) => c.type !== 'dir').reduce((a, c) => a + (c.size || 0), 0)
      const dirs = children.filter((c) => c.type === 'dir')
      if (dirs.length === 0) { finish(); return }
      dirs.forEach((d) => pendingDirs.current.add(d.name))
      const res = await window.winraid?.remote.sizeScanSubtree?.(connectionId, folderPath)
      if (!res?.ok) throw new Error(res?.error || 'Scan failed')
    } catch (err) {
      if (cancelledRef.current) return
      setError(err.message || 'Scan failed')
      setPhase('error')
    }
  }

  return { phase, sizeBytes, error, start }
}

export default function PropertiesModal({ entries, connectionId, connection, copyPath, onClose }) {
  const single = entries.length === 1 ? entries[0] : null
  const titleId = useId()

  const [attrs, setAttrs]           = useState(null)
  const [attrsError, setAttrsError] = useState(null)
  const [mirror, setMirror]         = useState(null)
  const [multiMirror, setMultiMirror] = useState(null)

  const mirrorTargetPath = single ? localMirrorPath(connection, single.path) : null
  const folderScan = useFolderSizeScan(connectionId, single?.type === 'dir' ? single.path : null)

  // Remote attributes — a single non-recursive stat call, fine to fire on
  // open (unlike the folder-size walk, which is the one thing this dialog
  // must never do eagerly).
  useEffect(() => {
    if (!single) return undefined
    let cancelled = false
    setAttrs(null)
    setAttrsError(null)
    // Wrapped in a resolved promise (not chained directly) so a preload that
    // predates this surface — dev restart, version skew — degrades to a
    // reported error instead of a synchronous throw when entryInfo is absent.
    Promise.resolve()
      .then(() => window.winraid?.remote.entryInfo?.(connectionId, single.path))
      .then((res) => {
        if (cancelled) return
        if (res?.ok) setAttrs(res)
        else setAttrsError(res?.error || 'Could not read entry attributes')
      })
      .catch((err) => { if (!cancelled) setAttrsError(err?.message || 'Could not read entry attributes') })
    return () => { cancelled = true }
  }, [connectionId, single])

  // Mirror status — the section that justifies the dialog. Not-applicable is
  // its own rendered state (mirrorTargetPath === null), never an empty one.
  useEffect(() => {
    if (!single) return undefined
    if (!mirrorTargetPath) { setMirror(null); return undefined }
    let cancelled = false
    setMirror('loading')
    Promise.all([
      window.winraid?.local.stat?.(mirrorTargetPath),
      window.winraid?.queue.list?.(),
    ]).then(([statRes, jobs]) => {
      if (cancelled) return
      if (!statRes?.ok || !statRes.exists) { setMirror({ exists: false }); return }
      const sizeMatch  = statRes.size === single.size
      const mtimeMatch = single.modified ? Math.abs((statRes.mtime ?? 0) - single.modified) <= 1000 : null
      const queued = (jobs ?? []).some((j) => (
        j.srcPath === mirrorTargetPath && (j.status === 'PENDING' || j.status === 'TRANSFERRING')
      ))
      setMirror({ exists: true, sizeMatch, mtimeMatch, localMtime: statRes.mtime, queued })
    }).catch(() => { if (!cancelled) setMirror({ exists: false }) })
    return () => { cancelled = true }
  }, [single, mirrorTargetPath, connection])

  // Multi-selection mirror summary — "n of m mirrored", never per-entry.
  useEffect(() => {
    if (single) return undefined
    const candidates = entries.map((e) => localMirrorPath(connection, e.path)).filter(Boolean)
    if (candidates.length === 0) { setMultiMirror({ applicable: false }); return undefined }
    let cancelled = false
    Promise.all(candidates.map((p) => window.winraid?.local.stat?.(p)))
      .then((results) => {
        if (cancelled) return
        const mirroredCount = results.filter((r) => r?.ok && r.exists).length
        setMultiMirror({ applicable: true, mirroredCount, total: entries.length })
      })
      .catch(() => { if (!cancelled) setMultiMirror({ applicable: true, mirroredCount: 0, total: entries.length }) })
    return () => { cancelled = true }
  }, [single, entries, connection])

  const multiCount        = entries.length
  const multiHasFolders   = entries.some((e) => e.type === 'dir')
  const multiCombinedSize = entries.reduce((a, e) => a + (e.type === 'dir' ? 0 : (e.size || 0)), 0)
  const multiDirCount     = entries.filter((e) => e.type === 'dir').length
  const multiFileCount    = multiCount - multiDirCount

  const mode = attrs?.mode
  const modeLabel = mode ? `${mode}${formatMode(mode) ? ` (${formatMode(mode)})` : ''}` : ''

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.modalHeader}>
          <span className={styles.modalIconWrap}><Info size={20} /></span>
          <div>
            <h2 id={titleId} className={styles.modalTitle}>
              {single ? `${single.name} Properties` : `${multiCount} items — Properties`}
            </h2>
          </div>
        </div>

        <div className={styles.propSections}>
          {single ? (
            <>
              <Section title="Identity">
                <PropRow label="Name" value={single.name} />
                <PropRow
                  label="Location"
                  value={(
                    <button
                      type="button"
                      className={styles.propValueBtn}
                      title="Copy full path"
                      onClick={() => copyPath?.(single.path)}
                    >
                      {single.path}
                    </button>
                  )}
                />
                <PropRow label="Type" value={single.type === 'dir' ? 'Folder' : 'File'} />
              </Section>

              <Section title="Size and time">
                {single.type === 'dir' ? (
                  <div className={styles.propRow}>
                    <span className={styles.propLabel}>Size</span>
                    <span className={styles.propValue}>
                      {folderScan.phase === 'done' && formatSize(folderScan.sizeBytes)}
                      {folderScan.phase === 'scanning' && (
                        <>
                          <Loader size={13} className={styles.spinning} />
                          Calculating…
                        </>
                      )}
                      {(folderScan.phase === 'idle' || folderScan.phase === 'error') && (
                        <>
                          <button type="button" className={styles.propScanBtn} onClick={folderScan.start}>
                            Calculate size
                          </button>
                          {folderScan.phase === 'error' && (
                            <span className={styles.propError}>{folderScan.error}</span>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                ) : (
                  <PropRow label="Size" value={formatSize(single.size)} />
                )}
                <PropRow label="Modified" value={formatDate(single.modified)} />
                {attrs?.created && <PropRow label="Created" value={formatDate(attrs.created)} />}
              </Section>

              <Section title="Remote attributes">
                {attrsError ? (
                  <p className={styles.propNote}>Could not read attributes: {attrsError}</p>
                ) : !attrs ? (
                  <p className={styles.propNote}>Loading…</p>
                ) : (
                  <>
                    <PropRow label="Permissions" value={modeLabel} />
                    <PropRow label="Owner" value={attrs.owner} />
                    <PropRow label="Group" value={attrs.group} />
                    {attrs.isSymlink && (
                      <PropRow label="Symlink target" value={attrs.symlinkTarget || 'Unknown'} />
                    )}
                  </>
                )}
              </Section>

              <Section title="Mirror status">
                {!mirrorTargetPath ? (
                  <p className={styles.propNote}>Not applicable — this connection doesn&apos;t mirror to a local folder.</p>
                ) : mirror === null || mirror === 'loading' ? (
                  <p className={styles.propNote}>Loading…</p>
                ) : !mirror.exists ? (
                  <PropRow label="Local copy" value="Not present" />
                ) : (
                  <>
                    <PropRow label="Local copy" value="Present" />
                    <PropRow label="Size and time" value={mirror.sizeMatch && mirror.mtimeMatch !== false ? 'Match' : 'Different'} />
                    <PropRow label="Last transferred" value={formatDate(mirror.localMtime)} />
                    <PropRow label="Queued" value={mirror.queued ? 'Yes' : 'No'} />
                  </>
                )}
              </Section>
            </>
          ) : (
            <Section title="Selection">
              <PropRow label="Items" value={String(multiCount)} />
              <PropRow
                label="Combined size"
                value={multiHasFolders ? `${formatSize(multiCombinedSize)} (files only)` : formatSize(multiCombinedSize)}
              />
              <PropRow
                label="Breakdown"
                value={`${multiDirCount} ${multiDirCount === 1 ? 'folder' : 'folders'}, ${multiFileCount} ${multiFileCount === 1 ? 'file' : 'files'}`}
              />
              <PropRow
                label="Mirror status"
                value={
                  !multiMirror
                    ? 'Loading…'
                    : !multiMirror.applicable
                      ? 'Not applicable for this connection'
                      : `${multiMirror.mirroredCount} of ${multiMirror.total} mirrored`
                }
              />
            </Section>
          )}
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.modalCancel} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
