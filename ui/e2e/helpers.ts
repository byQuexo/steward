import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page } from '@playwright/test';

/** Storage state that pins the UI theme (the UI defaults to dark). */
export function themeState(theme: 'light' | 'dark') {
  const origin = new URL(process.env.STEWARD_URL ?? 'http://127.0.0.1:8000').origin;
  return { cookies: [], origins: [{ origin, localStorage: [{ name: 'steward.theme', value: theme === 'light' ? 'light' : 'dark' }] }] };
}

/** Dev login through the login screen (user cards). */
export async function login(page: Page, user: string) {
  await page.goto('/');
  await page.getByTestId(`login-${user}`).click();
  await expect(page.getByRole('navigation', { name: /Hauptnavigation|Main navigation/ })).toBeVisible();
}

export async function newUserPage(browser: Browser, user: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, user);
  return page;
}

export async function ask(page: Page, question: string) {
  const input = page.getByTestId('chat-input');
  await input.fill(question);
  await page.getByTestId('chat-send').click();
}

/** Run axe and fail on serious or critical violations (with a readable report). */
export async function expectNoSeriousA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const report = bad.map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.map((n) => `  - ${n.target.join(' ')}: ${n.failureSummary ?? ''}`).join('\n')}`).join('\n');
  expect(bad, `${label}\n${report}`).toEqual([]);
}
