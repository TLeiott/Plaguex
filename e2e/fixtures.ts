import { test as base, expect, type Page } from '@playwright/test'

export const MOCK = 'http://127.0.0.1:32499'

/** Drive the real PIN login flow against the mock plex.tv (auto-claims after one poll). */
export async function signIn(page: Page) {
  await page.goto('/login')
  const popup = page.waitForEvent('popup').catch(() => null)
  await page.getByTestId('sign-in').click()
  const p = await popup
  await p?.close()
  await expect(page).toHaveURL(/\/servers/)
  const server = page.getByTestId('server-item').first()
  await expect(server).toBeEnabled()
  await server.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home')).toBeVisible()
}

export async function resetMock() {
  await fetch(`${MOCK}/_mock/reset`, { method: 'POST' })
}

export async function mockState(): Promise<{
  timelineEvents: { ratingKey: string; state: string; time: number }[]
  scrobbles: { key: string; action: string }[]
  streamSelections: Record<string, { audioStreamID?: number; subtitleStreamID?: number }>
}> {
  const res = await fetch(`${MOCK}/_mock/state`)
  return (await res.json()) as Awaited<ReturnType<typeof mockState>>
}

export const test = base.extend<{ signedIn: void }>({
  signedIn: [
    async ({ page }, use) => {
      // No per-test reset: workers share one mock instance, so tests only assert on state they own.
      await signIn(page)
      await use()
    },
    { auto: false },
  ],
})

export { expect }
