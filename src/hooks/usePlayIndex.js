import { useState, useEffect, useCallback, useRef } from 'react'

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Sequential pick: the alphabetic successor of `current` within `pool`.
// Falls back to the alphabetic smallest pool entry when nothing in pool
// sorts after `current` — this gives the user a "moving cursor" feel
// where flipping shuffle off mid-walk continues from where they are
// rather than restarting from the head of the pool.
function sequentialPickAfter(pool, current) {
  if (pool.length === 0) return null
  if (!current) return pool.reduce((min, f) => f.path.localeCompare(min.path) < 0 ? f : min)
  let after = null
  let smallest = pool[0]
  for (const f of pool) {
    if (f.path.localeCompare(smallest.path) < 0) smallest = f
    if (f.path.localeCompare(current.path) > 0) {
      if (after === null || f.path.localeCompare(after.path) < 0) after = f
    }
  }
  return after ?? smallest
}

function removeFirstMatch(arr, item) {
  const i = arr.indexOf(item)
  if (i === -1) return arr
  const copy = arr.slice()
  copy.splice(i, 1)
  return copy
}

export function usePlayIndex(connId, path, startFile = null) {
  // Consolidated state: the trail (walked path), the pool (unwalked),
  // and the user's position within the trail. Single state object so
  // updates that affect more than one field stay atomic.
  const [state, setState] = useState({ trail: [], pool: [], index: 0 })

  const [scanning,    setScanning]    = useState(true)
  const [error,       setError]       = useState(null)
  const [recursive,   setRecursive]   = useState(true)
  const [shuffle,     setShuffle]     = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [scanId,      setScanId]      = useState(0)

  // shuffleRef lets `next`'s setState updater read the latest shuffle
  // value without re-creating the callback on every shuffle change.
  const shuffleRef = useRef(shuffle)
  shuffleRef.current = shuffle

  // Read defaults from config once on mount.
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

  // Start / restart scan whenever connId, path, recursive, scanId, or
  // startFile changes. startFile lets the caller seed the trail with a
  // specific file (used when navigating between folders so the file the
  // user was looking at carries into the new scope's trail rather than
  // being lost).
  useEffect(() => {
    if (!initialized) return
    setState({
      trail: startFile ? [startFile] : [],
      pool:  [],
      index: 0,
    })
    setScanning(true)
    setError(null)

    const scanPath = path

    const unsubFound = window.winraid?.remote.onMediaFound(({ files: incoming }) => {
      if (!incoming || incoming.length === 0) return
      setState((s) => {
        // Dedup: skip files already present in trail or pool. Without this,
        // a startFile that's also emitted by the new scan would land in
        // both trail (as seed) and pool (as a regular emit).
        const seen = new Set([
          ...s.trail.map((f) => f.path),
          ...s.pool.map((f) => f.path),
        ])
        const fresh = incoming.filter((f) => !seen.has(f.path))
        if (fresh.length === 0) return s
        if (s.trail.length === 0) {
          return {
            trail: [fresh[0]],
            pool:  [...s.pool, ...fresh.slice(1)],
            index: 0,
          }
        }
        return { ...s, pool: [...s.pool, ...fresh] }
      })
    })
    const unsubDone  = window.winraid?.remote.onMediaDone(() => setScanning(false))
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
  }, [connId, path, recursive, initialized, scanId, startFile])

  const next = useCallback(() => {
    setState((s) => {
      if (s.index < s.trail.length - 1) {
        return { ...s, index: s.index + 1 }
      }
      if (s.pool.length === 0) return s
      const tip  = s.trail[s.trail.length - 1] ?? null
      const pick = shuffleRef.current ? randomPick(s.pool) : sequentialPickAfter(s.pool, tip)
      return {
        trail: [...s.trail, pick],
        pool:  removeFirstMatch(s.pool, pick),
        index: s.index + 1,
      }
    })
  }, [])

  const prev = useCallback(() => {
    setState((s) => ({ ...s, index: Math.max(s.index - 1, 0) }))
  }, [])

  // Fork-on-toggle: if the user has walked back into the trail and then
  // toggles shuffle, the forward path beyond their current position is
  // discarded — those files go back into the pool so the next pick is a
  // fresh decision in the new mode. At the trail tip there is nothing to
  // discard, so the toggle is a pure mode flip (history-frozen rule).
  const toggleShuffle = useCallback(() => {
    setState((s) => {
      if (s.index >= s.trail.length - 1) return s
      return {
        trail: s.trail.slice(0, s.index + 1),
        pool:  [...s.pool, ...s.trail.slice(s.index + 1)],
        index: s.index,
      }
    })
    setShuffle((sh) => !sh)
  }, [])
  const toggleRecursive = useCallback(() => setRecursive((r) => !r), [])
  const retry           = useCallback(() => setScanId((k) => k + 1), [])

  // The most likely next file — the alphabetic successor of the current
  // trail tip in the pool. In sequential mode this is exactly what `next`
  // will pick. In shuffle mode it's a heuristic (a likely-soon file)
  // useful for prefetching to warm the browser cache.
  const tip = state.trail[state.trail.length - 1] ?? null
  const nextPredicted = state.pool.length > 0
    ? sequentialPickAfter(state.pool, tip)
    : null

  return {
    playlist: state.trail,
    index:    state.index,
    scanning,
    hasMore:  scanning || state.pool.length > 0,
    nextPredicted,
    recursive,
    toggleRecursive,
    shuffle,
    toggleShuffle,
    next,
    prev,
    error,
    retry,
  }
}
