export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'])
export const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv'])
export const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'opus'])
export const PDF_EXTENSIONS   = new Set(['pdf'])
export const TEXT_EXTENSIONS  = new Set([
  'json', 'yml', 'yaml', 'sh', 'bash', 'zsh',
  'conf', 'ini', 'env', 'toml', 'txt', 'xml', 'lua', 'py', 'nginx',
])
// Known-binary extensions. Everything else — including unlisted text/config
// types and extensionless files (Dockerfile, hosts, .gitignore) — is treated as
// editable. The remote read path already caps file size at 50 MB.
export const BINARY_EXTENSIONS = new Set([
  // raster images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif', 'avif',
  'raw', 'cr2', 'nef', 'arw', 'dng', 'psd', 'ai',
  // video
  'mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'm2ts', 'mpg', 'mpeg', '3gp', 'ogv',
  // audio
  'mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'opus', 'wma', 'aiff', 'mid', 'midi',
  // documents / office binaries
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  // archives
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'lz4', 'cab', 'iso', 'img', 'dmg',
  // executables / libraries / packages
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'jar', 'msi', 'apk', 'deb', 'rpm',
  'appimage', 'wasm', 'pyc', 'pdb',
  // fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // databases / binary data
  'db', 'sqlite', 'sqlite3', 'dat', 'pack', 'idx',
])

export function getExt(name) {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isImageFile(name)    { return IMAGE_EXTENSIONS.has(getExt(name)) }
export function isVideoFile(name)    { return VIDEO_EXTENSIONS.has(getExt(name)) }
export function isEditableFile(name) { return !BINARY_EXTENSIONS.has(getExt(name)) }

export function fileType(name) {
  const ext = getExt(name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (PDF_EXTENSIONS.has(ext))   return 'pdf'
  // Anything not a known binary type previews as text (logs, configs, code,
  // extensionless files) — mirrors isEditableFile.
  if (isEditableFile(name))      return 'text'
  return 'unknown'
}
