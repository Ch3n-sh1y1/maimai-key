/**
 * Audio-to-chart generator.
 *
 * The analysis stays intentionally lightweight: an energy/flux onset envelope,
 * autocorrelation BPM estimate and a phase search. It then quantizes onsets to
 * 16th notes and fills four difficulty profiles with deterministic patterns.
 *
 * The result is a *draft*: it always produces a playable Simai chart, but the
 * patterns are generated, not hand-designed. The generated .simai files can be
 * edited freely afterwards.
 */
import { audioContext } from './audio';

export interface Onset {
  /** Milliseconds from the start of the audio. */
  t: number;
  /** Normalized 0..1 strength. */
  strength: number;
}

export interface AudioAnalysis {
  bpm: number;
  confidence: number;
  durationMs: number;
  beatPhaseMs: number;
  onsets: Onset[];
}

export interface AutoChartOptions {
  bpm?: number;
  offsetMs: number;
  /** 0.7 = sparse, 1 = normal, 1.35 = denser. */
  density: number;
  includeHolds: boolean;
  includeSlides: boolean;
  includeTouches: boolean;
  seed: number;
}

export interface GeneratedDifficulty {
  name: string;
  level: number;
  body: string;
  noteCount: number;
}

export interface GeneratedCharts {
  bpm: number;
  durationMs: number;
  difficulties: GeneratedDifficulty[];
}

interface Profile {
  name: string;
  level: number;
  minGap: number;
  percentile: number;
  maxNps: number;
  chordEvery: number;
  holdEvery: number;
  slideEvery: number;
  touchEvery: number;
  breakEvery: number;
  pattern: number[];
}

const GRID = 16;
const PROFILES: Profile[] = [
  {
    name: 'Basic',
    level: 4,
    minGap: 0.34,
    percentile: 0.74,
    maxNps: 2.1,
    chordEvery: 0,
    holdEvery: 9,
    slideEvery: 0,
    touchEvery: 0,
    breakEvery: 0,
    pattern: [1, 5, 3, 7, 2, 6, 4, 8],
  },
  {
    name: 'Advanced',
    level: 7,
    minGap: 0.22,
    percentile: 0.56,
    maxNps: 3.2,
    chordEvery: 14,
    holdEvery: 11,
    slideEvery: 14,
    touchEvery: 0,
    breakEvery: 24,
    pattern: [1, 3, 5, 7, 5, 3, 1, 7],
  },
  {
    name: 'Expert',
    level: 10,
    minGap: 0.14,
    percentile: 0.38,
    maxNps: 4.6,
    chordEvery: 10,
    holdEvery: 13,
    slideEvery: 9,
    touchEvery: 17,
    breakEvery: 20,
    pattern: [1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6, 8, 7, 1, 8, 2],
  },
  {
    name: 'Master',
    level: 13,
    minGap: 0.095,
    percentile: 0.2,
    maxNps: 6.2,
    chordEvery: 8,
    holdEvery: 15,
    slideEvery: 7,
    touchEvery: 11,
    breakEvery: 16,
    pattern: [1, 4, 7, 2, 5, 8, 3, 6, 2, 6, 4, 8, 1, 5, 3, 7],
  },
];

/** Decode audio bytes using the same AudioContext the game uses. */
export async function decodeAudioBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = audioContext();
  if (ctx.state !== 'running') await ctx.resume();
  return ctx.decodeAudioData(bytes.slice(0));
}

/** Decode an audio file using the same AudioContext the game uses. */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  return decodeAudioBytes(await file.arrayBuffer());
}

export function analyzeBuffer(buffer: AudioBuffer, bpmOverride?: number): AudioAnalysis {
  const sampleRate = buffer.sampleRate;
  const frame = 1024;
  const hop = 512;
  const channels = Math.min(2, buffer.numberOfChannels);
  const data: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel++) data.push(buffer.getChannelData(channel));

  const length = buffer.length;
  const frameCount = Math.max(1, Math.floor((length - frame) / hop) + 1);
  const energy = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const start = i * hop;
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const samples = data[channel]!;
      for (let j = 0; j < frame; j++) {
        const value = samples[start + j] ?? 0;
        sum += value * value;
      }
    }
    energy[i] = Math.sqrt(sum / (frame * channels));
  }

  const flux = new Float32Array(frameCount);
  for (let i = 1; i < frameCount; i++) {
    flux[i] = Math.max(0, energy[i]! - energy[i - 1]!);
  }
  // Smooth the flux a little so single-sample spikes do not dominate.
  const envelope = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    envelope[i] = (flux[Math.max(0, i - 1)]! + flux[i]! * 2 + flux[Math.min(frameCount - 1, i + 1)]!) / 4;
  }
  normalize(envelope);

  const fps = sampleRate / hop;
  const beat = bpmOverride && bpmOverride > 0 ? { bpm: bpmOverride, lag: (60 * fps) / bpmOverride, confidence: 1 } : estimateTempo(envelope, fps);
  const phaseFrame = estimatePhase(envelope, Math.max(1, Math.round(beat.lag)));
  const beatPhaseMs = (phaseFrame / fps) * 1000;
  const onsets = detectOnsets(envelope, fps, buffer.duration * 1000);

  return {
    bpm: round(beat.bpm, 1),
    confidence: beat.confidence,
    durationMs: Math.round(buffer.duration * 1000),
    beatPhaseMs: Math.round(beatPhaseMs),
    onsets,
  };
}

