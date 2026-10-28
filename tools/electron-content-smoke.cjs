/**
 * Verifies that an extra content root (MAIMAI_CONTENT_DIR) is merged into the
 * song list. Runs against the source Electron app with dist/ already built.
 *
 * Usage: node tools/electron-content-smoke.cjs
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const userRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-content-'));
  const starter = path.resolve('public/content/starter');
  const target = path.join(userRoot, 'userpack');
  fs.cpSync(starter, target, { recursive: true });
  const manifestPath = path.join(target, 'pack.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.id = 'userpack';
  manifest.title = 'User Pack';
  manifest.artist = 'Local';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(userRoot, 'index.json'), JSON.stringify({ schema: 1, packs: ['userpack'] }));

  const env = { ...process.env, MAIMAI_CONTENT_DIR: userRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1600);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(700);
  const titles = await page.locator('.song-card h3').allInnerTexts();
  const stored = await page.evaluate(() => document.querySelectorAll('.song-card').length);
  const jackets = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.jacket img')).map((img) => img.naturalWidth),
  );

  console.log(JSON.stringify({ titles, stored, jackets, errors }, null, 2));
  await app.close();
  fs.rmSync(userRoot, { recursive: true, force: true });
  process.exit(errors.length === 0 && titles.includes('User Pack') && jackets.length >= 2 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
