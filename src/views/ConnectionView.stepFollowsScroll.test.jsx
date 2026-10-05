import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import ConnectionView from './ConnectionView'

// Contract under test — the connection editor's step tabs report where you
// actually are.
//
// The three steps are a tab strip over three sections that are all rendered
// and scrolled through, rather than pages that replace one another. The
// selected tab was only ever set by clicking a tab, so scrolling down to
// Folders or Rules left the strip insisting you were still on Server. The
// tabs claimed to be a position indicator while only reporting the last
// thing clicked.
//
// The selected tab now follows the section you have scrolled to, and
// clicking a tab still takes you to its section.

const EXISTING = {
  id: 'c1', name: 'Atlas', type: 'sftp', operation: 'copy', folderMode: 'mirror',
  localFolder: 'C:\\Users\\user\\Pictures\\Import',
  sftp: { host: 'nas.local', port: 22, username: 'user', remotePath: '/mnt/user/media' },
}

// Captures the observer so the test can say what is on screen.
let observed
let savedIntersectionObserver

class ObserverStub {
  constructor(callback) {
    observed = { callback, targets: [] }
  }
  observe(node) { observed.targets.push(node) }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

// Reports that `id` is the section in view.
function scrollTo(id) {
  const target = observed.targets.find((node) => node.id === `conn-section-${id}`)
  if (!target) throw new Error(`section "${id}" is not being observed`)
  act(() => {
    observed.callback(
      observed.targets.map((node) => ({
        target: node,
        isIntersecting: node === target,
        intersectionRatio: node === target ? 1 : 0,
        boundingClientRect: { top: node === target ? 0 : 500 },
      })),
      { disconnect() {} },
    )
  })
}

beforeEach(() => {
  savedIntersectionObserver = window.IntersectionObserver
  observed = null
  window.IntersectionObserver = ObserverStub
  globalThis.IntersectionObserver = ObserverStub
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
  })
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }))
})

afterEach(() => {
  window.IntersectionObserver = savedIntersectionObserver
  globalThis.IntersectionObserver = savedIntersectionObserver
  delete window.winraid
})

async function mount() {
  render(<ConnectionView existing={EXISTING} onSave={vi.fn()} onClose={vi.fn()} />)
  await act(async () => {})
}

function tab(name) {
  return screen.getByRole('tab', { name })
}

describe('the connection editor step tabs follow the scroll', () => {
  it('starts on the first step', async () => {
    await mount()
    expect(tab('1 · Server').getAttribute('aria-selected')).toBe('true')
  })

  it('watches every section', async () => {
    await mount()
    expect(observed.targets.map((n) => n.id).sort()).toEqual([
      'conn-section-folders', 'conn-section-rules', 'conn-section-server',
    ])
  })

  it('moves the selected tab when you scroll to a section', async () => {
    await mount()
    scrollTo('folders')
    expect(tab('2 · Folders').getAttribute('aria-selected')).toBe('true')
    expect(tab('1 · Server').getAttribute('aria-selected')).toBe('false')
  })

  it('keeps up as you carry on scrolling', async () => {
    await mount()
    scrollTo('folders')
    scrollTo('rules')
    expect(tab('3 · Rules').getAttribute('aria-selected')).toBe('true')
    expect(tab('2 · Folders').getAttribute('aria-selected')).toBe('false')
  })

  it('comes back up again', async () => {
    await mount()
    scrollTo('rules')
    scrollTo('server')
    expect(tab('1 · Server').getAttribute('aria-selected')).toBe('true')
  })

  it('still selects a step when its tab is chosen', async () => {
    await mount()
    fireEvent.click(tab('3 · Rules'))
    await act(async () => {})
    expect(tab('3 · Rules').getAttribute('aria-selected')).toBe('true')
  })
})
