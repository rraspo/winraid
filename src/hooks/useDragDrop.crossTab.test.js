import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragDrop } from './useDragDrop'
import { clearInternalDrag, getInternalDrag } from '../services/internalDrag'

// Every browse tab runs its own useDragDrop. A drag begun in one tab has to
// be droppable in another tab of the same connection — the hover over a tab
// switches to it, and the drop lands in that tab's folders.

const FOO_ENTRIES = [
  { name: 'a.txt', type: 'file', size: 100, modified: 0, entryPath: '/foo/a.txt' },
  { name: 'b.txt', type: 'file', size: 200, modified: 0, entryPath: '/foo/b.txt' },
]
const BAR_ENTRIES = [
  { name: 'inner', type: 'dir', size: 0, modified: 0, entryPath: '/bar/inner' },
]

function renderTab({ selectedId = 'conn-1', path, entries, selected = new Set() }) {
  const fetchDir = vi.fn()
  const setStatus = vi.fn()
  const clearSelection = vi.fn()
  const hook = renderHook(() =>
    useDragDrop({ selected, entries, selectedId, path, viewMode: 'list', fetchDir, setStatus, clearSelection }),
  )
  return { ...hook, fetchDir, setStatus, clearSelection }
}

function dragStartEvent() {
  return { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() }, preventDefault: vi.fn() }
}

function dragOverEvent() {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { dropEffect: 'none' },
    currentTarget: document.createElement('div'),
  }
}

beforeEach(() => {
  window.winraid = { remote: { move: vi.fn().mockResolvedValue({ ok: true }) } }
})

afterEach(() => clearInternalDrag())

describe('dragging between tabs', () => {
  it('moves the entries dragged in one tab into a folder of another tab on the same connection', async () => {
    const source = renderTab({ path: '/foo', entries: FOO_ENTRIES, selected: new Set(['a.txt', 'b.txt']) })
    const target = renderTab({ path: '/bar', entries: BAR_ENTRIES })

    act(() => source.result.current.handleDragStart(dragStartEvent(), FOO_ENTRIES[0], '/foo/a.txt'))

    await act(async () => {
      await target.result.current.handleDrop({ preventDefault: vi.fn() }, '/bar')
    })

    expect(window.winraid.remote.move).toHaveBeenCalledWith('conn-1', '/foo/a.txt', '/bar/a.txt')
    expect(window.winraid.remote.move).toHaveBeenCalledWith('conn-1', '/foo/b.txt', '/bar/b.txt')
    expect(target.setStatus).toHaveBeenCalledWith({ ok: true, msg: 'Moved 2 items' })
  })

  it('accepts the drag over another tab folder of the same connection', () => {
    const source = renderTab({ path: '/foo', entries: FOO_ENTRIES })
    const target = renderTab({ path: '/bar', entries: BAR_ENTRIES })

    act(() => source.result.current.handleDragStart(dragStartEvent(), FOO_ENTRIES[0], '/foo/a.txt'))

    const event = dragOverEvent()
    act(() => target.result.current.handleDragOverFolder(event, '/bar/inner'))
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.dataTransfer.dropEffect).toBe('move')
  })

  it('refuses the drag over a tab of a different connection', async () => {
    const source = renderTab({ path: '/foo', entries: FOO_ENTRIES })
    const target = renderTab({ selectedId: 'conn-2', path: '/bar', entries: BAR_ENTRIES })

    act(() => source.result.current.handleDragStart(dragStartEvent(), FOO_ENTRIES[0], '/foo/a.txt'))

    const event = dragOverEvent()
    act(() => target.result.current.handleDragOverFolder(event, '/bar/inner'))
    expect(event.preventDefault).not.toHaveBeenCalled()

    await act(async () => {
      await target.result.current.handleDrop({ preventDefault: vi.fn() }, '/bar')
    })
    expect(window.winraid.remote.move).not.toHaveBeenCalled()
  })

  it('forgets the drag once it ends, so a later drop elsewhere moves nothing', async () => {
    const source = renderTab({ path: '/foo', entries: FOO_ENTRIES })
    const target = renderTab({ path: '/bar', entries: BAR_ENTRIES })

    act(() => source.result.current.handleDragStart(dragStartEvent(), FOO_ENTRIES[0], '/foo/a.txt'))
    expect(getInternalDrag()).not.toBeNull()
    act(() => source.result.current.handleDragEnd())
    expect(getInternalDrag()).toBeNull()

    await act(async () => {
      await target.result.current.handleDrop({ preventDefault: vi.fn() }, '/bar')
    })
    expect(window.winraid.remote.move).not.toHaveBeenCalled()
  })
})
