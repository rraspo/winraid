// Checks that every visible text and icon on every preview screen holds
// WCAG contrast against what is actually painted behind it, in both themes.
//
// Token math (src/styles/tokens.contrast.test.js) proves the palette, but not
// what a component does with it: a tint stacked on a tint, a muted color on
// an overlay, a dark-only white glyph. Those only show up once the screen is
// laid out and painted, which jsdom cannot do, so this measures pixels:
//
//   1. Read each text run's and icon's color, folded with every ancestor's
//      opacity.
//   2. Make all text and the measured icons transparent, screenshot, and
//      sample the pixels behind each one: that is its real background,
//      whatever stack of tints, overlays or images produced it.
//   3. Composite the color over each sample and take the contrast.
//
// Text needs 4.5:1 (3:1 when large); icons need 3:1. Disabled controls are
// exempt, and when a full-window layer is open only what is inside it is
// judged, since what it covers is meant to be dimmed.
//
// Usage: node scripts/preview/contrast-audit.mjs [--theme light|dark] [--screen <name>]
//        (or: npm run preview:contrast)
// Exits 1 when anything falls short, listing each one.
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
const VIEWPORT = { width: 1280, height: 800 }

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? null : process.argv[index + 1]
}
const THEMES = argValue('--theme') ? [argValue('--theme')] : ['light', 'dark']
const SCREENS = argValue('--screen') ? [argValue('--screen')] : SCREEN_NAMES

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

// Runs inside the page. Records every text run and icon to judge, tags each
// with data-contrast-id, and returns its color, opacity and boxes.
function collectTargets() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const toRgba = (cssColor) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = 'rgba(0, 0, 0, 0)'
    context.fillStyle = cssColor
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
    return [red, green, blue, alpha / 255]
  }

  const coversWindow = (element) => {
    if (getComputedStyle(element).position !== 'fixed') return false
    const box = element.getBoundingClientRect()
    return box.width >= window.innerWidth * 0.9 && box.height >= window.innerHeight * 0.9
  }
  let topLayer = null
  for (let element = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2); element; element = element.parentElement) {
    if (coversWindow(element)) topLayer = element
  }

  const opacityOf = (element) => {
    let opacity = 1
    for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    return opacity
  }
  const hidden = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return true
    }
    return false
  }
  const exempt = (element) =>
    Boolean(element.closest(':disabled, [aria-disabled="true"]')) ||
    (topLayer && !topLayer.contains(element))
  const onScreen = (rect) =>
    rect.width >= 2 && rect.height >= 2 && rect.right > 0 && rect.bottom > 0 &&
    rect.left < window.innerWidth && rect.top < window.innerHeight
  // CSS-module class names read "_rowKind_ab12c_34"; the middle is the name.
  const describe = (element) => {
    const raw = typeof element.className === 'string'
      ? element.className.split(' ')[0]
      : element.getAttribute('class')?.split(' ')[0] ?? ''
    const className = raw.replace(/^_(.+)_[a-z0-9]{5}_\d+$/, '$1')
    return `<${element.tagName.toLowerCase()}${className ? ` .${className}` : ''}>`
  }

  const targets = []
  let nextId = 0
  const add = (element, kind, label, color, rects, large, where = describe(element)) => {
    const fg = toRgba(color)
    const opacity = fg[3] * opacityOf(element)
    if (opacity < 0.05) return
    // Sample points across each box, kept only where this element is what is
    // on top: text under a popover, or the part of an icon a badge covers,
    // is not judged against what it cannot be seen on.
    const points = []
    for (const rect of rects.filter(onScreen)) {
      const inset = Math.min(2, rect.width / 4, rect.height / 4)
      for (const fy of [0.2, 0.5, 0.8]) {
        for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const x = rect.left + inset + (rect.width - 2 * inset) * fx
          const y = rect.top + inset + (rect.height - 2 * inset) * fy
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue
          const hit = document.elementFromPoint(x, y)
          if (hit && (element.contains(hit) || hit.contains(element))) points.push([x, y])
        }
      }
    }
    if (!points.length) return
    let id = element.getAttribute('data-contrast-id')
    if (!id) {
      id = String(nextId++)
      element.setAttribute('data-contrast-id', id)
    }
    targets.push({ id, kind, label, where, fg: fg.slice(0, 3), opacity, points, large })
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim()
    const element = node.parentElement
    if (!text || !element || hidden(element) || exempt(element)) continue
    if (element.closest('script, style, noscript')) continue
    const style = getComputedStyle(element)
    const size = parseFloat(style.fontSize)
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
    const range = document.createRange()
    range.selectNodeContents(node)
    // SVG text is painted by fill; color is only its currentColor source.
    const paint = element.closest('svg') ? style.fill : style.color
    add(element, 'text', text.replace(/\s+/g, ' ').slice(0, 40), paint, [...range.getClientRects()], large)
  }

  for (const field of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea')) {
    if (hidden(field) || exempt(field)) continue
    const style = field.value ? getComputedStyle(field) : getComputedStyle(field, '::placeholder')
    const label = field.value || field.getAttribute('placeholder')
    if (!label) continue
    add(field, field.value ? 'text' : 'placeholder', label.slice(0, 40), style.color, [field.getBoundingClientRect()], false)
  }

  for (const icon of document.querySelectorAll('svg')) {
    if (icon.parentElement?.closest('svg') || hidden(icon) || exempt(icon)) continue
    const rect = icon.getBoundingClientRect()
    // Charts and illustrations are not glyphs; judge only icon-sized art.
    if (rect.width > 48 || rect.height > 48) continue
    const style = getComputedStyle(icon)
    const paint = style.stroke !== 'none' && !style.stroke.startsWith('url') ? style.stroke : style.fill
    if (!paint || paint === 'none' || paint.startsWith('url')) continue
    // An icon's own class is just "lucide"; its host says where it is.
    const host = icon.parentElement
    const label = icon.closest('[aria-label]')?.getAttribute('aria-label') ||
      host?.textContent.trim().replace(/\s+/g, ' ') ||
      [...icon.classList].find((name) => name.startsWith('lucide-'))?.slice(7) || 'icon'
    add(icon, 'icon', label.slice(0, 40), paint, [rect], true, host ? describe(host) : 'svg')
  }
  return targets
}

