// Checks that every visible control on every preview screen can actually be
// clicked across its whole face, at the window widths the app supports.
//
// Two different things make part of a control dead, and neither shows up in
// a unit test because jsdom has no layout:
//
//   - Something else is on top of it. The browser toolbar's breadcrumbs once
//     painted over the connection picker, so a folder click switched
//     connections instead.
//   - It sits inside the title bar's drag region. On Windows, Electron hands
//     `-webkit-app-region: drag` areas to the OS as window caption, so a click
//     there moves the window and never reaches the page, whatever is stacked
//     above it. A full-window overlay whose header overlaps the title bar
//     loses the top of every button in that header.
//
// For each control, a 3x3 grid of points across its visible area is tested:
// a point inside a drag region that no `no-drag` area carves out, or a point
// where elementFromPoint lands on some other element, is a dead spot.
//
// Usage: node scripts/preview/hit-audit.mjs   (or: npm run preview:hits)
// Exits 1 when any control has a dead spot, listing each one.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCREEN_NAMES } from './screens.js'
import { encodeSolidColorPng, colorForName } from './pngFixture.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const PORT = 5180
const BASE_URL = `http://127.0.0.1:${PORT}`

// 860 is the app's minimum window width.
const WIDTHS = [860, 1024, 1280, 1920]
const HEIGHT = 800

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

async function fulfillNasStream(route) {
  const url = new URL(route.request().url())
  const name = url.pathname.split('/').pop() || 'fixture'
  const png = encodeSolidColorPng(320, 200, colorForName(name))
  await route.fulfill({ status: 200, contentType: 'image/png', body: png })
}

// Runs inside the page. Returns one record per control with a dead spot.
function findDeadSpots() {
  const CONTROLS = [
    'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea',
    '[role="button"]', '[role="tab"]', '[role="radio"]', '[role="checkbox"]',
    '[role="switch"]', '[role="menuitem"]', '[role="option"]',
  ].join(',')

  const regionOf = (element) => {
    const style = getComputedStyle(element)
    return style.getPropertyValue('app-region') || style.getPropertyValue('-webkit-app-region')
  }
  const dragRects = []
  const noDragRects = []
  for (const element of document.querySelectorAll('*')) {
    const region = regionOf(element)
    if (region === 'drag') dragRects.push(element.getBoundingClientRect())
    else if (region === 'no-drag') noDragRects.push(element.getBoundingClientRect())
  }
  const inside = (rect, x, y) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
  const isCaption = (x, y) =>
    dragRects.some((rect) => inside(rect, x, y)) && !noDragRects.some((rect) => inside(rect, x, y))

  // The part of a control that is actually on screen: its box clipped by
  // every scrolling or overflow-hidden ancestor and by the viewport, so a
  // crumb scrolled out of its trail is not reported as covered.
  const visibleRect = (element) => {
    const box = element.getBoundingClientRect()
    let left = Math.max(box.left, 0)
    let top = Math.max(box.top, 0)
    let right = Math.min(box.right, window.innerWidth)
    let bottom = Math.min(box.bottom, window.innerHeight)
    let escaped = getComputedStyle(element).position === 'fixed'
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      // A fixed-position layer is not clipped by the overflow of anything
      // above it, so neither are the controls inside it.
      if (escaped) break
      if (style.position === 'fixed') escaped = true
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const clip = ancestor.getBoundingClientRect()
        left = Math.max(left, clip.left)
        top = Math.max(top, clip.top)
        right = Math.min(right, clip.right)
        bottom = Math.min(bottom, clip.bottom)
      }
    }
    return right - left >= 2 && bottom - top >= 2 ? { left, top, right, bottom } : null
  }

  const describe = (element) => {
    const label = element.getAttribute('aria-label') || element.getAttribute('placeholder') ||
      element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)
    const className = typeof element.className === 'string' ? element.className.split(' ')[0] : ''
    return `<${element.tagName.toLowerCase()}${className ? ` .${className}` : ''}>${label ? ` "${label}"` : ''}`
  }

  const reachesControl = (hit, control) => {
    if (!hit) return false
    if (hit === control || control.contains(hit)) return true
    // A click on a control's own <label> activates it.
    const label = hit.closest('label')
    return Boolean(label && (label.control === control || label.contains(control)))
  }

  // When a full-window layer (a viewer or a dialog backdrop) is open, what it
  // covers is meant to be covered, so only controls inside the topmost such
  // layer are judged. The title bar's own controls are always judged: a
  // layer drawn over minimize and close is itself a defect.
  const coversWindow = (element) => {
    if (getComputedStyle(element).position !== 'fixed') return false
    const box = element.getBoundingClientRect()
    return box.width >= window.innerWidth * 0.9 && box.height >= window.innerHeight * 0.9
  }
  let topLayer = null
  for (let element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2); element; element = element.parentElement) {
    if (coversWindow(element)) topLayer = element
  }
  const inTitleBar = (control) => {
    for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (regionOf(ancestor) === 'drag') return true
    }
    return false
  }

  const results = []
  for (const control of document.querySelectorAll(CONTROLS)) {
    if (control.disabled || control.closest('[aria-hidden="true"], [inert]')) continue
    if (topLayer && !topLayer.contains(control) && !inTitleBar(control)) continue
    const style = getComputedStyle(control)
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue
    const rect = visibleRect(control)
    if (!rect) continue

    let caption = 0
    const coveredBy = new Map()
    const fractions = [0.15, 0.5, 0.85]
    for (const fy of fractions) {
      for (const fx of fractions) {
        const x = rect.left + (rect.right - rect.left) * fx
        const y = rect.top + (rect.bottom - rect.top) * fy
        if (isCaption(x, y)) caption++
        const hit = document.elementFromPoint(x, y)
        if (!reachesControl(hit, control)) {
          const key = hit ? describe(hit) : '(nothing)'
          coveredBy.set(key, (coveredBy.get(key) ?? 0) + 1)
        }
      }
    }
    if (caption || coveredBy.size) {
      results.push({
        control: describe(control),
        caption,
        coveredBy: [...coveredBy.entries()].map(([by, count]) => `${by} ${count}/9`),
      })
    }
  }
  return results
}

