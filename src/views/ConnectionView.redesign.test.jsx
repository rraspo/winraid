import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import ConnectionView from './ConnectionView'

// Contract under test — the connection editor on the redesign, after
// ref/new-connection-wizard.png: the prototype's three-step wizard. The
// steps are a tab strip over three always-rendered sections, so every
// field, hint, checkbox and action the editor has today keeps its name
// and behavior (see ConnectionView.keepEmptyDirs / renameDuplicates tests):
// choosing a step scrolls to and focuses its section rather than hiding
// the others.
//
// DOM contract:
//   - <h1> reads "New connection" for a new one and "Edit connection" when
//     editing
//   - <div role="tablist" aria-label="Steps"> with tabs named exactly
//     "1 · Server", "2 · Folders", "3 · Rules"; the tab whose section was
//     last chosen (or the first) has aria-selected="true"
//   - three <section> elements labelled by headings "Server", "Folders",
//     "Rules": Server holds protocol, host, port, username, authentication
//     and the "Test connection" action; Folders holds the watch folder and
//     the remote path; Rules holds operation, folder structure, keep empty
//     folders, rename duplicates and the extension filters
//   - "Save" and "Cancel" stay at the bottom

const EXISTING = {
  id: 'c1', name: 'Atlas', type: 'sftp', operation: 'copy', folderMode: 'mirror',
  localFolder: 'C:\\Users\\user\\Pictures\\Import',
  sftp: { host: 'nas.local', port: 22, username: 'user', remotePath: '/mnt/user/media' },
}

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => { delete window.winraid })

async function mount(existing = null) {
  render(<ConnectionView existing={existing} onSave={vi.fn()} onClose={vi.fn()} />)
  await act(async () => {})
}

function tab(name) {
  return within(screen.getByRole('tablist', { name: 'Steps' })).getByRole('tab', { name })
}

function section(name) {
  return screen.getByRole('region', { name })
}

describe('ConnectionView redesign', () => {
  it('titles a new connection and an edit differently', async () => {
    await mount(null)
    expect(screen.getByRole('heading', { level: 1, name: 'New connection' })).toBeTruthy()
  })

  it('titles an edit by its purpose', async () => {
    await mount(EXISTING)
    expect(screen.getByRole('heading', { level: 1, name: 'Edit connection' })).toBeTruthy()
  })

  it('shows the three steps with the first selected', async () => {
    await mount(null)
    expect(tab('1 · Server').getAttribute('aria-selected')).toBe('true')
    expect(tab('2 · Folders').getAttribute('aria-selected')).toBe('false')
    expect(tab('3 · Rules').getAttribute('aria-selected')).toBe('false')
  })

  it('keeps every step rendered and places the fields in their sections', async () => {
    await mount(EXISTING)
    const server = section('Server')
    expect(within(server).getByLabelText(/host/i)).toBeTruthy()
    expect(within(server).getByLabelText(/username/i)).toBeTruthy()
    expect(within(server).getByRole('button', { name: 'Test connection' })).toBeTruthy()
    const folders = section('Folders')
    expect(within(folders).getByLabelText(/watch folder/i)).toBeTruthy()
    expect(within(folders).getByLabelText(/remote path/i)).toBeTruthy()
    const rules = section('Rules')
    expect(within(rules).getByText(/operation/i)).toBeTruthy()
    expect(within(rules).getByText(/folder structure/i)).toBeTruthy()
    expect(within(rules).getByLabelText(/extensions/i)).toBeTruthy()
  })

  it('selecting a step marks it selected', async () => {
    await mount(EXISTING)
    fireEvent.click(tab('3 · Rules'))
    expect(tab('3 · Rules').getAttribute('aria-selected')).toBe('true')
    expect(tab('1 · Server').getAttribute('aria-selected')).toBe('false')
    expect(section('Server')).toBeTruthy()
  })

  it('keeps Save and Cancel', async () => {
    await mount(EXISTING)
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})