// Runs inside the page: hides what was measured, so the next screenshot
// shows only what sits behind it.
function hideTargets() {
  const style = document.createElement('style')
  style.textContent = `
    *, *::before, *::after, *::placeholder {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-shadow: none !important;
      caret-color: transparent !important;
    }
    svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }
    svg[data-contrast-id] { visibility: hidden !important; }`
  document.head.appendChild(style)
}

// Runs inside the page: decodes the background screenshot and samples it at
// each target's points.
async function sampleBackgrounds({ png, targets }) {
  const image = new Image()
  image.src = `data:image/png;base64,${png}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const at = (x, y) => {
    const offset = (Math.min(canvas.height - 1, Math.max(0, Math.round(y))) * canvas.width +
      Math.min(canvas.width - 1, Math.max(0, Math.round(x)))) * 4
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
  }
  return targets.map((target) => target.points.map(([x, y]) => at(x, y)))
}

function luminance([red, green, blue]) {
  const linear = (channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

function blend(fg, alpha, bg) {
  return fg.map((channel, index) => Math.round(channel * alpha + bg[index] * (1 - alpha)))
}

const hex = (rgb) => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`

function judge(target, samples) {
  // The 20th percentile, not the minimum: a box can clip a neighbor's border
  // or a focus ring, and one stray pixel should not fail the whole run.
  const scored = samples
    .map((bg) => ({ bg, ratio: contrast(blend(target.fg, target.opacity, bg), bg) }))
    .sort((a, b) => a.ratio - b.ratio)
  const pick = scored[Math.floor(scored.length * 0.2)]
  const required = target.kind === 'text' || target.kind === 'placeholder'
    ? (target.large ? 3 : 4.5)
    : 3
  return { ...pick, required }
}

async function auditScreen(browser, name, theme) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()
  try {
    await page.route('nas-stream://**', fulfillNasStream)
    await page.goto(`${BASE_URL}/?screen=${encodeURIComponent(name)}&theme=${theme}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('html[data-preview-ready], html[data-preview-error]', { timeout: 10000 })
    const driveError = await page.getAttribute('html', 'data-preview-error')
    if (driveError) return { name, theme, error: `drive step failed: ${driveError}` }
    const appliedTheme = await page.getAttribute('html', 'data-theme')
    if (appliedTheme !== theme) return { name, theme, error: `asked for ${theme}, page rendered ${appliedTheme}` }
    // Let entrance transitions settle, then freeze everything so hiding the
    // text does not start a color transition mid-screenshot.
    await page.waitForTimeout(400)
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
    // Hit-testing skips pointer-events: none, which badges and overlays use,
    // so it is lifted while points are picked to see what is really on top.
    const hitTestable = await page.addStyleTag({ content: '*, *::before, *::after { pointer-events: auto !important; }' })
    const targets = await page.evaluate(collectTargets)
    await hitTestable.evaluate((style) => style.remove())
    await page.evaluate(hideTargets)
    const png = (await page.screenshot()).toString('base64')
    const samples = await page.evaluate(sampleBackgrounds, { png, targets })
    const failures = targets
      .map((target, index) => ({ target, verdict: judge(target, samples[index]) }))
      .filter(({ verdict }) => verdict.ratio < verdict.required)
    return { name, theme, checked: targets.length, failures }
  } catch (err) {
    return { name, theme, error: err.message }
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
    for (const theme of THEMES) {
      for (const name of SCREENS) results.push(await auditScreen(browser, name, theme))
    }
  } finally {
    if (browser) await browser.close()
    stopServer()
  }

  let failures = 0
  let checked = 0
  for (const result of results) {
    if (result.error) {
      failures++
      console.error(`[contrast] ${result.theme} ${result.name}: ${result.error}`)
      continue
    }
    checked += result.checked
    for (const { target, verdict } of result.failures) {
      failures++
      console.error(
        `[contrast] ${result.theme} ${result.name}: ${target.kind} ${target.where} "${target.label}" ` +
        `${verdict.ratio.toFixed(2)}:1 < ${verdict.required}:1 ` +
        `(${hex(target.fg)}${target.opacity < 1 ? ` @${target.opacity.toFixed(2)}` : ''} on ${hex(verdict.bg)})`,
      )
    }
  }
  if (failures) {
    console.error(`[contrast] ${failures} shortfall(s) across ${results.length} screen/theme runs, ${checked} targets checked`)
    process.exit(1)
  }
  console.log(`[contrast] every text and icon holds contrast across ${results.length} screen/theme runs, ${checked} targets checked`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
