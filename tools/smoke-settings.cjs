/**
 * Settings screen smoke test: opens settings, rebinds a key, verifies persistence.
 * Requires the Vite dev server (http://localhost:5173).
 */
const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const OUT = path.resolve(process.argv[2] || 'shots');
const URL = process.env.SMOKE_URL || 'http://localhost:5173/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('s');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'settings-1.png') });

  const bindings = page.locator('.key-binding');
  const before = await bindings.first().innerText();
  await bindings.first().click();
  await page.waitForTimeout(120);
  await page.keyboard.press('q');
  await page.waitForTimeout(500);
  const after = await bindings.first().innerText();
  await page.screenshot({ path: path.join(OUT, 'settings-2.png') });

  const stored = await page.evaluate(() => localStorage.getItem('maimai-key/settings/v1'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const heading = await page.locator('.brand').innerText();

  console.log(JSON.stringify({ before, after, persistedQ: stored?.includes('"KeyQ":1') ?? false, heading, errors }, null, 2));
  await browser.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
