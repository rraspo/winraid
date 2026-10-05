import { getExt } from './fileTypes'

// Extension-to-label map for the list view's Kind column — the fast,
// no-I/O approach Explorer itself uses. A mime-sniff would need to read
// file bytes over the remote connection for every visible row, an
// unjustified round trip for a column that only needs a rough
// classification.
const EXTENSION_LABELS = {
  jpg: 'JPEG image', jpeg: 'JPEG image', png: 'PNG image', gif: 'GIF image',
  webp: 'WebP image', svg: 'SVG image', bmp: 'Bitmap image',
  mp4: 'MP4 video', m4v: 'MP4 video', webm: 'WebM video', mov: 'QuickTime video', mkv: 'MKV video',
  mp3: 'MP3 audio', flac: 'FLAC audio', wav: 'WAV audio', aac: 'AAC audio',
  ogg: 'OGG audio', m4a: 'M4A audio', opus: 'Opus audio',
  pdf: 'PDF document',
  zip: 'ZIP archive', rar: 'RAR archive', '7z': '7-Zip archive', tar: 'TAR archive', gz: 'GZip archive',
  txt: 'Text document', md: 'Markdown document',
  doc: 'Word document', docx: 'Word document',
  xls: 'Excel spreadsheet', xlsx: 'Excel spreadsheet',
  ppt: 'PowerPoint presentation', pptx: 'PowerPoint presentation',
}

// A folder's kind, a known extension's label, or a sensible fallback — an
// unrecognized extension names itself ("XYZ file") and an extensionless
// file falls back to a plain "File", never a blank cell.
export function fileKind(entry) {
  if (entry.type === 'dir') return 'File folder'
  const ext = getExt(entry.name)
  if (!ext) return 'File'
  return EXTENSION_LABELS[ext] ?? `${ext.toUpperCase()} file`
}
