import type { PackManifest } from './types';
import { SUPPORTED_AUDIO_EXTENSIONS } from './audioFormat';

export interface ContentIssue {
  packId: string;
  title?: string;
  reason: string;
}

const AUDIO_EXTENSIONS = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS);
const JACKET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
const MAX_DIFFICULTIES = 8;

/** Relative paths must stay inside the pack directory on every platform. */
export function isSafePackPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  const parts = normalized.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function extensionOf(value: string): string {
  const match = /\.[^./\\]+$/.exec(value);
  return match ? match[0].toLowerCase() : '';
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} 必须是非空字符串`);
  }
  return value.trim();
}

function finiteField(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} 必须是有限数字`);
  }
  return value;
}

/** Validate the parts of pack.json that the runtime relies on. */
export function validatePackManifest(input: unknown, expectedId?: string): PackManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('pack.json 必须是对象');
  }
  const raw = input as Record<string, unknown>;
  if (raw.schema !== 1) throw new Error('pack.json schema 必须为 1');

  const id = stringField(raw.id, 'id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`id "${id}" 含有非法字符`);
  }
  if (expectedId && id !== expectedId) {
    throw new Error(`id "${id}" 与目录名 "${expectedId}" 不一致`);
  }

  const title = stringField(raw.title, 'title');
  const artist = typeof raw.artist === 'string' ? raw.artist : '';
  const charter = typeof raw.charter === 'string' ? raw.charter : '';
  const bpm = finiteField(raw.bpm, 'bpm');
  if (bpm <= 0 || bpm > 1000) throw new Error(`bpm ${bpm} 超出范围`);
  const audioOffsetMs = raw.audioOffsetMs === undefined ? 0 : finiteField(raw.audioOffsetMs, 'audioOffsetMs');
  if (Math.abs(audioOffsetMs) > 60_000) throw new Error('audioOffsetMs 超出范围');

  const audio = raw.audio;
  if (!isSafePackPath(audio) || !AUDIO_EXTENSIONS.has(extensionOf(audio))) {
    throw new Error('audio 必须是包内且受支持的音频相对路径');
  }

  let jacket: string | undefined;
  if (raw.jacket !== undefined) {
    if (!isSafePackPath(raw.jacket) || !JACKET_EXTENSIONS.has(extensionOf(raw.jacket))) {
      throw new Error('jacket 必须是包内图片相对路径');
    }
    jacket = raw.jacket;
  }

  if (!Array.isArray(raw.difficulties) || raw.difficulties.length === 0 || raw.difficulties.length > MAX_DIFFICULTIES) {
    throw new Error(`difficulties 必须有 1-${MAX_DIFFICULTIES} 项`);
  }
  const difficulties = raw.difficulties.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`difficulties[${index}] 必须是对象`);
    }
    const item = entry as Record<string, unknown>;
    const name = stringField(item.name, `difficulties[${index}].name`);
    const level = finiteField(item.level, `difficulties[${index}].level`);
    if (level < 1 || level > 20) throw new Error(`difficulties[${index}].level 超出范围`);
    if (!isSafePackPath(item.chart) || extensionOf(item.chart) !== '.simai') {
      throw new Error(`difficulties[${index}].chart 必须是包内 .simai 路径`);
    }
    return { name, level, chart: item.chart };
  });

  return {
    schema: 1,
    id,
    title,
    artist,
    charter,
    bpm,
    audioOffsetMs,
    audio,
    ...(jacket ? { jacket } : {}),
    difficulties,
  };
}
