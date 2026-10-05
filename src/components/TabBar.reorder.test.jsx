import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import TabBar from './TabBar'

vi.mock('./ConnectionIcon', () => ({ default: () => null }))

const CONNECTIONS = [{ id: 'c1', name: 'Atlas', icon: null, type: 'sftp' }]

const TABS = [
  { id: 't1', connId: 'c1', type: 'browse', label: 'Documents' },
  { id: 't2', connId: 'c1', type: 'browse', label: 'Photos' },
  { id: 't3', connId: 'c1', type: 'size',    label: 'Sizes'    },
  { id: 't4', connId: 'c1', type: 'backup',  label: 'Backup'   },
]

// Drop semantics this contract fixes: dropping ON a tab inserts the dragged
// tab at that tab's index — the target tab and everything after it shift
// right. This is the standard HTML5 DnD convention for tab strips and is
// the only shape the assertions below can be expressed against. The
// implementer chooses the markup, the dataTransfer payload, and how they
// compute the target index from the drop event; the rendered order is what
// the contract pins down.
function TabStripHarness({ tabs, activeId, onActivate, onClose }) {
  const [openTabs,    setOpenTabs]    = useState(tabs)
  const [activeTabId, setActiveTabId] = useState(activeId)

  function handleReorder(fromIndex, toIndex) {
    setOpenTabs((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev
      let target = toIndex
      if (target < 0) target = 0
      if (target >= prev.length) target = prev.length - 1
      if (fromIndex === target) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  return (
    <TabBar
      openTabs={openTabs}
      activeTabId={activeTabId}
      connections={CONNECTIONS}
      dirtyTabs={new Set()}
      onActivate={(id) => { onActivate(id); setActiveTabId(id) }}
      onClose={(id) => {
        onClose(id)
        setOpenTabs((prev) => prev.filter((t) => t.id !== id))
        if (id === activeTabId) setActiveTabId(null)
      }}
      onReorder={handleReorder}
    />
  )
}

function mountStrip({ tabs = TABS, activeId = tabs[0]?.id, onActivate = vi.fn(), onClose = vi.fn() } = {}) {
  const { container } = render(
    <TabStripHarness tabs={tabs} activeId={activeId} onActivate={onActivate} onClose={onClose} />
  )
  return { container, onActivate, onClose }
}

const tabEl = (container, id) => container.querySelector(`[data-tabid="${id}"]`)
const tabIds = (container) =>
  Array.from(container.querySelectorAll('[data-tabid]')).map((el) => el.dataset.tabid)
const activeId = (container) =>
  container.querySelector('.tabActive')?.dataset.tabid ?? null

function dragData() {
  return { dataTransfer: { effectAllowed: '', setData: vi.fn(), setDragImage: vi.fn() } }
}
function dropData() {
  // The implementer picks the marker type; providing a small set keeps the
  // test resilient across reasonable conventions (`text/plain` is always
  // present on real drags, and a custom application/x-* is the in-house
  // marker pattern the rest of the codebase uses).
  return { dataTransfer: { types: ['text/plain', 'application/x-winraid-tab'] } }
}

// An insertion indicator MUST be discoverable by accessible means during a
// drag. The implementer chooses the role, the exact wording, and whether
// it's a separator, an aria-live region, or a labelled line; the contract
// only requires it to be findable by an aria-label containing "drop" or
// "insert" (case-insensitive), and to disappear when the drag ends.
function findIndicator() {
  return screen.queryByLabelText(/drop|insert/i)
}

describe('TabBar — drag-to-reorder', () => {
  describe('reorders the strip', () => {
    it('moves a tab to a later position when dropped onto a later tab', () => {
      const { container } = mountStrip()
      // [t1, t2, t3, t4] → drag t1, drop on t3 → [t2, t3, t1, t4]
      fireEvent.dragStart(tabEl(container, 't1'), dragData())
      fireEvent.drop(tabEl(container, 't3'), dropData())
      expect(tabIds(container)).toEqual(['t2', 't3', 't1', 't4'])
    })

    it('moves a tab to an earlier position when dropped onto an earlier tab', () => {
      const { container } = mountStrip()
      // [t1, t2, t3, t4] → drag t4, drop on t1 → [t4, t1, t2, t3]
      fireEvent.dragStart(tabEl(container, 't4'), dragData())
      fireEvent.drop(tabEl(container, 't1'), dropData())
      expect(tabIds(container)).toEqual(['t4', 't1', 't2', 't3'])
    })
  })

  describe('insertion indicator', () => {
    it('appears while a drag is in progress and disappears when the drag ends', () => {
      const { container } = mountStrip()
      // Before the drag starts, nothing indicator-like is in the DOM.
      expect(findIndicator()).toBeNull()

      fireEvent.dragStart(tabEl(container, 't1'), dragData())
      // During the drag, an element whose accessible name signals an
      // insertion point must be present.
      expect(findIndicator()).not.toBeNull()

      fireEvent.dragEnd(tabEl(container, 't1'), dragData())
      // Once the drag ends, no insertion indicator remains.
      expect(findIndicator()).toBeNull()
    })
  })

  describe('self-drop does not misbehave', () => {
    it('a drag that starts and ends on the same tab leaves order, active, and the tab itself unchanged', () => {
      // The hazard this guards against: a same-place drag being treated as
      // a click and closing the tab the user was trying to move. Losing a
      // tab while reordering is worse than the feature is useful.
      const { container, onClose } = mountStrip({ activeId: 't1' })
      const source = tabEl(container, 't1')
      fireEvent.dragStart(source, dragData())
      fireEvent.drop(source, dropData())
      fireEvent.dragEnd(source, dragData())
      expect(tabIds(container)).toEqual(['t1', 't2', 't3', 't4'])
      expect(activeId(container)).toBe('t1')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('a drag cancelled before any drop leaves order, active, and the tab itself unchanged', () => {
      // dragEnd without a prior drop is the "user released elsewhere" case.
      // The implementer must not use the missing-drop signal as an excuse
      // to close the source tab.
      const { container, onClose } = mountStrip({ activeId: 't1' })
      fireEvent.dragStart(tabEl(container, 't1'), dragData())
      fireEvent.dragEnd(tabEl(container, 't1'), dragData())
      expect(tabIds(container)).toEqual(['t1', 't2', 't3', 't4'])
      expect(activeId(container)).toBe('t1')
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('existing close behaviour survives', () => {
    it('clicking the close button still closes the tab', () => {
      const { container, onClose } = mountStrip()
      const closeBtn = tabEl(container, 't1').querySelector('button')
      fireEvent.click(closeBtn)
      expect(onClose).toHaveBeenCalledWith('t1')
      expect(tabIds(container)).toEqual(['t2', 't3', 't4'])
    })

    it('middle-clicking still closes the tab and does not activate it', () => {
      const { container, onClose, onActivate } = mountStrip()
      fireEvent.mouseDown(tabEl(container, 't2'), { button: 1 })
      expect(onClose).toHaveBeenCalledWith('t2')
      expect(onActivate).not.toHaveBeenCalled()
      expect(tabIds(container)).toEqual(['t1', 't3', 't4'])
    })
  })

  describe('active tab stays active across a reorder', () => {
    it('when the active tab is not the one being dragged', () => {
      const { container } = mountStrip({ activeId: 't1' })
      // [t1, t2, t3, t4], active t1 → drag t4, drop on t1 → [t4, t1, t2, t3]
      fireEvent.dragStart(tabEl(container, 't4'), dragData())
      fireEvent.drop(tabEl(container, 't1'), dropData())
      expect(tabIds(container)).toEqual(['t4', 't1', 't2', 't3'])
      expect(activeId(container)).toBe('t1')
    })

    it('when the active tab is the one being dragged', () => {
      const { container } = mountStrip({ activeId: 't3' })
      // [t1, t2, t3, t4], active t3 → drag t3, drop on t1 → [t3, t1, t2, t4]
      fireEvent.dragStart(tabEl(container, 't3'), dragData())
      fireEvent.drop(tabEl(container, 't1'), dropData())
      expect(tabIds(container)).toEqual(['t3', 't1', 't2', 't4'])
      expect(activeId(container)).toBe('t3')
    })
  })

  describe('clamping', () => {
    it('a drop that cannot be resolved to an in-range target produces a well-formed strip', () => {
      // Drop on the strip container itself (no specific tab target). The
      // implementer's clamp logic must keep the strip well-formed: same
      // length, same set of tabs, the dragged tab still present, no
      // duplicates, no exceptions thrown. Where exactly the dragged tab
      // lands (first or last) is the implementer's convention; the contract
      // only requires an in-range, valid result.
      const { container } = mountStrip()
      const strip = container.querySelector('.tabBar')
      fireEvent.dragStart(tabEl(container, 't2'), dragData())
      fireEvent.dragOver(strip)
      fireEvent.drop(strip, dropData())

      const ids = tabIds(container)
      expect(ids).toHaveLength(4)
      expect(new Set(ids)).toEqual(new Set(['t1', 't2', 't3', 't4']))
      expect(ids.indexOf('t2')).toBeGreaterThanOrEqual(0)
    })
  })

  describe('single tab', () => {
    it('does not misbehave when there is only one tab to reorder', () => {
      // With a single tab, any reorder is by definition a no-op. The
      // assertables are: the strip keeps the one tab, it stays active,
      // and the drag handlers don't accidentally close it.
      const { container, onClose } = mountStrip({
        tabs: [{ id: 't1', connId: 'c1', type: 'browse', label: 'Documents' }],
        activeId: 't1',
      })
      const only = tabEl(container, 't1')
      fireEvent.dragStart(only, dragData())
      fireEvent.dragOver(only)
      fireEvent.drop(only, dropData())
      fireEvent.dragEnd(only, dragData())
      expect(tabIds(container)).toEqual(['t1'])
      expect(activeId(container)).toBe('t1')
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
