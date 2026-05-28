const STORAGE_KEY = 'browse-sort-prefs'

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {} }
  catch { return {} }
}

function save(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

function parentPath(path) {
  if (path === '/' || !path) return null
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

export function resolveSortMode(path, persistence) {
  if (persistence === 'default') return 'nameAsc'
  const prefs = load()
  if (persistence === 'folder') {
    return prefs[path] ?? 'nameAsc'
  }
  if (persistence === 'siblings') {
    const parent = parentPath(path)
    if (parent == null) return 'nameAsc'
    const parentKey = `siblings:${parent}`
    return prefs[parentKey] ?? 'nameAsc'
  }
  return 'nameAsc'
}

export function saveSortMode(path, mode, persistence) {
  if (persistence === 'default') return
  const prefs = load()
  if (persistence === 'folder') {
    prefs[path] = mode
  } else if (persistence === 'siblings') {
    const parent = parentPath(path)
    if (parent != null) prefs[`siblings:${parent}`] = mode
  }
  save(prefs)
}

export function clearSortPrefs() {
  localStorage.removeItem(STORAGE_KEY)
}
