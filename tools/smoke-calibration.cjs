/**
 * Calibration overlay smoke test: runs the metronome and applies a measured
 * input offset. Requires the Vite dev server.
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

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(300);
  await page.keyboard.press('s');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'settings-calibration.png') });

  await page.getByRole('button', { name: '开始校准' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'calibration-idle.png') });

  // Start the metronome, then tap on a 550ms grid until 12 taps are collected.
  await page.keyboard.press('Space');
  await page.waitForTimeout(1350);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(550);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'calibration-result.png') });
  const resultText = await page.locator('.calibration-result').innerText();
  const applyEnabled = await page.locator('[data-action="apply"]').isEnabled();

  if (applyEnabled) {
    await page.locator('[data-action="apply"]').click();
    await page.waitForTimeout(400);
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('maimai-key/settings/v1') ?? '{}'));
  await page.screenshot({ path: path.join(OUT, 'calibration-applied.png') });

  console.log(
    JSON.stringify(
      { resultText, applyEnabled, inputMs: stored?.offsets?.inputMs, errors },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(errors.length > 0 || !applyEnabled ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
