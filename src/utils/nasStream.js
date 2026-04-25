export function nasStreamUrl(connectionId, remotePath) {
  const encodedPath = remotePath.split('/').map(encodeURIComponent).join('/')
  return `nas-stream://${connectionId}${encodedPath}`
}
