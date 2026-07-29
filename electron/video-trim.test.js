import { describe, it, expect, vi } from 'vitest'
import {
  ffmpegTrimArgs, probeFfmpegCommand, parseFfmpegProbe, FFMPEG_WIN64_URL,
  ffmpegKeyframeProbeArgs, ffmpegStreamProbeArgs, ffmpegReencodeArgs, ffmpegTailSegmentArgs, ffmpegConcatArgs,
  parseKeyframeTimes, parseVideoStreamInfo, encoderForCodec, planTrim,
  shellFromArgs, runTrim,
} from './video-trim.js'

const NO_ROTATION = { degrees: 0, modern: true }

describe('ffmpegTrimArgs', () => {
  it('mirrors the remote flags as an unquoted array for a local spawn', () => {
    const args = ffmpegTrimArgs({
      input: 'C:\\tmp dir\\in.mp4',
      output: 'C:\\tmp dir\\out.mp4',
      start: 1.5,
      duration: 8.5,
    })
    expect(args).toEqual([
      '-nostdin', '-y',
      '-ss', '1.500',
      '-i', 'C:\\tmp dir\\in.mp4',
      '-t', '8.500',
      '-c', 'copy', '-map', '0', '-avoid_negative_ts', 'make_zero',
      'C:\\tmp dir\\out.mp4',
    ])
  })

  it('renders as an SSH exec command with only the paths quoted', () => {
    const cmd = shellFromArgs(ffmpegTrimArgs({
      input: '/mnt/user/v/a b.mp4', output: '/mnt/user/v/a b_trimmed.mp4', start: 1.5, duration: 8.5,
    }))
    expect(cmd).toBe("ffmpeg -nostdin -y -ss 1.500 -i '/mnt/user/v/a b.mp4' -t 8.500 -c copy -map 0 -avoid_negative_ts make_zero '/mnt/user/v/a b_trimmed.mp4'")
  })

  it('publishes a Windows static-build download URL', () => {
    expect(FFMPEG_WIN64_URL).toMatch(/^https:\/\//)
    expect(FFMPEG_WIN64_URL).toMatch(/\.zip$/)
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

describe('shellFromArgs', () => {
  it('leaves plain flags bare and quotes anything else', () => {
    expect(shellFromArgs(['-ss', '1.500', '-i', '/v/a b.mp4'])).toBe("ffmpeg -ss 1.500 -i '/v/a b.mp4'")
  })

  it('quotes the concat protocol input, which is not a plain token', () => {
    expect(shellFromArgs(['-i', 'concat:/v/a.ts|/v/b.ts'])).toBe("ffmpeg -i 'concat:/v/a.ts|/v/b.ts'")
  })

  it('rejects control characters in an argument', () => {
    expect(() => shellFromArgs(['-i', '/v/a\nb.mp4'])).toThrow()
  })
})

describe('keyframe probe', () => {
  // Real `ffmpeg -skip_frame nokey ... -vf showinfo` stderr, trimmed.
  const showinfo = [
    'frame=    2 fps=0.0 q=-0.0 size=N/A time=00:00:15.00 bitrate=N/A speed= 566x',
    '[Parsed_showinfo_0 @ 0x765ee4003380] n:   0 pts: 153600 pts_time:10      duration:    512 duration_time:0.0333333 fmt:yuv420p sar:1/1 s:640x360 i:P iskey:1 type:I checksum:36504054',
    '[Parsed_showinfo_0 @ 0x765ee4003380] n:   1 pts: 230400 pts_time:15.5    duration:    512 duration_time:0.0333333 fmt:yuv420p sar:1/1 s:640x360 i:P iskey:1 type:I checksum:F056B061',
  ].join('\n')

  it('reads absolute keyframe times out of showinfo output', () => {
    expect(parseKeyframeTimes(showinfo)).toEqual([10, 15.5])
  })

  it('ignores non-showinfo noise and empty output', () => {
    expect(parseKeyframeTimes('ffmpeg version 7.1\n  Duration: 00:00:20.02, start: 0.000000\n')).toEqual([])
    expect(parseKeyframeTimes(undefined)).toEqual([])
  })

  it('asks only for keyframes in an absolute window after the cut point', () => {
    expect(ffmpegKeyframeProbeArgs({ input: '/v/in.mp4', start: 7.1, window: 12 })).toEqual([
      '-nostdin', '-hide_banner',
      '-skip_frame', 'nokey',
      '-ss', '7.100', '-i', '/v/in.mp4',
      '-copyts', '-to', '19.100',
      '-an', '-sn', '-vf', 'showinfo', '-f', 'null', '-',
    ])
  })
})

describe('parseVideoStreamInfo', () => {
  it('reads codec and pixel format from the first video stream', () => {
    const out = '  Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661), yuv420p(progressive), 640x360 [SAR 1:1 DAR 16:9], 800 kb/s, 30 fps'
    expect(parseVideoStreamInfo(out)).toEqual({ codec: 'h264', pixFmt: 'yuv420p' })
  })

  it('handles a profile in the codec name and a 10-bit pixel format', () => {
    const out = '  Stream #0:1: Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160'
    expect(parseVideoStreamInfo(out)).toEqual({ codec: 'hevc', pixFmt: 'yuv420p10le' })
  })

  it('returns nothing recognizable when there is no video stream', () => {
    expect(parseVideoStreamInfo('  Stream #0:0: Audio: aac (LC), 48000 Hz, stereo')).toEqual({ codec: null, pixFmt: null })
  })

  it('keeps the banner, which carries the version rotation handling depends on', () => {
    expect(ffmpegStreamProbeArgs({ input: '/v/in.mp4' })).toEqual(['-nostdin', '-i', '/v/in.mp4'])
  })
})

describe('encoderForCodec', () => {
  it('maps a source codec to the encoder that reproduces it', () => {
    expect(encoderForCodec('h264').encoder).toBe('libx264')
    expect(encoderForCodec('hevc').encoder).toBe('libx265')
  })

  it('has no mapping for an unknown codec', () => {
    expect(encoderForCodec('prores')).toBeNull()
    expect(encoderForCodec(null)).toBeNull()
  })
})

describe('planTrim', () => {
  const encoder = encoderForCodec('h264')

  it('stream-copies when the cut already lands on a keyframe', () => {
    expect(planTrim({ start: 10, end: 20, keyframes: [10, 15], encoder })).toEqual({ mode: 'copy' })
  })

  it('tolerates sub-frame float drift on the keyframe match', () => {
    expect(planTrim({ start: 10.004, end: 20, keyframes: [10, 15], encoder })).toEqual({ mode: 'copy' })
  })

  it('splits at the first keyframe after the cut point', () => {
    expect(planTrim({ start: 7.1, end: 12.1, keyframes: [10, 15], encoder })).toEqual({ mode: 'smart', splitAt: 10 })
  })

  it('re-encodes the whole selection when no keyframe falls inside it', () => {
    expect(planTrim({ start: 7.1, end: 9, keyframes: [10, 15], encoder })).toEqual({ mode: 'reencode' })
    expect(planTrim({ start: 7.1, end: 12.1, keyframes: [], encoder })).toEqual({ mode: 'reencode' })
  })

  it('stays with a plain stream copy when no encoder can reproduce the codec', () => {
    expect(planTrim({ start: 7.1, end: 12.1, keyframes: [10], encoder: null })).toEqual({ mode: 'copy' })
  })
})

describe('ffmpegReencodeArgs', () => {
  const args = ffmpegReencodeArgs({
    input: '/v/in.mp4', output: '/v/out.mp4', start: 7.1, end: 10,
    encoder: encoderForCodec('h264'), pixFmt: 'yuv420p', rotation: NO_ROTATION,
  })

  it('seeks fast on the input and cuts exactly on the output side', () => {
    // -ss before -i lands on the preceding keyframe (fast); -copyts keeps the
    // source timeline so the output-side -ss/-to are exact source timestamps.
    expect(args.join(' ')).toContain('-ss 7.100 -copyts -i /v/in.mp4 -ss 7.100 -to 10.000')
  })

  it('re-encodes video only, keeping every other stream as-is', () => {
    expect(args.join(' ')).toContain('-c copy -c:v libx264')
    expect(args.join(' ')).toContain('-pix_fmt yuv420p')
    expect(args.join(' ')).toContain('-map 0')
  })

  it('disables B-frames so the segment starts at timestamp zero', () => {
    expect(args.join(' ')).toContain('-bf 0')
  })

  it('never lets ffmpeg bake a display matrix into the pixels', () => {
    // Autorotate would transpose the re-encoded part only, leaving it at odds
    // with the stream-copied part.
    expect(args).toContain('-noautorotate')
  })

  it('omits -pix_fmt when the source format is unknown', () => {
    const noPix = ffmpegReencodeArgs({ input: '/v/in.mp4', output: '/v/h.mp4', start: 0, end: 1, encoder: encoderForCodec('h264'), pixFmt: null, rotation: NO_ROTATION })
    expect(noPix).not.toContain('-pix_fmt')
  })

  it('writes the source rotation back when it produces the final file', () => {
    const rotated = ffmpegReencodeArgs({
      input: '/v/in.mp4', output: '/v/out.mp4', start: 0, end: 1,
      encoder: encoderForCodec('h264'), pixFmt: 'yuv420p', rotation: { degrees: 90, modern: true },
    })
    expect(rotated.join(' ')).toContain('-display_rotation 270')
  })

  it('leaves rotation to the concat step when it produces a segment', () => {
    const segment = ffmpegReencodeArgs({
      input: '/v/in.mp4', output: '/v/head.ts', start: 0, end: 1,
      encoder: encoderForCodec('h264'), pixFmt: 'yuv420p', rotation: { degrees: 90, modern: true }, segment: true,
    })
    expect(segment).not.toContain('-display_rotation')
    expect(segment.join(' ')).toContain('-muxdelay 0 -muxpreload 0 -f mpegts')
  })
})

describe('ffmpegTailSegmentArgs', () => {
  const args = ffmpegTailSegmentArgs({ input: '/v/in.mp4', output: '/v/tail.ts', start: 10, duration: 2.1, offset: 2.9 })

  it('stream-copies from the keyframe, offset to where the head ends', () => {
    expect(args).toEqual([
      '-nostdin', '-y', '-ss', '10.000', '-i', '/v/in.mp4', '-t', '2.100',
      '-c', 'copy', '-map', '0', '-output_ts_offset', '2.900',
      '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', '/v/tail.ts',
    ])
  })

  it('carries no timestamp rebase, which would push the tail past the seam', () => {
    expect(args).not.toContain('-avoid_negative_ts')
  })
})

describe('ffmpegConcatArgs', () => {
  it('joins the segments with the concat protocol — no list file to write', () => {
    expect(ffmpegConcatArgs({ segments: ['/v/head.ts', '/v/tail.ts'], output: '/v/out.mp4', rotation: NO_ROTATION })).toEqual([
      '-nostdin', '-y', '-i', 'concat:/v/head.ts|/v/tail.ts',
      '-c', 'copy', '-map', '0', '-avoid_negative_ts', 'make_zero', '/v/out.mp4',
    ])
  })

  it('restores the rotation the transport streams dropped', () => {
    const modern = ffmpegConcatArgs({ segments: ['/v/a.ts'], output: '/v/o.mp4', rotation: { degrees: 90, modern: true } })
    expect(modern.join(' ')).toContain('-display_rotation 270 -i concat:/v/a.ts')

    const legacy = ffmpegConcatArgs({ segments: ['/v/a.ts'], output: '/v/o.mp4', rotation: { degrees: 90, modern: false } })
    expect(legacy.join(' ')).toContain('-metadata:s:v:0 rotate=90')
  })
})

describe('runTrim', () => {
  const SHOWINFO = '[Parsed_showinfo_0 @ 0x1] n: 0 pts: 153600 pts_time:10 iskey:1 type:I'
  const STREAMS  = 'ffmpeg version 7.1 Copyright (c) 2000-2024\n  Stream #0:0: Video: h264 (avc1 / 0x31637661), yuv420p(progressive), 640x360'

  // Fake ffmpeg: answers the two probes from canned output, succeeds otherwise.
  function makeExec(overrides = {}) {
    const calls = []
    const exec = vi.fn(async (args) => {
      calls.push(args)
      if (args.includes('showinfo')) return { code: 0, stdout: '', stderr: overrides.showinfo ?? SHOWINFO }
      if (args.length === 3) return { code: 1, stdout: '', stderr: overrides.streams ?? STREAMS }
      const fail = overrides.failOn?.(args)
      return fail ? { code: 1, stdout: '', stderr: fail } : { code: 0, stdout: '', stderr: '' }
    })
    return { exec, calls }
  }

  const base = { input: '/v/in.mp4', output: '/v/.tmp-out.mp4', start: 7.1, end: 12.1 }

  it('cuts the head, copies the tail and concatenates them', async () => {
    const { exec, calls } = makeExec()
    const remove = vi.fn(async () => {})

    const res = await runTrim({ ...base, exec, remove })

    expect(res).toEqual({ ok: true, mode: 'smart' })
    const [, , head, tail, concat] = calls
    expect(head).toContain('libx264')
    expect(head).toContain('/v/.tmp-out-head.ts')
    expect(tail.join(' ')).toContain('-ss 10.000')
    expect(tail.join(' ')).toContain('-output_ts_offset 2.900')
    expect(concat).toContain('concat:/v/.tmp-out-head.ts|/v/.tmp-out-tail.ts')
    expect(concat[concat.length - 1]).toBe('/v/.tmp-out.mp4')

    expect(remove.mock.calls.flat()).toEqual(['/v/.tmp-out-head.ts', '/v/.tmp-out-tail.ts'])
  })

  it('keeps the segments beside an extensionless hidden temp file, not beside its directory', async () => {
    const { exec, calls } = makeExec()
    await runTrim({ ...base, output: '/v/.winraid-trim-1234', exec, remove: vi.fn() })
    expect(calls[2]).toContain('/v/.winraid-trim-1234-head.ts')
    expect(calls[3]).toContain('/v/.winraid-trim-1234-tail.ts')
  })

  it('carries the source rotation through to the joined file', async () => {
    const { exec, calls } = makeExec({
      streams: 'ffmpeg version 7.1\n  Stream #0:0: Video: h264 (avc1), yuv420p, 640x360\n      displaymatrix: rotation of -90.00 degrees',
    })
    await runTrim({ ...base, exec, remove: vi.fn() })
    expect(calls[4].join(' ')).toContain('-display_rotation 270')
  })

  it('falls back to the legacy rotate tag on ffmpeg older than 5.1', async () => {
    const { exec, calls } = makeExec({
      streams: 'ffmpeg version 4.4.1\n  Stream #0:0: Video: h264 (avc1), yuv420p, 640x360\n      displaymatrix: rotation of -90.00 degrees',
    })
    await runTrim({ ...base, exec, remove: vi.fn() })
    expect(calls[4].join(' ')).toContain('-metadata:s:v:0 rotate=90')
  })

  it('runs a single stream copy when the cut already sits on a keyframe', async () => {
    const { exec, calls } = makeExec({ showinfo: '[Parsed_showinfo_0 @ 0x1] n: 0 pts_time:7.1 iskey:1' })
    const res = await runTrim({ ...base, exec, remove: vi.fn() })

    expect(res).toEqual({ ok: true, mode: 'copy' })
    expect(calls).toHaveLength(3)
    expect(calls[2].join(' ')).toContain('-c copy -map 0 -avoid_negative_ts make_zero')
  })

  it('re-encodes the whole selection when it holds no keyframe', async () => {
    const { exec, calls } = makeExec({ showinfo: '' })
    const res = await runTrim({ ...base, exec, remove: vi.fn() })

    expect(res).toEqual({ ok: true, mode: 'reencode' })
    expect(calls[2]).toContain('libx264')
    expect(calls[2]).not.toContain('-f')          // straight into the real container, no transport stream
    expect(calls[2][calls[2].length - 1]).toBe('/v/.tmp-out.mp4')
  })

  it('falls back to a stream copy when the source codec has no encoder', async () => {
    const { exec, calls } = makeExec({ streams: '  Stream #0:0: Video: prores (apcn), yuv422p10le, 1920x1080' })
    const res = await runTrim({ ...base, exec, remove: vi.fn() })

    expect(res).toEqual({ ok: true, mode: 'copy' })
    expect(calls[calls.length - 1].join(' ')).toContain('-c copy')
  })

  it('falls back to a stream copy when a probe blows up', async () => {
    const exec = vi.fn(async (args) => {
      if (args.includes('showinfo')) throw new Error('exec timed out')
      if (args.length === 3) return { code: 1, stdout: '', stderr: STREAMS }
      return { code: 0, stdout: '', stderr: '' }
    })
    const log = vi.fn()
    const res = await runTrim({ ...base, exec, remove: vi.fn(), log })

    expect(res).toEqual({ ok: true, mode: 'copy', degraded: true })
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('exec timed out'))
  })

  it('falls back to a stream copy when the head re-encode fails', async () => {
    const { exec } = makeExec({ failOn: (args) => (args.includes('libx264') ? 'Unknown encoder libx264' : null) })
    const remove = vi.fn(async () => {})
    const log = vi.fn()
    const res = await runTrim({ ...base, exec, remove, log })

    expect(res).toEqual({ ok: true, mode: 'copy', degraded: true })
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Unknown encoder'))
    expect(remove.mock.calls.flat()).toContain('/v/.tmp-out-head.ts')
  })

  it('falls back when a stream cannot ride a transport stream', async () => {
    const { exec } = makeExec({ failOn: (args) => (args.includes('mpegts') ? 'Subtitle codec 94213 not supported' : null) })
    const res = await runTrim({ ...base, exec, remove: vi.fn(), log: vi.fn() })

    expect(res).toEqual({ ok: true, mode: 'copy', degraded: true })
  })

  it('reports a failing stream copy rather than pretending it worked', async () => {
    const { exec } = makeExec({
      showinfo: '[Parsed_showinfo_0 @ 0x1] pts_time:7.1 iskey:1',
      failOn: () => 'No space left on device',
    })
    const res = await runTrim({ ...base, exec, remove: vi.fn() })

    expect(res).toEqual({ ok: false, error: 'No space left on device' })
  })
})
