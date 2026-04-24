// Extracted SFTP recursive helpers. Each function accepts an optional depth
// counter and maxDepth limit (default 50) to guard against circular mounts or
// pathologically deep trees that would otherwise cause a stack overflow.

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

export async function remoteWalkCreate(sftp, remotePath, localPath, mkdirSync, join, created = [], depth = 0, maxDepth = 50) {
  if (depth > maxDepth) throw new Error('Directory tree too deep (max 50 levels)')
  mkdirSync(localPath, { recursive: true })
  created.push(localPath)
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) return resolve() // skip unreadable dirs (permissions etc.)
      const dirs = list.filter(
        (e) => ((e.attrs.mode ?? 0) & 0o170000) === 0o040000 && !e.filename.startsWith('.')
      )
      Promise.all(
        dirs.map((d) =>
          remoteWalkCreate(sftp, `${remotePath}/${d.filename}`, join(localPath, d.filename), mkdirSync, join, created, depth + 1, maxDepth)
        )
      ).then(resolve).catch(reject)
    })
  })
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
