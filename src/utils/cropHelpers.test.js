import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cropMimeType, cropCopyPath, nextAvailableCopyPath,
  fullImageCrop, centeredAspectCrop,
  applyCropToImage, rotateCropImage, rotateImage, scaleDisplayCropToSource,
} from './cropHelpers'

// ---------------------------------------------------------------------------
// Canvas mock helpers
// ---------------------------------------------------------------------------

function makeCanvasMock() {
  const drawImage = vi.fn()
  const translate = vi.fn()
  const rotate    = vi.fn()
  const ctx = { drawImage, translate, rotate }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb, _mime, _q) => cb(new Blob(['pixel'], { type: _mime ?? 'image/jpeg' }))),
    _ctx: ctx,
  }
  return canvas
}

let origCreateElement
let canvasMock

beforeEach(() => {
  canvasMock = makeCanvasMock()
  origCreateElement = document.createElement.bind(document)
  document.createElement = (tag) => tag === 'canvas' ? canvasMock : origCreateElement(tag)
})

afterEach(() => {
  document.createElement = origCreateElement
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// cropMimeType
// ---------------------------------------------------------------------------

describe('cropMimeType', () => {
  it('returns image/jpeg for .jpg', () => expect(cropMimeType('photo.jpg')).toBe('image/jpeg'))
  it('returns image/jpeg for .jpeg', () => expect(cropMimeType('photo.jpeg')).toBe('image/jpeg'))
  it('returns image/png for .png (case-insensitive)', () => expect(cropMimeType('image.PNG')).toBe('image/png'))
  it('returns image/webp for .webp', () => expect(cropMimeType('img.webp')).toBe('image/webp'))
  it('defaults to image/jpeg for unknown extensions', () => expect(cropMimeType('file.xyz')).toBe('image/jpeg'))
})

// ---------------------------------------------------------------------------
// cropCopyPath
// ---------------------------------------------------------------------------

describe('cropCopyPath', () => {
  it('inserts _cropped before the extension', () => {
    expect(cropCopyPath('/mnt/share/photo.jpg')).toBe('/mnt/share/photo_cropped.jpg')
  })
  it('handles double extensions', () => {
    expect(cropCopyPath('/foo/bar.tar.gz')).toBe('/foo/bar.tar_cropped.gz')
  })
  it('appends _cropped when there is no extension', () => {
    expect(cropCopyPath('/foo/bar')).toBe('/foo/bar_cropped')
  })
  it('does not treat hidden files as having an extension', () => {
    const result = cropCopyPath('/home/user/.bashrc')
    expect(result).toContain('_cropped')
  })
})

// ---------------------------------------------------------------------------
// fullImageCrop / centeredAspectCrop
// ---------------------------------------------------------------------------

describe('fullImageCrop', () => {
  it('covers the full displayed dimensions at (0, 0)', () => {
    expect(fullImageCrop(800, 600)).toEqual({ unit: 'px', x: 0, y: 0, width: 800, height: 600 })
  })
})

describe('centeredAspectCrop', () => {
  it('is horizontally centered when height is the limiting dimension', () => {
    // 800x600 container with 1:1 aspect → max square is 600x600
    const c = centeredAspectCrop(800, 600, 1)
    expect(c.width).toBe(600)
    expect(c.height).toBe(600)
    expect(c.x).toBe(100)   // (800-600)/2
    expect(c.y).toBe(0)
  })

  it('is vertically centered when width is the limiting dimension', () => {
    // 400x600 container with 16:9 aspect → width-limited: 400 wide, 225 tall
    const c = centeredAspectCrop(400, 600, 16 / 9)
    expect(c.width).toBe(400)
    expect(c.height).toBeCloseTo(400 / (16 / 9), 0)
    expect(c.x).toBe(0)
    expect(c.y).toBeGreaterThan(0)
  })

  it('aspect ratio of result matches requested ratio', () => {
    const c = centeredAspectCrop(1000, 800, 4 / 3)
    expect(c.width / c.height).toBeCloseTo(4 / 3, 2)
  })

  it('9:16 portrait aspect fits inside a landscape container', () => {
    const c = centeredAspectCrop(1200, 700, 9 / 16)
    expect(c.width).toBeLessThanOrEqual(1200)
    expect(c.height).toBeLessThanOrEqual(700)
    expect(c.width / c.height).toBeCloseTo(9 / 16, 2)
  })
})

// ---------------------------------------------------------------------------
// applyCropToImage — extracts the correct source region
//
// react-image-crop gives crop coordinates in CSS pixels (the image's display
// size). The source image may have more native pixels than CSS pixels, so we
// must convert display coords → native pixel coords before passing them to
// drawImage. The output canvas is sized to the native pixels of the crop region
// so no quality is lost.
// ---------------------------------------------------------------------------

describe('applyCropToImage', () => {
  // Helper: make a mock img element with both display size and native size.
  function makeImg(naturalWidth, naturalHeight, displayWidth, displayHeight) {
    return { naturalWidth, naturalHeight, width: displayWidth, height: displayHeight }
  }

  it('extracts the correct region when the image has more pixels than its display size', async () => {
    // 3000x2000 image displayed at 600x400 — 5 native pixels per CSS pixel.
    // A crop at display (60, 40, 300×200) must read native pixels (300, 200, 1500×1000).
    const img  = makeImg(3000, 2000, 600, 400)
    const crop = { x: 60, y: 40, width: 300, height: 200 }

    await applyCropToImage(img, crop, 'image/jpeg')

    expect(canvasMock._ctx.drawImage).toHaveBeenCalledWith(
      img,
      300, 200,     // source origin in native pixels
      1500, 1000,   // source region size in native pixels
      0, 0,
      1500, 1000,   // dest fills the canvas (same size, no extra scaling)
    )
  })

  it('extracts the correct region when display size equals native size', async () => {
    // Image shown at its natural size — display coords equal native coords.
    const img  = makeImg(500, 400, 500, 400)
    const crop = { x: 50, y: 50, width: 200, height: 150 }

    await applyCropToImage(img, crop, 'image/jpeg')

    expect(canvasMock._ctx.drawImage).toHaveBeenCalledWith(
      img, 50, 50, 200, 150, 0, 0, 200, 150,
    )
  })

  it('output canvas dimensions equal the native pixel size of the crop region', async () => {
    // 1920x1080 image displayed at 960x540 — a full-display crop (no selection trimming)
    // should produce a canvas at the full native 1920x1080, not at the display size.
    const img  = makeImg(1920, 1080, 960, 540)
    const crop = { x: 0, y: 0, width: 960, height: 540 }

    await applyCropToImage(img, crop, 'image/png')

    expect(canvasMock.width).toBe(1920)
    expect(canvasMock.height).toBe(1080)
  })

  it('rounds fractional native pixel coords rather than truncating them', async () => {
    // 1000/333 ≈ 3.003 — coords must be rounded, not floored, for accurate region selection.
    const img  = makeImg(1000, 750, 333, 250)
    const crop = { x: 33, y: 25, width: 100, height: 75 }

    await applyCropToImage(img, crop, 'image/jpeg')

    const scaleX = 1000 / 333
    const scaleY = 750  / 250
    expect(canvasMock.width).toBe(Math.round(100 * scaleX))
    expect(canvasMock.height).toBe(Math.round(75 * scaleY))
  })

  it('returns the blob produced by toBlob', async () => {
    const img    = makeImg(100, 100, 100, 100)
    const crop   = { x: 0, y: 0, width: 50, height: 50 }
    const result = await applyCropToImage(img, crop, 'image/jpeg')
    expect(result).toBeInstanceOf(Blob)
  })
})

// ---------------------------------------------------------------------------
// rotateCropImage — 90° clockwise rotation swaps dimensions
// ---------------------------------------------------------------------------

describe('rotateCropImage', () => {
  it('swaps canvas dimensions (landscape → portrait)', async () => {
    const img = { naturalWidth: 800, naturalHeight: 600 }
    await rotateCropImage(img, 'image/jpeg')

    expect(canvasMock.width).toBe(600)
    expect(canvasMock.height).toBe(800)
  })

  it('translates to canvas centre and rotates 90° before drawing', async () => {
    const img = { naturalWidth: 400, naturalHeight: 300 }
    await rotateCropImage(img, 'image/jpeg')

    // After swap: canvas is 300×400. Centre is (150, 200).
    expect(canvasMock._ctx.translate).toHaveBeenCalledWith(150, 200)
    expect(canvasMock._ctx.rotate).toHaveBeenCalledWith(Math.PI / 2)
  })

  it('returns a Blob', async () => {
    const result = await rotateCropImage({ naturalWidth: 100, naturalHeight: 100 }, 'image/jpeg')
    expect(result).toBeInstanceOf(Blob)
  })
})

// ---------------------------------------------------------------------------
// rotateImage — generalized rotation used by the standalone image rotate
// mode (90/180/270), and by rotateCropImage (always 90) below it.
// ---------------------------------------------------------------------------

describe('rotateImage', () => {
  it('swaps canvas dimensions for a 90° rotation (landscape -> portrait)', async () => {
    const img = { naturalWidth: 800, naturalHeight: 600 }
    await rotateImage(img, 'image/jpeg', 90)
    expect(canvasMock.width).toBe(600)
    expect(canvasMock.height).toBe(800)
  })

  it('swaps canvas dimensions for a 270° rotation', async () => {
    const img = { naturalWidth: 800, naturalHeight: 600 }
    await rotateImage(img, 'image/jpeg', 270)
    expect(canvasMock.width).toBe(600)
    expect(canvasMock.height).toBe(800)
  })

  it('preserves canvas dimensions for a 180° rotation', async () => {
    const img = { naturalWidth: 800, naturalHeight: 600 }
    await rotateImage(img, 'image/jpeg', 180)
    expect(canvasMock.width).toBe(800)
    expect(canvasMock.height).toBe(600)
  })

  it('rejects an unsupported angle rather than silently acting as 90°', async () => {
    const img = { naturalWidth: 800, naturalHeight: 600 }
    await expect(rotateImage(img, 'image/jpeg', 45)).rejects.toThrow()
    expect(canvasMock.getContext).not.toHaveBeenCalled()
  })

  it('defaults to a 90° rotation when no degrees argument is given', async () => {
    const img = { naturalWidth: 400, naturalHeight: 300 }
    await rotateImage(img, 'image/jpeg')
    expect(canvasMock.width).toBe(300)
    expect(canvasMock.height).toBe(400)
  })

  it('returns a Blob', async () => {
    const result = await rotateImage({ naturalWidth: 100, naturalHeight: 100 }, 'image/jpeg', 90)
    expect(result).toBeInstanceOf(Blob)
  })
})

describe('rotateCropImage delegates to rotateImage with a fixed 90° default', () => {
  it('still swaps canvas dimensions the same way rotateImage(img, mime, 90) does', async () => {
    const img = { naturalWidth: 640, naturalHeight: 480 }
    await rotateCropImage(img, 'image/png')
    expect(canvasMock.width).toBe(480)
    expect(canvasMock.height).toBe(640)
  })
})

describe('nextAvailableCopyPath', () => {
  it('defaults to the _cropped suffix (existing behavior)', () => {
    expect(nextAvailableCopyPath('/a/img.jpg', [])).toBe('/a/img_cropped.jpg')
  })

  it('accepts a custom suffix base', () => {
    expect(nextAvailableCopyPath('/a/v.mp4', [], '_trimmed')).toBe('/a/v_trimmed.mp4')
  })

  it('increments the custom suffix when a sibling exists', () => {
    expect(nextAvailableCopyPath('/a/v.mp4', ['v_trimmed.mp4'], '_trimmed')).toBe('/a/v_trimmed_2.mp4')
  })

  it('returns the _cropped variant when no copies exist', () => {
    expect(nextAvailableCopyPath('/photos/img.jpg', new Set()))
      .toBe('/photos/img_cropped.jpg')
  })

  it('returns _cropped_2 when _cropped already exists', () => {
    expect(nextAvailableCopyPath('/photos/img.jpg', new Set(['img_cropped.jpg'])))
      .toBe('/photos/img_cropped_2.jpg')
  })

  it('returns _cropped_3 when _cropped and _cropped_2 both exist', () => {
    expect(nextAvailableCopyPath('/photos/img.jpg', new Set(['img_cropped.jpg', 'img_cropped_2.jpg'])))
      .toBe('/photos/img_cropped_3.jpg')
  })

  it('skips gaps — returns the first unused suffix even if higher numbers are missing', () => {
    expect(nextAvailableCopyPath('/photos/img.jpg', new Set(['img_cropped.jpg', 'img_cropped_3.jpg'])))
      .toBe('/photos/img_cropped_2.jpg')
  })

  it('handles paths without an extension', () => {
    expect(nextAvailableCopyPath('/photos/img', new Set(['img_cropped'])))
      .toBe('/photos/img_cropped_2')
  })

  it('accepts an array of names instead of a Set', () => {
    expect(nextAvailableCopyPath('/photos/img.jpg', ['img_cropped.jpg']))
      .toBe('/photos/img_cropped_2.jpg')
  })
})

// ---------------------------------------------------------------------------
// scaleDisplayCropToSource — maps a CSS-pixel crop selection on the rendered
// video element to source pixels for ffmpeg's crop filter. All coordinates in
// the result are even (yuv420 chroma subsampling requires even dimensions, and
// even offsets keep chroma aligned). Returns null when no valid crop can be
// produced — the caller keeps Save disabled rather than sending garbage.
// ---------------------------------------------------------------------------

describe('scaleDisplayCropToSource', () => {
  it('maps a display selection to source pixels at 2x scale', () => {
    expect(scaleDisplayCropToSource({ x: 10, y: 10, width: 100, height: 50 }, 960, 540, 1920, 1080))
      .toEqual({ x: 20, y: 20, width: 200, height: 100 })
  })

  it('returns the full frame for a full-frame selection at 1:1', () => {
    expect(scaleDisplayCropToSource({ x: 0, y: 0, width: 960, height: 540 }, 960, 540, 960, 540))
      .toEqual({ x: 0, y: 0, width: 960, height: 540 })
  })

  it('floors odd results to even values', () => {
    expect(scaleDisplayCropToSource({ x: 11, y: 7, width: 101, height: 51 }, 960, 540, 960, 540))
      .toEqual({ x: 10, y: 6, width: 100, height: 50 })
  })

  it('clamps a selection that spills past the source edge', () => {
    expect(scaleDisplayCropToSource({ x: 900, y: 500, width: 100, height: 80 }, 960, 540, 960, 540))
      .toEqual({ x: 900, y: 500, width: 60, height: 40 })
  })

  it('rounds an odd-dimensioned source frame down to even output', () => {
    expect(scaleDisplayCropToSource({ x: 0, y: 0, width: 1279, height: 719 }, 1279, 719, 1279, 719))
      .toEqual({ x: 0, y: 0, width: 1278, height: 718 })
  })

  it('returns null when the display size is unknown', () => {
    expect(scaleDisplayCropToSource({ x: 0, y: 0, width: 100, height: 100 }, 0, 0, 1920, 1080)).toBeNull()
  })

  it('returns null when there is no selection', () => {
    expect(scaleDisplayCropToSource(null, 960, 540, 1920, 1080)).toBeNull()
  })

  it('returns null when the selection is too small to encode', () => {
    expect(scaleDisplayCropToSource({ x: 0, y: 0, width: 1, height: 300 }, 960, 540, 960, 540)).toBeNull()
  })
})
