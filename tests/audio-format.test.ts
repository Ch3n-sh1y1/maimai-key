import { describe, expect, it } from 'vitest';
import { classifyAudioFormat, SUPPORTED_AUDIO_EXTENSIONS } from '../src/core/audioFormat';

describe('audio format classification', () => {
  it('accepts standard DRM-free audio formats', () => {
    for (const extension of SUPPORTED_AUDIO_EXTENSIONS) {
      expect(classifyAudioFormat(`track${extension}`).kind).toBe('supported');
    }
  });

  it('rejects platform DRM caches with platform-specific messages', () => {
    const ncm = classifyAudioFormat('song.ncm');
    expect(ncm.kind).toBe('encrypted');
    expect(ncm.platform).toBe('网易云音乐');

    const qmc = classifyAudioFormat('song.qmcflac');
    expect(qmc.kind).toBe('encrypted');
    expect(qmc.platform).toBe('QQ 音乐');

    expect(classifyAudioFormat('song.kgm').platform).toBe('酷狗音乐');
    expect(classifyAudioFormat('song.kwm').platform).toBe('酷我音乐');
  });

  it('detects NCM by magic bytes even when renamed', () => {
    const head = new TextEncoder().encode('CTENFDAM');
    expect(classifyAudioFormat('renamed.mp3', head).kind).toBe('encrypted');
  });

  it('reports unknown extensions', () => {
    const info = classifyAudioFormat('song.wma');
    expect(info.kind).toBe('unknown');
    expect(info.message).toContain('MP3');
  });
});
