import { describe, it, expect, vi } from 'vitest'
import { ffmpegCropArgs, runCrop, FALLBACK_ENCODER } from './video-crop.js'

const H264_STDERR = 'Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080'
const HEVC_STDERR = 'Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv), 3840x2160'
const VP9_STDERR  = 'Stream #0:0(und): Video: vp9 (Profile 0), yuv420p(tv), 1280x720'

const rect = { x: 100, y: 50, width: 1280, height: 720 }

describe('ffmpegCropArgs', () => {
  const encoder = { encoder: 'libx264', options: ['-crf', '18', '-preset', 'veryfast', '-bf', '0'] }

  it('builds a full re-encode with the crop filter, copying non-video streams', () => {
    expect(ffmpegCropArgs({ input: '/v/in.mp4', output: '/v/out.mp4', rect, encoder, pixFmt: 'yuv420p' })).toEqual([
      '-nostdin', '-y',
      '-i', '/v/in.mp4',
      '-vf', 'crop=1280:720:100:50',
      '-c', 'copy', '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-bf', '0',
      '-pix_fmt', 'yuv420p',
      '-map', '0',
      '/v/out.mp4',
    ])
  })

  it('omits -pix_fmt when the source pixel format is unknown', () => {
    const args = ffmpegCropArgs({ input: '/v/in.mp4', output: '/v/out.mp4', rect, encoder, pixFmt: null })
    expect(args).not.toContain('-pix_fmt')
  })

  it('leaves autorotation on so a rotated phone clip is cropped in display orientation', () => {
    const args = ffmpegCropArgs({ input: '/v/in.mp4', output: '/v/out.mp4', rect, encoder, pixFmt: 'yuv420p' })
    expect(args).not.toContain('-noautorotate')
  })
})

describe('FALLBACK_ENCODER', () => {
  it('is h264 — the safe target when the source codec has no matching encoder', () => {
    expect(FALLBACK_ENCODER.encoder).toBe('libx264')
  })
})

// exec mock: first call is the stream probe (answers on stderr), second is the
// crop encode. Mirrors the injected-effects contract runTrim uses.
function makeExec(probeStderr, encodeResult = { code: 0, stderr: '' }) {
  const calls = []
  const exec = vi.fn(async (args) => {
    calls.push(args)
    if (calls.length === 1) return { code: 1, stdout: '', stderr: probeStderr }
    return { stdout: '', ...encodeResult }
  })
  return { exec, calls }
}

describe('runCrop', () => {
  it('probes the source and re-encodes with the matching encoder and pixel format', async () => {
    const { exec, calls } = makeExec(H264_STDERR)
    const res = await runCrop({ input: '/v/in.mp4', output: '/v/.tmp.mp4', rect, exec })
    expect(res.ok).toBe(true)
    expect(exec).toHaveBeenCalledTimes(2)
    // Probe is a bare -i on the input
    expect(calls[0]).toContain('-i')
    expect(calls[0]).toContain('/v/in.mp4')
    // Encode reproduces the source codec and pixel format
    const encode = calls[1]
    expect(encode).toContain('-c:v')
    expect(encode[encode.indexOf('-c:v') + 1]).toBe('libx264')
    expect(encode[encode.indexOf('-pix_fmt') + 1]).toBe('yuv420p')
    expect(encode[encode.indexOf('-vf') + 1]).toBe('crop=1280:720:100:50')
  })

  it('keeps a 10-bit HEVC source in its own codec and bit depth', async () => {
    const { exec, calls } = makeExec(HEVC_STDERR)
    const res = await runCrop({ input: '/v/in.mp4', output: '/v/.tmp.mp4', rect, exec })
    expect(res.ok).toBe(true)
    const encode = calls[1]
    expect(encode[encode.indexOf('-c:v') + 1]).toBe('libx265')
    expect(encode[encode.indexOf('-pix_fmt') + 1]).toBe('yuv420p10le')
  })

  it('falls back to h264 with a safe pixel format when the codec has no encoder', async () => {
    const { exec, calls } = makeExec(VP9_STDERR)
    const res = await runCrop({ input: '/v/in.mp4', output: '/v/.tmp.mp4', rect, exec })
    expect(res.ok).toBe(true)
    const encode = calls[1]
    expect(encode[encode.indexOf('-c:v') + 1]).toBe('libx264')
    expect(encode[encode.indexOf('-pix_fmt') + 1]).toBe('yuv420p')
  })

  it('still crops with the fallback encoder when the probe itself fails', async () => {
    const log = vi.fn()
    const exec = vi.fn()
      .mockRejectedValueOnce(new Error('ssh channel closed'))
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
    const res = await runCrop({ input: '/v/in.mp4', output: '/v/.tmp.mp4', rect, exec, log })
    expect(res.ok).toBe(true)
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('ssh channel closed'))
    const encode = exec.mock.calls[1][0]
    expect(encode[encode.indexOf('-c:v') + 1]).toBe('libx264')
  })

  it('reports the tail of stderr when the encode fails', async () => {
    const { exec } = makeExec(H264_STDERR, { code: 1, stderr: 'lots of progress\nConversion failed!' })
    const res = await runCrop({ input: '/v/in.mp4', output: '/v/.tmp.mp4', rect, exec })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Conversion failed!')
  })
})
