import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import SizeView from './SizeView'

// Contract under test — the Size map on the redesign, after
// ref/size-map.png: a page header with the title and a one-line subtitle
// naming the scanned root, then the chart card on the left and the folder
// rows on the right. Scanning, cancelling, re-scanning, drilling into a
// slice and jumping to the browser keep working exactly as before (see
// SizeView.test.jsx).
//
// DOM contract:
//   - <h1>Size map</h1>
//   - subtitle "Where the space on <remote path> goes — click a slice to
//     inspect it", with the "Last scan" text kept next to it
//   - the chart lives in <section aria-label="Size chart">, the rows in
//     <section aria-label="Folders">; both exist once a scan has results,
//     neither renders a chart in the idle state (existing test)
//   - each folder row shows the name, the size and its share as "<n>%",
//     and carries a button "Open in browser" that calls onBrowsePath(path)

const CONN = { id: 'conn-1', name: 'Atlas', type: 'sftp', sftp: { host: '10.0.0.1', remotePath: '/mnt/user/media' } }

beforeEach(() => { window.winraid = createWinraidMock() })
afterEach(() => { delete window.winraid })

describe('SizeView redesign', () => {
  it('has the title and the subtitle naming the scanned root', () => {
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Size map' })).toBeInTheDocument()
    expect(screen.getByText(/Where the space on \/mnt\/user\/media goes/)).toBeInTheDocument()
    expect(screen.getByText(/Last scan: never/)).toBeInTheDocument()
  })

  it('keeps the scan control in the header', () => {
    render(<SizeView connectionId="conn-1" connection={CONN} />)
    expect(screen.getByRole('button', { name: /scan now/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Size chart' })).toBeNull()
  })
})
