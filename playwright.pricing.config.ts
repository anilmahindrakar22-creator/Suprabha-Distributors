import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pricing-browser', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:3100', screenshot: 'only-on-failure' },
  projects: [
    { name: 'pricing-desktop', use: { ...devices['Desktop Chrome'], channel: process.env.CI ? undefined : 'chrome' } },
    { name: 'pricing-mobile', use: { ...devices['Pixel 7'], channel: process.env.CI ? undefined : 'chrome' } },
  ],
  webServer: { command: 'pnpm exec vite --config tests/ui/vite.config.ts', url: 'http://127.0.0.1:3100', timeout: 60000 },
});
