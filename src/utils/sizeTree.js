// Pure helpers for the size-scan tree. Levels stream in incrementally (a folder
// first appears with size 0, then its real recursive size arrives), so merging
// must upsert by path rather than only append.

export function findNodeByPath(node, path) {
  if (!node) return null
  if (node.path === path) return node
  for (const c of node.children ?? []) {
    const found = findNodeByPath(c, path)
    if (found) return found
  }
  return null
}

/**
 * Merge a level's entries under the node at parentPath, mutating `tree`.
 * Existing children are updated in place (size refreshed, own children kept);
 * new children are appended. The parent's size is recomputed from its children:
 * exactly the child sum at the root, and the growing max elsewhere (a folder's
 * own recursive total may exceed the partial child sum mid-scan).
 *
 * @returns the same `tree` reference.
 */
export function upsertLevel(tree, parentPath, entries) {
  if (!tree) return tree
  const parent = findNodeByPath(tree, parentPath)
  if (!parent) return tree
  parent.children = parent.children ?? []

  for (const entry of entries) {
    const existing = parent.children.find((c) => c.path === entry.path)
    if (existing) {
      existing.sizeKb = entry.sizeKb
      if (entry.name != null) existing.name = entry.name
    } else {
      parent.children.push({ ...entry, children: [] })
    }
  }

  const childSum = parent.children.reduce((s, c) => s + (c.sizeKb || 0), 0)
  if (parent === tree) parent.sizeKb = childSum
  else if (childSum > parent.sizeKb) parent.sizeKb = childSum

  return tree
}
