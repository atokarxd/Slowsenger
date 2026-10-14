import { test, expect } from '@playwright/test';

const SUPABASE_URL = 'https://ainenjvhxtwgqfrjfyyy.supabase.co';

test.describe('Login page', () => {
  test('renders login form with email and password fields', async ({ page }) => {
    await page.goto('/auth/login');

    await expect(page.locator('h1')).toHaveText('LOGIN');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('shows validation error when submitting empty form', async ({ page }) => {
    await page.goto('/auth/login');

    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.login-error')).toHaveText('Please enter your email and password.');
  });

  test('redirects to dashboard on successful login', async ({ page }) => {
    const user = {
      id: 'test-user-id',
      aud: 'authenticated',
      email: 'test@example.com',
      role: 'authenticated',
    };

    // Any other REST call (dashboard data) returns an empty list.
    // Registered first because Playwright gives later routes priority.
    await page.route(`${SUPABASE_URL}/rest/v1/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    // Profile existence check after sign-in
    await page.route(`${SUPABASE_URL}/rest/v1/profiles?select=id&**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: user.id }]) })
    );

    // Sign-in
    await page.route(`${SUPABASE_URL}/auth/v1/token**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'fake-refresh-token',
          user,
        }),
      })
    );

    // Current user lookup (auth.getUser)
    await page.route(`${SUPABASE_URL}/auth/v1/user**`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
    );

    await page.goto('/auth/login');
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
