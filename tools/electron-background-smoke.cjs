/**
 * Packaged background/pause smoke:
 * - HEIC -> crop editor -> save -> title background
 * - reload -> background persisted
 * - AUTO start -> Esc pause -> pause panel
 * - pause menu returns to the title page
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-bg-'));
  const contentRoot = path.join(base, 'content');
  fs.mkdirSync(contentRoot, { recursive: true });
  const env = { ...process.env, MAIMAI_CONTENT_DIR: contentRoot, MAIMAI_USER_DATA_DIR: path.join(base, 'user-data') };
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
  await page.waitForTimeout(1500);

  const heic = path.join(os.tmpdir(), 'maimai-image-formats', 'sample.heic');
  await page.click('[data-action="background"]');
  await page.waitForSelector('[data-bg-editor]');
  await page.setInputFiles('[data-bg-file]', heic);
  await page.waitForFunction(
    () => !document.querySelector('[data-action="save"]')?.hasAttribute('disabled'),
    null,
    { timeout: 30000 },
  );
  const heicNote = await page.locator('[data-bg-note]').innerText();
  await page.click('[data-action="save"]');
  await page.waitForSelector('[data-bg-editor]', { state: 'detached', timeout: 30000 });
  const titlePhoto = await page.locator('[data-bg-photo]').evaluate((el) => !el.hasAttribute('hidden'));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const persisted = await page.locator('[data-bg-photo]').evaluate((el) => !el.hasAttribute('hidden'));

  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  await page.click('[data-action="auto"]');
  await page.waitForFunction(() => (window.__maimaiDebug?.clock() ?? -1) > 300, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.pause-overlay');
  const pauseText = await page.locator('.pause-card').innerText();
  await page.screenshot({ path: path.resolve('shots/packaged-pause.png') });

  await page.click('.pause-overlay [data-action="home"]');
  await page.waitForSelector('.title-screen');
  const homeFromPause = await page.locator('.title-screen').count();

  console.log(
    JSON.stringify(
      { heicNote, titlePhoto, persisted, pauseText, homeFromPause, errors },
      null,
      2,
    ),
  );
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  const ok =
    errors.length === 0 &&
    heicNote.includes('1440×960') &&
    titlePhoto &&
    persisted &&
    pauseText.includes('返回主页面') &&
    homeFromPause === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
