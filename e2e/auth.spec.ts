import { test, expect, signIn } from './fixtures'

test.describe('authentication', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Plaguex' })).toBeVisible()
  })

  test('signs in with the PIN flow, picks a server, and lands on home', async ({ page }) => {
    await signIn(page)
    await expect(page.getByTestId('hero')).toBeVisible()
  })

  test('session persists across reloads', async ({ page }) => {
    await signIn(page)
    await page.reload()
    await expect(page.getByTestId('home')).toBeVisible()
  })

  test('sign out returns to login and clears the session', async ({ page }) => {
    await signIn(page)
    await page.goto('/settings')
    await page.getByTestId('sign-out').click()
    await expect(page).toHaveURL(/\/login/)
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })

  test('unreachable connections are skipped in favour of a reachable one', async ({ page }) => {
    await page.goto('/login')
    const popup = page.waitForEvent('popup').catch(() => null)
    await page.getByTestId('sign-in').click()
    await (await popup)?.close()
    const item = page.getByTestId('server-item').first()
    await expect(item).toContainText(/Local|Remote/)
    await expect(item).not.toContainText('Unreachable')
  })
})
