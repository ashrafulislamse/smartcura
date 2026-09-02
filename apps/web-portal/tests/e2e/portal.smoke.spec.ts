import { test, expect } from '@playwright/test';
import {
  attachFailures,
  configuredRoutes,
  installFailureCapture,
  loginAsFixture,
} from './support/portal';

test.describe('portal authenticated route smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsFixture(page);
  });

  for (const route of configuredRoutes()) {
    test(`loads ${route} without browser or server failures`, async ({ page }, testInfo) => {
      const failures = installFailureCapture(page);
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response?.ok(), `GET ${route}`).toBeTruthy();
      await expect(page.locator('body')).not.toContainText('Application error', { timeout: 10_000 });
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await attachFailures(testInfo, failures);
    });
  }
});
