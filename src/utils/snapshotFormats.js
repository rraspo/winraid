/**
 * Format triples for video snapshot encoding.
 * mime + ext + quality stay in lockstep — single source of truth.
 * quality is undefined for PNG; canvas.toBlob ignores it for lossless formats.
 */
export const SNAPSHOT_FORMATS = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg',  quality: 0.92 },
  png:  { mime: 'image/png',  ext: 'png',  quality: undefined },
  webp: { mime: 'image/webp', ext: 'webp', quality: 0.92 },
}

export function resolveSnapshotFormat(key) {
  return SNAPSHOT_FORMATS[key] ?? SNAPSHOT_FORMATS.jpeg
}
