import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, onChange }) => (
    <textarea data-testid="cm" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import EditorView from './EditorView'
import { createWinraidMock } from '../__mocks__/winraid'

beforeEach(() => {
  window.winraid = createWinraidMock({
    remote: {
      readFile:  vi.fn().mockResolvedValue({ ok: true, content: 'hello' }),
      writeFile: vi.fn().mockResolvedValue({ ok: true }),
    },
  })
})
afterEach(() => { delete window.winraid })

describe('EditorView', () => {
  it('loads the file content', async () => {
    render(<EditorView connectionId="c1" filePath="/a/notes.txt" />)
    await waitFor(() => expect(screen.getByTestId('cm').value).toBe('hello'))
  })

  it('reports dirty state when edited', async () => {
    const onDirtyChange = vi.fn()
    render(<EditorView connectionId="c1" filePath="/a/notes.txt" onDirtyChange={onDirtyChange} />)
    await waitFor(() => expect(screen.getByTestId('cm').value).toBe('hello'))
    fireEvent.change(screen.getByTestId('cm'), { target: { value: 'changed' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('saves the draft via remote.writeFile', async () => {
    render(<EditorView connectionId="c1" filePath="/a/notes.txt" />)
    await waitFor(() => expect(screen.getByTestId('cm').value).toBe('hello'))
    fireEvent.change(screen.getByTestId('cm'), { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(window.winraid.remote.writeFile).toHaveBeenCalledWith('c1', '/a/notes.txt', 'hello world')
    )
  })
})
