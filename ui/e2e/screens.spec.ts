import { expect, test, type Page } from '@playwright/test';

import { ask, login, newUserPage } from './helpers';

// README screenshots. Most are taken against a demo with a real model:
//   steward demo --profile profiles/acme --ui ui/dist      (API key in env or credential store)
//   SCREENSHOTS=live npx playwright test screens
// The injection shot needs the scripted model (a real model refuses the injected
// instructions itself, so there is nothing for Warden to stop on screen):
//   steward demo --profile profiles/acme --ui ui/dist --offline
//   SCREENSHOTS=offline npx playwright test screens
// Skipped in normal e2e runs.
const MODE = process.env.SCREENSHOTS;
test.skip(!MODE, 'set SCREENSHOTS=live or SCREENSHOTS=offline to retake the README screenshots');
const live = () => test.skip(MODE !== 'live', 'live model only');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
test.setTimeout(240_000);

const OUT = '../docs/assets/screens';

async function shot(page: Page, name: string) {
  // No toasts over the composer; every image loaded; the presence animation settled.
  const toasts = page.getByTestId('toast-dismiss');
  while ((await toasts.count()) > 0) await toasts.first().click();
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
  live();
  await page.goto('/');
  await expect(page.getByTestId('login-sven')).toBeVisible();
  await shot(page, 'login');
});

test('empty chat', async ({ page }) => {
  live();
  await login(page, 'sven');
  await shot(page, 'chat-empty');
});

test('cited answer from a scanned PDF', async ({ page }) => {
  live();
  await login(page, 'ivo');
  await ask(page, 'WireGuard meldet handshake did not complete. Was soll ich tun?');
  await finished(page);
  await expect(page.getByTestId('citation-card').first()).toBeVisible();
  await shot(page, 'chat-citation');
});

test('approval: held call, the inbox, the approved result', async ({ browser }) => {
  live();
  const sven = await newUserPage(browser, 'sven');
  await ask(sven, 'Setz den Deal d-1007 auf 80.000 Euro');
  const card = sven.getByTestId('approval-card').last();
  await expect(card).toHaveAttribute('data-status', 'pending', { timeout: 120_000 });
  const id = await card.getAttribute('data-approval-id');
  await shot(sven, 'chat-confirm');
  await card.getByTestId('gate-confirm').click();

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
  live();
  test.setTimeout(480_000);
  const sara = await newUserPage(browser, 'sara');
  await ask(sara, 'Recherchiere den Deal mit Fjord Logistics und lege im Projekt OPS ein Jira-Issue für das Angebot an');
  // The action agent's write is Sara's to confirm (approve_by: subject).
  const card = sara.getByTestId('approval-card').last();
  await expect(card).toHaveAttribute('data-status', 'pending', { timeout: 180_000 });
  await card.getByTestId('gate-confirm').click();

  await finished(sara);
  await shot(sara, 'chat-delegation');
  await sara.context().close();
});

test('console: effective rights and what-if', async ({ page }) => {
  live();
  await login(page, 'ines');
  await page.getByRole('link', { name: 'Console' }).click();
  await page.getByTestId('users-table').getByRole('button', { name: /Sven Berger/ }).click();
  await page.getByTestId('whatif-action').selectOption('tool:crm.update_deal');
  await page.getByTestId('whatif-args').fill('{"tenant":"dach","deal_id":"d-1007","amount":80000}');
  await page.getByTestId('whatif-run').click();
  await expect(page.getByTestId('whatif-result')).toBeVisible();
  await shot(page, 'console-whatif');
});

test('injection, scripted model: two calls denied, the permitted write waits for Ivo', async ({ page }) => {
  test.skip(MODE !== 'offline', 'scripted model only');
  await login(page, 'ivo');
  await ask(page, 'Fasse Ticket t-2051 zusammen');
  const gate = page.getByTestId('approval-card').last();
  await expect(gate.getByTestId('gate-confirm')).toBeVisible();
  // Past the short "denied" flash: Steward asks Ivo about the one write he could do.
  await expect(page.getByTestId('presence')).toHaveAttribute('data-presence', 'awaiting_approval');
  await shot(page, 'chat-injection');
  await gate.getByTestId('gate-cancel').click();
  await finished(page);
});
