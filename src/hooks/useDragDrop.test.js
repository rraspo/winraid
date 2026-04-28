import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragDrop } from './useDragDrop'

const ENTRIES = [
  { name: 'a.txt', type: 'file', size: 100, modified: Date.now() },
  { name: 'b.txt', type: 'file', size: 200, modified: Date.now() },
  { name: 'sub',   type: 'dir',  size: 0,   modified: Date.now() },
]
const ENTRY_PATHS = { 'a.txt': '/foo/a.txt', 'b.txt': '/foo/b.txt', 'sub': '/foo/sub' }

function setup({ selected = new Set(), viewMode = 'list' } = {}) {
  const fetchDir = vi.fn()
  const navigate = vi.fn()
  const clearSelection = vi.fn()
  window.winraid = { remote: { move: vi.fn().mockResolvedValue({ ok: true }) } }
  const entriesWithPaths = ENTRIES.map((e) => ({ ...e, entryPath: ENTRY_PATHS[e.name] }))
  return {
    fetchDir,
    navigate,
    clearSelection,
    ...renderHook(() =>
      useDragDrop({
        selected,
        entries: entriesWithPaths,
        selectedId: 'conn-1',
        path: '/foo',
        viewMode,
        fetchDir,
        navigate,
        clearSelection,
      })
    ),
  }
}

describe('handleDragStart', () => {
  it('moves only the dragged item when it is not selected', () => {
    const { result } = setup({ selected: new Set(['b.txt']) })
    const entry = { name: 'a.txt', type: 'file', size: 100, modified: Date.now() }
    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/a.txt',
    ))
    expect(result.current.dragSource.entries.map((e) => e.name)).toEqual(['a.txt'])
  })

  it('moves all selected items when the dragged item is selected', () => {
    const { result } = setup({ selected: new Set(['a.txt', 'b.txt']) })
    const entry = { name: 'a.txt', type: 'file', size: 100, modified: Date.now() }
    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/a.txt',
    ))
    expect(result.current.dragSource.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt'])
  })
})

describe('dragSourcePaths', () => {
  it('contains entryPaths of all dragging items', () => {
    const { result } = setup({ selected: new Set(['a.txt', 'b.txt']) })
    const entry = { name: 'a.txt', type: 'file', size: 100, modified: Date.now() }
    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/a.txt',
    ))
    expect(result.current.dragSourcePaths.has('/foo/a.txt')).toBe(true)
    expect(result.current.dragSourcePaths.has('/foo/b.txt')).toBe(true)
    expect(result.current.dragSourcePaths.has('/foo/sub')).toBe(false)
  })
})

describe('handleDragEnd', () => {
  it('clears dragSource', () => {
    const { result } = setup()
    const entry = { name: 'a.txt', type: 'file', size: 100, modified: Date.now() }
    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/a.txt',
    ))
    act(() => result.current.handleDragEnd())
    expect(result.current.dragSource).toBeNull()
  })
})

describe('handleDrop', () => {
  it('calls remote.move for each dragged entry and then fetchDir', async () => {
    const { result, fetchDir } = setup({ selected: new Set(['a.txt', 'b.txt']) })
    const entry = { name: 'a.txt', type: 'file', size: 100, modified: Date.now() }

    // Start drag first so dragSourceRef is set
    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/a.txt',
    ))

    await act(async () => {
      await result.current.handleDrop(
        { preventDefault: vi.fn() },
        '/foo/sub',
      )
    })

    expect(window.winraid.remote.move).toHaveBeenCalledWith('conn-1', '/foo/a.txt', '/foo/sub/a.txt')
    expect(window.winraid.remote.move).toHaveBeenCalledWith('conn-1', '/foo/b.txt', '/foo/sub/b.txt')
    expect(fetchDir).toHaveBeenCalled()
  })

  it('clears dragSource after drop', async () => {
    const { result } = setup()
    const entry = { name: 'a.txt', type: 'file', size: 100, modified: Date.now() }

    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/a.txt',
    ))

    await act(async () => {
      await result.current.handleDrop({ preventDefault: vi.fn() }, '/foo/sub')
    })

    expect(result.current.dragSource).toBeNull()
  })

  it('calls clearSelection after a committed drop', async () => {
    const { result, clearSelection } = setup({ selected: new Set(['a.txt', 'b.txt']) })
    const entry = { name: 'a.txt', type: 'file', size: 100, modified: Date.now() }

    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/a.txt',
    ))

    await act(async () => {
      await result.current.handleDrop({ preventDefault: vi.fn() }, '/foo/sub')
    })

    expect(clearSelection).toHaveBeenCalled()
  })

  it('does not call clearSelection when drop is cancelled (target is source)', async () => {
    const { result, clearSelection } = setup()
    const entry = { name: 'sub', type: 'dir', size: 0, modified: Date.now() }

    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/sub',
    ))

    await act(async () => {
      await result.current.handleDrop({ preventDefault: vi.fn() }, '/foo/sub')
    })

    expect(clearSelection).not.toHaveBeenCalled()
  })

  it('does not move when target is the source itself', async () => {
    const { result } = setup()
    const entry = { name: 'sub', type: 'dir', size: 0, modified: Date.now() }

    act(() => result.current.handleDragStart(
      { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() },
      entry,
      '/foo/sub',
    ))

    await act(async () => {
      await result.current.handleDrop({ preventDefault: vi.fn() }, '/foo/sub')
    })

    expect(window.winraid.remote.move).not.toHaveBeenCalled()
  })
})
