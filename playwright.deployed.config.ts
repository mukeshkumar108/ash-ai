import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: /deployed\.smoke\.test\.ts/,
  timeout: 180_000,
  reporter: 'list',
});
