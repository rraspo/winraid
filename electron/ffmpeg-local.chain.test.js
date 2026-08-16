// Fallthrough behavior of the pinned ffmpeg download chain. The chain exists
// so one dead upstream can't break the fallback, which means the interesting
// cases are all failure cases: a candidate that 404s, one that downloads but
// won't extract, one that extracts a binary that won't run, and the user
// cancelling partway through.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Extraction shells out to PowerShell and validation runs the binary with
// -version; both go through spawn, so the mock stands in for both and lets a
// test choose which step fails.
const spawnMock = vi.fn()
vi.mock('child_process', () => {
  const spawn = (...args) => spawnMock(...args)
  return { spawn, default: { spawn } }
})

const { downloadFfmpeg } = await import('./ffmpeg-local.js')
const { FFMPEG_WIN64_CANDIDATES } = await import('./video-trim.js')

let dataDir

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'wr-ffmpeg-chain-'))
  spawnMock.mockReset()
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

// An electron-net-style request stub that replays one canned response.
function respondingRequest({ statusCode = 200, bytes = 1000, chunks = 2 } = {}) {
  const req = new EventEmitter()
  req.end = vi.fn(() => {
    queueMicrotask(() => {
      const res = new EventEmitter()
      res.statusCode = statusCode
      res.headers = { 'content-length': String(bytes) }
      req.emit('response', res)
      if (statusCode === 200) {
        for (let i = 0; i < chunks; i++) res.emit('data', Buffer.alloc(bytes / chunks))
        res.emit('end')
      }
    })
  })
  req.abort = vi.fn()
  return req
}

// Drives spawn: PowerShell "extraction" lays down the nested layout the real
// archive has, and the -version probe reports a running binary. `fail` picks a
// step to break instead.
function stubSpawn({ fail = null, extractRoot = 'ffmpeg-build' } = {}) {
  spawnMock.mockImplementation((cmd, args) => {
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    const isExtract = String(cmd).includes('powershell')

    queueMicrotask(() => {
      if (isExtract) {
        if (fail === 'extract') return proc.emit('close', 1)
        const dest = /-DestinationPath "([^"]+)"/.exec(String(args?.[2] ?? ''))?.[1]
        if (dest) {
          const binDir = join(dest, extractRoot, 'bin')
          mkdirSync(binDir, { recursive: true })
          writeFileSync(join(binDir, 'ffmpeg.exe'), 'stub')
        }
        return proc.emit('close', 0)
      }
      if (fail === 'validate') return proc.emit('close', 1)
      proc.stdout.emit('data', 'ffmpeg version 8.1.2-static Copyright (c) ...')
      proc.emit('close', 0)
    })
    return proc
  })
}

describe('downloadFfmpeg candidate chain', () => {
  it('falls through to the next candidate when one 404s', async () => {
    stubSpawn()
    const tried = []
    const request = vi.fn((url) => {
      tried.push(url)
      return respondingRequest({ statusCode: tried.length === 1 ? 404 : 200 })
    })

    const result = await downloadFfmpeg({ dataDir, request, onProgress: vi.fn() })

    expect(result.ok).toBe(true)
    expect(tried).toEqual([FFMPEG_WIN64_CANDIDATES[0], FFMPEG_WIN64_CANDIDATES[1]])
  })

  it('falls through when a candidate downloads but will not extract', async () => {
    let call = 0
    spawnMock.mockImplementation((cmd, args) => {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      const isExtract = String(cmd).includes('powershell')
      queueMicrotask(() => {
        if (isExtract) {
          call++
          if (call === 1) return proc.emit('close', 1)  // first candidate's archive is broken
          const dest = /-DestinationPath "([^"]+)"/.exec(String(args?.[2] ?? ''))?.[1]
          if (dest) {
            const binDir = join(dest, 'ffmpeg-build', 'bin')
            mkdirSync(binDir, { recursive: true })
            writeFileSync(join(binDir, 'ffmpeg.exe'), 'stub')
          }
          return proc.emit('close', 0)
        }
        proc.stdout.emit('data', 'ffmpeg version 8.1.2-static Copyright (c) ...')
        proc.emit('close', 0)
      })
      return proc
    })

    const tried = []
    const request = vi.fn((url) => { tried.push(url); return respondingRequest() })

    const result = await downloadFfmpeg({ dataDir, request, onProgress: vi.fn() })

    expect(result.ok).toBe(true)
    expect(tried).toEqual([FFMPEG_WIN64_CANDIDATES[0], FFMPEG_WIN64_CANDIDATES[1]])
  })

  it('reports an error instead of throwing when every candidate fails', async () => {
    stubSpawn({ fail: 'extract' })
    const tried = []
    const request = vi.fn((url) => { tried.push(url); return respondingRequest() })

    const result = await downloadFfmpeg({ dataDir, request, onProgress: vi.fn() })

    expect(result.ok).toBe(false)
    expect(result.canceled).toBeFalsy()
    expect(result.error).toBeTruthy()
    expect(tried).toEqual([...FFMPEG_WIN64_CANDIDATES])
  })

  it('stops the whole chain on cancel rather than trying the next candidate', async () => {
    stubSpawn()
    const controller = new AbortController()
    const requests = []
    const request = vi.fn(() => {
      const req = new EventEmitter()
      req.end = vi.fn(() => {
        queueMicrotask(() => {
          const res = new EventEmitter()
          res.statusCode = 200
          res.headers = { 'content-length': '1000' }
          req.emit('response', res)
          res.emit('data', Buffer.alloc(100))
          controller.abort()
        })
      })
      req.abort = vi.fn()
      requests.push(req)
      return req
    })

    const result = await downloadFfmpeg({ dataDir, request, onProgress: vi.fn(), signal: controller.signal })

    expect(result).toEqual({ ok: false, canceled: true })
    expect(request).toHaveBeenCalledTimes(1)
    expect(requests[0].abort).toHaveBeenCalled()
    expect(existsSync(join(dataDir, 'ffmpeg', 'download.zip'))).toBe(false)
  })

  it('reports progress for the candidate that succeeds, without leaking the failed one', async () => {
    stubSpawn()
    const seen = []
    const tried = []
    const request = vi.fn((url) => {
      tried.push(url)
      return respondingRequest({ statusCode: tried.length === 1 ? 404 : 200, bytes: 1000, chunks: 4 })
    })

    const result = await downloadFfmpeg({ dataDir, request, onProgress: (p) => seen.push(p) })

    expect(result.ok).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    // Fractions climb monotonically and finish at 1 — a chain that carried the
    // failed candidate's byte count over would overshoot or start mid-way.
    expect(seen[seen.length - 1]).toBeCloseTo(1)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1])
    expect(seen[0]).toBeCloseTo(0.25)
  })
})
