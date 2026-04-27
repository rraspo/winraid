import { useState, useEffect, useCallback, useRef } from 'react'

export function usePlayIndex(connId, path) {
  const [files,       setFiles]       = useState([])
  const [index,       setIndex]       = useState(0)
  const [scanning,    setScanning]    = useState(true)
  const [error,       setError]       = useState(null)
  const [recursive,   setRecursive]   = useState(true)
  const [shuffle,     setShuffle]     = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [scanKey,     setScanKey]     = useState(0)

  const indexRef = useRef(0)
  indexRef.current = index

  const filesRef   = useRef([])
  const shuffleRef = useRef(shuffle)
  shuffleRef.current = shuffle

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
    filesRef.current = []
    setIndex(0)
    setScanning(true)
    setError(null)

    const scanPath = path  // capture root path for fatal-error detection

    const unsubFound = window.winraid?.remote.onMediaFound(({ files: incoming }) => {
      setFiles((prev) => {
        let next
        if (shuffleRef.current) {
          next = [...prev]
          const start = indexRef.current + 1
          for (const f of incoming) {
            const pos = start + Math.floor(Math.random() * (next.length - start + 1))
            next.splice(pos, 0, f)
          }
        } else {
          next = [...prev, ...incoming]
        }
        filesRef.current = next
        return next
      })
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
    setIndex((i) => (filesRef.current.length === 0 ? 0 : Math.min(i + 1, filesRef.current.length - 1)))
  }, [])

  const prev = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0))
  }, [])

  const toggleShuffle = useCallback(() => {
    setShuffle((prevShuffle) => {
      const nextShuffle = !prevShuffle
      if (nextShuffle) {
        setFiles((prevFiles) => {
          const arr   = [...prevFiles]
          filesRef.current = arr
          const start = indexRef.current + 1
          for (let i = arr.length - 1; i > start; i--) {
            const j = start + Math.floor(Math.random() * (i - start + 1))
            ;[arr[i], arr[j]] = [arr[j], arr[i]]
          }
          return arr
        })
      }
      return nextShuffle
    })
  }, [])

  const toggleRecursive = useCallback(() => {
    setRecursive((r) => !r)
  }, [])

  const retry = useCallback(() => setScanKey((k) => k + 1), [])

  return { files, index, setIndex, scanning, recursive, toggleRecursive, shuffle, toggleShuffle, next, prev, error, retry }
}
