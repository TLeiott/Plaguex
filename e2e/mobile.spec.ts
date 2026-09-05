import { test, expect } from './fixtures'

test.describe('mobile layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile project only')
  test.beforeEach(async ({ signedIn: _ }) => {})

  test('bottom tab bar navigates and sidebar is hidden', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Navigation' }).last()).toBeVisible()
    await expect(page.getByTestId('library-nav')).toBeHidden()
    await page.getByRole('link', { name: 'Search' }).last().click()
    await expect(page).toHaveURL(/\/search/)
    await page.getByRole('link', { name: 'Settings' }).last().click()
    await expect(page).toHaveURL(/\/settings/)
  })

  test('shelves scroll horizontally without page overflow', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(overflow).toBe(false)
  })

  test('poster cards and hero stay compact on a phone', async ({ page }) => {
    const viewport = page.viewportSize()!
    const card = page
      .getByRole('region', { name: /Recently added in Movies/ })
      .getByTestId('item-card')
      .first()
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    // Several posters must fit side by side; a card wider than 40% of the screen is a layout bug.
    expect(box!.width).toBeLessThan(viewport.width * 0.4)
    const hero = await page.getByTestId('hero').boundingBox()
    expect(hero!.height).toBeLessThan(viewport.height * 0.45)
  })

  test('player offers rotate instead of fullscreen on phones', async ({ page }) => {
    await page.goto('/play/101')
    await expect(page.getByTestId('player')).toBeVisible()
    await page.getByTestId('player').tap()
    await expect(page.getByTestId('fullscreen')).toHaveCount(0)
    const rotate = page.getByTestId('rotate')
    await expect(rotate).toBeVisible()
    await rotate.tap()
    await expect(page.getByTestId('player')).toHaveAttribute('data-rotated', 'true')
  })

  test('tapping the video toggles controls without pausing; centre button pauses', async ({
    page,
  }) => {
    await page.goto('/play/101')
    const video = page.getByTestId('video')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true)
    await video.tap()
    await page.waitForTimeout(400)
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
    const center = page.getByTestId('center-play')
    await expect(center).toBeVisible()
    await center.tap()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  })
})
