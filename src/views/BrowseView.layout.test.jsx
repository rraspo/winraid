import { test, expect } from '@playwright/experimental-ct-react'
import BrowseView from './BrowseView'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const SAMPLE_ENTRIES = [
  { name: 'Documents', type: 'dir', size: 0, modified: Date.now() },
  { name: 'Photos', type: 'dir', size: 0, modified: Date.now() },
  { name: 'a-very-long-filename-that-should-definitely-truncate-and-not-overflow.txt', type: 'file', size: 1024, modified: Date.now() },
  { name: 'video.mp4', type: 'file', size: 52428800, modified: Date.now() },
  { name: 'music.flac', type: 'file', size: 31457280, modified: Date.now() },
  { name: 'archive.zip', type: 'file', size: 104857600, modified: Date.now() },
]

const HOOKS_CONFIG = {
  remoteEntries: { ok: true, entries: SAMPLE_ENTRIES },
  configData: {
    connections: [{
      id: 'conn-1',
      name: 'Kepler',
      localFolder: 'C:\\sync',
      sftp: { host: '10.0.0.1', remotePath: '/mnt/data' },
    }],
    activeConnectionId: 'conn-1',
  },
}

// ---------------------------------------------------------------------------
// Layout regression tests
// ---------------------------------------------------------------------------

test.describe('BrowseView grid layout', () => {
  test('grid cards stay within container bounds', async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 700 })

    // Force grid mode via localStorage before mount
    await page.evaluate(() => localStorage.setItem('browse-view', 'grid'))

    const component = await mount(
      <BrowseView onHistoryPush={() => {}} />,
      { hooksConfig: HOOKS_CONFIG }
    )

    // Wait for grid cards to render
    await expect(component.getByText('Documents')).toBeVisible()

    const cards = component.locator('[class*="gridCard"]')
    const cardCount = await cards.count()
    expect(cardCount).toBe(SAMPLE_ENTRIES.length)

    // Get the grid wrapper bounds
    const wrapper = component.locator('[class*="gridWrapper"]')
    const wrapperBox = await wrapper.boundingBox()
    expect(wrapperBox).not.toBeNull()

    // Every card must be within the wrapper's horizontal bounds
    for (let i = 0; i < cardCount; i++) {
      const cardBox = await cards.nth(i).boundingBox()
      expect(cardBox).not.toBeNull()
      expect(cardBox.width).toBeGreaterThan(0)
      expect(cardBox.height).toBeGreaterThan(0)
      expect(cardBox.x).toBeGreaterThanOrEqual(wrapperBox.x - 1)
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(wrapperBox.x + wrapperBox.width + 1)
    }
  })

  test('grid card text does not overflow card boundary', async ({ mount, page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    await page.evaluate(() => localStorage.setItem('browse-view', 'grid'))

    const component = await mount(
      <BrowseView onHistoryPush={() => {}} />,
      { hooksConfig: HOOKS_CONFIG }
    )

    await expect(component.getByText('Documents')).toBeVisible()

    // Find the card with the long filename
    const longNameEl = component.getByText(/a-very-long-filename/)
    await expect(longNameEl).toBeAttached()

    // The name wrapper (with overflow:hidden) should clip text within the card
    const nameWrap = longNameEl.locator('xpath=ancestor::*[contains(@class, "gridNameWrap")]').first()
    const wrapBox = await nameWrap.boundingBox()
    const card = longNameEl.locator('xpath=ancestor::*[contains(@class, "gridCard")]').first()
    const cardBox = await card.boundingBox()

    expect(wrapBox.x + wrapBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
  })

  test('grid cards render with visible content (not empty)', async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await page.evaluate(() => localStorage.setItem('browse-view', 'grid'))

    const component = await mount(
      <BrowseView onHistoryPush={() => {}} />,
      { hooksConfig: HOOKS_CONFIG }
    )

    await expect(component.getByText('Documents')).toBeVisible()

    // Each card must have visible text content (catches the "empty cards" bug)
    for (const entry of SAMPLE_ENTRIES) {
      await expect(component.getByText(entry.name)).toBeVisible()
    }
  })

  test('menu button stays inside card at narrow viewport', async ({ mount, page }) => {
    await page.setViewportSize({ width: 500, height: 700 })
    await page.evaluate(() => localStorage.setItem('browse-view', 'grid'))

    const component = await mount(
      <BrowseView onHistoryPush={() => {}} />,
      { hooksConfig: HOOKS_CONFIG }
    )

    await expect(component.getByText('Documents')).toBeVisible()

    const menuBtns = component.locator('[class*="menuDotBtn"]')
    const cards = component.locator('[class*="gridCard"]')
    const count = await menuBtns.count()

    for (let i = 0; i < count; i++) {
      const btnBox = await menuBtns.nth(i).boundingBox()
      const cardBox = await cards.nth(i).boundingBox()
      if (btnBox && cardBox) {
        expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
      }
    }
  })
})

test.describe('BrowseView list layout', () => {
  test('list view columns align with headers', async ({ mount, page }) => {
    await page.setViewportSize({ width: 900, height: 700 })
    await page.evaluate(() => localStorage.setItem('browse-view', 'list'))

    const component = await mount(
      <BrowseView onHistoryPush={() => {}} />,
      { hooksConfig: HOOKS_CONFIG }
    )

    // Wait for entries
    await expect(component.getByText('Documents')).toBeVisible()

    // Column headers should be visible
    await expect(component.getByText('Name', { exact: true })).toBeVisible()
    await expect(component.getByText('Size', { exact: true })).toBeVisible()
    await expect(component.getByText('Modified', { exact: true })).toBeVisible()
  })

  test('breadcrumb wraps at narrow viewport', async ({ mount, page }) => {
    await page.setViewportSize({ width: 400, height: 700 })
    await page.evaluate(() => localStorage.setItem('browse-view', 'list'))

    const component = await mount(
      <BrowseView onHistoryPush={() => {}} />,
      { hooksConfig: HOOKS_CONFIG }
    )

    await expect(component.getByText('Documents')).toBeVisible()

    // Breadcrumb container should not overflow the viewport
    const breadcrumb = component.locator('[class*="breadcrumb"]')
    const box = await breadcrumb.boundingBox()
    expect(box).not.toBeNull()
    expect(box.width).toBeLessThanOrEqual(400)
  })
})
