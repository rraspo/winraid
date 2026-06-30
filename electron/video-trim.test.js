import { describe, it, expect } from 'vitest'
import { ffmpegTrimCommand, probeFfmpegCommand, parseFfmpegProbe } from './video-trim.js'

describe('ffmpegTrimCommand', () => {
  const cmd = ffmpegTrimCommand({
    input: '/mnt/user/v/a b.mp4',
    output: '/mnt/user/v/a b_trimmed.mp4',
    start: 1.5,
    duration: 8.5,
  })

  it('seeks with -ss before -i and uses -t for duration', () => {
    expect(cmd).toContain('-ss 1.500')
    expect(cmd).toContain("-i '/mnt/user/v/a b.mp4'")
    expect(cmd).toContain('-t 8.500')
  })

  it('stream-copies all streams without re-encoding', () => {
    expect(cmd).toContain('-c copy')
    expect(cmd).toContain('-map 0')
    expect(cmd).toContain('-nostdin')
  })

  it('quotes the output path', () => {
    expect(cmd).toContain("'/mnt/user/v/a b_trimmed.mp4'")
  })

  it('rejects a path with control characters', () => {
    expect(() => ffmpegTrimCommand({ input: '/v/a\nb.mp4', output: '/v/o.mp4', start: 0, duration: 1 })).toThrow()
  })
})

describe('parseFfmpegProbe', () => {
  it('detects an installed ffmpeg and its version', () => {
    expect(parseFfmpegProbe('ffmpeg version 4.4.1-0ubuntu1 Copyright (c) ...')).toEqual({ available: true, version: '4.4.1-0ubuntu1' })
  })

  it('reports unavailable when ffmpeg is missing', () => {
    expect(parseFfmpegProbe('bash: ffmpeg: command not found')).toEqual({ available: false })
  })

  it('probe command asks ffmpeg for its version', () => {
    expect(probeFfmpegCommand()).toBe('ffmpeg -version')
  })
})
