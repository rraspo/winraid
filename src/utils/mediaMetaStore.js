import { useSyncExternalStore, useCallback } from 'react'

// Media facts (duration, resolution, dimensions) reported by thumbnails, keyed
// by entry path. Kept outside React state on purpose: thumbnails report as
// they mount, many per scrolled row, and a state object high in the tree
// would re-render the whole Browse screen for each report. Here each row
// subscribes to its own path, so a report re-renders that row alone.
export function createMediaMetaStore() {
  const values = new Map()
  const listeners = new Map()

  return {
    get(path) {
      return values.get(path)
    },
    set(path, meta) {
      const existing = values.get(path)
      if (existing && existing.kind === meta.kind && existing.duration === meta.duration
        && existing.width === meta.width && existing.height === meta.height) return
      values.set(path, meta)
      listeners.get(path)?.forEach((listener) => listener())
    },
    subscribe(path, listener) {
      if (!listeners.has(path)) listeners.set(path, new Set())
      listeners.get(path).add(listener)
      return () => {
        const forPath = listeners.get(path)
        forPath?.delete(listener)
        if (forPath?.size === 0) listeners.delete(path)
      }
    },
  }
}

const noSubscription = () => () => {}

export function useMediaMeta(store, path) {
  const subscribe = useCallback((listener) => store.subscribe(path, listener), [store, path])
  return useSyncExternalStore(store ? subscribe : noSubscription, () => store?.get(path))
}
