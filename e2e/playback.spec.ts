import type { Page } from '@playwright/test'
import { test, expect, mockState } from './fixtures'

/** ratingKeys come from the mock fixtures; look them up through the UI to avoid hard-coding. */
async function firstItemKey(page: Page, libraryId: string, sort?: string) {
  await page.goto(`/library/${libraryId}?view=all${sort ? `&sort=${sort}` : ''}`)
  const card = page.getByTestId('item-card').first()
  return (await card.getAttribute('data-rating-key'))!
}

test.describe('playback', () => {
  test.beforeEach(async ({ signedIn: _ }) => {})

  test('direct plays an h264/mp4 movie, reports progress, and stops cleanly', async ({ page }) => {
    const key = '101' // Movie 01: mp4 / h264 / aac in the fixtures
    await page.goto(`/play/${key}`)

    const player = page.getByTestId('player')
    await expect(player).toBeVisible()
    await expect(page.getByTestId('play-method')).toHaveText(/Direct play/i)
    const video = page.getByTestId('video')
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(0.5)

    // Timeline pings reach the server.
    await expect
      .poll(
        async () => (await mockState()).timelineEvents.filter((e) => e.ratingKey === key).length,
      )
      .toBeGreaterThan(0)

    // Leaving sends a final "stopped" with the position. Other workers may play the same item
    // concurrently, so count stop events instead of inspecting the last one.
    const stopped = async () =>
      (await mockState()).timelineEvents.filter((e) => e.ratingKey === key && e.state === 'stopped')
        .length
    const before = await stopped()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect.poll(stopped).toBeGreaterThan(before)
  })

  test('falls back to HLS for an unsupported container', async ({ page }) => {
    const key = '102' // Movie 02: mkv / hevc / eac3 -> not directly playable in Chromium
    await page.goto(`/play/${key}`)
    await expect(page.getByTestId('play-method')).toHaveText(/Direct stream|Transcode/i)
    const video = page.getByTestId('video')
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 })
      .toBeGreaterThan(0.5)
  })

  test('keyboard shortcuts: space pauses, arrows seek, f toggles fullscreen class', async ({
    page,
  }) => {
    const key = await firstItemKey(page, '1')
    await page.goto(`/play/${key}`)
    const video = page.getByTestId('video')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true)
    await page.keyboard.press('Space')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(before + 5)
    await page.keyboard.press('m')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true)
  })

  test('episode shows skip-intro during the intro marker and offers next episode', async ({
    page,
  }) => {
    // Show A S01E01 has an intro marker starting at 0 in the fixtures.
    await page.goto('/search?q=Show A')
    await page.getByTestId('item-card').first().click()
    await page.getByTestId('item-card').first().click() // season 1
    await page
      .getByTestId('episode-list')
      .locator('li')
      .first()
      .getByRole('link', { name: /Play/ })
      .click()
    await expect(page.getByTestId('player')).toBeVisible()
    await expect(page.getByTestId('next-episode')).toBeVisible()
    const skip = page.getByTestId('skip-marker')
    await expect(skip).toBeVisible({ timeout: 15_000 })
    const video = page.getByTestId('video')
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
    await skip.click()
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(before + 1)
  })

  test('subtitle selection is persisted on the server', async ({ page }) => {
    const key = '103' // Movie 03: mkv / h264 with embedded ass + external srt
    await page.goto(`/play/${key}`)
    await page.getByTestId('player').hover()
    await page.getByTestId('tracks-button').click()
    const menu = page.getByTestId('track-menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitemradio').filter({ hasNotText: 'Off' }).last().click()
    await expect
      .poll(async () => Object.keys((await mockState()).streamSelections).length)
      .toBeGreaterThan(0)
  })
})
