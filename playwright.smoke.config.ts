import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: /.*\.smoke\.test\.ts/,
  timeout: 120_000,
  reporter: 'list',
});
