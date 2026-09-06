import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import LogView from './LogView'

// Contract under test — the Logs screen on the redesign, after
// ref/logs.png: a title row with the log file name and a live "tailing"
// marker, then one row per entry with time, level and message columns.
// The filter box and the open/clear actions keep working as before.
//
// DOM contract:
//   - <h1>Logs</h1>
//   - a status text "<log file basename> · tailing" from log.getPath()
//   - the entries list is <ol aria-label="Log entries">; each row carries
//     data-level="<level>" and three cells with the time, the level in
//     upper case, and the message
//   - the filter input keeps the placeholder "Filter logs…"

const ENTRIES = [
  { ts: Date.parse('2026-09-06T21:36:00'), level: 'info',  message: 'Transferring clip.mp4' },
  { ts: Date.parse('2026-09-06T21:37:00'), level: 'warn',  message: 'Watcher resumed after network drop' },
  { ts: Date.parse('2026-09-06T21:38:00'), level: 'error', message: 'Name collision on NAS' },
]

beforeEach(() => {
  window.winraid = createWinraidMock({
    log: {
      getPath: vi.fn().mockResolvedValue('/var/log/winraid/winraid-2026-09-06.log'),
      tail:    vi.fn().mockResolvedValue(ENTRIES),
    },
  })
})

afterEach(() => { delete window.winraid })

async function mount() {
  render(<LogView />)
  await screen.findByText('Transferring clip.mp4')
}

describe('LogView redesign', () => {
  it('has the title, the log file name and the tailing marker', async () => {
    await mount()
    expect(screen.getByRole('heading', { level: 1, name: 'Logs' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('winraid-2026-09-06.log · tailing')).toBeInTheDocument())
  })

  it('renders one row per entry with time, level and message', async () => {
    await mount()
    const list = screen.getByRole('list', { name: 'Log entries' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.getAttribute('data-level'))).toEqual(['info', 'warn', 'error'])
    expect(within(rows[1]).getByText('WARN')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Watcher resumed after network drop')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/21:36/)).toBeInTheDocument()
  })

  it('keeps the filter box', async () => {
    await mount()
    expect(screen.getByPlaceholderText('Filter logs…')).toBeInTheDocument()
  })
})
