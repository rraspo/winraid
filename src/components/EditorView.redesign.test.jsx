import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }) => (
    <textarea data-testid="cm" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import EditorView from './EditorView'
import { createWinraidMock } from '../__mocks__/winraid'

// Contract under test — the text editor on the redesign, after
// ref/text-editor.png: the file name and the Save / Discard actions in the
// top row, the editor filling the middle, and a footer with the full path,
// the encoding marker and the save state. Loading, dirty tracking and
// saving keep working (see EditorView.test.jsx).
//
// DOM contract:
//   - a top row showing the file's basename
//   - buttons "Save" and "Discard", disabled until the draft differs
//   - <footer> containing the full remote path, the text "UTF-8 · LF",
//     and a status that reads "Saved" when clean and "Unsaved changes"
//     when dirty

beforeEach(() => {
  window.winraid = createWinraidMock({
    remote: {
      readFile:  vi.fn().mockResolvedValue({ ok: true, content: 'hello' }),
      writeFile: vi.fn().mockResolvedValue({ ok: true }),
    },
  })
})
afterEach(() => { delete window.winraid })

async function mount() {
  render(<EditorView connectionId="c1" filePath="/mnt/user/docs/notes.txt" />)
  await waitFor(() => expect(screen.getByTestId('cm').value).toBe('hello'))
}

describe('EditorView redesign', () => {
  it('shows the basename in the top row and the full path in the footer', async () => {
    await mount()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    const footer = screen.getByRole('contentinfo')
    expect(footer.textContent).toContain('/mnt/user/docs/notes.txt')
    expect(footer.textContent).toContain('UTF-8 · LF')
  })

  it('reports Saved when clean and Unsaved changes when dirty, with the actions following', async () => {
    await mount()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Discard' }).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('cm'), { target: { value: 'hello world' } })
    expect(within(footer).getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Discard' }).disabled).toBe(false)
  })
})
