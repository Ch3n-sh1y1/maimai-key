import './style.css';
import { primeAudio } from './audio';
import { ContentSource, loadPack, loadPackIndex, type LoadedPack } from './content';
import { getPixiApp } from './pixi';
import { PlaySession, type PlayOutcome } from './play-session';
import { renderCreator } from './creator';
import {
  clearBackground as clearStoredBackground,
  getBackgroundUrl,
  initBackgrounds,
  openBackgroundEditor,
  type BackgroundTarget,
} from './background';
import { isAcceptedImage } from '../core/imageFormat';
import {
  clearHost,
  renderError,
  renderLoading,
  renderResult,
  renderSelect,
  renderSettings,
  renderTitle,
  showPauseOverlay,
  type UiApi,
} from './ui';
import { getScore, loadScores, loadSettings, recordScore, saveReplay, saveSettings, STORAGE_ISSUE_EVENT, type ScoreBook, type ScoreEntry } from './storage';
import type { GameSettings } from '../core/settings';
import type { Replay, ReplayInput } from '../core/replay';
import type { ContentIssue } from '../core/packValidation';

class MaimaiApp implements UiApi {
  readonly source = new ContentSource();
  packs: LoadedPack[] = [];
  contentIssues: ContentIssue[] = [];
  settings: GameSettings = loadSettings();
  scores: ScoreBook = loadScores();
  selection = { pack: 0, difficulty: 0 };
  lastOutcome: PlayOutcome | null = null;
  lastBest: ScoreEntry | undefined;
  lastReplay: Replay | undefined;
  readonly quitAvailable = Boolean(window.maimai);

  private readonly host = document.getElementById('ui')!;
  private session: PlaySession | null = null;
  private cleanup: (() => void) | null = null;
  private pauseCleanup: (() => void) | null = null;
  private currentAuto = false;
  private currentReplayInputs: ReplayInput[] | undefined;
  private settingsOrigin: 'title' | 'select' = 'title';
  private readonly jacketUrls = new Map<string, string>();
  private gameDropCleanup: (() => void) | null = null;
  private gameNavCleanup: (() => void) | null = null;

  jacketUrl(packId: string): string | undefined {
    return this.jacketUrls.get(packId);
  }

  async boot(): Promise<void> {
    window.addEventListener('pointerdown', () => primeAudio(), { once: true });
    window.addEventListener('keydown', () => primeAudio(), { once: true });
    this.installDropGuard();
    window.addEventListener(STORAGE_ISSUE_EVENT, (event) => {
      this.showToast(String((event as CustomEvent<string>).detail ?? '存储写入失败'));
    });

    try {
      await this.loadAllContent();
      await initBackgrounds();
    } catch (error) {
      renderError(this.host, `内容加载失败：\n${(error as Error).message}`, () => window.location.reload());
      return;
    }

    this.showTitle();
    if (this.settings.fullscreen && window.maimai) {
      void window.maimai.setFullscreen(true);
    }
    window.maimai?.onFullscreenChange((fullscreen) => {
      if (this.settings.fullscreen === fullscreen) return;
      this.settings = { ...this.settings, fullscreen };
      saveSettings(this.settings);
    });
  }