function normalize(values: Float32Array): void {
  let max = 0;
  for (const value of values) max = Math.max(max, value);
  if (max <= 1e-9) return;
  for (let i = 0; i < values.length; i++) values[i] = values[i]! / max;
}

function estimateTempo(envelope: Float32Array, fps: number): { bpm: number; lag: number; confidence: number } {
  const minLag = Math.max(2, Math.floor((60 * fps) / 200));
  const maxLag = Math.min(envelope.length - 2, Math.ceil((60 * fps) / 55));
  let bestLag = minLag;
  let bestScore = -Infinity;
  let mean = 0;
  for (const value of envelope) mean += value;
  mean /= Math.max(1, envelope.length);

  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = lag; i < envelope.length; i += 2) {
      sum += (envelope[i]! - mean) * (envelope[i - lag]! - mean);
      count++;
    }
    const score = count > 0 ? sum / count : 0;
    scores.push(score);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const scoreAt = (lag: number): number => {
    const index = Math.round(lag) - minLag;
    if (index < 0 || index >= scores.length) return -Infinity;
    return scores[index]!;
  };

  let bpm = (60 * fps) / bestLag;
  let chosenScore = bestScore;
  // A strong every-other-beat accent can win the raw autocorrelation. If the
  // double-time lag is reasonably strong, prefer the faster reading (most
  // rhythm-game charts live in 100–180 BPM).
  if (bpm < 100) {
    const doubleLag = Math.round(bestLag / 2);
    const doubleScore = scoreAt(doubleLag);
    if (doubleLag >= minLag && doubleScore >= bestScore * 0.5) {
      bestLag = doubleLag;
      bpm *= 2;
      chosenScore = Math.max(chosenScore, doubleScore);
    }
  } else if (bpm > 180) {
    const halfLag = Math.round(bestLag * 2);
    const halfScore = scoreAt(halfLag);
    if (halfLag <= maxLag && halfScore >= bestScore * 0.5) {
      bestLag = halfLag;
      bpm /= 2;
      chosenScore = Math.max(chosenScore, halfScore);
    }
  }

  let variance = 0;
  for (const value of envelope) variance += (value - mean) * (value - mean);
  variance /= Math.max(1, envelope.length);
  const confidence = Math.max(0, Math.min(1, Math.sqrt(Math.max(0, chosenScore) / (variance + 1e-9))));
  return { bpm, lag: (60 * fps) / bpm, confidence };
}

function estimatePhase(envelope: Float32Array, lag: number): number {
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < lag; phase++) {
    let sum = 0;
    let count = 0;
    for (let i = phase; i < envelope.length; i += lag) {
      sum += envelope[i]!;
      count++;
    }
    const score = count > 0 ? sum / count : 0;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

function detectOnsets(envelope: Float32Array, fps: number, durationMs: number): Onset[] {
  const sorted = Array.from(envelope).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)] ?? 0;
  const threshold = Math.max(0.045, median + mad * 1.1);
  const minDistanceMs = 85;
  const onsets: Onset[] = [];
  let lastMs = -Infinity;
  for (let i = 1; i < envelope.length - 1; i++) {
    const value = envelope[i]!;
    if (value < threshold) continue;
    if (value < envelope[i - 1]! || value < envelope[i + 1]!) continue;
    const t = (i / fps) * 1000;
    if (t < 250 || t > durationMs - 80) continue;
    if (t - lastMs < minDistanceMs) continue;
    lastMs = t;
    onsets.push({ t: Math.round(t), strength: Math.min(1, value / Math.max(0.2, sorted[sorted.length - 1] ?? 1)) });
  }
  return onsets;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * p)));
  return values[index] ?? 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCharts(analysis: AudioAnalysis, options: AutoChartOptions): GeneratedCharts {
  const bpm = options.bpm && options.bpm > 0 ? options.bpm : analysis.bpm;
  const beatMs = 60000 / bpm;
  const slotMs = beatMs / 4;
  const density = Math.min(1.5, Math.max(0.6, options.density));
  const strengths = analysis.onsets.map((onset) => onset.strength).sort((a, b) => a - b);
  const difficulties = PROFILES.map((profile) =>
    buildDifficulty(analysis, profile, {
      ...options,
      bpm,
      slotMs,
      beatMs,
      density,
      threshold: percentile(strengths, profile.percentile),
    }),
  );
  return { bpm, durationMs: analysis.durationMs, difficulties };
}

