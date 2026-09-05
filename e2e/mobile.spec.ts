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
})
