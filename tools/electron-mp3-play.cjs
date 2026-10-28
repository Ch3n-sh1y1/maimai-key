/**
 * Converts a short MP3 into a chart in CHART LAB, saves it and plays it in AUTO.
 * Uses %TEMP%/maimai-audio-samples/sample.mp3.
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const mp3 = path.join(os.tmpdir(), 'maimai-audio-samples', 'sample.mp3');
  if (!fs.existsSync(mp3)) throw new Error(`missing sample: ${mp3}`);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-mp3-'));
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
  await page.waitForTimeout(1200);
  await page.click('[data-action="creator"]');
  await page.setInputFiles('[data-file]', mp3);
  await page.fill('[data-title]', 'MP3 Test');
  await page.click('[data-action="generate"]');
  await page.waitForFunction(
    () => (document.querySelector('[data-status]')?.textContent ?? '').includes('完成：'),
    null,
    { timeout: 60000 },
  );
  const stats = await page.locator('[data-stats]').innerText();
  await page.click('[data-action="save"]');
  await page.waitForSelector('.select-screen', { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator('.song-card', { hasText: 'MP3 Test' }).first().click();
  await page.click('[data-action="auto"]');
  await page.waitForSelector('.result-screen', { timeout: 30000 });
  const grade = await page.locator('.grade').innerText();
  const result = await page.locator('.result-card').innerText();
  console.log(JSON.stringify({ stats, grade, result, errors }, null, 2));
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(errors.length === 0 && grade === 'SSS+' ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
