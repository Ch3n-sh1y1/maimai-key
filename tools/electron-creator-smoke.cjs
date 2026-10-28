/**
 * End-to-end test for the in-app audio-to-chart studio.
 * Uses the placeholder WAV, generates four difficulties, saves them into a
 * temporary user content root and verifies the new pack shows up in select.
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-creator-'));
  const contentRoot = path.join(base, 'content');
  fs.mkdirSync(contentRoot, { recursive: true });
  const audio = path.resolve('public/content/starter/audio/neon-drift.wav');
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
  await page.waitForTimeout(400);
  await page.setInputFiles('[data-file]', audio);
  await page.fill('[data-title]', 'Auto Test Song');
  await page.click('[data-action="generate"]');
  await page.waitForSelector('.creator-tabs button', { timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('.creator-tabs button').length === 4, null, {
    timeout: 30000,
  });
  const stats = await page.locator('[data-stats]').innerText();
  const tabs = await page.locator('.creator-tabs button').allInnerTexts();
  const editorLength = await page.locator('[data-editor]').inputValue();
  await page.screenshot({ path: path.resolve('shots/creator-preview.png') });

  await page.click('[data-action="save"]');
  await page.waitForSelector('.select-screen', { timeout: 30000 });
  await page.waitForTimeout(800);
  const titles = await page.locator('.song-card h3').allInnerTexts();
  await page.screenshot({ path: path.resolve('shots/creator-saved.png') });

  const packDirs = fs
    .readdirSync(contentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
  const packDir = packDirs[0];
  const manifest = packDir
    ? JSON.parse(fs.readFileSync(path.join(contentRoot, packDir, 'pack.json'), 'utf8'))
    : null;
  const chartFiles = packDir
    ? fs.readdirSync(path.join(contentRoot, packDir, 'charts'))
    : [];

  console.log(
    JSON.stringify(
      {
        stats,
        tabs,
        editorLength: editorLength.length,
        titles,
        packDirs,
        difficulties: manifest?.difficulties,
        chartFiles,
        errors,
      },
      null,
      2,
    ),
  );
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  const ok =
    errors.length === 0 &&
    tabs.length === 4 &&
    titles.includes('Auto Test Song') &&
    manifest?.difficulties?.length === 4 &&
    chartFiles.length === 4;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
