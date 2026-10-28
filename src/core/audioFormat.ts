/**
 * Audio format policy for the chart import/crafting tools.
 *
 * DRM-free platform downloads are usually MP3/FLAC/M4A/AAC/OGG; those are
 * decoded by Chromium/Electron's Web Audio implementation.
 *
 * Platform cache files (NetEase NCM, QQ QMC/MFLAC/MGG, KuGou KGM, KuWo KWM…)
 * are encrypted for DRM and are intentionally not decrypted here.
 */
export type AudioFormatKind = 'supported' | 'encrypted' | 'unknown';

export interface AudioFormatInfo {
  kind: AudioFormatKind;
  extension: string;
  platform?: string;
  label?: string;
  message?: string;
}

export const SUPPORTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.oga',
  '.opus',
  '.webm',
] as const;

export const SUPPORTED_AUDIO_ACCEPT = [
  'audio/*',
  ...SUPPORTED_AUDIO_EXTENSIONS,
  '.ncm',
  '.mflac',
  '.mgg',
  '.qmcflac',
  '.kgm',
  '.kwm',
].join(',');

interface EncryptedFormat {
  platform: string;
  label: string;
}

const ENCRYPTED_FORMATS: Record<string, EncryptedFormat> = {
  '.ncm': { platform: '网易云音乐', label: 'NCM 加密缓存' },
  '.uc': { platform: '网易云音乐', label: '缓存文件' },
  '.uc!': { platform: '网易云音乐', label: '缓存文件' },
  '.qmc0': { platform: 'QQ 音乐', label: 'QMC 加密音频' },
  '.qmc2': { platform: 'QQ 音乐', label: 'QMC 加密音频' },
  '.qmc3': { platform: 'QQ 音乐', label: 'QMC 加密音频' },
  '.qmcflac': { platform: 'QQ 音乐', label: 'QMC 加密音频' },
  '.qmcogg': { platform: 'QQ 音乐', label: 'QMC 加密音频' },
  '.qmcra': { platform: 'QQ 音乐', label: 'QMC 加密音频' },
  '.mflac': { platform: 'QQ 音乐', label: 'MFLAC 加密音频' },
  '.mflac0': { platform: 'QQ 音乐', label: 'MFLAC 加密音频' },
  '.mgg': { platform: 'QQ 音乐', label: 'MGG 加密音频' },
  '.mgg1': { platform: 'QQ 音乐', label: 'MGG 加密音频' },
  '.mggl': { platform: 'QQ 音乐', label: 'MGG 加密音频' },
  '.kgm': { platform: '酷狗音乐', label: 'KGM 加密音频' },
  '.kgma': { platform: '酷狗音乐', label: 'KGMA 加密音频' },
  '.vpr': { platform: '酷狗音乐', label: 'VPR 缓存' },
  '.kwm': { platform: '酷我音乐', label: 'KWM 加密音频' },
  '.xm': { platform: '虾米音乐', label: '加密音频' },
};

const NCM_MAGIC = [0x43, 0x54, 0x45, 0x4e, 0x46, 0x44, 0x41, 0x4d]; // CTENFDAM

function extensionOf(fileName: string): string {
  const match = /\.[^./\\]+$/.exec(fileName);
  return match ? match[0].toLowerCase() : '';
}

export function classifyAudioFormat(fileName: string, head?: Uint8Array): AudioFormatInfo {
  const extension = extensionOf(fileName);
  const encrypted = ENCRYPTED_FORMATS[extension];
  if (encrypted) {
    return {
      kind: 'encrypted',
      extension,
      platform: encrypted.platform,
      label: encrypted.label,
      message:
        `检测到 ${encrypted.platform} 的 ${encrypted.label}（${extension}）。` +
        '这是受 DRM 保护的平台缓存，本项目不解密；请先在平台内合法下载/导出无加密的 MP3、FLAC 或 M4A 文件。',
    };
  }
  if (head && head.length >= NCM_MAGIC.length && NCM_MAGIC.every((byte, index) => head[index] === byte)) {
    return {
      kind: 'encrypted',
      extension: extension || '.ncm',
      platform: '网易云音乐',
      label: 'NCM 加密缓存',
      message:
        '文件头是网易云 NCM 加密格式。请在网易云内使用合法下载/导出的无加密音频（MP3/FLAC），本项目不提供解密。',
    };
  }
  if ((SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extension)) {
    return { kind: 'supported', extension };
  }
  return {
    kind: 'unknown',
    extension,
    message:
      `无法识别的音频扩展名 ${extension || '(无)'}。` +
      '支持 MP3、WAV、FLAC、M4A、AAC、OGG、OPUS、WEBM；WMA/APE/AIFF 等请先转成 MP3 或 FLAC。',
  };
}

export function supportedAudioSummary(): string {
  return 'MP3 · WAV · FLAC · M4A · AAC · OGG · OPUS · WEBM';
}
