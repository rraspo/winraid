// Per-connection favorite directory paths. Stored in config under
// favoritesByConnection[connectionId] as an array of POSIX remote paths.

// Strip a trailing slash, but never reduce root "/" to empty.
function normalize(path) {
  if (!path) return path
  const trimmed = path.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export function isFavorite(list, path) {
  const target = normalize(path)
  return (list ?? []).some((p) => normalize(p) === target)
}

export function toggleFavorite(list, path) {
  const target = normalize(path)
  const current = list ?? []
  if (current.some((p) => normalize(p) === target)) {
    return current.filter((p) => normalize(p) !== target)
  }
  return [...current, target]
}

// Display label for a favorite — the final path segment, or "/" for root.
export function favName(path) {
  const n = normalize(path)
  if (n === '/') return '/'
  return n.slice(n.lastIndexOf('/') + 1)
}
