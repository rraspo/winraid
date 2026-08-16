import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import App from './App'

// Paths used by the fixtures. Generic stand-ins only.
const ROOT_PATH = '/mnt/user/media'
const FAV_PATH  = '/mnt/user/media/photos'
const DEEP_PATH = '/mnt/user/media/photos/2026'
const CONN_ID   = 'c1'

// The shell's children are stubbed so the test drives App's own navigation
// wiring — useNavHistory, openTab, navigateFavorite, restoreEntry — without
// mounting every view and its IPC.
// vi.mock factories are hoisted above the consts above, so they repeat the
// path literals rather than closing over them.
vi.mock('./components/Sidebar', () => ({
  default: ({ onOpenTab, onNavigateFavorite }) => (
    <div>
      <button data-testid="open-browse" onClick={() => onOpenTab('c1', 'browse')}>open</button>
      <button data-testid="fav" onClick={() => onNavigateFavorite('c1', '/mnt/user/media/photos')}>fav</button>
    </div>
  ),
}))

// Stands in for BrowseView: pushes the tab's initial directory entry on mount
// the way useBrowse does, reports the browseRestore it is handed, and can push
// a deeper directory the way navigate() does on a folder click.
vi.mock('./views/BrowseView', () => {
  // Named so the hooks below are linted as a component rather than a bare
  // arrow assigned to `default`.
  function BrowseStub({ browseRestore, onHistoryPush, connectionId }) {
    const pushedInitial = useRef(false)
    useEffect(() => {
      if (pushedInitial.current) return
      pushedInitial.current = true
      onHistoryPush?.({ kind: 'browse', path: '/mnt/user/media', quickLookFile: null, connectionId })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-once push, guarded by the ref
    return (
      <div>
        <span data-testid="restore-path">{browseRestore ? String(browseRestore.path) : 'none'}</span>
        <button
          data-testid="go-deeper"
          onClick={() => onHistoryPush?.({ kind: 'browse', path: '/mnt/user/media/photos/2026', quickLookFile: null, connectionId })}
        >
          deeper
        </button>
      </div>
    )
  }
  return { default: BrowseStub }
})

vi.mock('./components/Header',       () => ({ default: () => <div /> }))
vi.mock('./components/StatusBar',    () => ({ default: () => <div /> }))
vi.mock('./components/TabBar',       () => ({ default: () => <div /> }))
vi.mock('./components/EditorView',   () => ({ default: () => <div /> }))
vi.mock('./components/ui/ToastHost', () => ({ default: () => <div /> }))
vi.mock('./views/ConnectionView',    () => ({ default: () => <div /> }))
vi.mock('./views/DashboardView',     () => ({ default: () => <div /> }))
vi.mock('./views/QueueView',         () => ({ default: () => <div /> }))
vi.mock('./views/BackupView',        () => ({ default: () => <div /> }))
vi.mock('./views/SizeView',          () => ({ default: () => <div /> }))
vi.mock('./views/SettingsView',      () => ({ default: () => <div /> }))
vi.mock('./views/LogView',           () => ({ default: () => <div /> }))

const noopSubscribe = () => () => {}

beforeEach(() => {
  window.winraid = {
    config:   {
      get: vi.fn(async () => ({
        connections: [{ id: CONN_ID, name: 'Atlas', sftp: { remotePath: ROOT_PATH } }],
        favoritesByConnection: { [CONN_ID]: [FAV_PATH] },
      })),
      set: vi.fn(async () => {}),
    },
    watcher:  { list: vi.fn(async () => ({})), onStatus: noopSubscribe, pauseAll: vi.fn(), resumeAll: vi.fn() },
    queue:    { list: vi.fn(async () => []), onProgress: noopSubscribe, onUpdated: noopSubscribe, pause: vi.fn(), resume: vi.fn() },
    backup:   { onProgress: noopSubscribe },
    activity: { reveal: vi.fn() },
  }
})

// Mouse button 3 is the side "back" button; App listens for it on mousedown.
function pressMouseBack() {
  fireEvent.mouseDown(window, { button: 3 })
}

describe('App navigation history — jumps that bypass navigate()', () => {
  it('goes back to the favorite folder, not the tab\'s initial directory', async () => {
    render(<App />)

    // Open the browse tab: it lands on the connection's configured root.
    fireEvent.click(screen.getByTestId('open-browse'))
    await screen.findByTestId('restore-path')

    // Jump to a favorite folder, then click into a folder inside it.
    fireEvent.click(screen.getByTestId('fav'))
    await waitFor(() => expect(screen.getByTestId('restore-path')).toHaveTextContent(FAV_PATH))
    fireEvent.click(screen.getByTestId('go-deeper'))

    // Back must land on the favorite folder we came from.
    pressMouseBack()
    await waitFor(() => expect(screen.getByTestId('restore-path')).toHaveTextContent(FAV_PATH))

    // And only the next back reaches the tab's initial directory.
    pressMouseBack()
    await waitFor(() => expect(screen.getByTestId('restore-path')).toHaveTextContent(ROOT_PATH))
  })
})
