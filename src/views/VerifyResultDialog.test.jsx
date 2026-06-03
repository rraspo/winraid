import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { VerifyResultDialog } from './ConnectionView'

beforeEach(() => {
  window.winraid = {
    queue: { reduceCompleted: vi.fn().mockResolvedValue({ lifetimeCompleted: 0 }) },
  }
})

afterEach(() => { cleanup(); delete window.winraid })

const RESULT = {
  total: 4,
  notFound:  ['a.txt', 'b.txt'],
  confirmed: ['c.txt', 'd.txt'],
}

function setup(overrides = {}) {
  const onEnqueue = vi.fn().mockResolvedValue(undefined)
  const onDelete  = vi.fn().mockResolvedValue({ deleted: 2, errors: [] })
  const onClose   = vi.fn()
  render(
    <VerifyResultDialog
      result={RESULT}
      onEnqueue={onEnqueue}
      onDelete={onDelete}
      onClose={onClose}
      {...overrides}
    />
  )
  return { onEnqueue, onDelete, onClose }
}

describe('VerifyResultDialog — Not on NAS delete option', () => {
  it('offers a Delete files action for the not-on-NAS group', () => {
    setup()
    expect(screen.getByRole('button', { name: /delete 2 file/i })).toBeInTheDocument()
  })

  it('deletes the not-on-NAS files (local paths) when clicked', async () => {
    const { onDelete } = setup()
    fireEvent.click(screen.getByRole('button', { name: /delete 2 file/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(['a.txt', 'b.txt']))
  })

  it('does NOT reduce the completed counter when deleting not-on-NAS files', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /delete 2 file/i }))
    await waitFor(() => {})
    expect(window.winraid.queue.reduceCompleted).not.toHaveBeenCalled()
  })
})

describe('VerifyResultDialog — confirmed cleanup reduces the counter', () => {
  it('reduces the completed counter by the number of deleted confirmed copies', async () => {
    const { onDelete } = setup()
    // The confirmed section's delete button
    fireEvent.click(screen.getByRole('button', { name: /delete 2 local file/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(['c.txt', 'd.txt']))
    await waitFor(() => expect(window.winraid.queue.reduceCompleted).toHaveBeenCalledWith(2))
  })
})
