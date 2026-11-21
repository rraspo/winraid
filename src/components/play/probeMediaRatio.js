function ratioOf(width, height) {
  return width > 0 && height > 0 ? width / height : null
}

/**
 * Reads a file's width / height before its wall tile is placed, so the
 * justified rows can be laid out once instead of reflowing as tiles load.
 * Images load the same URL their tile shows, which warms the cache for it;
 * videos read only their metadata and release the stream right after.
 * Resolves null on an error, zero dimensions or a timeout; never rejects.
 */
export function probeMediaRatio({ src, type, timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    const isVideo = type === 'video'
    const element = isVideo ? document.createElement('video') : new Image()
    let settled = false

    function finish(ratio) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      element.onload = null
      element.onerror = null
      element.onloadedmetadata = null
      if (isVideo) {
        element.removeAttribute('src')
        element.load()
      }
      resolve(ratio)
    }

    const timer = setTimeout(() => finish(null), timeoutMs)
    element.onerror = () => finish(null)
    if (isVideo) {
      element.preload = 'metadata'
      element.muted = true
      element.onloadedmetadata = () => finish(ratioOf(element.videoWidth, element.videoHeight))
    } else {
      element.onload = () => finish(ratioOf(element.naturalWidth, element.naturalHeight))
    }
    element.src = src
  })
}
