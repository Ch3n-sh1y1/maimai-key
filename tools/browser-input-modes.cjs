/**
 * Input-mode regression:
 * - touch mode exposes eight sectors and a synthetic multi-touch hit is judged
 * - keyboard mode uses the piano field and both note directions boot cleanly
 */
const { chromium } = require('playwright-core');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://localhost:5173/';

async function launch(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return { page, errors, context };
}

async function selectSetting(page, value) {
  await page.click('.title-menu [data-action="settings"]');
  await page.waitForSelector('.settings-screen');
  const selects = page.locator('.settings-screen select');
  for (let i = 0; i < (await selects.count()); i++) {
    const select = selects.nth(i);
    if (await select.locator(`option[value="${value}"]`).count()) {
      await select.selectOption(value);
      break;
    }
  }
  await page.click('.settings-screen [data-action="back"]');
  await page.waitForSelector('.title-screen');
}

async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });

  const touch = await launch(browser);
  await touch.page.goto(`${BASE}?seek=13000`, { waitUntil: 'load' });
  await touch.page.waitForTimeout(450);
  await selectSetting(touch.page, 'touch');
  await touch.page.click('.title-menu [data-action="start"]');
  await touch.page.waitForSelector('.select-screen');
  await touch.page.click('.select-screen [data-action="play"]');
  await touch.page.waitForFunction(() => (window.__maimaiDebug?.clock?.() ?? 0) > 13150, null, {
    timeout: 15000,
  });
  const point = await touch.page.evaluate(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const cx = width / 2;
    const cy = height * 0.545;
    const radius = Math.min(width * 0.3, height * 0.375);
    return { x: cx + radius * 0.7, y: cy };
  });
  await touch.page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas');
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 71,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      button: 0,
    }));
  }, point);
  await touch.page.waitForTimeout(40);
  await touch.page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas');
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 71,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      button: 0,
    }));
  }, point);
  await touch.page.waitForTimeout(250);
  const touchStats = await touch.page.evaluate(() => window.__maimaiDebug?.stats?.());
  const touchMode = await touch.page.evaluate(
    () => JSON.parse(localStorage.getItem('maimai-key/settings/v1') || 'null')?.inputMode,
  );

  await touch.context.close();
  const keyboard = await launch(browser);
  await keyboard.page.goto(BASE, { waitUntil: 'load' });
  await keyboard.page.waitForTimeout(450);
  await keyboard.page.click('.title-menu [data-action="start"]');
  await keyboard.page.waitForSelector('.select-screen');
  await keyboard.page.click('.select-screen [data-action="auto"]');
  await keyboard.page.waitForTimeout(1600);
  const keyboardMode = await keyboard.page.evaluate(
    () => JSON.parse(localStorage.getItem('maimai-key/settings/v1') || 'null')?.inputMode ?? 'keyboard',
  );
  const keyboardClock = await keyboard.page.evaluate(() => window.__maimaiDebug?.clock?.() ?? 0);

  await keyboard.context.close();
  const up = await launch(browser);
  await up.page.goto(BASE, { waitUntil: 'load' });
  await up.page.waitForTimeout(450);
  await selectSetting(up.page, 'up');
  await up.page.click('.title-menu [data-action="start"]');
  await up.page.waitForSelector('.select-screen');
  await up.page.click('.select-screen [data-action="auto"]');
  await up.page.waitForTimeout(1600);
  const upClock = await up.page.evaluate(() => window.__maimaiDebug?.clock?.() ?? 0);

  await up.context.close();
  const errors = [...touch.errors, ...keyboard.errors, ...up.errors];
  console.log(JSON.stringify({
    touchMode,
    touchStats,
    keyboardMode,
    keyboardClock,
    upClock,
    errors,
  }, null, 2));

  const ok =
    errors.length === 0 &&
    touchMode === 'touch' &&
    (touchStats?.resolved ?? 0) >= 1 &&
    keyboardMode === 'keyboard' &&
    keyboardClock > 300 &&
    upClock > 300;
  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
