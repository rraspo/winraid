// A tiny, dependency-free PNG encoder used to synthesize fixture image bytes
// for the preview harness. Node ships zlib, so no image/canvas library is
// needed — this writes a valid truecolor PNG by hand (signature, IHDR,
// one IDAT chunk, IEND).
import { deflateSync } from 'node:zlib'

function buildCrcTable() {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let value = n
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    table[n] = value >>> 0
  }
  return table
}

const CRC_TABLE = buildCrcTable()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const lengthBuffer = Buffer.alloc(4)
  lengthBuffer.writeUInt32BE(data.length, 0)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer])
}

/** Encodes a solid-color truecolor PNG of the given size. rgb is [r, g, b], 0-255 each. */
export function encodeSolidColorPng(width, height, rgb) {
  const [red, green, blue] = rgb
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8   // bit depth
  ihdrData[9] = 2   // color type: truecolor (RGB, no alpha)
  ihdrData[10] = 0  // compression method
  ihdrData[11] = 0  // filter method
  ihdrData[12] = 0  // interlace method
  const ihdr = chunk('IHDR', ihdrData)

  const rowBytes = width * 3
  const raw = Buffer.alloc((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1)
    raw[rowStart] = 0 // per-row filter type: none
    for (let x = 0; x < width; x++) {
      const pixelStart = rowStart + 1 + x * 3
      raw[pixelStart] = red
      raw[pixelStart + 1] = green
      raw[pixelStart + 2] = blue
    }
  }
  const idat = chunk('IDAT', deflateSync(raw))
  const iend = chunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

// Small, fixed palette so fixture thumbnails are visually distinct without
// needing real image data. Deterministic per name so the same fixture file
// always renders the same color across a run.
const PALETTE = [
  [230, 126, 34],  // orange
  [52, 152, 219],  // blue
  [46, 204, 113],  // green
  [155, 89, 182],  // purple
  [241, 196, 15],  // yellow
  [231, 76, 60],   // red
  [26, 188, 156],  // teal
  [149, 165, 166], // gray
]

/** Deterministically maps a file name to one of the fixed palette colors. */
export function colorForName(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
