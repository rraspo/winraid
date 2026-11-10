// @vitest-environment node
// The Activity entry for a finished upload must open the folder the file
// actually landed in. Drag-and-drop uploads land under the folder they were
// dropped on (job.remoteDest), not under the connection's remote root.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { transferMock } = vi.hoisted(() => ({ transferMock: vi.fn() }))

vi.mock('./queue.js', () => ({
  getNextPending: vi.fn(),
  updateJob: vi.fn(),
  listJobs: vi.fn(() => []),
  STATUS: { PENDING: 'PENDING', TRANSFERRING: 'TRANSFERRING', DONE: 'DONE', ERROR: 'ERROR' },
}))
vi.mock('./config.js', () => ({ getConfig: vi.fn() }))
vi.mock('./ipc-bridge.js', () => ({ init: vi.fn(), sendToRenderer: vi.fn(), notify: vi.fn() }))
vi.mock('./logger.js', () => ({ log: vi.fn() }))
vi.mock('./activity.js', () => ({ pushActivity: vi.fn() }))
vi.mock('./folder-mode.js', () => ({
  shouldPruneEmptyDirs: vi.fn(() => false),
  deletesLocalAfterUpload: vi.fn((conn) => conn.operation === 'move'),
}))
vi.mock('fs/promises', () => ({ unlink: vi.fn(() => Promise.resolve()) }))
vi.mock('./backends/sftp.js', () => ({
  createSftpBackend: vi.fn(() => ({ transfer: transferMock })),
}))

import { getNextPending } from './queue.js'
import { getConfig } from './config.js'
import { pushActivity } from './activity.js'
import { ensureWorkerRunning, stopWorker } from './worker.js'

async function runOneJob(job, operation) {
  getConfig.mockReturnValue({
    connections: [{ id: 'conn-1', type: 'sftp', name: 'NAS', operation, sftp: { remotePath: '/backups' } }],
  })
  getNextPending.mockReturnValueOnce({ id: 'job-1', connectionId: 'conn-1', ...job }).mockReturnValue(null)
  transferMock.mockResolvedValue({})

  ensureWorkerRunning()
  await vi.advanceTimersByTimeAsync(1000)
  expect(transferMock).toHaveBeenCalledTimes(1)
  return pushActivity.mock.calls.map(([entry]) => entry).find((entry) => entry.level === 'info')
}

describe('upload activity route', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopWorker()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it.each(['move', 'copy'])('opens the drop folder for a dropped file (%s connection)', async (operation) => {
    const entry = await runOneJob({
      srcPath: 'C:\\Users\\me\\Desktop\\movie.mkv', filename: 'movie.mkv', relPath: 'movie.mkv', remoteDest: '/media/inbox',
    }, operation)

    expect(entry.nav).toEqual({ kind: 'remote', path: '/media/inbox', highlight: 'movie.mkv' })
    expect(entry.detail).toBe('/media/inbox')
  })

  it('opens the dropped folder\'s own subfolder for a file inside a dropped folder', async () => {
    const entry = await runOneJob({
      srcPath: 'C:\\Users\\me\\Desktop\\Photos\\a.jpg', filename: 'a.jpg', relPath: 'Photos/a.jpg', remoteDest: '/media/inbox',
    }, 'move')

    expect(entry.nav).toEqual({ kind: 'remote', path: '/media/inbox/Photos', highlight: 'a.jpg' })
  })

  it('opens the connection\'s remote folder for a watched file', async () => {
    const entry = await runOneJob({
      srcPath: 'C:\\watch\\sub\\movie.mkv', filename: 'movie.mkv', relPath: 'sub/movie.mkv', remoteDest: null,
    }, 'move')

    expect(entry.nav).toEqual({ kind: 'remote', path: '/backups/sub', highlight: 'movie.mkv' })
  })
})
