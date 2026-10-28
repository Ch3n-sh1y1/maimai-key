/**
 * Electron smoke test: launches the packaged-style app shell (dist/) and
 * verifies the content IPC bridge works.
 *
 * Usage: node tools/electron-smoke.cjs
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const OUT = path.resolve(process.argv[2] || 'shots');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'electron-title.png') });

  await page.click('[data-action="start"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'electron-select.png') });
  const title = await page.locator('.song-card h3').first().innerText();
  const bridge = await page.evaluate(() => Boolean(window.maimai));

  console.log(JSON.stringify({ title, bridge, errors }, null, 2));
  await app.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
