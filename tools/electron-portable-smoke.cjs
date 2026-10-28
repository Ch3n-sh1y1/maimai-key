const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-portable-'));
  const portable = path.join(base, 'portable');
  fs.mkdirSync(portable, { recursive: true });
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: portable };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.MAIMAI_CONTENT_DIR;
  delete env.MAIMAI_USER_DATA_DIR;
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  await page.waitForSelector('.title-screen', { timeout: 15000 });
  const userRoot = await page.evaluate(() => window.maimai.userRoot());
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const version = await page.locator('.footnote').innerText();
  console.log(JSON.stringify({ userRoot, userData, version }, null, 2));
  await app.close();
  const contentSeed = fs.existsSync(path.join(portable, 'content', 'starter', 'pack.json'));
  fs.rmSync(base, { recursive: true, force: true });
  const ok =
    path.resolve(userRoot) === path.join(portable, 'content') &&
    path.resolve(userData) === path.join(portable, 'user-data') &&
    contentSeed &&
    version.startsWith('v');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
