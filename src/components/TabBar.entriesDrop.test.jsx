import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import TabBar from './TabBar'
import { setInternalDrag, clearInternalDrag } from '../services/internalDrag'

vi.mock('./ConnectionIcon', () => ({ default: () => null }))

// Files dragged out of a browse tab can be dropped on another tab's header:
// they move into the folder that tab is showing. Hovering a tab with files
// switches to it, so the drop can also land on a specific folder inside it.

const CONNECTIONS = [
  { id: 'c1', name: 'Atlas', icon: null, type: 'sftp' },
  { id: 'c2', name: 'Vault', icon: null, type: 'sftp' },
]

const TABS = [
  { id: 't1', connId: 'c1', type: 'browse', label: 'Documents', location: { connectionId: 'c1', path: '/docs' } },
  { id: 't2', connId: 'c1', type: 'browse', label: 'Photos',    location: { connectionId: 'c1', path: '/photos' } },
  { id: 't3', connId: 'c2', type: 'browse', label: 'Archive',   location: { connectionId: 'c2', path: '/archive' } },
  { id: 't4', connId: 'c1', type: 'size',   label: 'Sizes' },
]

function renderBar(props = {}) {
  const onActivate = vi.fn()
  const onDropEntries = vi.fn()
  const utils = render(
    <TabBar
      openTabs={TABS}
      activeTabId="t1"
      connections={CONNECTIONS}
      dirtyTabs={new Set()}
      onActivate={onActivate}
      onClose={vi.fn()}
      onDropEntries={onDropEntries}
      {...props}
    />,
  )
  const tab = (id) => utils.container.querySelector(`[data-tabid="${id}"]`)
  return { ...utils, tab, onActivate, onDropEntries }
}

// fireEvent returns false when a handler called preventDefault — which is
// exactly how a drop target tells the browser it accepts the drag.
function dragOverAccepted(element) {
  return !fireEvent.dragOver(element, { dataTransfer: { dropEffect: 'none', types: [] } })
}

beforeEach(() => {
  vi.useFakeTimers()
  setInternalDrag({ connectionId: 'c1', entries: [{ name: 'a.txt', entryPath: '/docs/a.txt' }] })
})

afterEach(() => {
  clearInternalDrag()
  vi.useRealTimers()
})

describe('TabBar — dropping files on a tab', () => {
  it('accepts files over a browse tab of the same connection and hands the drop to onDropEntries', () => {
    const { tab, onDropEntries } = renderBar()
    expect(dragOverAccepted(tab('t2'))).toBe(true)
    expect(tab('t2').getAttribute('data-drop-target')).toBe('true')

    fireEvent.drop(tab('t2'), { dataTransfer: { types: [] } })
    expect(onDropEntries).toHaveBeenCalledWith('t2')
    expect(tab('t2').getAttribute('data-drop-target')).toBeNull()
  })

  it('refuses files over a tab of another connection or a tab that is not a browse tab', () => {
    const { tab, onDropEntries } = renderBar()
    expect(dragOverAccepted(tab('t3'))).toBe(false)
    expect(dragOverAccepted(tab('t4'))).toBe(false)

    fireEvent.drop(tab('t3'), { dataTransfer: { types: [] } })
    fireEvent.drop(tab('t4'), { dataTransfer: { types: [] } })
    expect(onDropEntries).not.toHaveBeenCalled()
  })

  it('refuses files over the tab they were dragged from', () => {
    const { tab } = renderBar()
    expect(dragOverAccepted(tab('t1'))).toBe(false)
  })

  it('switches to a hovered tab after a short dwell', () => {
    const { tab, onActivate } = renderBar()
    fireEvent.dragOver(tab('t3'), { dataTransfer: { types: [] } })
    act(() => { vi.advanceTimersByTime(599) })
    expect(onActivate).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onActivate).toHaveBeenCalledWith('t3')
  })

  it('does not switch when the files leave the tab before the dwell ends', () => {
    const { tab, onActivate } = renderBar()
    fireEvent.dragOver(tab('t2'), { dataTransfer: { types: [] } })
    fireEvent.dragLeave(tab('t2'), { dataTransfer: { types: [] } })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('ignores drags that carry no files from a browse tab', () => {
    clearInternalDrag()
    const { tab, onActivate, onDropEntries } = renderBar()
    fireEvent.dragOver(tab('t2'), { dataTransfer: { types: [] } })
    act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.drop(tab('t2'), { dataTransfer: { types: [] } })
    expect(onActivate).not.toHaveBeenCalled()
    expect(onDropEntries).not.toHaveBeenCalled()
  })
})
