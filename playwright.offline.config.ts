import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './tests/pricing-browser', testMatch: 'offline-pin-orders.spec.ts', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:3110', screenshot: 'only-on-failure' },
  projects: [
    { name: 'offline-desktop', use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' } },
    { name: 'offline-mobile', use: { ...devices['Pixel 7'], channel: process.env.CI ? undefined : 'chrome' } },
  ], webServer: { command: 'pnpm exec vite --config tests/offline-ui/vite.config.ts', url: 'http://127.0.0.1:3110', timeout: 60000 },
});
