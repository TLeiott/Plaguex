import { defineConfig, devices } from '@playwright/test'

const MOCK_PORT = 32499
const WEB_PORT = 4173

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Tests deep-link straight into /play/:id. A real user arrives via a click (user activation), so
    // mirror that instead of letting Chromium's autoplay policy block play() in a fresh document.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: `PORT=${MOCK_PORT} BASE_URL=http://127.0.0.1:${MOCK_PORT} PIN_AUTO_CLAIM_AFTER=1 pnpm --filter @plaguex/mock-plex start`,
      url: `http://127.0.0.1:${MOCK_PORT}/identity`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `VITE_PLEXTV_URL=http://127.0.0.1:${MOCK_PORT}/plextv VITE_PLEX_AUTH_APP_URL=http://127.0.0.1:${MOCK_PORT}/plextv/auth pnpm --filter @plaguex/web build && pnpm --filter @plaguex/web preview`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
