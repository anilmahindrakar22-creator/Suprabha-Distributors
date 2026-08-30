import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.{test,spec}.{js,mjs,ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['lib/access-control.mjs', 'lib/stock-handler.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
