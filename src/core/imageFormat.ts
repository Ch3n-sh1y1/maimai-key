export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.jfif',
  '.png',
  '.webp',
  '.avif',
  '.gif',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
] as const;

export const BACKGROUND_ACCEPT = ['image/*', ...IMAGE_EXTENSIONS].join(',');

export function imageExtension(fileName: string): string {
  const match = /\.[^./\\]+$/.exec(fileName);
  return match ? match[0].toLowerCase() : '';
}

export function isAcceptedImage(fileName: string, mime = ''): boolean {
  if (mime.startsWith('image/')) return true;
  const extension = imageExtension(fileName);
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extension);
}
