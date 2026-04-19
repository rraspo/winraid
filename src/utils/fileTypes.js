export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'])
export const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv'])
export const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'opus'])
export const PDF_EXTENSIONS   = new Set(['pdf'])
export const TEXT_EXTENSIONS  = new Set([
  'json', 'yml', 'yaml', 'sh', 'bash', 'zsh',
  'conf', 'ini', 'env', 'toml', 'txt', 'xml', 'lua', 'py', 'nginx',
])
export const EDITABLE_EXTENSIONS = TEXT_EXTENSIONS

export function getExt(name) {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isImageFile(name)    { return IMAGE_EXTENSIONS.has(getExt(name)) }
export function isVideoFile(name)    { return VIDEO_EXTENSIONS.has(getExt(name)) }
export function isEditableFile(name) { return EDITABLE_EXTENSIONS.has(getExt(name)) }

export function fileType(name) {
  const ext = getExt(name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (TEXT_EXTENSIONS.has(ext))  return 'text'
  if (PDF_EXTENSIONS.has(ext))   return 'pdf'
  return 'unknown'
}
