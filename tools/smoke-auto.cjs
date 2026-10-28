/**
 * AUTO-mode end-to-end run against the production build (vite preview).
 * Verifies the full loop reaches the result screen.
 */
const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const OUT = path.resolve(process.argv[2] || 'shots');
const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
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
  await page.waitForTimeout(400);
  await page.click('[data-action="auto"]');
  await page.waitForTimeout(14000);
  await page.screenshot({ path: path.join(OUT, 'auto-play.png') });
  const midStats = await page.evaluate(() => window.__maimaiDebug?.stats() ?? null);

  await page.waitForSelector('.result-screen', { timeout: 150000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'result.png') });
  const resultText = await page.locator('.result-card').innerText();
  const grade = await page.locator('.grade').innerText();
  const achievement = await page.locator('.result-score strong').innerText();

  console.log(JSON.stringify({ midStats, grade, achievement, resultText, errors }, null, 2));
  await browser.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
