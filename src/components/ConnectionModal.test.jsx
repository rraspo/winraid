import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { createWinraidMock } from '../__mocks__/winraid'
import ConnectionModal from './ConnectionModal'

const baseProps = { onClose: vi.fn(), onSave: vi.fn() }

const sftpConn = {
  id: 'c1',
  name: 'NAS',
  type: 'sftp',
  sftp: { host: 'nas.local', port: 22, username: 'backup', password: 'pw', remotePath: '/mnt/user' },
}

const HOST_KEY_ERROR = {
  ok: false,
  code: 'HOST_KEY_CHANGED',
  error: 'The host key for nas.local changed. It may be a different machine.',
}

beforeEach(() => { window.winraid = createWinraidMock() })
afterEach(() => { cleanup(); delete window.winraid })

async function testConnection() {
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await waitFor(() => expect(window.winraid.ssh.test).toHaveBeenCalled())
}

describe('ConnectionModal — changed host key', () => {
  it('offers to forget the pinned key only when that is what failed', async () => {
    window.winraid.ssh.test.mockResolvedValue(HOST_KEY_ERROR)
    render(<ConnectionModal {...baseProps} existing={sftpConn} />)
    await testConnection()

    expect(await screen.findByText(/host key for nas\.local changed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /forget saved key/i })).toBeInTheDocument()
  })

  it('does not offer it for an ordinary connection failure', async () => {
    window.winraid.ssh.test.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })
    render(<ConnectionModal {...baseProps} existing={sftpConn} />)
    await testConnection()

    expect(await screen.findByText('ECONNREFUSED')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /forget saved key/i })).toBeNull()
  })

  it('forgets the key for the host and port on screen, then retests', async () => {
    window.winraid.ssh.test.mockResolvedValue(HOST_KEY_ERROR)
    render(<ConnectionModal {...baseProps} existing={{ ...sftpConn, sftp: { ...sftpConn.sftp, port: 2222 } }} />)
    await testConnection()

    window.winraid.ssh.test.mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: /forget saved key/i }))

    await waitFor(() => expect(window.winraid.ssh.forgetHostKey).toHaveBeenCalledWith('nas.local', 2222))
    expect(await screen.findByText('Connected')).toBeInTheDocument()
  })

  it('surfaces a failure to forget rather than silently doing nothing', async () => {
    window.winraid.ssh.test.mockResolvedValue(HOST_KEY_ERROR)
    window.winraid.ssh.forgetHostKey.mockResolvedValue({ ok: false, error: 'Invalid host' })
    render(<ConnectionModal {...baseProps} existing={sftpConn} />)
    await testConnection()

    fireEvent.click(screen.getByRole('button', { name: /forget saved key/i }))
    expect(await screen.findByText('Invalid host')).toBeInTheDocument()
  })
})
