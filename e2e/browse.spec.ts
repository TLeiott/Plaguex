import { test, expect } from './fixtures'

test.describe('browsing', () => {
  test.beforeEach(async ({ signedIn: _ }) => {})

  test('home shows continue watching and recently added shelves', async ({ page }) => {
    await expect(page.getByTestId('hero')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Continue Watching' })).toBeVisible()
    await expect(page.getByRole('region', { name: /Recently added in Movies/ })).toBeVisible()
    await expect(page.getByRole('region', { name: /Recently added in TV Shows/ })).toBeVisible()
  })

  test('library grid paginates, sorts and filters', async ({ page }) => {
    await page.goto('/library/1?view=all')
    const grid = page.getByTestId('item-grid')
    await expect(grid).toBeVisible()
    const count = await grid.getByTestId('item-card').count()
    expect(count).toBeGreaterThanOrEqual(10)

    await page.getByLabel('Sort').selectOption('addedAt:desc')
    await expect(page).toHaveURL(/sort=addedAt(%3A|:)desc/)

    await page.getByRole('checkbox', { name: 'Unwatched' }).check()
    await expect(page).toHaveURL(/unwatched=true/)
    await expect.poll(() => grid.getByTestId('item-card').count()).toBeLessThan(count)
  })

  test('library recommended view shows hubs', async ({ page }) => {
    await page.goto('/library/1')
    await expect(page.getByTestId('shelf').first()).toBeVisible()
  })

  test('movie detail page shows metadata and media info', async ({ page }) => {
    await page.goto('/library/1?view=all')
    await page.getByTestId('item-card').first().click()
    await expect(page).toHaveURL(/\/item\/\d+/)
    await expect(page.getByTestId('play')).toBeVisible()
    await page.getByRole('button', { name: /Media info/ }).click()
    await expect(page.getByText(/Version 1/)).toBeVisible()
  })

  test('show -> season -> episode navigation', async ({ page }) => {
    await page.goto('/library/2?view=all')
    await page.getByTestId('item-card').first().click()
    await expect(page.getByRole('heading', { name: 'Seasons' })).toBeVisible()
    await page.getByTestId('item-card').first().click()
    await expect(page.getByTestId('episode-list')).toBeVisible()
    const episodes = page.getByTestId('episode-list').locator('li')
    expect(await episodes.count()).toBeGreaterThan(0)
  })

  test('mark watched toggles and persists on the server', async ({ page }) => {
    await page.goto('/library/1?view=all')
    await page.getByTestId('item-card').first().click()
    const toggle = page.getByTestId('toggle-watched')
    const before = await toggle.getAttribute('aria-pressed')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
    await page.reload()
    await expect(page.getByTestId('toggle-watched')).toHaveAttribute(
      'aria-pressed',
      before === 'true' ? 'false' : 'true',
    )
  })

  test('search finds items as you type', async ({ page }) => {
    await page.goto('/search')
    await page.getByTestId('search-input').fill('Show A')
    await expect(page.getByTestId('item-card').first()).toBeVisible()
    await expect(page).toHaveURL(/q=Show/)
    await page.getByTestId('search-input').fill('zzzzzz-no-match')
    await expect(page.getByText(/No results/)).toBeVisible()
  })

  test('settings persist', async ({ page }) => {
    await page.goto('/settings')
    await page.getByTestId('setting-autoSkipIntro').check()
    await page.getByTestId('setting-quality').selectOption('8000')
    await page.reload()
    await expect(page.getByTestId('setting-autoSkipIntro')).toBeChecked()
    await expect(page.getByTestId('setting-quality')).toHaveValue('8000')
  })

  test('recently added shelf title links to the full library listing', async ({ page }) => {
    await page.getByTestId('shelf-title-link').first().click()
    await expect(page).toHaveURL(/\/library\/1\?.*view=all/)
    await expect(page.getByTestId('item-grid')).toBeVisible()
  })

  test('shows an offline banner when the server is unreachable and keeps the shell usable', async ({
    page,
  }) => {
    await page.route('**/127.0.0.1:32499/**', (route) => route.abort('connectionrefused'))
    await page.goto('/settings')
    await page.getByRole('link', { name: 'Home', exact: true }).first().click()
    await expect(page.getByTestId('offline-banner')).toBeVisible()
    await expect(
      page.getByTestId('settings-page').or(page.getByRole('alert')).first(),
    ).toBeVisible()
    await page.unroute('**/127.0.0.1:32499/**')
    await page.getByTestId('offline-banner').getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('diagnostics benchmark runs every check and a playback probe, and produces a report', async ({
    page,
  }) => {
    await page.goto('/settings')
    await page.getByTestId('open-diagnostics').click()
    await expect(page).toHaveURL(/\/diagnostics/)
    await page.goto('/diagnostics?seconds=3')
    await page.getByTestId('run-benchmark').click()
    const steps = page.getByTestId('benchmark-steps')
    await expect(steps).toBeVisible({ timeout: 60_000 })
    await expect(steps.locator('li')).toHaveCount(11)
    await expect(steps.getByText('fail', { exact: true })).toHaveCount(0)
    const probe = page.getByTestId('playback-probe').first()
    await expect(probe).toBeVisible()
    await expect(probe).toContainText('Stream:')
    await expect(probe).not.toContainText('never')
    await page.getByText('Full report').click()
    await expect(page.getByTestId('report-text')).toContainText('## Playback probes')
    await expect(page.getByTestId('share-report')).toBeVisible()
  })
})
