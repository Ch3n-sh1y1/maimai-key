/**
 * Imports a community Simai chart pack (`maidata.txt` + audio) into the
 * content directory as a native pack.
 *
 * Usage:
 *   pnpm tsx tools/import-maidata.ts <maidata.txt> <audio file> [--id <packId>] [--jacket <image>]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { difficultyName, parseMaidata, parseSimai } from '../src/core/simai';

interface Args {
  maidata: string;
  audio: string;
  id?: string;
  jacket?: string;
  contentRoot: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let id: string | undefined;
  let jacket: string | undefined;
  let contentRoot = 'public/content';
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]!;
    if (value === '--id') id = argv[++i];
    else if (value === '--jacket') jacket = argv[++i];
    else if (value === '--out') contentRoot = argv[++i] ?? contentRoot;
    else positional.push(value);
  }
  if (positional.length < 2) {
    console.error('usage: tsx tools/import-maidata.ts <maidata.txt> <audio> [--id id] [--jacket image] [--out dir]');
    process.exit(2);
  }
  return {
    maidata: resolve(positional[0]!),
    audio: resolve(positional[1]!),
    id,
    jacket: jacket ? resolve(jacket) : undefined,
    contentRoot: resolve(contentRoot),
  };
}

function slugify(value: string): string {
  const ascii = value.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-');
  if (ascii.length >= 2) return ascii.slice(0, 48);
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return `chart-${hash.toString(36)}`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const file = parseMaidata(readFileSync(args.maidata, 'utf8'));
  if (!existsSync(args.audio)) {
    console.error(`audio file not found: ${args.audio}`);
    process.exit(2);
  }
  if (file.levels.length === 0) {
    console.error('maidata.txt does not contain any &inote_N chart');
    process.exit(2);
  }

  const id = args.id ?? slugify(file.title);
  const packDir = join(args.contentRoot, id);
  mkdirSync(join(packDir, 'charts'), { recursive: true });

  const audioExt = extname(args.audio).toLowerCase() || '.mp3';
  const audioName = `audio/track${audioExt}`;
  mkdirSync(join(packDir, 'audio'), { recursive: true });
  copyFileSync(args.audio, join(packDir, audioName));

  let jacketName: string | undefined;
  if (args.jacket && existsSync(args.jacket)) {
    const ext = extname(args.jacket).toLowerCase() || '.png';
    jacketName = `jacket${ext}`;
    copyFileSync(args.jacket, join(packDir, jacketName));
  }

  const difficulties = file.levels.map((level, index) => {
    const chartName = `charts/level-${level.index}.simai`;
    writeFileSync(join(packDir, chartName), level.body, 'utf8');
    const parsed = parseSimai(level.body, {
      bpm: file.wholeBpm || 120,
      difficultyName: difficultyName(level.index),
      level: Number(level.levelText) || index + 1,
    });
    console.log(
      `[${difficultyName(level.index)} ${level.levelText || '?'}] ${parsed.chart.notes.length} notes, ` +
        `${(parsed.chart.durationMs / 1000).toFixed(1)}s, warnings=${parsed.warnings.length}`,
    );
    for (const warning of parsed.warnings.slice(0, 5)) console.log(`  - ${warning}`);
    return {
      name: difficultyName(level.index),
      level: Number(level.levelText) || index + 1,
      chart: chartName,
    };
  });

  const manifest = {
    schema: 1,
    id,
    title: file.title,
    artist: file.artist || 'Unknown',
    charter: file.charter || 'Unknown',
    bpm: file.wholeBpm || 120,
    audioOffsetMs: Math.round((file.firstSeconds || 0) * 1000),
    audio: audioName,
    ...(jacketName ? { jacket: jacketName } : {}),
    difficulties,
  };
  writeFileSync(join(packDir, 'pack.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const indexPath = join(args.contentRoot, 'index.json');
  let index: { schema: number; packs: string[] } = { schema: 1, packs: [] };
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf8')) as typeof index;
    } catch {
      index = { schema: 1, packs: [] };
    }
  }
  if (!index.packs.includes(id)) index.packs.push(id);
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');

  console.log(`\nimported "${file.title}" -> ${packDir}`);
  console.log(`  audio: ${basename(args.audio)} -> ${audioName}`);
  console.log(`  difficulties: ${difficulties.map((d) => `${d.name}(${d.level})`).join(', ')}`);
}

main();
