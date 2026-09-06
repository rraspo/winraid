import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { VerifyResultDialog } from './ConnectionView'

// Contract under test — the verification results on the redesign, after
// ref/verification-results.png: a dialog with a title, a stat strip, the
// per-group file lists and the actions. Every action from
// VerifyResultDialog.test.jsx keeps its name and effect.
//
// DOM contract:
//   - role="dialog" named "Verification results", aria-modal
//   - a stat strip with <article aria-label="Confirmed on NAS"> and
//     <article aria-label="Missing on NAS"> holding the counts
//   - a "Close" button calling onClose

beforeEach(() => {
  window.winraid = { queue: { reduceCompleted: vi.fn().mockResolvedValue({ lifetimeCompleted: 0 }) } }
})

afterEach(() => { cleanup(); delete window.winraid })

const RESULT = { total: 4, notFound: ['a.txt', 'b.txt'], confirmed: ['c.txt', 'd.txt'] }

function mount() {
  const onClose = vi.fn()
  render(<VerifyResultDialog result={RESULT} onEnqueue={vi.fn().mockResolvedValue(undefined)} onDelete={vi.fn().mockResolvedValue({ deleted: 2, errors: [] })} onClose={onClose} />)
  return { onClose }
}

describe('VerifyResultDialog redesign', () => {
  it('is a modal dialog with the stat strip', () => {
    mount()
    const dialog = screen.getByRole('dialog', { name: 'Verification results' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(screen.getByRole('article', { name: 'Confirmed on NAS' })).getByText('2')).toBeTruthy()
    expect(within(screen.getByRole('article', { name: 'Missing on NAS' })).getByText('2')).toBeTruthy()
  })

  it('closes from the Close action', () => {
    const { onClose } = mount()
    screen.getByRole('button', { name: 'Close' }).click()
    expect(onClose).toHaveBeenCalled()
  })
})
