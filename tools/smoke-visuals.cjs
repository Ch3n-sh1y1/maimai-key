/**
 * Visual smoke for slide / touch notes using the ?seek= debug helper.
 * Requires the Vite dev server.
 */
const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const OUT = path.resolve(process.argv[2] || 'shots');
const BASE = process.env.SMOKE_URL || 'http://localhost:5173/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(`${BASE}?seek=23200`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="auto"]');
  await page.waitForFunction(() => (window.__maimaiDebug?.clock() ?? -1) >= 24050, null, { timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, 'slide.png') });
  const slideClock = await page.evaluate(() => window.__maimaiDebug?.clock() ?? null);

  await page.goto(`${BASE}?seek=24500`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.locator('.difficulty-tab').nth(2).click();
  await page.waitForTimeout(200);
  await page.click('[data-action="auto"]');
  await page.waitForFunction(() => (window.__maimaiDebug?.clock() ?? -1) >= 26900, null, { timeout: 20000 });
  await page.screenshot({ path: path.join(OUT, 'touch.png') });
  const touchClock = await page.evaluate(() => window.__maimaiDebug?.clock() ?? null);

  console.log(JSON.stringify({ slideClock, touchClock, errors }, null, 2));
  await browser.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
