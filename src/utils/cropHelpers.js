export function cropMimeType(name) {
  const ext = name.toLowerCase().split('.').pop()
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[ext] ?? 'image/jpeg'
}

export function cropCopyPath(remotePath, base = '_cropped') {
  const dot = remotePath.lastIndexOf('.')
  return dot === -1 ? remotePath + base : remotePath.slice(0, dot) + base + remotePath.slice(dot)
}

// Walk <base>, <base>_2, <base>_3, ... and return the first variant whose
// basename is not already present in existingNames (a Set or array of names in
// the target directory). Used to avoid clobbering an existing sibling.
export function nextAvailableCopyPath(remotePath, existingNames, base = '_cropped') {
  const set     = existingNames instanceof Set ? existingNames : new Set(existingNames ?? [])
  const slash   = remotePath.lastIndexOf('/')
  const dir     = slash >= 0 ? remotePath.slice(0, slash) : ''
  const dot     = remotePath.lastIndexOf('.')
  const stem    = remotePath.slice(slash + 1, dot >= slash ? dot : remotePath.length)
  const ext     = dot >= slash ? remotePath.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    const suffix = i === 1 ? base : `${base}_${i}`
    const name   = `${stem}${suffix}${ext}`
    if (!set.has(name)) return dir ? `${dir}/${name}` : name
  }
  return cropCopyPath(remotePath, base)
}

export function fullImageCrop(w, h) {
  return { unit: 'px', x: 0, y: 0, width: w, height: h }
}

export function centeredAspectCrop(w, h, aspect) {
  const cw = Math.min(w, h * aspect)
  const ch = cw / aspect
  return { unit: 'px', x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), width: Math.round(cw), height: Math.round(ch) }
}

export async function rotateCropImage(imgEl, mime) {
  const canvas = document.createElement('canvas')
  canvas.width  = imgEl.naturalHeight
  canvas.height = imgEl.naturalWidth
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(imgEl, -imgEl.naturalWidth / 2, -imgEl.naturalHeight / 2)
  return new Promise((resolve) => canvas.toBlob(resolve, mime, 1))
}

// displayCrop: crop in CSS pixels from react-image-crop's onComplete callback.
// imgEl must be the live <img> element so we can read naturalWidth/height and
// the CSS-layout width/height to compute the scale factor.
export async function applyCropToImage(imgEl, displayCrop, mime) {
  const scaleX = imgEl.naturalWidth  / imgEl.width
  const scaleY = imgEl.naturalHeight / imgEl.height
  const x = Math.round(displayCrop.x      * scaleX)
  const y = Math.round(displayCrop.y      * scaleY)
  const w = Math.round(displayCrop.width  * scaleX)
  const h = Math.round(displayCrop.height * scaleY)
  const canvas = document.createElement('canvas')
  canvas.width  = w
  canvas.height = h
  canvas.getContext('2d').drawImage(imgEl, x, y, w, h, 0, 0, w, h)
  return new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92))
}
