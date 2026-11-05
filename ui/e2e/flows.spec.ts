import { expect, test } from '@playwright/test';

import { ask, login, newUserPage } from './helpers';

test('sven asks for an 80k deal, sara approves in her inbox, sven sees the tool result', async ({ browser }) => {
  const sven = await newUserPage(browser, 'sven');
  await ask(sven, 'Setz den Deal d-1007 auf 80.000 Euro');

  // Warden holds the call: amber decision badge and a live approval card.
  const tool = sven.locator('[data-testid="tool-item"][data-tool="crm.update_deal"]').last();
  await expect(tool).toBeVisible();
  await expect(tool).toContainText('big-deals-need-approval');
  const card = sven.getByTestId('approval-card').last();
  await expect(card).toHaveAttribute('data-status', 'pending');
  await expect(card).toContainText('crm.update_deal');
  await expect(card).toContainText('80000');
  await expect(card).toContainText('sara');
  const approvalId = await card.getAttribute('data-approval-id');
  expect(approvalId).toBeTruthy();

  // Sara: the inbox badge counts it, she approves with a click.
  const sara = await newUserPage(browser, 'sara');
  await expect(sara.getByTestId('approvals-badge')).toBeVisible();
  await sara.getByRole('link', { name: /Freigaben|Approvals/ }).click();
  const inbox = sara.locator(`[data-testid="approval-card"][data-approval-id="${approvalId}"]`);
  await expect(inbox).toBeVisible();
  await expect(inbox).toContainText('sven');
  await inbox.getByRole('button', { name: /^(Freigeben|Approve)$/ }).click();
  await expect(sara.locator(`[data-approval-id="${approvalId}"]`)).toHaveCount(0);

  // Sven: the card flips to approved, the call runs, the turn finishes.
  await expect(card).toHaveAttribute('data-status', 'approved');
  await expect(tool).toHaveAttribute('data-status', 'ok');
  const turn = sven.getByTestId('turn').last();
  await expect(turn).toHaveAttribute('data-status', 'done');
  await expect(turn.getByTestId('answer')).toContainText('80.000');
  await expect(turn.getByTestId('cost-chip')).toBeVisible();

  await sven.context().close();
  await sara.context().close();
});

test('ivo gets a verified citation and the page image loads', async ({ page }) => {
  await login(page, 'ivo');
  // The thumbnail fetches the page image (Warden checks `x-docs-page` on every fetch).
  const image = page.waitForResponse((r) => r.url().includes('/api/docs/pages/it-vpn-setup/2.png'));
  await ask(page, 'WireGuard meldet handshake did not complete. Was soll ich tun?');
  const turn = page.getByTestId('turn').last();
  await expect(turn).toHaveAttribute('data-status', 'done');
  await expect(turn.locator('[data-testid="tool-item"][data-tool="docs.search"]')).toHaveAttribute('data-status', 'ok');

  const citation = turn.getByTestId('citation-card').first();
  await expect(citation).toContainText('VPN');
  expect((await image).status()).toBe(200);
  await citation.getByRole('button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const img = dialog.getByRole('img');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(dialog.locator('mark')).toContainText('handshake did not complete');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('ivo: injected ticket instructions are denied by Warden', async ({ page }) => {
  await login(page, 'ivo');
  await ask(page, 'Fasse Ticket t-2051 zusammen');
  const salary = page.locator('[data-testid="tool-item"][data-tool="hr.get_salary"]').last();
  await expect(salary).toContainText(/Verweigert|Denied/);
  await expect(salary).toHaveAttribute('data-status', 'failed');
  const post = page.locator('[data-testid="tool-item"][data-tool="chat.post_message"]').last();
  await expect(post).toContainText(/Verweigert|Denied/);
  // ticket.close waits for ines; we stop here (the inbox times out and denies).
  await expect(page.getByTestId('approval-card').last()).toHaveAttribute('data-status', 'pending');
  await page.getByRole('button', { name: /Abbrechen|Cancel/ }).click();
});

test('ines: console loads users, effective rights, what-if and connectors', async ({ page }) => {
  await login(page, 'ines');
  await page.getByRole('link', { name: 'Console' }).click();
  await expect(page).toHaveURL(/\/console\/effective/);
  const users = page.getByTestId('users-table');
  await expect(users).toContainText('Hanna Schmidt');
  await expect(users).toContainText('Sven Berger');

  await users.getByRole('button', { name: /Sven Berger/ }).click();
  const eff = page.getByTestId('effective-card');
  await expect(eff).toContainText('crm:write');
  await page.getByTestId('whatif-action').selectOption('tool:crm.update_deal');
  await page.getByTestId('whatif-args').fill('{"tenant":"dach","deal_id":"d-1007","amount":80000}');
  await page.getByTestId('whatif-run').click();
  const result = page.getByTestId('whatif-result');
  await expect(result).toContainText('big-deals-need-approval');
  await expect(result).toContainText(/Freigabe nötig|Needs approval/);
  // Decided by Warden compiled to WebAssembly in the browser, and the server agrees.
  await expect(page.getByTestId('whatif-source')).toContainText(/WebAssembly/);
  await expect(page.getByTestId('whatif-source')).toContainText(/stimmt überein|agrees/);

  await page.getByRole('link', { name: /Connectors/ }).click();
  await expect(page.getByTestId('connector-card').first()).toBeVisible();
  expect(await page.getByTestId('connector-card').count()).toBeGreaterThan(3);
  await expect(page.getByTestId('connector-card').filter({ hasText: 'crm.update_deal' })).toBeVisible();
  await expect(page.getByTestId('connector-health').first()).toBeVisible();

  await page.getByRole('link', { name: /Benutzer & Rollen|Users & roles/ }).click();
  await expect(page.getByTestId('roles-table')).toContainText('it-admin');
});
