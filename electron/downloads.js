// Downloads from the NAS as background jobs.
//
// A job is one user action — a file, a folder, or a selection of entries —
// planned up front (folders walked, sizes summed) so progress is a real
// fraction of known totals, then transferred one file at a time. start()
// returns at once; the renderer follows the job through onUpdate snapshots
// and can cancel it, which stops mid-file and removes the partial file while
// keeping the files already finished.
import { mkdir, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { backupWalkRemote } from './sftp-helpers.js'

const FINISHED = new Set(['done', 'failed', 'canceled'])

function statRemote(sftp, remotePath) {
  return new Promise((resolve, reject) =>
    sftp.stat(remotePath, (err, stats) => (err ? reject(err) : resolve(stats))),
  )
}

// fastGet keeps several reads in flight, about ten times a sequential read
// stream's LAN throughput (33 vs 3 MB/s measured), but has no way to be
// stopped. It reads through whatever it is called on (open, fstat, stat, read,
// close, outgoing.state), so it is called on this view of the session, whose
// read fails once the job is canceled; fastGet's own error path then closes
// both handles and reports the failure.
function cancelable(sftp, signal) {
  return {
    get server() { return sftp.server },
    get outgoing() { return sftp.outgoing },
    open: (...args) => sftp.open(...args),
    fstat: (...args) => sftp.fstat(...args),
    stat: (...args) => sftp.stat(...args),
    close: (...args) => sftp.close(...args),
    read: (...args) => {
      if (signal.aborted) return args.at(-1)(new Error('Download canceled'))
      return sftp.read(...args)
    },
  }
}

// One { remotePath, localPath, size, name } per file to fetch. A folder lands
// under localPath/<folder name>, as the save dialog's "choose a folder" means.
async function planFiles(sftp, items) {
  const files = []
  for (const item of items) {
    if (item.isDir) {
      const walked = await backupWalkRemote(sftp, item.remotePath, basename(item.remotePath))
      for (const file of walked) {
        files.push({ remotePath: file.remotePath, localPath: join(item.localPath, ...file.relPath.split('/')), size: file.size, name: basename(file.remotePath) })
      }
    } else {
      const stats = await statRemote(sftp, item.remotePath)
      files.push({ remotePath: item.remotePath, localPath: item.localPath, size: stats.size ?? 0, name: basename(item.remotePath) })
    }
  }
  return files
}

// touch(connectionId) is called as bytes arrive: the SFTP pool closes a
// session 30 s after its last touch, which would cut a long transfer off.
export function createDownloadManager({ getSftp, onUpdate, onFinish = () => {}, touch = () => {}, progressIntervalMs = 100 }) {
  const jobs = new Map()

  const snapshot = (job) => ({
    id: job.id,
    connectionId: job.connectionId,
    label: job.label,
    destination: job.destination,
    state: job.state,
    filesDone: job.filesDone,
    filesTotal: job.filesTotal,
    bytesDone: job.bytesDone,
    bytesTotal: job.bytesTotal,
    currentFile: job.currentFile,
    error: job.error,
  })

  const publish = (job) => {
    job.lastPublished = Date.now()
    onUpdate(snapshot(job))
  }

  const finish = (job, state, error = null) => {
    job.state = state
    job.error = error
    job.currentFile = null
    publish(job)
    onFinish(snapshot(job))
  }

  async function transferFile(sftp, job, file) {
    await mkdir(dirname(file.localPath), { recursive: true })
    const before = job.bytesDone
    try {
      await new Promise((resolve, reject) => {
        sftp.fastGet.call(cancelable(sftp, job.controller.signal), file.remotePath, file.localPath, {
          concurrency: 4,
          chunkSize: 256 * 1024,
          step: (transferred) => {
            job.bytesDone = before + transferred
            if (Date.now() - job.lastPublished >= progressIntervalMs) {
              touch(job.connectionId)
              publish(job)
            }
          },
        }, (err) => (err ? reject(err) : resolve()))
      })
    } catch (err) {
      await unlink(file.localPath).catch(() => {})
      throw err
    }
  }

  async function run(job, items) {
    try {
      const sftp = await getSftp(job.connectionId)
      if (!sftp) return finish(job, 'failed', 'Connection unavailable')
      const files = await planFiles(sftp, items)
      if (job.controller.signal.aborted) return finish(job, 'canceled')
      job.filesTotal = files.length
      job.bytesTotal = files.reduce((sum, file) => sum + file.size, 0)
      job.state = 'running'
      publish(job)
      for (const file of files) {
        if (job.controller.signal.aborted) return finish(job, 'canceled')
        job.currentFile = file.name
        publish(job)
        await transferFile(sftp, job, file)
        job.filesDone++
      }
      finish(job, 'done')
    } catch (err) {
      if (job.controller.signal.aborted) finish(job, 'canceled')
      else finish(job, 'failed', err.message)
    }
  }

  return {
    // items: [{ remotePath, localPath, isDir }]; destination is what the
    // user picked, shown and revealed when the job ends.
    start(connectionId, items, destination) {
      const job = {
        id: randomUUID(),
        connectionId,
        label: items.length === 1 ? basename(items[0].remotePath) : `${items.length} items`,
        destination,
        state: 'preparing',
        filesDone: 0,
        filesTotal: 0,
        bytesDone: 0,
        bytesTotal: 0,
        currentFile: null,
        error: null,
        controller: new AbortController(),
        lastPublished: 0,
      }
      jobs.set(job.id, job)
      publish(job)
      run(job, items)
      return job.id
    },

    cancel(id) {
      const job = jobs.get(id)
      if (!job || FINISHED.has(job.state)) return false
      job.controller.abort()
      return true
    },

    list() {
      return [...jobs.values()].map(snapshot)
    },

    // Finished jobs stay listed until the renderer lets them go, so a window
    // reloaded mid-session still shows how they ended.
    dismiss(id) {
      const job = jobs.get(id)
      if (!job || !FINISHED.has(job.state)) return false
      jobs.delete(id)
      return true
    },
  }
}
