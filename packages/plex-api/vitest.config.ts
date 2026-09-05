import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { name: 'plex-api', environment: 'node', include: ['test/**/*.test.ts'] },
})
