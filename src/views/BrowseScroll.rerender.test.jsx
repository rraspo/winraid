import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { forwardRef } from 'react'

// Contract under test — scrolling must not re-render rows or cards that are
// already on screen. Virtualization caps how many are mounted; memo on
// BrowseListRow and GridCard is what caps how often they render, and it
// only holds while the views hand them props that keep their identity when
// nothing about the entry changed.
//
// The virtualizer is replaced with one the test can tick: each tick
// re-renders the view the way a real scroll does, with fresh virtual-item
// objects describing the same window. EntryMenu renders once per row/card
// render, so it is the render counter.

let tick = () => {}
let menuRenders = 0

vi.mock('../hooks/useVirtualizers', () => {
  function useVirtualizerStub(count, size) {
    const [, setTick] = useState(0)
    tick = () => setTick((n) => n + 1)
    return {
      getVirtualItems: () => Array.from({ length: Math.min(count, 10) }, (_, index) => ({
        index, start: index * size, size, end: (index + 1) * size, key: index, lane: 0,
      })),
      getTotalSize: () => count * size,
      measure: () => {},
    }
  }
  return {
    GRID_PAD: 16,
    GRID_GAP: 12,
    useListVirtualizer: (entries, _el, rowHeight = 41) => ({ rowVirtualizer: useVirtualizerStub(entries.length, rowHeight) }),
    useGridVirtualizer: (entries) => ({ gridVirtualizer: useVirtualizerStub(Math.ceil(entries.length / 4), 176), gridCols: 4, gridRowH: 176 }),
  }
})

vi.mock('../components/browse/EntryMenu', () => ({
  default: forwardRef(function EntryMenuCounter() {
    menuRenders++
    return null
  }),
}))

vi.mock('../components/browse/Thumbnail', () => ({ default: () => null }))

const { default: BrowseList } = await import('./BrowseList')
const { default: BrowseGrid } = await import('./BrowseGrid')

const ENTRIES = Array.from({ length: 40 }, (_, i) => ({
  name: `IMG_${String(i).padStart(3, '0')}.jpg`,
  type: 'file',
  size: 1000 + i,
  modified: 1_700_000_000_000 + i,
  entryPath: `/media/IMG_${String(i).padStart(3, '0')}.jpg`,
}))

// Every callback and collection the parent passes, created once so their
// identity is stable across renders — as useBrowse's are.
const noop = () => {}
const PROPS = {
  entriesWithPaths: ENTRIES, loading: false, error: null,
  newFolderName: null, setNewFolderName: noop, handleCreateFolder: noop,
  path: '/media', selectedId: 'c1', busy: false,
  selected: new Set(), dragSourcePaths: new Set(), lastVisitedDir: null,
  highlightFile: null, highlightRef: { current: null }, cursorEntry: null,
  scrollAnchor: null, setScrollAnchor: noop,
  handleDragStart: noop, handleDragEnd: noop, handleDragOverFolder: noop, handleDragLeaveFolder: noop, handleDrop: noop,
  navigate: noop, openQuickLook: noop, handleItemPointer: noop, toggleSelectAll: noop,
  handleRubberBandStart: noop, handleRubberBandMove: noop, handleRubberBandEnd: noop, rubberBand: null,
  handleDownload: noop, setEditingFile: noop, setMoveTarget: noop, setDeleteTarget: noop, onProperties: noop,
  requestBulkDelete: noop, requestBulkMove: noop, requestBulkDownload: noop, requestBulkProperties: noop,
  localMirrorOf: () => null, checkLocalExists: noop, onRevealLocal: noop, onMiddleClickFolder: noop,
  thumbnailsEnabled: true, mediaMetaByPath: {}, onThumbnailMetadata: noop,
}

beforeEach(() => { menuRenders = 0 })
afterEach(() => { cleanup() })

describe('scrolling re-renders nothing that is already on screen', () => {
  it('list view: a scroll tick over the same window renders no row again', () => {
    render(<BrowseList {...PROPS} />)
    const mounted = menuRenders
    expect(mounted).toBeGreaterThanOrEqual(10)

    act(() => tick())
    act(() => tick())

    expect(menuRenders).toBe(mounted)
  })

  it('list view: selecting a second row re-renders only the two selected rows', () => {
    const { rerender } = render(<BrowseList {...PROPS} selected={new Set([ENTRIES[0].name])} />)
    const before = menuRenders

    rerender(<BrowseList {...PROPS} selected={new Set([ENTRIES[0].name, ENTRIES[1].name])} />)

    expect(menuRenders - before).toBe(2)
  })

  it('grid view: selecting a second card re-renders only the two selected cards', () => {
    const { rerender } = render(<BrowseGrid {...PROPS} selected={new Set([ENTRIES[0].name])} />)
    const before = menuRenders

    rerender(<BrowseGrid {...PROPS} selected={new Set([ENTRIES[0].name, ENTRIES[1].name])} />)

    expect(menuRenders - before).toBe(2)
  })

  it('grid view: a scroll tick over the same window renders no card again', () => {
    render(<BrowseGrid {...PROPS} />)
    const mounted = menuRenders
    expect(mounted).toBeGreaterThanOrEqual(40)

    act(() => tick())
    act(() => tick())

    expect(menuRenders).toBe(mounted)
  })
})
