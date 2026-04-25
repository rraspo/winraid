import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SettingsView from './SettingsView'
import { createWinraidMock } from '../__mocks__/winraid'

beforeEach(() => {
  window.winraid = createWinraidMock({
    config: {
      get: vi.fn().mockImplementation((key) => {
        if (key === 'playDefaults') return Promise.resolve({ recursive: true, shuffle: false })
        return Promise.resolve({})
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  })
})

afterEach(() => { delete window.winraid })

describe('SettingsView — Play section', () => {
  it('renders the Play section heading', async () => {
    render(<SettingsView />)
    await act(async () => {})
    expect(screen.getByText('Play')).toBeTruthy()
  })

  it('reads recursive default from config and shows it checked', async () => {
    render(<SettingsView />)
    await act(async () => {})
    const toggle = screen.getByRole('switch', { name: 'Default to recursive scan' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('reads shuffle default from config and shows it unchecked', async () => {
    render(<SettingsView />)
    await act(async () => {})
    const toggle = screen.getByRole('switch', { name: 'Default to shuffle' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('clicking the recursive toggle writes the new value via config.set', async () => {
    render(<SettingsView />)
    await act(async () => {})
    const toggle = screen.getByRole('switch', { name: 'Default to recursive scan' })
    fireEvent.click(toggle)
    expect(window.winraid.config.set).toHaveBeenCalledWith(
      'playDefaults',
      expect.objectContaining({ recursive: false })
    )
  })

  it('clicking the shuffle toggle writes the new value via config.set', async () => {
    render(<SettingsView />)
    await act(async () => {})
    const toggle = screen.getByRole('switch', { name: 'Default to shuffle' })
    fireEvent.click(toggle)
    expect(window.winraid.config.set).toHaveBeenCalledWith(
      'playDefaults',
      expect.objectContaining({ shuffle: true })
    )
  })
})
