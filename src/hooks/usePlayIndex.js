import { useState, useEffect, useCallback, useRef } from 'react'

export function usePlayIndex(connId, path) {
  const [files,       setFiles]       = useState([])
  const [index,       setIndex]       = useState(0)
  const [scanning,    setScanning]    = useState(false)
  const [error,       setError]       = useState(null)
  const [recursive,   setRecursive]   = useState(true)
  const [shuffle,     setShuffle]     = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [scanKey,     setScanKey]     = useState(0)

  const indexRef = useRef(0)
  indexRef.current = index

  // Read defaults from config once on mount
  useEffect(() => {
    let cancelled = false
    window.winraid?.config.get('playDefaults')
      .then((defaults) => {
        if (cancelled) return
        if (defaults?.recursive !== undefined) setRecursive(defaults.recursive)
        if (defaults?.shuffle   !== undefined) setShuffle(defaults.shuffle)
        setInitialized(true)
      })
      .catch(() => { if (!cancelled) setInitialized(true) })
    return () => { cancelled = true }
  }, [])

  // Start / restart scan whenever connId, path, recursive, or scanKey changes
  useEffect(() => {
    if (!initialized) return
    setFiles([])
    setIndex(0)
    setScanning(true)
    setError(null)

    const scanPath = path  // capture root path for fatal-error detection

    const unsubFound = window.winraid?.remote.onMediaFound(({ files: incoming }) => {
      setFiles((prev) => [...prev, ...incoming])
    })
    const unsubDone  = window.winraid?.remote.onMediaDone(() => setScanning(false))
    // Fatal errors arrive with errPath === scanPath; per-directory errors are non-fatal
    const unsubError = window.winraid?.remote.onMediaError(({ path: errPath, msg }) => {
      if (errPath === scanPath) {
        setError(msg)
        setScanning(false)
      }
    })

    window.winraid?.remote.mediaScan(connId, path, { recursive })

    return () => {
      unsubFound?.()
      unsubDone?.()
      unsubError?.()
      window.winraid?.remote.mediaCancel(connId)
    }
  }, [connId, path, recursive, initialized, scanKey])

  const next = useCallback(() => {
    setFiles((prevFiles) => {
      setIndex((i) => Math.min(i + 1, prevFiles.length - 1))
      return prevFiles
    })
  }, [])

  const prev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0))
  }, [])

  const toggleShuffle = useCallback(() => {
    setShuffle((prevShuffle) => {
      const next = !prevShuffle
      if (next) {
        setFiles((prevFiles) => {
          const arr   = [...prevFiles]
          const start = indexRef.current + 1
          for (let i = arr.length - 1; i > start; i--) {
            const j = start + Math.floor(Math.random() * (i - start + 1))
            ;[arr[i], arr[j]] = [arr[j], arr[i]]
          }
          return arr
        })
      }
      return next
    })
  }, [])

  const toggleRecursive = useCallback(() => {
    setRecursive((r) => !r)
  }, [])

  const retry = useCallback(() => setScanKey((k) => k + 1), [])

  return { files, index, setIndex, scanning, recursive, toggleRecursive, shuffle, toggleShuffle, next, prev, error, retry }
}
