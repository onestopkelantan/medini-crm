import { test as setup, expect } from '@playwright/test';

/**
 * S10 T3/T4 — E2E authenticated setup (F-09 / P8-F3 remediation, Tier 4 C).
 *
 * Problem: journeys-b-h performs 8 logins from the SAME localhost IP within
 * one file. Login is rate-limited at 5/min/IP by the backend throttler, so
 * sequential runs can trip 429 mid-file (P8-F3 / F-09 test-infra flake).
 *
 * Fix: authenticate ONCE here, persist the resulting localStorage tokens to
 * a storageState file, and let every journey reuse the already-authenticated
 * browser context. This changes NOTHING on the backend — rate limits stay
 * fully active; the suite simply stops hammering /auth/login.
 *
 * Requires: backend (:3000) + frontend (:5173) running.
 */
setup('authenticate as HQ', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#username', 'hq');
  await page.fill('#password', 'medini123');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/);

  /* Tokens live in localStorage (see src/lib/api.ts) — storageState must
   * capture them explicitly, since localStorage is only serialized when
   * origins are declared. */
  await page.context().storageState({ path: 'e2e/.auth/hq-state.json' });
});
