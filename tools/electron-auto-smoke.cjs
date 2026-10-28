/**
 * Full AUTO playthrough against the packaged build, asserting the result screen.
 * Usage: PACKAGED_EXE=... node tools/electron-auto-smoke.cjs
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');

const EXE = path.resolve(process.env.PACKAGED_EXE || 'release/win-unpacked/MaimaiKey.exe');
const OUT = path.resolve(process.argv[2] || 'shots');

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
  await page.waitForTimeout(1500);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(500);
  await page.click('[data-action="auto"]');
  await page.waitForTimeout(12000);
  const mid = await page.evaluate(() => window.__maimaiDebug?.stats() ?? null);
  await page.waitForSelector('.result-screen', { timeout: 150000 });
  await page.waitForTimeout(400);
  const achievement = await page.locator('.result-score strong').innerText();
  const grade = await page.locator('.grade').innerText();
  const resultText = await page.locator('.result-card').innerText();
  await page.screenshot({ path: path.join(OUT, 'packaged-auto-result.png') });

  console.log(JSON.stringify({ mid, grade, achievement, resultText, errors }, null, 2));
  await app.close();
  process.exit(errors.length === 0 && grade === 'SSS+' ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
