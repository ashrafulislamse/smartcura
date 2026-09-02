import { expect, type Page, type TestInfo } from '@playwright/test';

export const PORTAL_ROUTES = [
  '/dashboard',
  '/appointments',
  '/users/doctors',
  '/pharmacy/orders',
  '/support/tickets',
] as const;

export type PortalRoute = (typeof PORTAL_ROUTES)[number];

export function configuredRoutes(): readonly string[] {
  const value = process.env.PLAYWRIGHT_ROUTES?.trim();
  return value ? value.split(',').map(route => (route.startsWith('/') ? route : `/${route}`)) : PORTAL_ROUTES;
}

export async function loginAsFixture(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(process.env.PLAYWRIGHT_USER_EMAIL ?? 'smoke@smartcura.app');
  await page.getByLabel('Password').fill(process.env.PLAYWRIGHT_USER_PASSWORD ?? 'smoke-test-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
}

export function installFailureCapture(page: Page): { consoleErrors: string[]; failedRequests: string[]; serverErrors: string[] } {
  const result = { consoleErrors: [] as string[], failedRequests: [] as string[], serverErrors: [] as string[] };
  page.on('console', message => {
    if (message.type() === 'error') result.consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    result.failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'unknown error'}`);
  });
  page.on('response', response => {
    if (response.status() >= 500) result.serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return result;
}

export async function attachFailures(testInfo: TestInfo, failures: ReturnType<typeof installFailureCapture>): Promise<void> {
  await testInfo.attach('browser-failures.json', {
    body: JSON.stringify(failures, null, 2),
    contentType: 'application/json',
  });
  expect(failures.serverErrors, 'server errors').toEqual([]);
  expect(failures.failedRequests, 'failed browser requests').toEqual([]);
  expect(failures.consoleErrors, 'browser console errors').toEqual([]);
}
