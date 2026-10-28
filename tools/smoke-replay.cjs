/**
 * End-to-end replay test: plays a short section, finishes, saves a replay and
 * plays it back. Requires the Vite dev server.
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
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(`${BASE}?seek=65000`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="play"]');
  await page.waitForTimeout(1800);
  for (const key of ['a', 's', 'd', 'f', 'j', 'k', 'l', ';']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(800);
  for (const key of ['j', 'k', 'a', 's']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(90);
  }

  await page.waitForSelector('.result-screen', { timeout: 45000 });
  const resultText = await page.locator('.result-card').innerText();
  const replayButton = await page.locator('[data-action="replay"]').count();
  const stored = await page.evaluate(() => ({
    replays: JSON.parse(localStorage.getItem('maimai-key/replays/v1') ?? '[]').length,
    scores: JSON.parse(localStorage.getItem('maimai-key/scores/v1') ?? '{}'),
  }));
  await page.screenshot({ path: path.join(OUT, 'replay-result.png') });

  let replayStarted = false;
  if (replayButton > 0) {
    await page.click('[data-action="replay"]');
    await page.waitForTimeout(2600);
    replayStarted = await page.evaluate(() => Boolean(window.__maimaiDebug));
    await page.screenshot({ path: path.join(OUT, 'replay-playing.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  console.log(JSON.stringify({ replayButton, replayStarted, stored, resultText, errors }, null, 2));
  await browser.close();
  process.exit(errors.length > 0 || replayButton === 0 || !replayStarted ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
