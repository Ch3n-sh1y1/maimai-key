import type { Chart, PackManifest } from '../core/types';
import { parseSimai } from '../core/simai';
import { validatePackManifest } from '../core/packValidation';

export interface GeneratedChartInput {
  name: string;
  level: number;
  body: string;
}

export interface GeneratedPackPayload {
  id: string;
  title: string;
  artist: string;
  charter: string;
  bpm: number;
  offsetMs: number;
  audioName: string;
  audioData: Uint8Array;
  charts: GeneratedChartInput[];
}

export interface GeneratedPackResult {
  id: string;
  dir: string;
}

export interface ElectronContentResponse {
  kind: 'text' | 'binary';
  text?: string;
  data?: Uint8Array;
}

declare global {
  interface Window {
    maimai?: {
      readContent(path: string): Promise<ElectronContentResponse>;
      saveGenerated(payload: GeneratedPackPayload): Promise<GeneratedPackResult>;
      openContentFolder(): Promise<{ path: string; error?: string }>;
      userRoot(): Promise<string>;
      quit(): void;
      toggleFullscreen(): Promise<boolean>;
      setFullscreen(fullscreen: boolean): Promise<boolean>;
      onFullscreenChange(callback: (fullscreen: boolean) => void): () => void;
      logError(message: string): void;
      platform: string;
    };
  }
}

const base = import.meta.env.BASE_URL;

export function contentUrl(path: string): string {
  return `${base}content/${path}`;
}

export interface LoadedPack {
  manifest: PackManifest;
  charts: Chart[];
  root: string;
}

/** Reads files from the bundled content directory (HTTP in the browser, IPC in Electron). */
export class ContentSource {
  private textCache = new Map<string, string>();

  clearCache(): void {
    this.textCache.clear();
  }

  async readText(path: string): Promise<string> {
    const cached = this.textCache.get(path);
    if (cached !== undefined) return cached;

    let text: string;
    if (window.maimai) {
      const response = await window.maimai.readContent(path);
      if (response.kind === 'text' && response.text !== undefined) {
        text = response.text;
      } else if (response.data) {
        text = new TextDecoder().decode(response.data);
      } else {
        throw new Error(`无法读取内容文件: ${path}`);
      }
    } else {
      const response = await fetch(contentUrl(path));
      if (!response.ok) throw new Error(`无法读取内容文件: ${path} (${response.status})`);
      text = await response.text();
    }

    this.textCache.set(path, text);
    return text;
  }

  async readBytes(path: string): Promise<ArrayBuffer> {
    if (window.maimai) {
      const response = await window.maimai.readContent(path);
      if (response.data) {
        return response.data.buffer.slice(
          response.data.byteOffset,
          response.data.byteOffset + response.data.byteLength,
        ) as ArrayBuffer;
      }
      if (response.text !== undefined) return new TextEncoder().encode(response.text).buffer;
      throw new Error(`无法读取内容文件: ${path}`);
    }
    const response = await fetch(contentUrl(path));
    if (!response.ok) throw new Error(`无法读取内容文件: ${path} (${response.status})`);
    return response.arrayBuffer();
  }
}

export async function loadPackIndex(source: ContentSource): Promise<string[]> {
  const text = await source.readText('index.json');
  const parsed = JSON.parse(text) as { packs?: unknown };
  if (!Array.isArray(parsed.packs)) throw new Error('index.json 缺少 packs 数组');
  const ids = parsed.packs.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)];
}

export async function loadPack(source: ContentSource, id: string): Promise<LoadedPack> {
  const manifestText = await source.readText(`${id}/pack.json`);
  const parsedManifest = JSON.parse(manifestText) as unknown;
  const manifest = validatePackManifest(parsedManifest, id);

  const charts: Chart[] = [];
  for (const difficulty of manifest.difficulties) {
    const body = await source.readText(`${id}/${difficulty.chart}`);
    const parsed = parseSimai(body, {
      bpm: manifest.bpm,
      difficultyName: difficulty.name,
      level: difficulty.level,
      audioOffsetMs: manifest.audioOffsetMs,
      title: manifest.title,
      artist: manifest.artist,
      charter: manifest.charter,
    });
    if (parsed.warnings.length > 0) {
      console.warn(`[chart] ${manifest.title} / ${difficulty.name}:`, parsed.warnings);
    }
    if (parsed.chart.notes.length === 0) {
      throw new Error(`谱面 ${difficulty.chart} 没有可游玩音符`);
    }
    charts.push(parsed.chart);
  }

  return { manifest, charts, root: id };
}
