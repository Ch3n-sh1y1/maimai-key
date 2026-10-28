/**
 * Electron hardening smoke:
 * - a malformed pack is skipped, valid packs still load
 * - modal shortcuts do not leak to the title page
 * - HTML file drop does not navigate
 * - external window.open is denied
 * - F11 fullscreen state is reflected in settings
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-hardening-'));
  const contentRoot = path.join(base, 'content');
  fs.mkdirSync(path.join(contentRoot, 'broken'), { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, 'broken', 'pack.json'),
    JSON.stringify({
      schema: 2,
      id: 'broken',
      title: 'Broken Pack',
      artist: 'n/a',
      charter: 'n/a',
      bpm: 120,
      audioOffsetMs: 0,
      audio: 'audio/track.wav',
      difficulties: [{ name: 'Basic', level: 1, chart: 'charts/basic.simai' }],
    }),
  );
  const env = { ...process.env, MAIMAI_CONTENT_DIR: contentRoot, MAIMAI_USER_DATA_DIR: path.join(base, 'user-data') };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const packaged = process.env.PACKAGED_EXE;
  const app = packaged
    ? await electron.launch({ executablePath: path.resolve(packaged), args: [], env })
    : await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  const appInfo = await app.evaluate(({ app }) => ({ appPath: app.getAppPath(), version: app.getVersion(), exe: process.execPath }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.waitForSelector('.title-screen', { timeout: 15000 });

  await page.click('[data-action="background"]');
  await page.waitForSelector('[data-bg-editor]');
  for (const key of ['KeyS', 'KeyC', 'KeyB', 'KeyQ']) await page.keyboard.press(key);
  const modalStayed = {
    title: await page.locator('.title-screen').count(),
    settings: await page.locator('.settings-screen').count(),
    editor: await page.locator('[data-bg-editor]').count(),
  };
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-bg-editor]', { state: 'detached' });

  await page.click('[data-action="start"]');
  await page.waitForSelector('.select-screen');
  const issues = await page.locator('.content-issues').count();
  if (issues) await page.locator('.content-issues summary').click();
  const issueText = issues ? await page.locator('.content-issues').innerText() : '';
  const songs = await page.locator('.song-card').count();

  const dropPrevented = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<h1>bad</h1>'], 'bad.html', { type: 'text/html' }));
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await page.waitForTimeout(300);
  const urlAfterDrop = page.url();

  const opened = await page.evaluate(() => {
    const win = window.open('https://example.com/', '_blank');
    return win === null;
  });
  await page.waitForTimeout(300);
  const windowCount = app.windows().length;

  await page.click('.select-screen [data-action="settings"]');
  await page.waitForSelector('.settings-screen');
  const fullscreenCheckbox = page.locator('.settings-screen input.checkbox').last();
  const before = await fullscreenCheckbox.isChecked();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
  });
  await page.waitForTimeout(600);
  const isFullscreen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  const after = await fullscreenCheckbox.isChecked();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
  });
  await page.waitForTimeout(600);

  console.log(
    JSON.stringify(
      {
        appInfo,
        modalStayed,
        issues,
        issueText,
        songs,
        dropPrevented,
        urlAfterDrop,
        opened,
        windowCount,
        fullscreen: { before, isFullscreen, after },
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
    modalStayed.title === 1 &&
    modalStayed.settings === 0 &&
    modalStayed.editor === 1 &&
    issues === 1 &&
    issueText.includes('broken') &&
    songs >= 1 &&
    dropPrevented &&
    urlAfterDrop.startsWith('file:') &&
    opened &&
    windowCount === 1 &&
    isFullscreen === true &&
    after === true;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
