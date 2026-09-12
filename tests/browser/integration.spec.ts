import { test, expect } from '@playwright/test';

test('production bundle boots without a wallet and never invents ledger state', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Private Counter' })).toBeVisible();
  await expect(page.locator('.counter-value')).toHaveText('—');
  for (const button of await page.getByRole('button', { name: 'Call', exact: true }).all()) await expect(button).toBeDisabled();
  await page.getByRole('button', { name: 'Connect Lace' }).click();
  await expect(page.getByRole('alert')).toContainText('not installed');
  expect(errors).toEqual([]);
});

test('rejects a wrong-network wallet before reading or transacting', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { midnight: { lace: { name: 'Lace', rdns: 'lace', connect: async () => ({
      getConnectionStatus: async () => ({ status: 'connected', networkId: 'preview' }),
    }) } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Lace' }).click();
  await expect(page.getByRole('alert')).toContainText('Network mismatch');
  await expect(page.locator('.counter-value')).toHaveText('—');
  await expect(page.locator('.tx-result')).toHaveCount(0);
});

test('serves the real compiled artifacts as binary assets', async ({ request }) => {
  for (const name of ['claim', 'increment', 'decrement']) {
    for (const path of [`keys/${name}.prover`, `keys/${name}.verifier`, `zkir/${name}.bzkir`]) {
      const result = await request.get(`/counter/${path}`);
      expect(result.ok()).toBeTruthy();
      expect(result.headers()['content-type']).not.toContain('text/html');
      expect((await result.body()).length).toBeGreaterThan(0);
    }
  }
});
