import { defineConfig } from '@playwright/test';

// Pure unit tests: no dev server, no browser.
export default defineConfig({
  testDir: './tests/unit',
  testMatch: /.*\.test\.ts/,
  timeout: 30_000,
  reporter: 'list',
});
