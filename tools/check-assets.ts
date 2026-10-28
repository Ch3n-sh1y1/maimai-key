/**
 * Content integrity + asset policy check.
 *
 * - every pack referenced by index.json exists and its files are present;
 * - every chart parses without fatal errors (warnings are reported);
 * - bundled media uses only permitted container types;
 * - no executable/script files are shipped inside content directories.
 *
 * Run: pnpm check:assets
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { parseSimai } from '../src/core/simai';

const ROOT = process.cwd();
const CONTENT_DIRS = ['public/content', 'dist/content'].filter((dir) => existsSync(join(ROOT, dir)));
const ALLOWED = new Set(['.json', '.simai', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.wav', '.ogg', '.mp3']);
const DANGEROUS = new Set(['.js', '.mjs', '.cjs', '.ts', '.exe', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.html', '.htm']);

let failures = 0;
let warnings = 0;

function fail(message: string): void {
  failures++;
  console.error(`✗ ${message}`);
}

function warn(message: string): void {
  warnings++;
  console.warn(`! ${message}`);
}

function walk(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

for (const contentDir of CONTENT_DIRS) {
  const absolute = join(ROOT, contentDir);
  console.log(`\n[content] ${contentDir}`);
  const index = JSON.parse(readFileSync(join(absolute, 'index.json'), 'utf8')) as { packs?: string[] };
  const packs = index.packs ?? [];
  if (packs.length === 0) fail(`${contentDir}/index.json lists no packs`);

  for (const packId of packs) {
    const packDir = join(absolute, packId);
    const manifestPath = join(packDir, 'pack.json');
    if (!existsSync(manifestPath)) {
      fail(`${packId}: pack.json missing`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      id?: string;
      audio?: string;
      jacket?: string;
      difficulties?: Array<{ chart?: string }>;
    };
    if (manifest.id !== packId) fail(`${packId}: pack.json id mismatch (${manifest.id})`);
    if (!manifest.audio || !existsSync(join(packDir, manifest.audio))) {
      fail(`${packId}: audio file missing`);
    }

    for (const difficulty of manifest.difficulties ?? []) {
      if (!difficulty.chart) {
        fail(`${packId}: difficulty without chart path`);
        continue;
      }
      const chartPath = join(packDir, difficulty.chart);
      if (!existsSync(chartPath)) {
        fail(`${packId}: chart missing ${difficulty.chart}`);
        continue;
      }
      const parsed = parseSimai(readFileSync(chartPath, 'utf8'), { bpm: 120 });
      if (parsed.chart.notes.length === 0) fail(`${packId}/${difficulty.chart}: no notes parsed`);
      if (parsed.warnings.length > 0) {
        warn(`${packId}/${difficulty.chart}: ${parsed.warnings.length} parser warning(s)`);
      }
      console.log(`  ${packId}/${difficulty.chart}: ${parsed.chart.notes.length} notes`);
    }

    for (const file of walk(packDir)) {
      const ext = extname(file).toLowerCase();
      if (DANGEROUS.has(ext)) fail(`unexpected executable content: ${relative(ROOT, file)}`);
      else if (!ALLOWED.has(ext)) warn(`unreviewed file type in content: ${relative(ROOT, file)}`);
    }
  }
}

console.log(`\n${failures === 0 ? 'OK' : 'FAILED'}: ${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures === 0 ? 0 : 1);
