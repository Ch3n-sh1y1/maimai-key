/**
 * Verifies CHART LAB decoding for MP3 / FLAC / M4A and the DRM-cache warning.
 * Samples are downloaded to %TEMP%/maimai-audio-samples by the caller.
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SAMPLES = path.join(os.tmpdir(), 'maimai-audio-samples');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-formats-'));
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
  await page.waitForTimeout(300);

  const results = [];
  for (const file of ['sample.mp3', 'sample.flac', 'sample.m4a']) {
    const full = path.join(SAMPLES, file);
    if (!fs.existsSync(full)) {
      results.push({ file, skipped: true });
      continue;
    }
    await page.setInputFiles('[data-file]', full);
    await page.fill('[data-title]', `Format ${file}`);
    await page.click('[data-action="generate"]');
    await page.waitForFunction(
      () => (document.querySelector('[data-status]')?.textContent ?? '').includes('完成：'),
      null,
      { timeout: 120000 },
    );
    const stats = await page.locator('[data-stats]').innerText();
    const tabs = await page.locator('.creator-tabs button').allInnerTexts();
    results.push({ file, stats, tabs });
  }

  // Fake NCM should be rejected with a platform-specific message.
  const fakeNcm = path.join(base, 'fake.ncm');
  fs.writeFileSync(fakeNcm, Buffer.concat([Buffer.from('CTENFDAM'), Buffer.alloc(64)]));
  await page.setInputFiles('[data-file]', fakeNcm);
  await page.waitForTimeout(300);
  const ncmMessage = await page.locator('[data-status]').innerText();
  await page.screenshot({ path: path.resolve('shots/audio-formats.png') });

  console.log(JSON.stringify({ results, ncmMessage, errors }, null, 2));
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  const ok =
    errors.length === 0 &&
    results.filter((item) => !item.skipped).every((item) => item.tabs?.length === 4) &&
    ncmMessage.includes('网易云') &&
    ncmMessage.includes('不解密');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