async function auditScreen(browser, name, width) {
  const context = await browser.newContext({ viewport: { width, height: HEIGHT } })
  const page = await context.newPage()
  try {
    await page.route('nas-stream://**', fulfillNasStream)
    await page.goto(`${BASE_URL}/?screen=${encodeURIComponent(name)}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('html[data-preview-ready], html[data-preview-error]', { timeout: 10000 })
    const driveError = await page.getAttribute('html', 'data-preview-error')
    if (driveError) return { name, width, error: `drive step failed: ${driveError}` }
    // Let entrance transitions settle so a control is not judged mid-animation.
    await page.waitForTimeout(400)
    return { name, width, deadSpots: await page.evaluate(findDeadSpots) }
  } catch (err) {
    return { name, width, error: err.message }
  } finally {
    await context.close()
  }
}

async function main() {
  const viteBin = path.join(repoRoot, 'node_modules', '.bin', 'vite')
  const viteProcess = spawn(viteBin, ['--config', 'scripts/preview/vite.config.js'], {
    cwd: repoRoot,
    stdio: 'ignore',
    detached: true,
  })
  const stopServer = () => {
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
      for (const width of WIDTHS) results.push(await auditScreen(browser, name, width))
    }
  } finally {
    if (browser) await browser.close()
    stopServer()
  }

  let failures = 0
  for (const result of results) {
    if (result.error) {
      failures++
      console.error(`[hits] ${result.name} @${result.width}: ${result.error}`)
      continue
    }
    for (const spot of result.deadSpots) {
      failures++
      const reasons = [
        spot.caption ? `in the title bar drag region ${spot.caption}/9` : null,
        ...spot.coveredBy.map((cover) => `covered by ${cover}`),
      ].filter(Boolean).join('; ')
      console.error(`[hits] ${result.name} @${result.width}: ${spot.control} — ${reasons}`)
    }
  }
  if (failures) {
    console.error(`[hits] ${failures} dead spot(s) across ${results.length} screen/width runs`)
    process.exit(1)
  }
  console.log(`[hits] every control fully clickable across ${results.length} screen/width runs`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
