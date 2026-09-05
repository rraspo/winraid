import { useCallback, useRef, useState } from 'react'
import * as toast from '../services/toast'

// Root-safe join, mirroring the same helper used by the browse-side bulk
// operations: a root of "/" gets the name appended directly, anything else
// gets a single "/" separator.
export function joinRemote(base, name) {
  const trimmedBase = base.replace(/\/+$/, '') || '/'
  return trimmedBase === '/' ? `/${name}` : `${trimmedBase}/${name}`
}

function dirOf(remotePath) {
  const lastSlash = remotePath.lastIndexOf('/')
  return lastSlash <= 0 ? '/' : remotePath.slice(0, lastSlash)
}

// Whether a destination folder still falls within the current scan: always
// when it's the scan root itself, and additionally any subfolder of it when
// the scan is recursive.
function isWithinScan(destinationFolder, scanRoot, recursive) {
  const normalizedRoot = scanRoot.replace(/\/+$/, '') || '/'
  if (destinationFolder === normalizedRoot) return true
  if (!recursive) return false
  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`
  return destinationFolder.startsWith(prefix)
}

// Sequential delete/move loops for the play wall's bulk selection actions.
// Both loops process one file at a time — never in parallel — so a slow or
// failing remote call never races another, and report progress as they go
// via `inFlight` so the bulk bar can show "Deleting <i> of <n>" /
// "Moving <i> of <n>".
export function usePlayMutations({ connectionId, removePaths, relocatePaths, dropFromSelection, onMutated }) {
  const [inFlight, setInFlight] = useState(null)
  const inFlightRef = useRef(false)

  const deleteFiles = useCallback(async (files) => {
    if (inFlightRef.current || files.length === 0) return
    inFlightRef.current = true
    const total = files.length
    let succeededCount = 0
    let failedCount = 0
    const succeededPaths = []
    for (let index = 0; index < files.length; index++) {
      setInFlight({ kind: 'delete', done: index, total })
      const file = files[index]
      const result = await window.winraid.remote.delete(connectionId, file.path, false)
      if (result?.ok) {
        window.winraid.cache.invalidateFile(connectionId, file.path)
        removePaths([file.path])
        dropFromSelection([file.path])
        succeededCount++
        succeededPaths.push(file.path)
      } else {
        failedCount++
      }
    }
    inFlightRef.current = false
    setInFlight(null)
    if (failedCount === 0) {
      toast.show({ msg: `Deleted ${succeededCount} item${succeededCount !== 1 ? 's' : ''}`, type: 'success' })
    } else {
      toast.show({ msg: `Deleted ${succeededCount}, failed ${failedCount}`, type: 'error' })
    }
    if (succeededPaths.length > 0) onMutated?.({ paths: succeededPaths })
  }, [connectionId, removePaths, dropFromSelection, onMutated])

  // `pairs` is [{ from, to }] in wall order. `isSingle` picks the success
  // toast copy (a rename reads "Moved to <path>"; a bulk move reads
  // "Moved <n> items to <dest>", using `dest` for the destination folder).
  const moveFiles = useCallback(async (pairs, { isSingle, scanRoot, recursive, dest }) => {
    if (inFlightRef.current || pairs.length === 0) return
    inFlightRef.current = true
    const total = pairs.length
    let succeededCount = 0
    let failedCount = 0
    const touchedPaths = []
    let lastSucceededTo = null
    for (let index = 0; index < pairs.length; index++) {
      setInFlight({ kind: 'move', done: index, total })
      const { from, to } = pairs[index]
      const result = await window.winraid.remote.move(connectionId, from, to)
      if (result?.ok) {
        const destinationFolder = dirOf(to)
        if (isWithinScan(destinationFolder, scanRoot, recursive)) {
          relocatePaths([{ from, to }])
        } else {
          removePaths([from])
        }
        dropFromSelection([from])
        succeededCount++
        lastSucceededTo = to
        touchedPaths.push(from, to)
      } else {
        failedCount++
      }
    }
    inFlightRef.current = false
    setInFlight(null)
    if (failedCount > 0) {
      toast.show({ msg: `Moved ${succeededCount}, failed ${failedCount}`, type: 'error' })
    } else if (isSingle) {
      toast.show({ msg: `Moved to ${lastSucceededTo}`, type: 'success' })
    } else {
      toast.show({ msg: `Moved ${succeededCount} item${succeededCount !== 1 ? 's' : ''} to ${dest}`, type: 'success' })
    }
    if (touchedPaths.length > 0) onMutated?.({ paths: touchedPaths })
  }, [connectionId, removePaths, relocatePaths, dropFromSelection, onMutated])

  return { inFlight, deleteFiles, moveFiles }
}
