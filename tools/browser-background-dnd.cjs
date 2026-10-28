const { chromium } = require('playwright-core');
const fs = require('node:fs');
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

  const png = fs.readFileSync(path.resolve('build/icon.png')).toString('base64');
  const svg = fs.readFileSync(path.resolve('public/art/title-placeholder.svg')).toString('base64');

  // Drop a PNG directly on the title screen.
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const file = new File([bytes], 'dropped.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document
      .querySelector('.title-screen')
      ?.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, png);
  await page.waitForSelector('[data-bg-editor]');
  const editorTitle = await page.locator('.bg-editor h2').innerText();
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]')?.hasAttribute('disabled'));
  await page.click('[data-action="save"]');
  await page.waitForSelector('[data-bg-editor]', { state: 'detached' });
  const titlePhotoVisible = await page.locator('[data-bg-photo]').evaluate((el) => !el.hasAttribute('hidden'));

  // Select screen home button.
  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  const homeButton = await page.locator('.select-screen [data-action="title"]').count();
  await page.click('.select-screen [data-action="title"]');
  await page.waitForSelector('.title-screen');

  // Start AUTO, Esc pause, check layout.
  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  await page.click('[data-action="auto"]');
  await page.waitForFunction(() => (window.__maimaiDebug?.clock() ?? -1) > 300, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-overlay');
  const pauseLayout = await page.locator('.pause-actions').evaluate((el) => ({
    display: getComputedStyle(el).display,
    columns: getComputedStyle(el).gridTemplateColumns,
    width: getComputedStyle(document.querySelector('.pause-card')).width,
  }));
  await page.screenshot({ path: 'shots/pause-test-new.png' });

  // Drop an SVG on the gameplay window while paused.
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const file = new File([bytes], 'game-bg.svg', { type: 'image/svg+xml' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, svg);
  await page.waitForSelector('[data-bg-editor]');
  await page.waitForFunction(() => !document.querySelector('[data-action="save"]')?.hasAttribute('disabled'));
  await page.click('[data-action="save"]');
  await page.waitForSelector('[data-bg-editor]', { state: 'detached' });
  const pauseAfterDrop = await page.locator('.pause-overlay').count();
  await page.click('.pause-overlay [data-action="resume"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'shots/game-custom-bg-dnd.png' });

  console.log(
    JSON.stringify(
      { editorTitle, titlePhotoVisible, homeButton, pauseLayout, pauseAfterDrop, errors },
      null,
      2,
    ),
  );
  await browser.close();
  const ok =
    errors.length === 0 &&
    editorTitle.includes('主页面背景') &&
    titlePhotoVisible &&
    homeButton === 1 &&
    pauseLayout.display === 'grid' &&
    pauseAfterDrop === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
