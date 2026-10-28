/**
 * Production builds must not expose DevTools. F12 / Ctrl+Shift+I / menu should
 * all be disabled; only source development mode keeps DevTools.
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-devtools-'));
  const contentRoot = path.join(base, 'content');
  fs.mkdirSync(contentRoot, { recursive: true });
  const env = { ...process.env, MAIMAI_CONTENT_DIR: contentRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.MAIMAI_DEVTOOLS;
  const packaged = process.env.PACKAGED_EXE;
  const app = packaged
    ? await electron.launch({ executablePath: path.resolve(packaged), args: [], env })
    : await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);

  const isOpen = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.isDevToolsOpened() ?? false);
  const menuIsNull = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null);

  const before = await isOpen();
  await page.keyboard.press('F12');
  await page.waitForTimeout(350);
  const afterF12 = await isOpen();
  await page.keyboard.press('Control+Shift+I');
  await page.waitForTimeout(350);
  const afterCtrlShiftI = await isOpen();
  const menuNull = await menuIsNull();

  console.log(JSON.stringify({ before, afterF12, afterCtrlShiftI, menuNull }, null, 2));
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(before === false && afterF12 === false && afterCtrlShiftI === false && menuNull ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
