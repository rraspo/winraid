// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// WR-28: worker-owned business logic must import WITHOUT pulling main.js (the
// composition root). We deliberately do NOT mock ./main.js — instead we make
// importing it throw, so any lingering worker -> main import edge fails this
// test loudly instead of silently loading the entire 3000-line entry module.
vi.mock('./main.js', () => {
  throw new Error('WR-28 regression: a worker-owned module imported ./main.js')
})
vi.mock('./ipc-bridge.js', () => ({
  init: vi.fn(),
  sendToRenderer: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('./queue.js', () => ({
  getNextPending: vi.fn(),
  updateJob: vi.fn(),
  listJobs: vi.fn(() => []),
  STATUS: { PENDING: 'PENDING', TRANSFERRING: 'TRANSFERRING', DONE: 'DONE', ERROR: 'ERROR' },
}))
vi.mock('./config.js', () => ({ getConfig: vi.fn(() => ({ connections: [] })) }))
vi.mock('./logger.js', () => ({ log: vi.fn() }))

describe('WR-28 — worker is decoupled from main.js', () => {
  it('imports worker.js without loading main.js', async () => {
    const worker = await import('./worker.js')
    expect(typeof worker.ensureWorkerRunning).toBe('function')
  })
})
