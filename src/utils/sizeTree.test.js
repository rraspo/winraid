import { describe, it, expect } from 'vitest'
import { findNodeByPath, upsertLevel } from './sizeTree'

function root() {
  return { name: 'data', path: '/data', sizeKb: 0, children: [] }
}

describe('findNodeByPath', () => {
  it('finds a nested node by path', () => {
    const tree = { path: '/a', children: [{ path: '/a/b', children: [{ path: '/a/b/c', children: [] }] }] }
    expect(findNodeByPath(tree, '/a/b/c').path).toBe('/a/b/c')
  })
  it('returns null when absent', () => {
    expect(findNodeByPath(root(), '/data/nope')).toBeNull()
  })
})

describe('upsertLevel', () => {
  it('adds new children under the parent', () => {
    const tree = root()
    upsertLevel(tree, '/data', [
      { name: 'movies', path: '/data/movies', sizeKb: 0 },
      { name: 'iso.img', path: '/data/iso.img', sizeKb: 200 },
    ])
    expect(tree.children.map((c) => c.path)).toEqual(['/data/movies', '/data/iso.img'])
  })

  it('updates an existing child size instead of duplicating it', () => {
    const tree = root()
    upsertLevel(tree, '/data', [{ name: 'movies', path: '/data/movies', sizeKb: 0 }])
    upsertLevel(tree, '/data', [{ name: 'movies', path: '/data/movies', sizeKb: 5000 }])
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].sizeKb).toBe(5000)
  })

  it('preserves an existing child’s own children when its size is updated', () => {
    const tree = root()
    upsertLevel(tree, '/data', [{ name: 'movies', path: '/data/movies', sizeKb: 0 }])
    tree.children[0].children.push({ name: 'a.mkv', path: '/data/movies/a.mkv', sizeKb: 100, children: [] })
    upsertLevel(tree, '/data', [{ name: 'movies', path: '/data/movies', sizeKb: 5000 }])
    expect(tree.children[0].children).toHaveLength(1)
  })

  it('recomputes the root size as the sum of its children', () => {
    const tree = root()
    upsertLevel(tree, '/data', [
      { name: 'a', path: '/data/a', sizeKb: 0 },
      { name: 'b.img', path: '/data/b.img', sizeKb: 300 },
    ])
    expect(tree.sizeKb).toBe(300)
    upsertLevel(tree, '/data', [{ name: 'a', path: '/data/a', sizeKb: 1200 }])
    expect(tree.sizeKb).toBe(1500)
  })
})
