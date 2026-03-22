import { test, expect } from '@playwright/experimental-ct-react'
import QueueView from './QueueView'

// ---------------------------------------------------------------------------
// Test data — passed via hooksConfig so the beforeMount hook injects it
// ---------------------------------------------------------------------------
const TEST_CONNECTIONS = [
  { id: 'conn-1', name: 'Kepler', sftp: { host: '10.0.0.1', remotePath: '/mnt' } },
]

function makeJob(overrides = {}) {
  return {
    id: overrides.id ?? 'job-1',
    srcPath: '/local/files/test.mp4',
    filename: overrides.filename ?? 'test.mp4',
    relPath: 'test.mp4',
    size: overrides.size ?? 1048576,
    status: overrides.status ?? 'DONE',
    progress: 0,
    errorMsg: '',
    connectionId: 'conn-1',
    createdAt: Date.now(),
    ...overrides,
  }
}

const JOBS = [
  makeJob({ id: 'j1', filename: 'Scene01.mp4', size: 524288000 }),
  makeJob({ id: 'j2', filename: 'Scene02.mp4', size: 314572800 }),
  makeJob({ id: 'j3', filename: 'this-is-a-very-long-filename-that-should-truncate-not-overflow-the-column.mkv', size: 1073741824 }),
  makeJob({ id: 'j4', filename: 'short.txt', status: 'PENDING', size: 512 }),
]

// ---------------------------------------------------------------------------
// Layout regression tests — run in real Chromium
// ---------------------------------------------------------------------------

test.describe('QueueView layout', () => {
  for (const width of [1200, 800, 600]) {
    test(`all column headers visible at ${width}px viewport`, async ({ mount, page }) => {
      await page.setViewportSize({ width, height: 600 })

      const component = await mount(
        <QueueView connections={TEST_CONNECTIONS} />,
        { hooksConfig: { queueJobs: JOBS } }
      )

      // All headers must be present and visible in the DOM
      await expect(component.getByText('File / Path')).toBeVisible()
      await expect(component.getByText('Connection')).toBeVisible()
      await expect(component.getByText('Status')).toBeVisible()
      await expect(component.getByText('Size')).toBeVisible()
      await expect(component.getByText('Added')).toBeVisible()
    })
  }

  test('header row does not overflow viewport width', async ({ mount, page }) => {
    await page.setViewportSize({ width: 700, height: 600 })

    const component = await mount(
      <QueueView connections={TEST_CONNECTIONS} />,
      { hooksConfig: { queueJobs: JOBS } }
    )

    await expect(component.getByText('File / Path')).toBeVisible()

    // The header row container (not individual cells)
    const header = component.getByText('File / PathConnectionStatusSizeAdded')
    const box = await header.boundingBox()
    expect(box).not.toBeNull()
    expect(box.width).toBeLessThanOrEqual(700)
  })

  test('column headers remain visible after resize down', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1200, height: 600 })

    const component = await mount(
      <QueueView connections={TEST_CONNECTIONS} />,
      { hooksConfig: { queueJobs: JOBS } }
    )

    await expect(component.getByText('Status')).toBeVisible()

    // Resize down
    await page.setViewportSize({ width: 500, height: 600 })

    // Headers must still be in the DOM (may scroll horizontally, but must not vanish)
    await expect(component.getByText('File / Path')).toBeAttached()
    await expect(component.getByText('Status')).toBeAttached()
  })

  test('long filenames truncate instead of overflowing row', async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 600 })

    const component = await mount(
      <QueueView connections={TEST_CONNECTIONS} />,
      { hooksConfig: { queueJobs: JOBS } }
    )

    // The long filename should be in the DOM
    const longName = component.getByText(/this-is-a-very-long-filename/)
    await expect(longName).toBeAttached()

    // Its rendered width should not exceed the component's bounds
    const componentBox = await component.boundingBox()
    const nameBox = await longName.boundingBox()

    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(componentBox.x + componentBox.width + 1)
  })

  test('job rows render with non-zero height', async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 600 })

    const component = await mount(
      <QueueView connections={TEST_CONNECTIONS} />,
      { hooksConfig: { queueJobs: JOBS } }
    )

    await expect(component.getByText('Scene01.mp4')).toBeVisible()

    const rows = component.locator('[class*="row"]')
    const count = await rows.count()
    expect(count).toBeGreaterThanOrEqual(JOBS.length)

    for (let i = 0; i < Math.min(count, JOBS.length); i++) {
      const box = await rows.nth(i).boundingBox()
      expect(box).not.toBeNull()
      expect(box.height).toBeGreaterThan(0)
      expect(box.width).toBeGreaterThan(0)
    }
  })
})
