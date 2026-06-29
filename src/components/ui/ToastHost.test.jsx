import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitForElementToBeRemoved } from '@testing-library/react'
import ToastHost from './ToastHost'
import * as toast from '../../services/toast'

afterEach(() => act(() => toast.clearAll()))

describe('ToastHost', () => {
  it('renders a row per stored toast', () => {
    render(<ToastHost />)
    act(() => {
      toast.show({ msg: 'Hello', sticky: true })
      toast.show({ msg: 'World', sticky: true })
    })
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('World')).toBeInTheDocument()
  })

  it('removes a toast (after its exit animation) when its close button is clicked', async () => {
    render(<ToastHost />)
    act(() => toast.show({ msg: 'Bye', sticky: true }))
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    // It lingers briefly (exit animation) then is removed.
    await waitForElementToBeRemoved(() => screen.queryByText('Bye'))
  })
})
