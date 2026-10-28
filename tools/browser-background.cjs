const { chromium } = require('playwright-core');
const path = require('node:path');

const BASE = 'http://localhost:5173/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function main() {
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
  await page.waitForTimeout(700);

  // Title background: choose PNG, zoom, save.
  await page.click('[data-action="background"]');
  await page.waitForSelector('[data-bg-editor]');
  await page.setInputFiles('[data-bg-file]', path.resolve('build/icon.png'));
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]')?.hasAttribute('disabled'));
  await page.locator('[data-bg-zoom]').fill('160');
  await page.locator('[data-bg-zoom]').dispatchEvent('input');
  await page.screenshot({ path: 'shots/bg-editor.png' });
  await page.click('[data-action="save"]');
  await page.waitForSelector('[data-bg-editor]', { state: 'detached' });
  const titlePhoto = await page.locator('[data-bg-photo]').evaluate((el) => ({
    hidden: el.hasAttribute('hidden'),
    image: getComputedStyle(el).backgroundImage,
  }));
  await page.screenshot({ path: 'shots/title-custom-bg.png' });

  // Reload: the rendered background must survive.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  const persisted = await page.locator('[data-bg-photo]').evaluate((el) => !el.hasAttribute('hidden'));

  // Select -> home button.
  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  await page.click('.select-screen [data-action="title"]');
  await page.waitForSelector('.title-screen');
  const homeButtonWorked = await page.locator('.title-screen').count();

  // Start AUTO, Escape pause/resume.
  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  await page.click('[data-action="auto"]');
  await page.waitForFunction(() => (window.__maimaiDebug?.clock() ?? -1) > 300, null, { timeout: 15000 });
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-overlay', { timeout: 5000 });
  const pausedText = await page.locator('.pause-card').innerText();
  await page.screenshot({ path: 'shots/pause-test.png' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-overlay', { state: 'detached', timeout: 5000 });

  // Pause menu -> return to main page.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-overlay');
  await page.click('.pause-overlay [data-action="home"]');
  await page.waitForSelector('.title-screen');
  const homeFromPause = await page.locator('.title-screen').count();

  console.log(
    JSON.stringify(
      { titlePhoto, persisted, homeButtonWorked, pausedText, homeFromPause, errors },
      null,
      2,
    ),
  );
  await browser.close();
  const ok =
    errors.length === 0 &&
    !titlePhoto.hidden &&
    titlePhoto.image.includes('blob:') &&
    persisted &&
    homeButtonWorked === 1 &&
    pausedText.includes('返回主页面') &&
    homeFromPause === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
