/**
 * Generates the bundled placeholder content: an original synthesized track,
 * three hand-generated charts and the pack manifest.
 *
 * Everything produced here is original / procedurally generated so the repo
 * can ship without any third-party music or chart data.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSimai } from '../src/core/simai';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'public', 'content');
const PACK_ID = 'starter';
const PACK_DIR = join(CONTENT, PACK_ID);

const BPM = 150;
const SAMPLE_RATE = 44100;
const BARS = 56;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

interface Section {
  name: string;
  startBar: number;
  endBar: number;
  intensity: number;
}

const SECTIONS: Section[] = [
  { name: 'intro', startBar: 0, endBar: 8, intensity: 0.35 },
  { name: 'verse', startBar: 8, endBar: 24, intensity: 0.7 },
  { name: 'chorus', startBar: 24, endBar: 40, intensity: 1 },
  { name: 'bridge', startBar: 40, endBar: 48, intensity: 0.55 },
  { name: 'outro', startBar: 48, endBar: BARS, intensity: 0.3 },
];

const CHORDS = [
  { root: 110.0, tones: [220.0, 261.63, 329.63] }, // Am
  { root: 87.31, tones: [174.61, 220.0, 261.63] }, // F
  { root: 130.81, tones: [261.63, 329.63, 392.0] }, // C
  { root: 98.0, tones: [196.0, 246.94, 293.66] }, // G
];

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sectionAt(bar: number): Section {
  for (const section of SECTIONS) {
    if (bar >= section.startBar && bar < section.endBar) return section;
  }
  return SECTIONS[SECTIONS.length - 1]!;
}

/* ------------------------------------------------------------------ */
/* Audio synthesis                                                     */
/* ------------------------------------------------------------------ */

function renderAudio(): Float32Array {
  const total = Math.ceil(BARS * BAR * SAMPLE_RATE) + SAMPLE_RATE;
  const buffer = new Float32Array(total);
  const rng = mulberry32(0x5eed1234);

  const addSample = (index: number, value: number) => {
    if (index >= 0 && index < buffer.length) buffer[index] = (buffer[index] ?? 0) + value;
  };

  const tone = (
    startSec: number,
    durationSec: number,
    freq: number,
    gain: number,
    type: 'sine' | 'saw' | 'square',
    attack = 0.005,
    release = 0.08,
    detune = 0,
  ) => {
    const start = Math.floor(startSec * SAMPLE_RATE);
    const length = Math.floor(durationSec * SAMPLE_RATE);
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const progress = i / length;
      const env = progress < attack / Math.max(durationSec, 1e-6)
        ? progress / (attack / Math.max(durationSec, 1e-6))
        : Math.max(0, 1 - (progress - (1 - release / Math.max(durationSec, 1e-6))) / (release / Math.max(durationSec, 1e-6)));
      const env2 = Math.max(0, Math.min(1, env));
      const phase = 2 * Math.PI * (freq + detune) * t;
      let value: number;
      if (type === 'sine') value = Math.sin(phase);
      else if (type === 'square') value = Math.sin(phase) >= 0 ? 0.7 : -0.7;
      else value = 2 * ((phase / (2 * Math.PI)) % 1) - 1;
      addSample(start + i, value * gain * env2);
    }
  };

  const kick = (startSec: number, gain = 0.9) => {
    const start = Math.floor(startSec * SAMPLE_RATE);
    const length = Math.floor(0.28 * SAMPLE_RATE);
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 16);
      const freq = 48 + 120 * Math.exp(-t * 26);
      const phase = 2 * Math.PI * freq * t;
      addSample(start + i, Math.sin(phase) * gain * env);
    }
  };

  const snare = (startSec: number, gain = 0.5) => {
    const start = Math.floor(startSec * SAMPLE_RATE);
    const length = Math.floor(0.18 * SAMPLE_RATE);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 26);
      const white = rng() * 2 - 1;
      const filtered = white - previous * 0.2;
      previous = white;
      addSample(start + i, (filtered * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * gain * env);
    }
  };

  const hat = (startSec: number, gain = 0.12, open = false) => {
    const start = Math.floor(startSec * SAMPLE_RATE);
    const length = Math.floor((open ? 0.14 : 0.045) * SAMPLE_RATE);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const env = Math.exp(-(i / length) * (open ? 7 : 22));
      const white = rng() * 2 - 1;
      const value = white - previous;
      previous = white;
      addSample(start + i, value * gain * env);
    }
  };

  for (let bar = 0; bar < BARS; bar++) {
    const section = sectionAt(bar);
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length]!;
    const barStart = bar * BAR;

    // Pad always plays, fading in/out with the section intensity.
    for (const freq of chord.tones) {
      tone(barStart, BAR * 0.96, freq / 2, 0.055 * section.intensity, 'sine', 0.18, 0.25, 0.5);
      tone(barStart, BAR * 0.96, freq, 0.035 * section.intensity, 'sine', 0.25, 0.3, -0.3);
    }

    for (let beat = 0; beat < 4; beat++) {
      const beatStart = barStart + beat * BEAT;
      if (section.intensity > 0.5) {
        kick(beatStart, 0.85);
        if (beat === 1 || beat === 3) snare(beatStart, 0.42);
        hat(beatStart, 0.1);
        hat(beatStart + BEAT / 2, 0.07, true);
      } else {
        if (beat === 0 || beat === 2) kick(beatStart, 0.55);
        hat(beatStart + BEAT / 2, 0.05);
      }

      // Bass: eighth-note pulse on the root with an occasional fifth.
      if (section.intensity > 0.40) {
        const root = chord.root / 2;
        tone(beatStart, BEAT * 0.46, root, 0.16, 'saw', 0.004, 0.06);
        tone(beatStart + BEAT / 2, BEAT * 0.46, root * (beat === 3 ? 1.5 : 1), 0.13, 'saw', 0.004, 0.06);
      }
    }

    // Lead arpeggio in the busier sections.
    if (section.intensity >= 0.55) {
      const step = BEAT / 2;
      for (let i = 0; i < 8; i++) {
        const freq = chord.tones[i % chord.tones.length]! * (i % 4 === 3 ? 2 : 1);
        tone(barStart + i * step, step * 0.8, freq, 0.05, 'square', 0.004, 0.04);
      }
    }
  }

  // Simple feedback delay on the whole mix for a little space.
  const delayed = new Float32Array(buffer.length);
  const delaySamples = Math.floor(BEAT * 0.75 * SAMPLE_RATE);
  for (let i = delaySamples; i < buffer.length; i++) {
    delayed[i] = (buffer[i - delaySamples] ?? 0) * 0.22;
  }
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = (buffer[i] ?? 0) + (delayed[i] ?? 0);
  }

  // Soft clip and global fade in/out.
  const fade = Math.floor(1.2 * SAMPLE_RATE);
  for (let i = 0; i < buffer.length; i++) {
    let value = (buffer[i] ?? 0) * 0.85;
    value = Math.tanh(value * 1.4) * 0.85;
    if (i < fade) value *= i / fade;
    const tail = buffer.length - i;
    if (tail < fade) value *= tail / fade;
    buffer[i] = value;
  }

  return buffer;
}

