import { defineConfig, devices } from '@playwright/test';

// The e2e tests run against a running `steward demo` (scripted model, dev login), which serves
// the built UI: `npm run build`, then
//   steward demo --profile profiles/acme --listen 127.0.0.1:8000 --ui ui/dist
const baseURL = process.env.STEWARD_URL ?? 'http://127.0.0.1:8000';

export default defineConfig({
  testDir: './e2e',
  // The demo keeps state (approvals, inboxes) in one process: run serially.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
