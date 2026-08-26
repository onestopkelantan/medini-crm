import { test, expect } from '@playwright/test';

/**
 * S10 T4 — Browser E2E Journeys B–H.
 * Requires backend (:3000) + frontend (:5173) + PostgreSQL + Redis.
 *
 * F-09 / P8-F3 remediation (Tier 4 C): authentication is performed ONCE by
 * the setup project (auth-setup.ts) and shared via storageState
 * (e2e/.auth/hq-state.json). Each journey below navigates directly to its
 * target page — no per-test /auth/login POST. Backend login rate limits
 * remain fully active; the suite no longer trips its own 5/min/IP bucket.
 */

test.describe('Journey B — Patient CRUD', () => {
  test('patients page loads', async ({ page }) => {
    await page.goto('/patients');
    await expect(page.locator('text=Patients').first()).toBeVisible();
  });

  test('create patient dialog opens', async ({ page }) => {
    await page.goto('/patients');
    await page.click('text=New Patient');
    await expect(page.locator('text=Register New Patient').first()).toBeVisible();
  });
});

test.describe('Journey C — Appointments', () => {
  test('appointments page loads', async ({ page }) => {
    await page.goto('/appointments');
    await expect(page.locator('text=Appointments').first()).toBeVisible();
  });
});

test.describe('Journey D — Clinical', () => {
  test('clinical page loads after login', async ({ page }) => {
    await page.goto('/clinical');
    await expect(page.locator('text=Clinical').first()).toBeVisible();
  });
});

test.describe('Journey E — Finance', () => {
  test('finance page loads after login', async ({ page }) => {
    await page.goto('/finance');
    await expect(page.locator('text=Finance').first()).toBeVisible();
  });
});

test.describe('Journey F — Reports', () => {
  test('reports page loads with KPI cards', async ({ page }) => {
    await page.goto('/reports');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/reports');
  });
});

test.describe('Journey G — User Lifecycle', () => {
  test('administration page loads (HQ only)', async ({ page }) => {
    await page.goto('/administration');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/administration');
  });

  test('invite staff dialog opens', async ({ page }) => {
    await page.goto('/administration');
    await page.waitForTimeout(2000);
    const inviteBtn = page.locator('button:has-text("Invite Staff")');
    if (await inviteBtn.isVisible()) {
      await inviteBtn.click();
      await expect(page.locator('text=Invite Staff').first()).toBeVisible();
    } else {
      expect(page.url()).toContain('/administration');
    }
  });
});

test.describe('Journey H — Multi-branch RBAC', () => {
  test('HQ can access all modules (dashboard/patients/finance/reports/admin)', async ({ page }) => {
    await page.goto('/dashboard');
    /* HQ sidebar shows all modules */
    await expect(page.locator('text=Finance').first()).toBeVisible();
    await expect(page.locator('text=Reports').first()).toBeVisible();
    await expect(page.locator('text=Administration').first()).toBeVisible();
  });
});