interface BuildContext extends AutoChartOptions {
  bpm: number;
  slotMs: number;
  beatMs: number;
  density: number;
  threshold: number;
}

function buildDifficulty(
  analysis: AudioAnalysis,
  profile: Profile,
  ctx: BuildContext,
): GeneratedDifficulty {
  const rand = mulberry32(ctx.seed + profile.level * 7919);
  const minGap = (profile.minGap / ctx.density) * 1000;
  const maxNotes = Math.max(12, Math.floor((analysis.durationMs / 1000) * profile.maxNps * ctx.density));
  const selected: Onset[] = [];
  let lastTime = -Infinity;
  for (const onset of analysis.onsets) {
    if (selected.length >= maxNotes) break;
    if (onset.strength < ctx.threshold) continue;
    if (onset.t - lastTime < minGap) continue;
    selected.push(onset);
    lastTime = onset.t;
  }

  const tokens = new Map<number, string>();
  let previousSector = 0;
  let noteCount = 0;
  let lastQ = 0;

  for (let index = 0; index < selected.length; index++) {
    const onset = selected[index]!;
    let q = Math.max(1, Math.round(onset.t / ctx.slotMs));
    if (q <= lastQ) q = lastQ + 1;
    lastQ = q;

    const pattern = profile.pattern;
    let sector = pattern[(index + ctx.seed) % pattern.length]!;
    if (sector === previousSector) sector = (sector % 8) + 1;
    if (rand() < 0.12) sector = 1 + Math.floor(rand() * 8);
    previousSector = sector;

    const next = selected[index + 1];
    const gapToNext = next ? next.t - onset.t : Infinity;
    let token: string;
    let kind: 'tap' | 'hold' | 'slide' | 'touch' = 'tap';

    if (
      ctx.includeSlides &&
      profile.slideEvery > 0 &&
      index % profile.slideEvery === 0 &&
      gapToNext > ctx.beatMs * 2.4 &&
      selected.length > 8
    ) {
      const distance = 2 + (index % 3);
      const target = ((sector - 1 + distance) % 8) + 1;
      token = `${sector}-${target}[4:1]`;
      kind = 'slide';
    } else if (
      ctx.includeHolds &&
      profile.holdEvery > 0 &&
      index % profile.holdEvery === 0 &&
      gapToNext > ctx.beatMs * 1.4
    ) {
      token = `${sector}h[4:1]`;
      kind = 'hold';
    } else if (
      ctx.includeTouches &&
      profile.touchEvery > 0 &&
      index % profile.touchEvery === 0 &&
      index > 6
    ) {
      token = `A${sector}`;
      kind = 'touch';
    } else if (
      profile.breakEvery > 0 &&
      index % profile.breakEvery === 0 &&
      onset.strength > 0.72
    ) {
      token = `${sector}b`;
    } else {
      token = String(sector);
    }

    if (
      kind === 'tap' &&
      profile.chordEvery > 0 &&
      index % profile.chordEvery === 0 &&
      onset.strength > 0.55
    ) {
      const partner = ((sector + 3) % 8) + 1;
      token = `${token}/${partner}`;
      noteCount += 2;
    } else {
      noteCount += 1;
    }
    tokens.set(q, token);
  }

  const rawMax = Math.max(1, Math.ceil((analysis.durationMs + 800) / ctx.slotMs));
  const maxQ = Math.ceil(rawMax / GRID) * GRID;
  const rows: string[] = [`(${formatBpm(ctx.bpm)}){${GRID}},`];
  for (let base = 1; base <= maxQ; base += GRID) {
    const cells: string[] = [];
    for (let s = 0; s < GRID; s++) {
      const q = base + s;
      const token = tokens.get(q) ?? '';
      cells.push(s === 0 ? `{${GRID}}${token}` : token);
    }
    rows.push(`${cells.join(',')},`);
  }
  rows.push('E');

  return {
    name: profile.name,
    level: profile.level,
    body: `${rows.join('\n')}\n`,
    noteCount,
  };
}

function formatBpm(bpm: number): string {
  return Number.isInteger(bpm) ? String(bpm) : String(Math.round(bpm * 10) / 10);
}

export function generatedNoteSummary(body: string): { count: number; durationMs: number } {
  // Lightweight preview without importing the parser into the analysis module.
  const count = (body.match(/(?<![A-Za-z0-9])[1-8][bhx]?/g) ?? []).length;
  return { count, durationMs: 0 };
}