function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

/* ------------------------------------------------------------------ */
/* Chart generation                                                    */
/* ------------------------------------------------------------------ */

interface Figure {
  grid: 4 | 8 | 16;
  slots: string[];
}

function emptySlots(count: number): string[] {
  return Array.from({ length: count }, () => '');
}

function measure(figure: Figure): string {
  return `{${figure.grid}}` + figure.slots.join(',');
}

function rotate(values: number[], offset: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    result.push(values[(i + offset) % values.length]!);
  }
  return result;
}

function generateBasic(): string {
  const bars: string[] = ['(150){4}'];
  for (let bar = 0; bar < BARS; bar++) {
    if (bar < 8 || bar >= 48) {
      bars.push(measure({ grid: 4, slots: emptySlots(4) }));
      continue;
    }
    const offset = Math.floor(bar / 4) % 8;
    const line = rotate([1, 2, 3, 4, 5, 6, 7, 8], offset);
    const slots = emptySlots(4);
    slots[0] = String(line[0]!);
    slots[1] = String(line[2]!);
    slots[2] = String(line[4]!);
    slots[3] = String(line[6]!);
    if (bar % 8 === 7) {
      slots[0] = `1h[4:2]`;
      slots[2] = '';
    }
    if (bar % 16 === 15) {
      slots[0] = `1-3[4:1]`;
      slots[2] = '';
    }
    if (bar % 32 === 31) {
      slots[0] = '1/5';
    }
    bars.push(measure({ grid: 4, slots }));
  }
  bars.push('E');
  return bars.join(',\n');
}

function generateAdvanced(): string {
  const bars: string[] = ['(150){4}'];
  for (let bar = 0; bar < BARS; bar++) {
    if (bar < 8 || bar >= 48) {
      bars.push(measure({ grid: 4, slots: emptySlots(4) }));
      continue;
    }
    const offset = Math.floor(bar / 2) % 8;
    const line = rotate([1, 3, 5, 7, 2, 4, 6, 8], offset);
    const grid: 4 | 8 = bar % 4 === 3 ? 8 : 4;
    const slots = emptySlots(grid);
    if (grid === 4) {
      slots[0] = String(line[0]!);
      slots[1] = String(line[3]!);
      slots[2] = String(line[5]!);
      slots[3] = String(line[7]!);
    } else {
      for (let i = 0; i < 8; i++) {
        slots[i] = i % 2 === 0 ? String(line[(i / 2) % 8]!) : '';
      }
    }
    if (bar % 8 === 7) {
      const start = line[0]!;
      const end = ((start + 3) % 8) + 1;
      slots[0] = `${start}-${end}[4:1]`;
      slots[1] = '';
    }
    if (bar % 16 === 15) {
      slots[grid - 2] = '3/7';
    }
    if (bar % 24 === 23) {
      slots[0] = `${line[0]!}b`;
    }
    bars.push(measure({ grid, slots }));
  }
  bars.push('E');
  return bars.join(',\n');
}

