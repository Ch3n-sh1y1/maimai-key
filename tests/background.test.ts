import { describe, expect, it } from 'vitest';
import { clampCrop, coverCrop } from '../src/app/background';
import { IMAGE_EXTENSIONS, isAcceptedImage } from '../src/core/imageFormat';

describe('background crop math', () => {
  it('covers a 16:9 stage from a wide image', () => {
    const crop = coverCrop(4000, 2000);
    expect(crop.w / crop.h).toBeCloseTo(16 / 9, 4);
    expect(crop.w).toBeCloseTo(3555.5556, 3);
    expect(crop.x).toBeCloseTo(222.2222, 3);
    expect(crop.y).toBe(0);
  });

  it('covers a 16:9 stage from a tall image', () => {
    const crop = coverCrop(2000, 4000);
    expect(crop.w / crop.h).toBeCloseTo(16 / 9, 4);
    expect(crop.h).toBeCloseTo(1125, 3);
    expect(crop.y).toBeCloseTo(1437.5, 3);
  });

  it('clamps a crop inside the image', () => {
    expect(clampCrop({ x: -50, y: -70, w: 500, h: 300 }, 1000, 800)).toEqual({
      x: 0,
      y: 0,
      w: 500,
      h: 300,
    });
    expect(clampCrop({ x: 900, y: 700, w: 500, h: 300 }, 1000, 800)).toEqual({
      x: 500,
      y: 500,
      w: 500,
      h: 300,
    });
  });
});

describe('background image formats', () => {
  it('accepts common photo formats by extension and MIME', () => {
    for (const extension of IMAGE_EXTENSIONS) {
      expect(isAcceptedImage(`photo${extension}`, '')).toBe(true);
    }
    expect(isAcceptedImage('photo.bin', 'image/png')).toBe(true);
    expect(isAcceptedImage('photo.heic', 'image/heic')).toBe(true);
  });

  it('rejects non-image files', () => {
    expect(isAcceptedImage('song.mp3', 'audio/mpeg')).toBe(false);
    expect(isAcceptedImage('archive.zip', 'application/zip')).toBe(false);
  });
});
