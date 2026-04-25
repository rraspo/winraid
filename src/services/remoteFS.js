const cache     = new Map()
const inflight  = new Map()
const listeners = new Set()

function key(connId, path) {
  return `${connId}:${path}`
}

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot(connId, path) {
  return cache.get(key(connId, path)) ?? null
}

export function list(connId, path) {
  const k = key(connId, path)
  const cached = cache.get(k)
  if (cached !== undefined) return Promise.resolve(cached)
  const existing = inflight.get(k)
  if (existing) return existing
  const p = window.winraid.remote.list(connId, path).then((res) => {
    inflight.delete(k)
    if (res?.ok) {
      cache.set(k, res.entries)
      notify()
      return res.entries
    }
    throw new Error(res?.error ?? 'list failed')
  }).catch((err) => {
    inflight.delete(k)
    throw err
  })
  inflight.set(k, p)
  return p
}

export function tree(connId, rootPath) {
  return window.winraid.remote.tree(connId, rootPath).then((res) => {
    if (!res?.ok && !res?.partial) return
    for (const [dirPath, entries] of Object.entries(res.dirMap ?? {})) {
      cache.set(key(connId, dirPath), entries)
    }
    notify()
  })
}

export function update(connId, path, updaterFn) {
  const k = key(connId, path)
  const current = cache.get(k)
  if (current === undefined) return
  cache.set(k, updaterFn(current))
  notify()
}

export function invalidate(connId, path) {
  const k = key(connId, path)
  cache.delete(k)
  inflight.delete(k)
  notify()
}

export function invalidateSubtree(connId, rootPath) {
  const prefix = key(connId, rootPath)
  for (const k of [...cache.keys()]) {
    if (k === prefix || k.startsWith(prefix + '/')) {
      cache.delete(k)
      inflight.delete(k)
    }
  }
  notify()
}

export function invalidateConnection(connId) {
  const prefix = `${connId}:`
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) {
      cache.delete(k)
      inflight.delete(k)
    }
  }
  notify()
}
