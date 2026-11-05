import { expect, test } from '@playwright/test';

import { ask, expectNoSeriousA11yViolations, login, themeState } from './helpers';

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe (${scheme})`, () => {
    // Reduced motion: entry fades would otherwise be caught mid-way by the contrast check.
    // Dark is the UI's default theme; pin the stored theme so "light" really checks light.
    test.use({ colorScheme: scheme, contextOptions: { reducedMotion: 'reduce' }, storageState: themeState(scheme) });

    test('login and chat with activity, citation and costs', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('login-ivo')).toBeVisible();
      await expectNoSeriousA11yViolations(page, 'login');

      await login(page, 'ivo');
      await expectNoSeriousA11yViolations(page, 'chat (empty)');
      await ask(page, 'WireGuard meldet handshake did not complete. Was soll ich tun?');
      await expect(page.getByTestId('turn').last()).toHaveAttribute('data-status', 'done');
      await expect(page.getByTestId('citation-card').first()).toBeVisible();
      await expectNoSeriousA11yViolations(page, 'chat (answered)');
    });

    test('approvals: pending card in the chat and in the inbox', async ({ browser, page }) => {
      // Sven's request is held by Warden; check his chat and Sara's inbox while it is pending.
      const svenContext = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce', storageState: themeState(scheme) });
      const sven = await svenContext.newPage();
      await login(sven, 'sven');
      await ask(sven, 'Setz den Deal d-1007 auf 80.000 Euro');
      const card = sven.getByTestId('approval-card').last();
      await expect(card).toHaveAttribute('data-status', 'pending');
      await expectNoSeriousA11yViolations(sven, 'chat (approval pending)');
      const id = await card.getAttribute('data-approval-id');

      await login(page, 'sara');
      await page.goto('/approvals');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const inbox = page.locator(`[data-approval-id="${id}"]`);
      await expect(inbox).toBeVisible();
      await expectNoSeriousA11yViolations(page, 'approvals');

      // Clean up: approve, so nothing waits for the inbox timeout.
      await inbox.getByRole('button', { name: /^(Freigeben|Approve)$/ }).click();
      await expect(card).toHaveAttribute('data-status', 'approved');
      await expect(sven.getByTestId('turn').last()).toHaveAttribute('data-status', 'done');
      await svenContext.close();
    });

    test('memory and costs', async ({ page }) => {
      await login(page, 'fiona');
      await page.goto('/memory');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoSeriousA11yViolations(page, 'memory');
      await page.goto('/costs');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/Gesamt|Total/).first()).toBeVisible();
      await expectNoSeriousA11yViolations(page, 'costs');
    });

    test('console', async ({ page }) => {
      await login(page, 'ines');
      await page.goto('/console/effective?user=sven');
      await expect(page.getByTestId('effective-card')).toBeVisible();
      await page.getByTestId('whatif-run').click();
      await expect(page.getByTestId('whatif-result')).toBeVisible();
      await expectNoSeriousA11yViolations(page, 'console/effective');
      for (const section of ['test-as', 'users', 'audit', 'kill', 'connectors']) {
        await page.goto(`/console/${section}`);
        await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
        // Data loaded: no skeletons left (the live SSE stream keeps the network busy).
        await expect(page.locator('.animate-pulse')).toHaveCount(0);
        await expectNoSeriousA11yViolations(page, `console/${section}`);
      }
    });
  });
}