  private showToast(message: string): void {
    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }
  private installDropGuard(): void {
    const hasFiles = (event: DragEvent): boolean =>
      Boolean(event.dataTransfer?.types.includes('Files'));
    window.addEventListener(
      'dragover',
      (event) => {
        if (hasFiles(event)) event.preventDefault();
      },
      true,
    );
    window.addEventListener(
      'drop',
      (event) => {
        const target = event.target;
        const editable =
          target instanceof HTMLElement &&
          Boolean(target.closest('input, textarea, [contenteditable="true"]'));
        if (!editable) event.preventDefault();
      },
      true,
    );
  }
  private async loadAllContent(): Promise<void> {
    const ids = await loadPackIndex(this.source);
    const results = await Promise.allSettled(ids.map((id) => loadPack(this.source, id)));
    const packs: LoadedPack[] = [];
    const issues: ContentIssue[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        packs.push(result.value);
      } else {
        const packId = ids[index] ?? 'unknown';
        issues.push({
          packId,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    this.packs = packs;
    this.contentIssues = issues;
    if (packs.length === 0) {
      throw new Error(
        issues.length > 0
          ? `没有可用曲包：\n${issues.map((issue) => `${issue.packId}: ${issue.reason}`).join('\n')}`
          : '曲库为空，请检查 content/index.json',
      );
    }
    for (const url of this.jacketUrls.values()) URL.revokeObjectURL(url);
    this.jacketUrls.clear();
    await Promise.all(
      this.packs.map(async (pack) => {
        const jacket = pack.manifest.jacket;
        if (!jacket) return;
        try {
          const bytes = await this.source.readBytes(`${pack.manifest.id}/${jacket}`);
          const url = URL.createObjectURL(new Blob([bytes], { type: imageMime(jacket) }));
          this.jacketUrls.set(pack.manifest.id, url);
        } catch (error) {
          console.warn(`jacket load failed: ${pack.manifest.id}`, error);
        }
      }),
    );
    if (this.packs.length > 0) {
      this.selection.pack = Math.min(this.selection.pack, this.packs.length - 1);
      const count = this.packs[this.selection.pack]!.manifest.difficulties.length;
      this.selection.difficulty = Math.min(this.selection.difficulty, Math.max(0, count - 1));
    }
  }

  backgroundUrl(target: BackgroundTarget): string | null {
    return getBackgroundUrl(target);
  }

  async editBackground(target: BackgroundTarget, file?: File): Promise<void> {
    try {
      const saved = await openBackgroundEditor(target, file);
      if (!saved) return;
      if (target === 'game') {
        this.session?.setBackground(getBackgroundUrl('game'));
      }
    } catch (error) {
      console.warn('background editor failed', error);
    }
  }

  async clearBackground(target: BackgroundTarget): Promise<void> {
    await clearStoredBackground(target);
    if (target === 'game') this.session?.setBackground(null);
  }

  async refreshContent(): Promise<void> {
    this.source.clearCache();
    await this.loadAllContent();
  }

  openCreator(from: 'title' | 'select'): void {
    this.destroySession();
    this.showScreen(() => renderCreator(this.host, this, from));
  }
  backToTitle(): void {
    this.destroySession();
    this.showScreen(() => renderTitle(this.host, this));
  }

  backToSelect(): void {
    this.destroySession();
    this.showScreen(() => renderSelect(this.host, this));
  }

  openSettings(from: 'title' | 'select'): void {
    this.settingsOrigin = from;
    this.showScreen(() => renderSettings(this.host, this, from));
  }

  updateSettings(next: GameSettings): void {
    this.settings = next;
    saveSettings(next);
    if (this.settingsOrigin === 'select') {
      // Keep the settings screen mounted; only persist.
    }
  }

  quit(): void {
    if (window.maimai) window.maimai.quit();
    else window.close();
  }

  retry(): void {
    const outcome = this.lastOutcome;
    if (!outcome) {
      this.backToSelect();
      return;
    }
    const index = this.packs.findIndex((pack) => pack.manifest.id === outcome.pack.manifest.id);
    if (outcome.replayMode && this.lastReplay) {
      this.start(Math.max(0, index), outcome.difficultyIndex, false, this.lastReplay.inputs);
      return;
    }
    this.start(Math.max(0, index), outcome.difficultyIndex, outcome.auto);
  }

  playReplay(): void {
    if (!this.lastReplay) return;
    const index = this.packs.findIndex((pack) => pack.manifest.id === this.lastReplay!.packId);
    if (index < 0) return;
    this.start(index, this.lastReplay.difficulty, false, this.lastReplay.inputs);
  }

  start(packIndex: number, difficultyIndex: number, auto: boolean, replayInputs?: ReplayInput[]): void {
    const pack = this.packs[packIndex];
    if (!pack) {
      this.backToSelect();
      return;
    }
    this.selection = { pack: packIndex, difficulty: difficultyIndex };
    this.currentAuto = auto;
    this.currentReplayInputs = replayInputs;
    primeAudio();
    this.destroySession();
    this.clearScreenCleanup();
    clearHost(this.host);
    renderLoading(this.host, '正在载入音频与谱面…');

    void (async () => {
      try {
        const app = await getPixiApp();
        const bytes = await this.source.readBytes(`${pack.manifest.id}/${pack.manifest.audio}`);
        clearHost(this.host);
        const session = new PlaySession(
          {
            app,
            pack,
            difficultyIndex,
            settings: this.settings,
            auto,
            audioBytes: bytes,
            backgroundUrl: getBackgroundUrl('game'),
            ...(replayInputs ? { replayInputs } : {}),
          },
          {
            onFinish: (outcome) => this.handleFinish(outcome),
            onPauseChange: (paused) => this.handlePause(paused),
          },
        );
        this.session = session;
        await session.start();
        this.installGameDrop();
        this.installGameNav();
      } catch (error) {
        this.destroySession();
        renderError(this.host, `无法开始游戏：\n${(error as Error).message}`, () => this.backToSelect());
      }
    })();
  }

  private handleFinish(outcome: PlayOutcome): void {
    this.lastOutcome = outcome;
    const difficultyName = outcome.pack.manifest.difficulties[outcome.difficultyIndex]!.name;
    if (!outcome.auto && !outcome.replayMode) {
      this.scores = recordScore(this.scores, outcome.pack.manifest.id, difficultyName, {
        achievement: outcome.stats.achievement,
        grade: outcome.grade,
        counts: outcome.stats.counts,
        maxCombo: outcome.stats.maxCombo,
        isAllPerfect: outcome.stats.isAllPerfect,
        isFullCombo: outcome.stats.isFullCombo,
        assisted: false,
      });
      if (outcome.inputs.length > 0) {
        const replay: Replay = {
          version: 1,
          packId: outcome.pack.manifest.id,
          difficulty: outcome.difficultyIndex,
          difficultyName,
          title: outcome.pack.manifest.title,
          createdAt: Date.now(),
          inputs: outcome.inputs,
        };
        this.lastReplay = replay;
        saveReplay(replay);
      }
    }
    this.lastBest = getScore(this.scores, outcome.pack.manifest.id, difficultyName);
    this.session?.destroy();
    this.session = null;
    this.pauseCleanup?.();
    this.pauseCleanup = null;
    this.showScreen(() => renderResult(this.host, this));
  }

  private installGameNav(): void {
    this.gameNavCleanup?.();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-pill game-pause-button';
    button.setAttribute('data-action', 'pause');
    button.setAttribute('aria-label', '暂停游戏');
    button.innerHTML = '<span class="nav-arrow" aria-hidden="true">Ⅱ</span> 暂停 <kbd>Esc</kbd>';
    button.addEventListener('click', () => this.session?.togglePause());
    this.host.appendChild(button);
    this.gameNavCleanup = () => button.remove();
  }
  private installGameDrop(): void {
    this.gameDropCleanup?.();
    const imageFrom = (event: DragEvent): File | null =>
      Array.from(event.dataTransfer?.files ?? []).find((file) =>
        isAcceptedImage(file.name, file.type),
      ) ?? null;
    const onDragOver = (event: DragEvent) => {
      if (!this.session || document.querySelector('[data-bg-editor]')) return;
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (!this.session || document.querySelector('[data-bg-editor]')) return;
      const file = imageFrom(event);
      if (!file) return;
      event.preventDefault();
      this.session.pause();
      void this.editBackground('game', file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    this.gameDropCleanup = () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }
  private handlePause(paused: boolean): void {
    if (paused) {
      this.pauseCleanup = showPauseOverlay(this.host, {
        resume: () => {
          this.pauseCleanup?.();
          this.pauseCleanup = null;
          void this.session?.resume();
        },
        home: () => {
          this.pauseCleanup?.();
          this.pauseCleanup = null;
          this.backToTitle();
        },
        retry: () => {
          this.pauseCleanup?.();
          this.pauseCleanup = null;
          this.destroySession();
          const index = this.packs.findIndex((pack) => pack.manifest.id === this.lastOutcome?.pack.manifest.id);
          this.start(
            index >= 0 ? index : this.selection.pack,
            this.selection.difficulty,
            this.currentAuto,
            this.currentReplayInputs,
          );
        },
        quit: () => {
          this.pauseCleanup?.();
          this.pauseCleanup = null;
          this.destroySession();
          this.backToSelect();
        },
      });
    } else {
      this.pauseCleanup?.();
      this.pauseCleanup = null;
    }
  }

  private showTitle(): void {
    this.destroySession();
    this.showScreen(() => renderTitle(this.host, this));
  }

  private showScreen(create: () => () => void): void {
    this.clearScreenCleanup();
    this.cleanup = create();
  }

  private clearScreenCleanup(): void {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  }

  private destroySession(): void {
    this.gameNavCleanup?.();
    this.gameNavCleanup = null;
    this.gameDropCleanup?.();
    this.gameDropCleanup = null;
    if (this.session) {
      this.session.destroy();
      this.session = null;
    }
    this.pauseCleanup?.();
    this.pauseCleanup = null;
  }
}

const app = new MaimaiApp();
void app.boot();

declare global {
  interface Window {
    __maimaiApp?: MaimaiApp;
  }
}
window.__maimaiApp = app;

function imageMime(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}