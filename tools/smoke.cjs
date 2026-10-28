/**
 * Headless smoke test for the browser build.
 *
 * Usage: node tools/smoke.cjs [outDir]
 * Requires the Vite dev server on http://localhost:5173.
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
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '01-title.png') });

  await page.click('[data-action="start"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '02-select.png') });

  await page.click('[data-action="play"]');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, '03-play-start.png') });

  // Play some keys while the chart runs (notes begin around 12.8s).
  await page.waitForTimeout(11500);
  const statsBefore = await page.evaluate(() => window.__maimaiDebug?.stats() ?? null);
  await page.screenshot({ path: path.join(OUT, '04-play-notes.png') });

  for (const key of ['a', 's', 'd', 'f', 'j', 'k', 'l']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(800);
  const statsAfter = await page.evaluate(() => window.__maimaiDebug?.stats() ?? null);
  await page.screenshot({ path: path.join(OUT, '05-play-hit.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '06-pause.png') });

  console.log(JSON.stringify({ statsBefore, statsAfter, errors }, null, 2));
  await browser.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
