// src/hooks/useSelection.test.js
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSelection } from './useSelection'

const ENTRIES = [
  { name: 'a.txt', type: 'file' },
  { name: 'b.txt', type: 'file' },
  { name: 'c.txt', type: 'file' },
  { name: 'd.txt', type: 'file' },
]

function setup(entries = ENTRIES) {
  return renderHook(() => useSelection({ entries, path: '/foo' }))
}

describe('handleItemPointer — plain click (no modifiers)', () => {
  it('replaces selection with the clicked item and sets anchor', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(1, {}))
    expect(result.current.selected).toEqual(new Set(['b.txt']))
    expect(result.current.anchorIndex).toBe(1)
  })

  it('replaces previous selection', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(0, {}))
    act(() => result.current.handleItemPointer(2, {}))
    expect(result.current.selected).toEqual(new Set(['c.txt']))
  })
})

describe('handleItemPointer — ctrl click (toggle)', () => {
  it('adds an unselected item', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(0, { ctrl: true }))
    act(() => result.current.handleItemPointer(2, { ctrl: true }))
    expect(result.current.selected).toEqual(new Set(['a.txt', 'c.txt']))
  })

  it('removes an already-selected item', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(0, { ctrl: true }))
    act(() => result.current.handleItemPointer(0, { ctrl: true }))
    expect(result.current.selected).toEqual(new Set())
  })

  it('updates anchor to toggled index', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(3, { ctrl: true }))
    expect(result.current.anchorIndex).toBe(3)
  })
})

describe('handleItemPointer — shift click (range)', () => {
  it('selects range from anchor to target (forward)', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(1, {}))      // anchor = 1
    act(() => result.current.handleItemPointer(3, { shift: true }))
    expect(result.current.selected).toEqual(new Set(['b.txt', 'c.txt', 'd.txt']))
  })

  it('selects range from anchor to target (backward)', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(3, {}))      // anchor = 3
    act(() => result.current.handleItemPointer(1, { shift: true }))
    expect(result.current.selected).toEqual(new Set(['b.txt', 'c.txt', 'd.txt']))
  })

  it('replaces prior selection with range', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(0, { ctrl: true }))  // select a.txt
    act(() => result.current.handleItemPointer(1, {}))               // anchor = 1, select b.txt
    act(() => result.current.handleItemPointer(3, { shift: true }))  // range 1–3
    expect(result.current.selected).toEqual(new Set(['b.txt', 'c.txt', 'd.txt']))
  })

  it('uses index 0 as anchor when no prior anchor', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(2, { shift: true }))
    expect(result.current.selected).toEqual(new Set(['a.txt', 'b.txt', 'c.txt']))
  })
})

describe('toggleSelectAll / clearSelection', () => {
  it('selects all when none selected', () => {
    const { result } = setup()
    act(() => result.current.toggleSelectAll())
    expect(result.current.selected.size).toBe(4)
  })

  it('clears all when all selected', () => {
    const { result } = setup()
    act(() => result.current.toggleSelectAll())
    act(() => result.current.toggleSelectAll())
    expect(result.current.selected.size).toBe(0)
  })

  it('clearSelection empties set', () => {
    const { result } = setup()
    act(() => result.current.handleItemPointer(0, {}))
    act(() => result.current.clearSelection())
    expect(result.current.selected.size).toBe(0)
  })
})

describe('auto-clear on path change', () => {
  it('clears selection when path prop changes', () => {
    const { result, rerender } = renderHook(
      ({ path }) => useSelection({ entries: ENTRIES, path }),
      { initialProps: { path: '/foo' } },
    )
    act(() => result.current.handleItemPointer(0, {}))
    expect(result.current.selected.size).toBe(1)
    rerender({ path: '/bar' })
    expect(result.current.selected.size).toBe(0)
  })
})
