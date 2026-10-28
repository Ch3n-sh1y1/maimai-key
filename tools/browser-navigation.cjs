const { chromium } = require('playwright-core');

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

  // Select: home is the top-left control.
  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  const selectNav = await page.locator('.select-screen .nav-pill').first().evaluate((el) => ({
    text: el.textContent,
    rect: el.getBoundingClientRect().toJSON(),
  }));
  await page.screenshot({ path: 'shots/nav-select.png' });
  await page.click('.select-screen [data-action="title"]');
  await page.waitForSelector('.title-screen');

  // Settings: back is the top-left control.
  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  await page.click('.select-screen [data-action="settings"]');
  await page.waitForSelector('.settings-screen');
  const settingsNav = await page.locator('.settings-screen .nav-pill').first().evaluate((el) => ({
    text: el.textContent,
    rect: el.getBoundingClientRect().toJSON(),
  }));
  await page.screenshot({ path: 'shots/nav-settings.png' });
  await page.click('.settings-screen [data-action="back"]');
  await page.waitForSelector('.select-screen');

  // Creator: back is the top-left control.
  await page.click('.select-screen [data-action="creator"]');
  await page.waitForSelector('.creator-screen');
  const creatorNav = await page.locator('.creator-screen .nav-pill').first().evaluate((el) => ({
    text: el.textContent,
    rect: el.getBoundingClientRect().toJSON(),
  }));
  await page.screenshot({ path: 'shots/nav-creator.png' });
  await page.click('.creator-screen [data-action="back"]');
  await page.waitForSelector('.select-screen');

  // Gameplay: pause button top-left, score HUD below it.
  await page.click('[data-action="auto"]');
  await page.waitForFunction(() => (window.__maimaiDebug?.clock() ?? -1) > 350, null, { timeout: 15000 });
  const pauseRect = await page.locator('.game-pause-button').evaluate((el) => el.getBoundingClientRect().toJSON());
  await page.screenshot({ path: 'shots/nav-game.png' });
  await page.click('.game-pause-button');
  await page.waitForSelector('.pause-overlay');
  const paused = await page.locator('.pause-card').count();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-overlay', { state: 'detached' });

  console.log(
    JSON.stringify({ selectNav, settingsNav, creatorNav, pauseRect, paused, errors }, null, 2),
  );
  await browser.close();
  const topLeft = (rect) => rect.left < 120 && rect.top < 120;
  const ok =
    errors.length === 0 &&
    selectNav.text.includes('主页') &&
    settingsNav.text.includes('返回') &&
    creatorNav.text.includes('返回') &&
    topLeft(selectNav.rect) &&
    topLeft(settingsNav.rect) &&
    topLeft(creatorNav.rect) &&
    topLeft(pauseRect) &&
    paused === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
