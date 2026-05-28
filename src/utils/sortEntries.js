const compareName = (a, b) => a.name.localeCompare(b.name)

const COMPARATORS = {
  nameAsc:  (a, b) => compareName(a, b),
  nameDesc: (a, b) => compareName(b, a),
  recent:   (a, b) => (b.modified ?? 0) - (a.modified ?? 0) || compareName(a, b),
  oldest:   (a, b) => (a.modified ?? 0) - (b.modified ?? 0) || compareName(a, b),
}

export function sortEntries(entries, mode, dirsFirst) {
  if (entries.length === 0) return []
  const cmp = COMPARATORS[mode] ?? COMPARATORS.nameAsc
  const sorted = [...entries]
  if (dirsFirst) {
    const dirs  = sorted.filter((e) => e.type === 'dir').sort(cmp)
    const files = sorted.filter((e) => e.type !== 'dir').sort(cmp)
    return [...dirs, ...files]
  }
  return sorted.sort(cmp)
}
