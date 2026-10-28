import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { saveGeneratedPack, writeIndex } = require('../electron/content-import.cjs') as {
  saveGeneratedPack: (root: string, payload: Record<string, unknown>) => { id: string; dir: string };
  writeIndex: (root: string) => void;
};

const roots: string[] = [];
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maimai-import-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'generated',
    title: 'Generated',
    artist: 'Artist',
    charter: 'Chart Lab',
    bpm: 150,
    offsetMs: 0,
    audioName: 'track.mp3',
    audioData: new Uint8Array(2048),
    charts: [{ name: 'Basic', level: 4, body: '(150)1,2,3,4' }],
    ...overrides,
  };
}

describe('atomic generated pack save', () => {
  it('writes a pack and a parseable index', () => {
    const root = tempRoot();
    const result = saveGeneratedPack(root, payload());
    expect(fs.existsSync(path.join(result.dir, 'pack.json'))).toBe(true);
    const index = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
    expect(index.packs).toEqual([result.id]);
    expect(fs.readdirSync(root).some((name) => name.startsWith('.index-'))).toBe(false);
  });

  it('removes a partial pack when validation fails', () => {
    const root = tempRoot();
    expect(() => saveGeneratedPack(root, payload({ audioName: 'track.ncm' }))).toThrow(/音频格式/);
    expect(fs.readdirSync(root)).toEqual([]);
    expect(() => saveGeneratedPack(root, payload({ charts: [{ name: 'Basic', level: 4, body: '' }] }))).toThrow();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('does not leave temporary index files after a write', () => {
    const root = tempRoot();
    const result = saveGeneratedPack(root, payload());
    writeIndex(root);
    expect(fs.readdirSync(root).filter((name) => name.includes('.tmp'))).toEqual([]);
    expect(fs.existsSync(path.join(result.dir, 'charts', 'level-1.simai'))).toBe(true);
  });
});
