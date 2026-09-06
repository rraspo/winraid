// Renders the React renderer in headless Chromium (via the standalone Vite
// server + preview bridge — see vite.config.js and bridge.js) and captures
// one screenshot per named screen from screens.js. Used to review upcoming
// redesign work against a design prototype without running Electron.
//
// Usage: node scripts/preview/shoot.mjs   (or: npm run preview:shoot)
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCREEN_NAMES } from './screens.js'
import { encodeSolidColorPng, colorForName } from './pngFixture.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const PORT = 5180
const BASE_URL = `http://127.0.0.1:${PORT}`
const SCREENSHOTS_DIR = path.join(repoRoot, 'screenshots')

function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    async function attempt() {
      try {
        await fetch(url)
        resolve()
        return
      } catch {
        // Server not accepting connections yet.
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Preview server did not start within ${timeoutMs}ms`))
        return
      }
      setTimeout(attempt, 200)
    }
    attempt()
  })
}

// The browser refuses the custom nas-stream: scheme before any application
// code runs, so window.winraid cannot serve these bytes itself (see
// bridge.js's file header). Fulfilling the request here, at the network
// layer, is the only place in a plain browser that can hand back pixels.
async function fulfillNasStream(route) {
  const request = route.request()
  const url = new URL(request.url())
  const name = url.pathname.split('/').pop() || 'fixture'
  const png = encodeSolidColorPng(320, 200, colorForName(name))
  await route.fulfill({ status: 200, contentType: 'image/png', body: png })
}

async function shootScreen(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    await page.route('nas-stream://**', fulfillNasStream)
    await page.goto(`${BASE_URL}/?screen=${encodeURIComponent(name)}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('html[data-preview-ready]', { timeout: 10000 })
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`) })
    console.log(`[preview] ${name} -> screenshots/${name}.png`)
    return { name, ok: true }
  } catch (err) {
    console.error(`[preview] ${name} failed: ${err.message}`)
    return { name, ok: false, error: err.message }
  } finally {
    await context.close()
  }
}

async function main() {
  await mkdir(SCREENSHOTS_DIR, { recursive: true })

  const viteBin = path.join(repoRoot, 'node_modules', '.bin', 'vite')
  // Run vite in its own process group (detached) so cleanup can kill the
  // whole tree — vite spawns further children (esbuild's service process)
  // that a plain kill() of the top process leaves running, which would
  // otherwise keep this script alive past its own completion.
  const viteProcess = spawn(viteBin, ['--config', 'scripts/preview/vite.config.js'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  viteProcess.stdout.on('data', (chunk) => process.stdout.write(chunk))
  viteProcess.stderr.on('data', (chunk) => process.stderr.write(chunk))

  function stopServer() {
    try {
      process.kill(-viteProcess.pid, 'SIGTERM')
    } catch {
      // Already exited.
    }
  }

  let browser = null
  const results = []
  try {
    await waitForServer(BASE_URL)
    browser = await chromium.launch()
    for (const name of SCREEN_NAMES) {
      // Screens are shot sequentially — one dev server and one browser are
      // shared across the run, so there is nothing to parallelize safely.
      results.push(await shootScreen(browser, name))
    }
  } finally {
    if (browser) await browser.close()
    stopServer()
  }

  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    console.error(`[preview] ${failed.length} screen(s) failed: ${failed.map((f) => f.name).join(', ')}`)
    process.exit(1)
  }
  console.log(`[preview] all ${results.length} screens captured successfully`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
