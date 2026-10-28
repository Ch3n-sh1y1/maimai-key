/**
 * Chart validator: parses a `.simai` file or a `maidata.txt` pack and reports
 * timing, note counts and parser warnings.
 *
 * Usage: pnpm chart:validate <file>
 */
import { readFileSync } from 'node:fs';
import { parseMaidata, parseSimai } from '../src/core/simai';

const target = process.argv[2];
if (!target) {
  console.error('usage: pnpm chart:validate <chart.simai | maidata.txt>');
  process.exit(2);
}

const text = readFileSync(target, 'utf8');
const isMaidata = /&(inote|title|wholebpm)\b/.test(text);

if (isMaidata) {
  const file = parseMaidata(text);
  console.log(`title: ${file.title}\nartist: ${file.artist}\nbpm: ${file.wholeBpm}\nlevels: ${file.levels.length}`);
  for (const level of file.levels) {
    const result = parseSimai(level.body, { bpm: file.wholeBpm || 120, audioOffsetMs: file.firstSeconds * 1000 });
    report(`level ${level.index} (${level.levelText || '?'})`, result.chart.notes, result.warnings);
  }
} else {
  const result = parseSimai(text, { bpm: 120 });
  report(target, result.chart.notes, result.warnings);
}

function report(label: string, notes: ReturnType<typeof parseSimai>['chart']['notes'], warnings: string[]): void {
  const counts: Record<string, number> = {};
  for (const note of notes) counts[note.kind] = (counts[note.kind] ?? 0) + 1;
  const duration = notes.reduce((max, note) => Math.max(max, note.endMs), 0);
  console.log(`\n[${label}] notes=${notes.length} duration=${(duration / 1000).toFixed(1)}s`);
  console.log(`  kinds: ${JSON.stringify(counts)}`);
  const bpmSet = new Set<string>();
  for (const note of notes) bpmSet.add(String(Math.round(note.timeMs)));
  console.log(`  first=${notes[0]?.timeMs.toFixed(0) ?? '-'}ms last=${notes[notes.length - 1]?.timeMs.toFixed(0) ?? '-'}ms`);
  if (warnings.length > 0) {
    console.log(`  warnings (${warnings.length}):`);
    for (const warning of warnings.slice(0, 20)) console.log(`   - ${warning}`);
  } else {
    console.log('  warnings: none');
  }
}
