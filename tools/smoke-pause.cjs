/**
 * Verifies pause / resume keeps the chart clock frozen and then continues.
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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="play"]');
  await page.waitForTimeout(3000);

  const clock = () => page.evaluate(() => window.__maimaiDebug?.clock() ?? null);
  const t1 = await clock();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const pausedVisible = await page.locator('.pause-overlay').count();
  await page.screenshot({ path: path.join(OUT, 'pause-test.png') });
  const t2 = await clock();
  await page.waitForTimeout(700);
  const t3 = await clock();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  const t4 = await clock();
  const stats = await page.evaluate(() => window.__maimaiDebug?.stats() ?? null);

  const frozen = Math.abs(t3 - t2) < 30;
  const advanced = t4 - t3;
  console.log(
    JSON.stringify(
      { t1, t2, t3, t4, frozen, pauseAdvanceMs: Math.round(advanced), pausedVisible, stats, errors },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(errors.length > 0 || !frozen ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
