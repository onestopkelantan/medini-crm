import { test, expect } from '@playwright/test';

/**
 * S10 T3 — Browser E2E Journey A: Login → Patient List → Create → View.
 * Requires backend (:3000) + frontend (:5173) running.
 *
 * F-09 / P8-F3 note (Tier 4 C): this file deliberately keeps REAL login
 * interactions (valid + invalid credentials) — that is its purpose: proving
 * the login flow itself. It stays within the 5/min/IP login budget
 * (3 logins total). Journeys B–H use the shared storageState instead.
 */

test.describe('Journey A — Login → Patients', () => {
  test('login with valid HQ credentials redirects to dashboard', async ({ page }) => {
    /* Journey A intentionally exercises the real login form. */
    test.use({ storageState: undefined });
    await page.goto('/login');
    await page.fill('#username', 'hq');
    await page.fill('#password', 'medini123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('login with wrong password stays on login page (no dashboard redirect)', async ({ page }) => {
    test.use({ storageState: undefined });
    await page.goto('/login');
    await page.fill('#username', 'hq');
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');
    /* Wrong credentials must NOT reach the dashboard — still on /login */
    await page.waitForTimeout(3000);
    expect(page.url()).toContain('/login');
  });

  test('patients page loads after login', async ({ page }) => {
    test.use({ storageState: undefined });
    await page.goto('/login');
    await page.fill('#username', 'hq');
    await page.fill('#password', 'medini123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/patients');
    await expect(page.locator('text=Patients').first()).toBeVisible();
  });
});
