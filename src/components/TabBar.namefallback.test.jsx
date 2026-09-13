import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TabBar from './TabBar'

// Contract under test — a tab always says what it is.
//
// A browse tab renames itself after the folder it is showing, and falls back
// to the connection's name at the connection's root. In the moment after a
// tab is created its path is still "/", whose last segment is an empty
// string — and an empty string is not nullish, so the fallback never ran and
// the tab rendered with no name at all: an icon, the word "browse", and
// nothing to say which connection it belonged to.

const CONNECTIONS = [{ id: 'c1', name: 'Atlas', icon: null }]

function renderTabs(tabs) {
  render(
    <TabBar
      openTabs={tabs}
      activeTabId={tabs[0]?.id}
      connections={CONNECTIONS}
      dirtyTabs={new Set()}
      onActivate={vi.fn()}
      onClose={vi.fn()}
    />,
  )
}

describe('a tab always has a name', () => {
  it('uses the folder it is showing', () => {
    renderTabs([{ id: 't1', connId: 'c1', type: 'browse', label: 'photos' }])
    expect(screen.getByText('photos')).toBeTruthy()
  })

  it('falls back to the connection when it has no folder label', () => {
    renderTabs([{ id: 't1', connId: 'c1', type: 'browse', label: null }])
    expect(screen.getByText('Atlas')).toBeTruthy()
  })

  it('falls back to the connection when the label is empty', () => {
    renderTabs([{ id: 't1', connId: 'c1', type: 'browse', label: '' }])
    expect(screen.getByText('Atlas')).toBeTruthy()
  })

  it('falls back to the connection id when the connection is unknown', () => {
    renderTabs([{ id: 't1', connId: 'gone', type: 'browse', label: '' }])
    expect(screen.getByText('gone')).toBeTruthy()
  })
})
