import { describe, it, expect } from 'vitest'
import {
  supportsDisplayRotation,
  parseRotation,
  combineRotation,
  probeRotationCommand,
  ffmpegRotateCommand,
  ffmpegRotateArgs,
} from './video-rotate.js'

describe('supportsDisplayRotation', () => {
  it('is false for ffmpeg older than 5.1 (no -display_rotation flag)', () => {
    expect(supportsDisplayRotation('4.4.1-0ubuntu1')).toBe(false)
    expect(supportsDisplayRotation('5.0.2')).toBe(false)
  })

  it('is true from 5.1 on', () => {
    expect(supportsDisplayRotation('5.1.3')).toBe(true)
    expect(supportsDisplayRotation('n6.0')).toBe(true)
    expect(supportsDisplayRotation('7.1-essentials_build-www.gyan.dev')).toBe(true)
  })

  it('assumes modern for git builds and missing versions', () => {
    expect(supportsDisplayRotation('N-113007-gc2184b65d2')).toBe(true)
    expect(supportsDisplayRotation(undefined)).toBe(true)
  })
})

describe('parseRotation', () => {
  it('reads a display-matrix rotation (CCW-positive) as clockwise degrees', () => {
    const out = [
      '  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 1920x1080, 30 fps',
      '    Side data:',
      '      displaymatrix: rotation of -90.00 degrees',
    ].join('\n')
    expect(parseRotation(out)).toBe(90)
  })

  it('maps a positive display-matrix angle to its clockwise equivalent', () => {
    expect(parseRotation('displaymatrix: rotation of 90.00 degrees')).toBe(270)
    expect(parseRotation('displaymatrix: rotation of -180.00 degrees')).toBe(180)
  })

  // ffmpeg 8.1 renamed the side-data label from "displaymatrix:" to
  // "Display Matrix:". Missing it reads as no rotation at all, which silently
  // rotates from the wrong origin instead of failing. Captured verbatim from
  // ffmpeg 8.1.2.
  it('reads the spaced display-matrix label newer ffmpeg prints', () => {
    const out = [
      '  Stream #0:0[0x1](und): Video: h264 (Main) (avc1 / 0x31637661), yuv420p(progressive), 720x1280, 102 kb/s, 30 fps',
      '    Side data:',
      '      Display Matrix: rotation of -90.00 degrees',
    ].join('\n')
    expect(parseRotation(out)).toBe(90)
  })

  it('reads the legacy rotate metadata tag (already clockwise)', () => {
    const out = [
      '    Metadata:',
      '      rotate          : 90',
      '      handler_name    : VideoHandler',
    ].join('\n')
    expect(parseRotation(out)).toBe(90)
  })

  it('defaults to 0 when no rotation is present', () => {
    expect(parseRotation('  Stream #0:0: Video: h264, yuv420p, 1280x720')).toBe(0)
    expect(parseRotation('')).toBe(0)
    expect(parseRotation(null)).toBe(0)
  })
})

describe('combineRotation', () => {
  it('adds a clockwise delta to the current rotation modulo 360', () => {
    expect(combineRotation(0, 90)).toBe(90)
    expect(combineRotation(90, 90)).toBe(180)
    expect(combineRotation(270, 90)).toBe(0)
    expect(combineRotation(180, 270)).toBe(90)
  })
})

describe('probeRotationCommand', () => {
  it('asks ffmpeg to open the file without transcoding, quoted for the shell', () => {
    expect(probeRotationCommand('/v/a b.mp4')).toBe("ffmpeg -nostdin -hide_banner -i '/v/a b.mp4'")
  })

  it('rejects a path with control characters', () => {
    expect(() => probeRotationCommand('/v/a\nb.mp4')).toThrow()
  })
})

describe('ffmpegRotateCommand', () => {
  it('rewrites the display matrix losslessly on modern ffmpeg (CCW flag from CW degrees)', () => {
    const cmd = ffmpegRotateCommand({ input: '/mnt/user/v/a b.mp4', output: '/mnt/user/v/a b_rotated.mp4', degrees: 90, modern: true })
    expect(cmd).toBe("ffmpeg -nostdin -y -display_rotation 270 -i '/mnt/user/v/a b.mp4' -c copy -map 0 '/mnt/user/v/a b_rotated.mp4'")
  })

  it('writes the rotate metadata tag on pre-5.1 ffmpeg', () => {
    const cmd = ffmpegRotateCommand({ input: '/v/in.mp4', output: '/v/out.mp4', degrees: 90, modern: false })
    expect(cmd).toBe("ffmpeg -nostdin -y -i '/v/in.mp4' -c copy -map 0 -metadata:s:v:0 rotate=90 '/v/out.mp4'")
  })

  it('accepts an absolute 0 to clear rotation', () => {
    expect(ffmpegRotateCommand({ input: '/v/i.mp4', output: '/v/o.mp4', degrees: 0, modern: true })).toContain('-display_rotation 0')
  })

  it('rejects degrees outside 0/90/180/270', () => {
    expect(() => ffmpegRotateCommand({ input: '/v/i.mp4', output: '/v/o.mp4', degrees: 45, modern: true })).toThrow()
  })

  it('rejects a path with control characters', () => {
    expect(() => ffmpegRotateCommand({ input: '/v/a\nb.mp4', output: '/v/o.mp4', degrees: 90, modern: true })).toThrow()
  })
})

describe('ffmpegRotateArgs', () => {
  it('mirrors the modern flags as an unquoted array for a local spawn', () => {
    expect(ffmpegRotateArgs({ input: 'C:\\tmp dir\\in.mp4', output: 'C:\\tmp dir\\out.mp4', degrees: 180, modern: true })).toEqual([
      '-nostdin', '-y',
      '-display_rotation', '180',
      '-i', 'C:\\tmp dir\\in.mp4',
      '-c', 'copy', '-map', '0',
      'C:\\tmp dir\\out.mp4',
    ])
  })

  it('mirrors the legacy metadata flags for a local spawn', () => {
    expect(ffmpegRotateArgs({ input: 'in.mp4', output: 'out.mp4', degrees: 270, modern: false })).toEqual([
      '-nostdin', '-y',
      '-i', 'in.mp4',
      '-c', 'copy', '-map', '0',
      '-metadata:s:v:0', 'rotate=270',
      'out.mp4',
    ])
  })
})
