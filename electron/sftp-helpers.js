import { mkdirSync } from 'fs'
import { join } from 'path'
import { isImageFile, isVideoFile } from '../src/utils/fileTypes.js'

export async function sftpRmRf(sftp, remotePath, depth = 0, maxDepth = 50) {
  if (depth > maxDepth) throw new Error('Directory tree too deep (max 50 levels)')
  const list = await new Promise((resolve, reject) =>
    sftp.readdir(remotePath, (err, items) => err ? reject(err) : resolve(items ?? []))
  )
  for (const item of list) {
    const child = `${remotePath}/${item.filename}`
    if (((item.attrs.mode ?? 0) & 0o170000) === 0o040000) {
      await sftpRmRf(sftp, child, depth + 1, maxDepth)
    } else {
      await new Promise((resolve, reject) =>
        sftp.unlink(child, (err) => err ? reject(err) : resolve())
      )
    }
  }
  await new Promise((resolve, reject) =>
    sftp.rmdir(remotePath, (err) => err ? reject(err) : resolve())
  )
}

export async function remoteWalkCreate(sftp, remotePath, localPath, created = [], depth = 0, maxDepth = 50) {
  if (depth > maxDepth) throw new Error('Directory tree too deep (max 50 levels)')
  mkdirSync(localPath, { recursive: true })
  created.push(localPath)
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) return reject(err)
      const dirs = list.filter(
        (e) => ((e.attrs.mode ?? 0) & 0o170000) === 0o040000 && !e.filename.startsWith('.')
      )
      Promise.all(
        dirs.map((d) =>
          remoteWalkCreate(sftp, `${remotePath}/${d.filename}`, join(localPath, d.filename), created, depth + 1, maxDepth)
        )
      ).then(resolve).catch(reject)
    })
  })
}

export async function mediaWalk(sftp, rootPath, {
  recursive   = true,
  signal,
  onBatch,
  onError,
  concurrency = 16,
} = {}) {
  const queue   = [rootPath]
  let inFlight  = 0
  let firstSent = false
  let buffer    = []
  let timer     = null
  const FLUSH_SIZE = 20
  const FLUSH_MS   = 100

  function flush() {
    if (timer) { clearTimeout(timer); timer = null }
    if (buffer.length === 0) return
    const out = buffer
    buffer = []
    if (typeof onBatch === 'function') onBatch(out)
  }

  function emit(file) {
    if (typeof onBatch !== 'function') return
    if (!firstSent) {
      firstSent = true
      onBatch([file])
      return
    }
    buffer.push(file)
    if (buffer.length >= FLUSH_SIZE) {
      flush()
    } else if (!timer) {
      timer = setTimeout(flush, FLUSH_MS)
    }
  }

  async function processDir(dirPath) {
    let list
    try {
      list = await new Promise((resolve, reject) =>
        sftp.readdir(dirPath, (err, items) => err ? reject(err) : resolve(items ?? []))
      )
    } catch (err) {
      if (typeof onError === 'function') {
        onError({ path: dirPath, msg: err?.message ?? String(err), code: err?.code })
      }
      return
    }
    for (const item of list) {
      if (item.filename.startsWith('.')) continue
      const childPath = `${dirPath}/${item.filename}`
      const isDir     = ((item.attrs?.mode ?? 0) & 0o170000) === 0o040000
      if (isDir) {
        if (recursive) queue.push(childPath)
        continue
      }
      const name  = item.filename
      const isImg = isImageFile(name)
      const isVid = !isImg && isVideoFile(name)
      if (!isImg && !isVid) continue
      emit({
        path:  childPath,
        size:  item.attrs?.size  ?? 0,
        mtime: item.attrs?.mtime ?? 0,
        type:  isImg ? 'image' : 'video',
      })
    }
  }

  await new Promise((resolve) => {
    let resolved = false
    function done() {
      if (resolved) return
      resolved = true
      resolve()
    }
    function pump() {
      if (signal?.aborted) {
        if (inFlight === 0) done()
        return
      }
      while (inFlight < concurrency && queue.length > 0) {
        const next = queue.shift()
        inFlight++
        Promise.resolve()
          .then(() => processDir(next))
          .finally(() => {
            inFlight--
            pump()
          })
      }
      if (inFlight === 0 && queue.length === 0) done()
    }
    pump()
  })

  flush()
}

export async function backupWalkRemote(sftp, remotePath, relBase, depth = 0, maxDepth = 50) {
  if (depth > maxDepth) throw new Error('Directory tree too deep (max 50 levels)')
  const results = []
  const list = await new Promise((resolve, reject) =>
    sftp.readdir(remotePath, (err, items) => err ? reject(err) : resolve(items ?? []))
  )
  for (const item of list) {
    if (item.filename.startsWith('.')) continue
    const childRemote = `${remotePath}/${item.filename}`
    const childRel    = relBase ? `${relBase}/${item.filename}` : item.filename
    const isDir       = ((item.attrs.mode ?? 0) & 0o170000) === 0o040000
    if (isDir) {
      const sub = await backupWalkRemote(sftp, childRemote, childRel, depth + 1, maxDepth)
      results.push(...sub)
    } else {
      results.push({ remotePath: childRemote, size: item.attrs.size ?? 0, mtime: item.attrs.mtime ?? 0, relPath: childRel })
    }
  }
  return results
}
