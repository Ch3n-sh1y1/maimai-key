/**
 * Smoke test for the packaged Windows build (release/win-unpacked).
 * Verifies the ASAR content bridge and that a chart starts rendering.
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const OUT = path.resolve(process.argv[2] || 'shots');
const EXE = path.resolve(process.env.PACKAGED_EXE || 'release/win-unpacked/MaimaiKey.exe');

async function main() {
  if (!fs.existsSync(EXE)) throw new Error(`packaged app not found: ${EXE}`);
  fs.mkdirSync(OUT, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: EXE, args: [], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'packaged-title.png') });

  await page.click('[data-action="start"]');
  await page.waitForTimeout(500);
  const title = await page.locator('.song-card h3').first().innerText();
  const bridge = await page.evaluate(() => Boolean(window.maimai));
  const bridgeIsFile = await page.evaluate(() => location.protocol);
  await page.screenshot({ path: path.join(OUT, 'packaged-select.png') });

  await page.click('[data-action="play"]');
  await page.waitForTimeout(3200);
  await page.screenshot({ path: path.join(OUT, 'packaged-play.png') });
  const debug = await page.evaluate(() => window.__maimaiDebug?.stats() ?? null);

  console.log(JSON.stringify({ title, bridge, bridgeIsFile, debug, errors }, null, 2));
  await app.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
