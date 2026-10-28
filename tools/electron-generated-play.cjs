/**
 * Generates a short click-track WAV, runs it through the audio-to-chart studio,
 * saves the pack and plays the generated Basic chart in AUTO to completion.
 */
const { _electron: electron } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function writeClickTrack(filePath, seconds = 10, bpm = 150) {
  const sampleRate = 44100;
  const total = Math.floor(seconds * sampleRate);
  const samples = new Int16Array(total);
  const beat = 60 / bpm;
  for (let n = 0; n < Math.floor(seconds / beat); n++) {
    const start = Math.floor((0.8 + n * beat) * sampleRate);
    for (let i = 0; i < sampleRate * 0.07 && start + i < total; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 40);
      const value = Math.sin(2 * Math.PI * 880 * t) * envelope * 0.5;
      samples[start + i] = Math.max(-32767, Math.min(32767, Math.round(value * 32767)));
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.byteLength, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, Buffer.from(samples.buffer)]));
}

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-backing-'));
  const contentRoot = path.join(base, 'content');
  fs.mkdirSync(contentRoot, { recursive: true });
  const audio = path.join(base, 'click-track.wav');
  writeClickTrack(audio);
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
  await page.waitForTimeout(300);
  await page.setInputFiles('[data-file]', audio);
  await page.fill('[data-title]', 'Click Test');
  await page.click('[data-action="generate"]');
  await page.waitForFunction(() => document.querySelectorAll('.creator-tabs button').length === 4, null, {
    timeout: 60000,
  });
  const stats = await page.locator('[data-stats]').innerText();
  // Custom edit path: replace the Basic body before saving.
  await page.fill('[data-editor]', '(150){4}1,2,3,4,E');
  await page.click('[data-action="save"]');
  await page.waitForSelector('.select-screen', { timeout: 30000 });
  await page.waitForTimeout(500);
  const card = page.locator('.song-card', { hasText: 'Click Test' }).first();
  await card.click();
  await page.waitForTimeout(200);
  await page.click('[data-action="auto"]');
  await page.waitForSelector('.result-screen', { timeout: 45000 });
  const grade = await page.locator('.grade').innerText();
  const resultText = await page.locator('.result-card').innerText();
  const savedBody = fs.readFileSync(path.join(contentRoot, 'click-test', 'charts', 'level-1.simai'), 'utf8');
  await page.screenshot({ path: path.resolve('shots/generated-play.png') });

  console.log(JSON.stringify({ stats, grade, resultText, savedBody, errors }, null, 2));
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
  const ok =
    errors.length === 0 &&
    grade === 'SSS+' &&
    resultText.includes('Click Test') &&
    savedBody.includes('(150){4}1,2,3,4,E');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
