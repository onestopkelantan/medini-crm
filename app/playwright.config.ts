import { defineConfig, devices } from '@playwright/test';

/**
 * S10 T3 — Playwright browser E2E (production frontend ↔ production backend).
 * Requires: backend running on :3000 + frontend dev server on :5173.
 *
 * F-09 / P8-F3 remediation (Tier 4 C): the setup project authenticates ONCE
 * and persists tokens to e2e/.auth/hq-state.json; every journey project then
 * reuses that storageState instead of re-POSTing /auth/login per test. Login
 * rate limits on the backend stay fully active — the suite simply stops
 * tripping its own 5/min/IP bucket (P8-F3 flake eliminated).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    storageState: 'e2e/.auth/hq-state.json',
  },
  projects: [
    { name: 'setup', testMatch: /auth-setup\.ts/, use: { storageState: undefined } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
});
