// Maps a remote path (under a connection's sync root) to the local folder that
// mirrors it. Only meaningful for 'mirror' / 'mirror_clean' connections, where
// the local subfolder tree is recreated on the remote. Returns null when the
// connection does not mirror, lacks the needed paths, or the remote path falls
// outside the configured sync root.
export function localMirrorPath(conn, remotePath) {
  if (!conn || typeof remotePath !== 'string') return null

  const mode = conn.folderMode
  if (mode !== 'mirror' && mode !== 'mirror_clean') return null

  const localFolder = conn.localFolder
  const base = conn.sftp?.remotePath ?? conn.smb?.remotePath ?? ''
  if (!localFolder || !base) return null

  const stripTrail = (s) => s.replace(/[/\\]+$/, '')
  const nBase = stripTrail(base)
  const nPath = stripTrail(remotePath)

  let rel
  if (nPath === nBase) rel = ''
  else if (nPath.startsWith(nBase + '/')) rel = nPath.slice(nBase.length + 1)
  else return null // outside the sync root

  const sep = localFolder.includes('\\') ? '\\' : '/'
  const lf = stripTrail(localFolder)
  return rel ? lf + sep + rel.split('/').join(sep) : lf
}
