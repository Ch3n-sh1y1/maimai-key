/**
 * A ZIP containing only a DRM cache (NCM) must fail gracefully with a clear
 * .failed message instead of crashing or creating a broken pack.
 */
const { _electron: electron } = require('playwright-core');
const AdmZip = require('adm-zip');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-drm-'));
  const contentRoot = path.join(base, 'content');
  fs.mkdirSync(contentRoot, { recursive: true });
  const src = path.join(base, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(src, 'maidata.txt'),
    '&title=DRM Song\n&artist=Nobody\n&inote_1=(120){4}1,2,3,4\n',
    'utf8',
  );
  fs.writeFileSync(path.join(src, 'song.ncm'), Buffer.concat([Buffer.from('CTENFDAM'), Buffer.alloc(128)]));
  const zip = new AdmZip();
  zip.addLocalFolder(src, 'drm-song');
  zip.writeZip(path.join(contentRoot, 'drm-song.zip'));

  const env = { ...process.env, MAIMAI_CONTENT_DIR: contentRoot };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.PACKAGED_EXE;
  const app = packaged
    ? await electron.launch({ executablePath: path.resolve(packaged), args: [], env })
    : await electron.launch({ args: ['.'], cwd: process.cwd(), env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2200);
  const failedDir = path.join(contentRoot, '.failed');
  const failedFiles = fs.existsSync(failedDir) ? fs.readdirSync(failedDir) : [];
  const failedText = failedFiles.length
    ? fs.readFileSync(path.join(failedDir, failedFiles[0]), 'utf8')
    : '';
  const packDirs = fs
    .readdirSync(contentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
  const remainingZip = fs.existsSync(path.join(contentRoot, 'drm-song.zip'));
  await page.click('[data-action="start"]');
  await page.waitForTimeout(500);
  const titles = await page.locator('.song-card h3').allInnerTexts();
  console.log(JSON.stringify({ failedFiles, failedText, packDirs, remainingZip, titles, errors }, null, 2));
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(
    errors.length === 0 &&
      failedText.includes('网易云') &&
      failedText.includes('不解密') &&
      !packDirs.includes('drm-song') &&
      remainingZip
      ? 0
      : 1,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
