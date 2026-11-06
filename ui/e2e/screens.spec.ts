import { expect, test, type Page } from '@playwright/test';

import { ask, login, newUserPage } from './helpers';

// README screenshots, taken against a running demo with a real model:
//   steward demo --profile profiles/acme --ui ui/dist      (API key in env or credential store)
//   SCREENSHOTS=1 npx playwright test screens
// Skipped in normal e2e runs.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to retake the README screenshots');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
test.setTimeout(240_000);

const OUT = '../docs/assets/screens';

async function shot(page: Page, name: string) {
  // No toasts over the composer; every image loaded; the presence animation settled.
  for (const close of await page.getByTestId('toast-dismiss').all()) await close.click();
  await expect(page.getByTestId('toast-dismiss')).toHaveCount(0);
  await expect
    .poll(() => page.locator('img').evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)))
    .toBe(true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

async function finished(page: Page) {
  await expect(page.getByTestId('turn').last()).toHaveAttribute('data-status', 'done', { timeout: 180_000 });
}

test('login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('login-sven')).toBeVisible();
  await shot(page, 'login');
});

test('empty chat', async ({ page }) => {
  await login(page, 'sven');
  await shot(page, 'chat-empty');
});

test('cited answer from a scanned PDF', async ({ page }) => {
  await login(page, 'ivo');
  await ask(page, 'WireGuard meldet handshake did not complete. Was soll ich tun?');
  await finished(page);
  await expect(page.getByTestId('citation-card').first()).toBeVisible();
  await shot(page, 'chat-citation');
});

test('approval: held call, the inbox, the approved result', async ({ browser }) => {
  const sven = await newUserPage(browser, 'sven');
  await ask(sven, 'Setz den Deal d-1007 auf 80.000 Euro');
  const card = sven.getByTestId('approval-card').last();
  await expect(card).toHaveAttribute('data-status', 'pending', { timeout: 120_000 });
  const id = await card.getAttribute('data-approval-id');

  const sara = await newUserPage(browser, 'sara');
  await sara.getByRole('link', { name: /Freigaben|Approvals/ }).click();
  const inbox = sara.locator(`[data-testid="approval-card"][data-approval-id="${id}"]`);
  await expect(inbox).toBeVisible();
  await inbox.click();
  await shot(sara, 'approvals');
  await inbox.getByRole('button', { name: /^(Freigeben|Approve)$/ }).click();

  await expect(card).toHaveAttribute('data-status', 'approved');
  await finished(sven);
  await shot(sven, 'chat-approval');
  await sven.context().close();
  await sara.context().close();
});

test('delegation: research agent, action agent, approval', async ({ browser }) => {
  const sara = await newUserPage(browser, 'sara');
  await ask(sara, 'Recherchiere den Deal mit Fjord Logistics und lege im Projekt OPS ein Jira-Issue für das Angebot an');
  const card = sara.getByTestId('approval-card').last();
  await expect(card).toHaveAttribute('data-status', 'pending', { timeout: 180_000 });
  const id = await card.getAttribute('data-approval-id');

  const ines = await newUserPage(browser, 'ines');
  await ines.getByRole('link', { name: /Freigaben|Approvals/ }).click();
  await ines.locator(`[data-testid="approval-card"][data-approval-id="${id}"]`).getByRole('button', { name: /^(Freigeben|Approve)$/ }).click();

  await finished(sara);
  await shot(sara, 'chat-delegation');
  await sara.context().close();
  await ines.context().close();
});

test('console: effective rights and what-if', async ({ page }) => {
  await login(page, 'ines');
  await page.getByRole('link', { name: 'Console' }).click();
  await page.getByTestId('users-table').getByRole('button', { name: /Sven Berger/ }).click();
  await page.getByTestId('whatif-action').selectOption('tool:crm.update_deal');
  await page.getByTestId('whatif-args').fill('{"tenant":"dach","deal_id":"d-1007","amount":80000}');
  await page.getByTestId('whatif-run').click();
  await expect(page.getByTestId('whatif-result')).toBeVisible();
  await shot(page, 'console-whatif');
});
