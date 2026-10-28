/**
 * Captures the refreshed title/select/settings screens and the three HUD modes.
 * Requires the Vite dev server.
 */
const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const OUT = path.resolve('shots');
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
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'ui-title-new.png') });
  await page.click('[data-action="start"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'ui-select-new.png') });
  await page.keyboard.press('s');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'ui-settings-new.png') });
  await page.getByRole('button', { name: '专业', exact: true }).click();
  const storedPreset = await page.evaluate(() => JSON.parse(localStorage.getItem('maimai-key/settings/v1') ?? '{}').hudPreset);
  await page.close();

  for (const preset of ['beginner', 'normal', 'pro']) {
    const hudPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    hudPage.on('pageerror', (error) => errors.push(`hud pageerror: ${error.message}`));
    await hudPage.goto(BASE, { waitUntil: 'load' });
    await hudPage.evaluate((value) => {
      const key = 'maimai-key/settings/v1';
      const settings = JSON.parse(localStorage.getItem(key) ?? '{}');
      settings.hudPreset = value;
      settings.showKeyHints = true;
      settings.offsets = { audioMs: 0, inputMs: 0, visualMs: 0 };
      localStorage.setItem(key, JSON.stringify(settings));
    }, preset);
    await hudPage.goto(`${BASE}?seek=23200`, { waitUntil: 'load' });
    await hudPage.waitForTimeout(700);
    await hudPage.click('[data-action="start"]');
    await hudPage.waitForTimeout(300);
    await hudPage.click('[data-action="auto"]');
    await hudPage.waitForFunction(() => (window.__maimaiDebug?.clock() ?? -1) >= 24050, null, {
      timeout: 25000,
    });
    await hudPage.screenshot({ path: path.join(OUT, `hud-${preset}.png`) });
    await hudPage.close();
  }

  console.log(JSON.stringify({ storedPreset, errors }, null, 2));
  await browser.close();
  process.exit(errors.length === 0 && storedPreset === 'pro' ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
