/**
 * Drop-in import smoke test.
 *
 * Creates two ZIPs in a temporary content root (a ready-made pack and a
 * maidata community pack), launches Electron with MAIMAI_CONTENT_DIR, and
 * verifies that both appear in the song list without editing index.json.
 */
const { _electron: electron } = require('playwright-core');
const AdmZip = require('adm-zip');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-drop-'));
  const root = path.join(base, 'content');
  fs.mkdirSync(root, { recursive: true });
  const starter = path.resolve('public/content/starter');

  // 1. Ready-made pack ZIP with a wrapper folder.
  const packSrc = path.join(base, 'pack-a-src');
  fs.cpSync(starter, packSrc, { recursive: true });
  const manifestPath = path.join(packSrc, 'pack.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.id = 'pack-a';
  manifest.title = 'Pack A';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const packZip = new AdmZip();
  packZip.addLocalFolder(packSrc, 'pack-a');
  packZip.writeZip(path.join(root, 'pack-a.zip'));

  // 2. Community maidata ZIP.
  const community = path.join(base, 'community-src');
  fs.mkdirSync(community, { recursive: true });
  fs.writeFileSync(
    path.join(community, 'maidata.txt'),
    [
      '&title=Community Song',
      '&artist=Local',
      '&first=0',
      '&wholebpm=120',
      '&lv_1=3',
      '&inote_1=(120){4}1,2,3,4,5,6,7,8',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.copyFileSync(
    path.resolve('public/content/starter/audio/neon-drift.wav'),
    path.join(community, 'track.wav'),
  );
  const communityZip = new AdmZip();
  communityZip.addLocalFolder(community, 'community');
  communityZip.writeZip(path.join(root, 'community.zip'));

  const env = { ...process.env, MAIMAI_CONTENT_DIR: root };
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
  await page.waitForTimeout(2500);
  await page.click('[data-action="start"]');
  await page.waitForTimeout(1000);
  const titles = await page.locator('.song-card h3').allInnerTexts();
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
  const remainingZips = fs.readdirSync(root).filter((name) => name.endsWith('.zip'));
  const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
  await page.screenshot({ path: path.resolve('shots/drop-import.png') });

  console.log(JSON.stringify({ titles, dirs, remainingZips, index, errors }, null, 2));
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  const ok =
    errors.length === 0 &&
    titles.includes('Pack A') &&
    titles.includes('Community Song') &&
    titles.includes('Neon Drift') &&
    remainingZips.length === 0;
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
