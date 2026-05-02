import { test, expect } from '@playwright/test';

const SUPABASE_URL = 'https://ainenjvhxtwgqfrjfyyy.supabase.co';

test.describe('Login page', () => {
  test('renders login form with username and password fields', async ({ page }) => {
    await page.goto('/auth/login');

    await expect(page.locator('h1')).toHaveText('LOGIN');
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('shows validation error when submitting empty form', async ({ page }) => {
    await page.goto('/auth/login');

    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.footer-text')).toContainText('Please enter your username or email and password.');
  });

  test('redirects to dashboard on successful login', async ({ page }) => {
    // Mock Supabase sign-in endpoint
    await page.route(`${SUPABASE_URL}/auth/v1/token**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: 'fake-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'fake-refresh-token',
          user: {
            id: 'test-user-id',
            email: 'test@example.com',
            role: 'authenticated',
          },
        }),
      });
    });

    // Mock Supabase profile query
    await page.route(`${SUPABASE_URL}/rest/v1/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'test-user-id',
            username: 'testuser',
            first_name: 'Test',
            last_name: 'User',
          },
        ]),
      });
    });

    await page.goto('/auth/login');
    await page.locator('input[name="username"]').fill('testuser');
    await page.locator('input[name="password"]').fill('password123');
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/dashboard/);
  });
});