function generateExpert(): string {
  const bars: string[] = ['(150){4}'];
  const rng = mulberry32(0x0badf00d);
  for (let bar = 0; bar < BARS; bar++) {
    if (bar < 8 || bar >= 48) {
      bars.push(measure({ grid: 4, slots: emptySlots(4) }));
      continue;
    }
    const offset = Math.floor(bar / 2) % 8;
    const line = rotate([1, 4, 7, 2, 5, 8, 3, 6], offset);
    const grid: 4 | 8 | 16 = bar % 8 === 7 ? 16 : bar % 4 === 3 ? 8 : 4;
    const slots = emptySlots(grid);
    if (grid === 4) {
      slots[0] = `${line[0]!}/${line[4]!}`;
      slots[1] = String(line[2]!);
      slots[2] = String(line[5]!);
      slots[3] = String(line[7]!);
    } else if (grid === 8) {
      for (let i = 0; i < 8; i++) {
        if (i % 2 === 0) slots[i] = String(line[(i / 2) % 8]!);
        else if (rng() > 0.55) slots[i] = String(line[(i + 3) % 8]!);
      }
    } else {
      for (let i = 0; i < 16; i++) {
        const density = i % 4;
        if (density === 0 || rng() > 0.45) slots[i] = String(line[(i + offset) % 8]!);
      }
    }
    if (bar % 8 === 3) {
      const start = line[0]!;
      const mid = ((start + 2) % 8) + 1;
      const end = ((start + 5) % 8) + 1;
      slots[0] = `${start}-${mid}[8:1]-${end}[4:1]`;
      if (grid > 4) slots[1] = '';
    }
    if (bar % 16 === 11) {
      slots[Math.max(0, grid - 2)] = '1/5';
    }
    if (bar % 32 === 23) {
      slots[0] = `${line[1]!}b`;
    }
    if (bar % 24 === 17) {
      slots[Math.min(grid - 1, 2)] = `A${line[3]!}`;
    }
    bars.push(measure({ grid, slots }));
  }
  bars.push('E');
  return bars.join(',\n');
}

/* ------------------------------------------------------------------ */

function main(): void {
  mkdirSync(PACK_DIR, { recursive: true });
  mkdirSync(join(PACK_DIR, 'charts'), { recursive: true });

  const audio = renderAudio();
  writeWav(join(PACK_DIR, 'audio', 'neon-drift.wav'), audio, SAMPLE_RATE);

  const basic = generateBasic();
  const advanced = generateAdvanced();
  const expert = generateExpert();
  writeFileSync(join(PACK_DIR, 'charts', 'basic.simai'), basic, 'utf8');
  writeFileSync(join(PACK_DIR, 'charts', 'advanced.simai'), advanced, 'utf8');
  writeFileSync(join(PACK_DIR, 'charts', 'expert.simai'), expert, 'utf8');

  const jacket = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1026"/>
      <stop offset="0.55" stop-color="#1b2a6b"/>
      <stop offset="1" stop-color="#ff5d73"/>
    </linearGradient>
    <radialGradient id="r" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#7ce0ff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#7ce0ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <circle cx="300" cy="300" r="180" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
  <circle cx="300" cy="300" r="120" fill="url(#r)"/>
  <text x="48" y="512" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="54" font-weight="700">NEON</text>
  <text x="48" y="562" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="54" font-weight="700" opacity="0.75">DRIFT</text>
  <text x="48" y="76" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="20" opacity="0.65">ORIGINAL PLACEHOLDER</text>
</svg>
`;
  writeFileSync(join(PACK_DIR, 'jacket.svg'), jacket, 'utf8');

  const manifest = {
    schema: 1,
    id: PACK_ID,
    title: 'Neon Drift',
    artist: 'Procedural Placeholder',
    charter: 'Auto-generated',
    bpm: BPM,
    audioOffsetMs: 0,
    audio: 'audio/neon-drift.wav',
    jacket: 'jacket.svg',
    difficulties: [
      { name: 'Basic', level: 4, chart: 'charts/basic.simai' },
      { name: 'Advanced', level: 7, chart: 'charts/advanced.simai' },
      { name: 'Expert', level: 10, chart: 'charts/expert.simai' },
    ],
  };
  writeFileSync(join(PACK_DIR, 'pack.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(
    join(CONTENT, 'index.json'),
    JSON.stringify({ schema: 1, packs: [PACK_ID] }, null, 2),
    'utf8',
  );

  for (const [name, body] of [['basic', basic], ['advanced', advanced], ['expert', expert]] as const) {
    const parsed = parseSimai(body, { bpm: BPM });
    const kinds = parsed.chart.notes.reduce<Record<string, number>>((acc, note) => {
      acc[note.kind] = (acc[note.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`${name}: ${parsed.chart.notes.length} notes ${JSON.stringify(kinds)} warnings=${parsed.warnings.length}`);
    if (parsed.warnings.length > 0) console.log(parsed.warnings.slice(0, 5));
  }
  console.log(`audio: ${(audio.length / SAMPLE_RATE).toFixed(1)}s, ${(audio.length * 2 / 1024 / 1024).toFixed(1)} MiB`);
}

main();
