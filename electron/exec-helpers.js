export function execWithTimeout(client, cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err)

      let stdout = ''
      let stderr = ''
      let settled = false
      let timer = null

      const settle = (code, error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) return reject(error)
        resolve({ code, stdout, stderr })
      }

      stream.on('data', (chunk) => { stdout += chunk.toString() })
      stream.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      stream.on('close', (code) => settle(code, null))

      timer = setTimeout(() => {
        settle(null, new Error(`SSH exec timed out after ${timeoutMs}ms: ${cmd}`))
        stream.destroy()
      }, timeoutMs)
    })
  })
}
