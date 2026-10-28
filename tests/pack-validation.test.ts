import { describe, expect, it } from 'vitest';
import { isSafePackPath, validatePackManifest } from '../src/core/packValidation';
import { loadPack, type ContentSource } from '../src/app/content';

const valid = {
  schema: 1,
  id: 'good',
  title: 'Good Pack',
  artist: 'Artist',
  charter: 'Charter',
  bpm: 150,
  audioOffsetMs: 0,
  audio: 'audio/track.mp3',
  jacket: 'jacket.png',
  difficulties: [
    { name: 'Basic', level: 4, chart: 'charts/basic.simai' },
  ],
};

function sourceOf(files: Record<string, string>): ContentSource {
  return {
    readText: async (path: string) => {
      const value = files[path];
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    readBytes: async () => new ArrayBuffer(0),
    clearCache: () => undefined,
  } as unknown as ContentSource;
}

describe('pack manifest validation', () => {
  it('accepts a normal schema-1 manifest', () => {
    const manifest = validatePackManifest(valid, 'good');
    expect(manifest.id).toBe('good');
    expect(manifest.difficulties).toHaveLength(1);
  });

  it('rejects unsafe relative paths and id mismatches', () => {
    expect(isSafePackPath('charts/basic.simai')).toBe(true);
    expect(isSafePackPath('../outside.simai')).toBe(false);
    expect(isSafePackPath('/absolute.simai')).toBe(false);
    expect(isSafePackPath('C:\\outside.simai')).toBe(false);
    expect(() => validatePackManifest({ ...valid, id: 'other' }, 'good')).toThrow(/目录名/);
    expect(() => validatePackManifest({ ...valid, audio: '../track.mp3' })).toThrow(/audio/);
    expect(() => validatePackManifest({ ...valid, difficulties: [] })).toThrow(/difficulties/);
    expect(() => validatePackManifest({ ...valid, schema: 2 })).toThrow(/schema/);
  });

  it('loads a valid pack and rejects an empty chart', async () => {
    const source = sourceOf({
      'good/pack.json': JSON.stringify(valid),
      'good/charts/basic.simai': '(150)1,2,3,4',
    });
    await expect(loadPack(source, 'good')).resolves.toMatchObject({ manifest: { id: 'good' } });

    const empty = sourceOf({
      'good/pack.json': JSON.stringify(valid),
      'good/charts/basic.simai': '(150)',
    });
    await expect(loadPack(empty, 'good')).rejects.toThrow(/没有可游玩音符/);
  });
});
