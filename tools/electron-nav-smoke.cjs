const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-nav-'));
  const contentRoot = path.join(base, 'content');
  fs.mkdirSync(contentRoot, { recursive: true });
  const env = { ...process.env, MAIMAI_CONTENT_DIR: contentRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.PACKAGED_EXE;
  const app = packaged
    ? await electron.launch({ executablePath: path.resolve(packaged), args: [], env })
    : await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1400);

  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  const selectNav = await page.locator('.select-screen .nav-pill').first().evaluate((el) => ({
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    rect: el.getBoundingClientRect().toJSON(),
  }));
  await page.click('.select-screen [data-action="title"]');
  await page.waitForSelector('.title-screen');

  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  await page.click('.select-screen [data-action="settings"]');
  await page.waitForSelector('.settings-screen');
  const settingsNav = await page.locator('.settings-screen .nav-pill').first().evaluate((el) => ({
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    rect: el.getBoundingClientRect().toJSON(),
  }));
  await page.click('.settings-screen [data-action="back"]');
  await page.waitForSelector('.select-screen');

  await page.click('.select-screen [data-action="creator"]');
  await page.waitForSelector('.creator-screen');
  const creatorNav = await page.locator('.creator-screen .nav-pill').first().evaluate((el) => ({
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    rect: el.getBoundingClientRect().toJSON(),
  }));
  await page.click('.creator-screen [data-action="back"]');
  await page.waitForSelector('.select-screen');

  await page.click('[data-action="auto"]');
  await page.waitForFunction(() => (window.__maimaiDebug?.clock() ?? -1) > 350, null, { timeout: 15000 });
  const pauseNav = await page.locator('.game-pause-button').evaluate((el) => ({
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    rect: el.getBoundingClientRect().toJSON(),
  }));
  await page.click('.game-pause-button');
  await page.waitForSelector('.pause-overlay');
  const overlay = await page.locator('.pause-card').innerText();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-overlay', { state: 'detached' });

  console.log(JSON.stringify({ selectNav, settingsNav, creatorNav, pauseNav, overlay, errors }, null, 2));
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  const topLeft = (rect) => rect.left < 120 && rect.top < 120;
  const ok =
    errors.length === 0 &&
    selectNav.text.includes('主页') &&
    settingsNav.text.includes('返回') &&
    creatorNav.text.includes('返回') &&
    pauseNav.text.includes('暂停') &&
    topLeft(selectNav.rect) &&
    topLeft(settingsNav.rect) &&
    topLeft(creatorNav.rect) &&
    topLeft(pauseNav.rect) &&
    overlay.includes('已暂停');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
