import type { GameSettings } from '../core/settings';
import { JUDGE_PRESETS, type JudgePresetName } from '../core/balance';
import { formatAchievement } from '../core/score';
import type { JudgmentCounts } from '../core/score';
import type { HudPreset, InputMode, NoteDirection, SlideMode } from '../core/settings';
import type { LoadedPack } from './content';
import type { ScoreBook, ScoreEntry } from './storage';
import { getScore } from './storage';
import type { PlayOutcome } from './play-session';
import type { Replay } from '../core/replay';
import { keyLabel } from './input';
import { showCalibration } from './calibration';
import type { BackgroundTarget } from './background';
import { isAcceptedImage } from '../core/imageFormat';
import { isModalOpen } from './modal';
import { APP_VERSION } from './version';
import type { ContentIssue } from '../core/packValidation';

export interface UiApi {
  readonly packs: LoadedPack[];
  readonly contentIssues: ContentIssue[];
  readonly settings: GameSettings;
  readonly scores: ScoreBook;
  readonly quitAvailable: boolean;
  selection: { pack: number; difficulty: number };
  lastOutcome: PlayOutcome | null;
  lastBest: ScoreEntry | undefined;
  lastReplay: Replay | undefined;
  jacketUrl(packId: string): string | undefined;
  start(packIndex: number, difficultyIndex: number, auto: boolean): void;
  openSettings(from: 'title' | 'select'): void;
  openCreator(from: 'title' | 'select'): void;
  refreshContent(): Promise<void>;
  backgroundUrl(target: BackgroundTarget): string | null;
  editBackground(target: BackgroundTarget, file?: File): Promise<void>;
  clearBackground(target: BackgroundTarget): Promise<void>;
  updateSettings(next: GameSettings): void;
  quit(): void;
  backToTitle(): void;
  backToSelect(): void;
  retry(): void;
  playReplay(): void;
}

const DIFF_COLORS = ['#9be15d', '#ffe066', '#ff9f6e', '#ff7b9c', '#c59bff'];

const SECTOR_NAMES: Record<number, string> = {
  1: '上',
  2: '右上',
  3: '右',
  4: '右下',
  5: '下',
  6: '左下',
  7: '左',
  8: '左上',
};

export function clearHost(host: HTMLElement): void {
  host.replaceChildren();
}

export function renderLoading(host: HTMLElement, text: string): void {
  clearHost(host);
  const screen = document.createElement('div');
  screen.className = 'screen loading-screen';
  screen.innerHTML = `<div class="spinner"></div><p>${escapeHtml(text)}</p>`;
  host.appendChild(screen);
}

export function renderError(host: HTMLElement, message: string, onBack: () => void): void {
  clearHost(host);
  const screen = document.createElement('div');
  screen.className = 'screen error-screen';
  const title = document.createElement('h2');
  title.textContent = '出错了';
  const body = document.createElement('pre');
  body.textContent = message;
  const info = document.createElement('p');
  info.className = 'muted error-version';
  info.textContent = `MaimaiKey v${APP_VERSION} · 错误详情已写入启动日志`;
  const actions = document.createElement('div');
  actions.className = 'error-actions';
  const button = document.createElement('button');
  button.className = 'primary';
  button.textContent = '返回选曲';
  button.addEventListener('click', onBack);
  const copy = document.createElement('button');
  copy.textContent = '复制错误信息';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${message}\n\nMaimaiKey v${APP_VERSION}`);
      copy.textContent = '已复制';
    } catch {
      copy.textContent = '复制失败，请手动选择上方文本';
    }
  });
  actions.append(button, copy);
  screen.append(title, body, info, actions);
  host.appendChild(screen);
}

export function renderTitle(host: HTMLElement, api: UiApi): () => void {
  clearHost(host);
  const screen = document.createElement('div');
  screen.className = 'screen title-screen';
  screen.innerHTML = `
    <div class="custom-photo" data-bg-photo hidden></div>
    <div class="title-glow"></div>
    <div class="title-rings" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <div class="title-content">
      <section class="title-menu" aria-label="主菜单">
        <p class="eyebrow">MAIN MENU</p>
        <div class="menu">
          <button class="primary" data-action="start"><span>开始游戏</span><kbd>Enter</kbd></button>
          <button data-action="creator"><span>自动打谱</span><kbd>C</kbd></button>
          <button data-action="background"><span>背景</span><kbd>B</kbd></button>
          <button data-action="settings"><span>设置</span><kbd>S</kbd></button>
          <button data-action="quit"${api.quitAvailable ? '' : ' disabled title="仅桌面版可用"'}>
            <span>退出</span><kbd>Esc</kbd>
          </button>
        </div>
        <p class="footnote">v${APP_VERSION} · 原创占位素材 · 拖照片到窗口换背景</p>
      </section>
      <section class="title-hero">
        <p class="eyebrow">A KEYBOARD RHYTHM GAME</p>
        <h1 class="brand">MAIMAI<span>KEY</span></h1>
        <p class="tagline">键盘舞萌 · 把 8 键圆环搬到你的桌面</p>
        <span class="title-rule" aria-hidden="true"></span>
        <p class="title-meta">8 KEY / DESKTOP EDITION</p>
      </section>
    </div>
  `;
  host.appendChild(screen);

  const controller = new AbortController();
  const photo = screen.querySelector<HTMLElement>('[data-bg-photo]')!;
  const applyBackground = () => {
    const url = api.backgroundUrl('title');
    screen.classList.toggle('has-photo', Boolean(url));
    photo.hidden = !url;
    photo.style.backgroundImage = url ? `url("${url}")` : '';
  };
  applyBackground();
  const onBackgroundChanged = (event: Event) => {
    if ((event as CustomEvent<{ target?: string }>).detail?.target === 'title') applyBackground();
  };
  window.addEventListener('maimai:background-changed', onBackgroundChanged);

  const hasImageDrop = (event: DragEvent): boolean =>
    Boolean(event.dataTransfer?.types.includes('Files')) ||
    Array.from(event.dataTransfer?.files ?? []).some((file) => isAcceptedImage(file.name, file.type));
  screen.addEventListener(
    'dragover',
    (event) => {
      if (!hasImageDrop(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      screen.classList.add('photo-drop');
    },
    { signal: controller.signal },
  );
  screen.addEventListener(
    'dragleave',
    (event) => {
      if (event.target === screen) screen.classList.remove('photo-drop');
    },
    { signal: controller.signal },
  );
  screen.addEventListener(
    'drop',
    (event) => {
      event.preventDefault();
      screen.classList.remove('photo-drop');
      const file = Array.from(event.dataTransfer?.files ?? []).find((item) =>
        isAcceptedImage(item.name, item.type),
      );
      if (file) void api.editBackground('title', file);
    },
    { signal: controller.signal },
  );

  const start = () => api.backToSelect();
  screen.querySelector('[data-action="start"]')?.addEventListener('click', start);
  screen.querySelector('[data-action="settings"]')?.addEventListener('click', () => api.openSettings('title'));
  screen.querySelector('[data-action="creator"]')?.addEventListener('click', () => api.openCreator('title'));
  screen.querySelector('[data-action="background"]')?.addEventListener('click', () => void api.editBackground('title'));
  screen.querySelector('[data-action="quit"]')?.addEventListener('click', () => {
    if (api.quitAvailable) api.quit();
  });
  window.addEventListener(
    'keydown',
    (event) => {
      if (isModalOpen()) return;
      if (event.code === 'Enter' || event.code === 'Space') {
        event.preventDefault();
        start();
      } else if (event.code === 'Escape' && api.quitAvailable) {
        event.preventDefault();
        api.quit();
      } else if (event.code === 'KeyS') {
        api.openSettings('title');
      } else if (event.code === 'KeyC') {
        api.openCreator('title');
      } else if (event.code === 'KeyB') {
        void api.editBackground('title');
      }
    },
    { signal: controller.signal },
  );
  return () => {
    controller.abort();
    window.removeEventListener('maimai:background-changed', onBackgroundChanged);
  };
}

export function renderSelect(host: HTMLElement, api: UiApi): () => void {
  clearHost(host);
  const { packs } = api;
  if (packs.length === 0) {
    renderError(host, '没有找到任何内容包。请检查 public/content 目录。', () => undefined);
    return () => undefined;
  }

  let packIndex = Math.min(api.selection.pack, packs.length - 1);
  let difficulty = Math.min(api.selection.difficulty, packs[packIndex]!.manifest.difficulties.length - 1);

  const screen = document.createElement('div');
  screen.className = 'screen select-screen';
  screen.innerHTML = `
    <header class="screen-header">
      <div class="screen-heading">
        <button class="nav-pill" data-action="title" title="返回主页">
          <span class="nav-arrow" aria-hidden="true">←</span> 主页 <kbd>Esc</kbd>
        </button>
        <div>
          <p class="eyebrow">SONG SELECT</p>
          <h2>选曲</h2>
        </div>
      </div>
      <div class="header-right">
        <button data-action="folder">导入曲包</button>
        <button data-action="creator">自动打谱 <kbd>C</kbd></button>
        <button data-action="settings">设置 <kbd>S</kbd></button>
        <p class="hint">↑↓ 选曲 · ←→ 难度 · Enter 开始</p>
      </div>
    </header>
    ${api.contentIssues.length > 0 ? `
      <details class="content-issues">
        <summary>已跳过 ${api.contentIssues.length} 个损坏的曲包</summary>
        <ul>${api.contentIssues.map((issue) => `<li><strong>${escapeHtml(issue.packId)}</strong>：${escapeHtml(issue.reason)}</li>`).join('')}</ul>
      </details>` : ''}
    <div class="select-body">
      <section class="song-list" aria-label="曲目列表"></section>
      <section class="difficulty-panel">
        <div class="difficulty-tabs" role="tablist"></div>
        <div class="chart-info"></div>
        <div class="select-actions">
          <button class="primary" data-action="play">开始游戏 <kbd>Enter</kbd></button>
          <button data-action="auto">AUTO 演示</button>
        </div>
      </section>
    </div>
  `;
  host.appendChild(screen);

  const listEl = screen.querySelector<HTMLElement>('.song-list')!;
  const tabsEl = screen.querySelector<HTMLElement>('.difficulty-tabs')!;
  const infoEl = screen.querySelector<HTMLElement>('.chart-info')!;

  const renderList = () => {
    listEl.replaceChildren();
    packs.forEach((pack, index) => {
      const card = document.createElement('button');
      card.className = `song-card ${index === packIndex ? 'selected' : ''}`;
      card.type = 'button';
      const jacket = document.createElement('div');
      jacket.className = 'jacket';
      const jacketUrl = api.jacketUrl(pack.manifest.id);
      if (jacketUrl) {
        const img = document.createElement('img');
        img.src = jacketUrl;
        img.alt = pack.manifest.title;
        img.onerror = () => {
          img.remove();
        };
        jacket.appendChild(img);
      }
      jacket.appendChild(makeJacketFallback(pack.manifest.title));
      const meta = document.createElement('div');
      meta.className = 'song-meta';
      meta.innerHTML = `<h3>${escapeHtml(pack.manifest.title)}</h3>
        <p>${escapeHtml(pack.manifest.artist)} · BPM ${pack.manifest.bpm}</p>
        <p class="muted">谱师 ${escapeHtml(pack.manifest.charter)}</p>`;
      card.append(jacket, meta);
      card.addEventListener('click', () => {
        packIndex = index;
        difficulty = Math.min(difficulty, packs[packIndex]!.manifest.difficulties.length - 1);
        renderList();
        renderDifficulty();
      });
      listEl.appendChild(card);
    });
  };

  const renderDifficulty = () => {
    const pack = packs[packIndex]!;
    tabsEl.replaceChildren();
    pack.manifest.difficulties.forEach((diff, index) => {
      const best = getScore(api.scores, pack.manifest.id, diff.name);
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `difficulty-tab ${index === difficulty ? 'selected' : ''}`;
      tab.style.setProperty('--diff-color', DIFF_COLORS[index % DIFF_COLORS.length]!);
      tab.innerHTML = `<span class="diff-name">${escapeHtml(diff.name)}</span>
        <span class="diff-level">${diff.level}</span>
        <span class="diff-best">${best ? formatAchievement(best.achievement) : '—'}</span>`;
      tab.addEventListener('click', () => {
        difficulty = index;
        renderDifficulty();
      });
      tabsEl.appendChild(tab);
    });

    const diff = pack.manifest.difficulties[difficulty]!;
    const chart = pack.charts[difficulty]!;
    const best = getScore(api.scores, pack.manifest.id, diff.name);
    const counts = chart.notes.reduce<Record<string, number>>((acc, note) => {
      acc[note.kind] = (acc[note.kind] ?? 0) + 1;
      return acc;
    }, {});
    infoEl.innerHTML = `
      <div class="info-grid">
        <div><span>难度</span><strong>${escapeHtml(diff.name)} ${diff.level}</strong></div>
        <div><span>音符</span><strong>${chart.notes.length}</strong></div>
        <div><span>时长</span><strong>${formatDuration(chart.durationMs)}</strong></div>
        <div><span>BPM</span><strong>${pack.manifest.bpm}</strong></div>
      </div>
      <p class="chart-kinds">${Object.entries(counts)
        .map(([kind, count]) => `${kindLabel(kind)} × ${count}`)
        .join(' · ')}</p>
      <div class="best-row">
        <span>历史最佳</span>
        <strong>${best ? `${formatAchievement(best.achievement)} · ${best.grade}${best.isAllPerfect ? ' · AP' : best.isFullCombo ? ' · FC' : ''}` : '暂无记录'}</strong>
      </div>
    `;
    infoEl.appendChild(makeKeymap(api.settings));
  };

  renderList();
  renderDifficulty();

  const play = (auto: boolean) => {
    api.selection = { pack: packIndex, difficulty };
    api.start(packIndex, difficulty, auto);
  };
  screen.querySelector('[data-action="play"]')?.addEventListener('click', () => play(false));
  screen.querySelector('[data-action="auto"]')?.addEventListener('click', () => play(true));
  screen.querySelector('[data-action="settings"]')?.addEventListener('click', () => api.openSettings('select'));
  screen.querySelector('[data-action="creator"]')?.addEventListener('click', () => api.openCreator('select'));
  screen.querySelector('[data-action="title"]')?.addEventListener('click', () => api.backToTitle());
  screen.querySelector('[data-action="folder"]')?.addEventListener('click', async () => {
    const result = await window.maimai?.openContentFolder();
    if (!result) {
      window.alert('曲库文件夹仅桌面版可用：Documents/MaimaiKey/content');
      return;
    }
    if (result.error) window.alert(`无法打开曲库文件夹：${result.error}`);
  });

  const controller = new AbortController();
  window.addEventListener(
    'keydown',
    (event) => {
      if (isModalOpen()) return;
      const pack = packs[packIndex]!;
      if (event.code === 'ArrowLeft') {
        difficulty = (difficulty + pack.manifest.difficulties.length - 1) % pack.manifest.difficulties.length;
        renderDifficulty();
      } else if (event.code === 'ArrowRight') {
        difficulty = (difficulty + 1) % pack.manifest.difficulties.length;
        renderDifficulty();
      } else if (event.code === 'ArrowUp') {
        packIndex = (packIndex + packs.length - 1) % packs.length;
        difficulty = Math.min(difficulty, packs[packIndex]!.manifest.difficulties.length - 1);
        renderList();
        renderDifficulty();
      } else if (event.code === 'ArrowDown') {
        packIndex = (packIndex + 1) % packs.length;
        difficulty = Math.min(difficulty, packs[packIndex]!.manifest.difficulties.length - 1);
        renderList();
        renderDifficulty();
      } else if (event.code === 'Enter') {
        event.preventDefault();
        play(false);
      } else if (event.code === 'KeyS') {
        api.openSettings('select');
      } else if (event.code === 'KeyC') {
        api.openCreator('select');
      } else if (event.code === 'Escape') {
        api.backToTitle();
      }
    },
    { signal: controller.signal },
  );

  return () => controller.abort();
}

export function renderSettings(host: HTMLElement, api: UiApi, from: 'title' | 'select'): () => void {
  clearHost(host);
  const settings = api.settings;
  const screen = document.createElement('div');
  screen.className = 'screen settings-screen';
  screen.innerHTML = `
    <header class="screen-header">
      <div class="screen-heading">
        <button class="nav-pill" data-action="back" title="返回上一页">
          <span class="nav-arrow" aria-hidden="true">←</span> 返回 <kbd>Esc</kbd>
        </button>
        <div><p class="eyebrow">SETTINGS · v${APP_VERSION}</p><h2>设置</h2></div>
      </div>
    </header>
    <div class="settings-body">
      <section class="panel"><h3>判定</h3><div class="rows" data-rows="judge"></div></section>
      <section class="panel"><h3>偏移与速度</h3><div class="rows" data-rows="offsets"></div></section>
      <section class="panel"><h3>键位</h3><div class="rows" data-rows="keys"></div>
        <div class="key-presets"></div>
      </section>
      <section class="panel"><h3>显示与声音</h3><div class="rows" data-rows="display"></div></section>
    </div>

  `;
  host.appendChild(screen);

  const update = (patch: Partial<GameSettings>) => {
    api.updateSettings({ ...api.settings, ...patch });
  };

  const judgeRows = screen.querySelector<HTMLElement>('[data-rows="judge"]')!;
  const offsetRows = screen.querySelector<HTMLElement>('[data-rows="offsets"]')!;
  const keyRows = screen.querySelector<HTMLElement>('[data-rows="keys"]')!;
  const displayRows = screen.querySelector<HTMLElement>('[data-rows="display"]')!;

  // Judge preset
  judgeRows.appendChild(
    row(
      '判定预设',
      selectEl(
        Object.entries(JUDGE_PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
        settings.judgePreset,
        (value) => update({ judgePreset: value as JudgePresetName }),
      ),
      '键盘友好会放宽判定窗口',
    ),
  );
  judgeRows.appendChild(
    row(
      '滑条模式',
      selectEl(
        [
          { value: 'waypoint', label: '路径键（按顺序敲路点）' },
          { value: 'auto', label: '自动滑条（只判起点）' },
        ],
        settings.slideMode,
        (value) => update({ slideMode: value as SlideMode }),
      ),
      '路径键更像街机；自动滑条适合休闲',
    ),
  );

  // Offsets & speed
  offsetRows.appendChild(
    row(
      '音符可视时间',
      sliderEl(0.7, 4, 0.05, settings.approachSeconds, (v) => `${v.toFixed(2)} s`, (v) => update({ approachSeconds: v })),
      '数值越大，音符下落越慢',
    ),
  );
  offsetRows.appendChild(
    row('音频偏移', sliderEl(-200, 200, 1, settings.offsets.audioMs, (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} ms`, (v) => update({ offsets: { ...api.settings.offsets, audioMs: v } })), '整体音符相对音乐提前/延后'),
  );
  offsetRows.appendChild(
    row('输入偏移', sliderEl(-200, 200, 1, settings.offsets.inputMs, (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} ms`, (v) => update({ offsets: { ...api.settings.offsets, inputMs: v } })), '总是 FAST 就调大，总是 LATE 就调小'),
  );
  offsetRows.appendChild(
    row('显示偏移', sliderEl(-200, 200, 1, settings.offsets.visualMs, (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} ms`, (v) => update({ offsets: { ...api.settings.offsets, visualMs: v } })), '只影响画面，不影响判定'),
  );

  const calibrateButton = document.createElement('button');
  calibrateButton.textContent = '开始校准';
  calibrateButton.addEventListener('click', () => {
    showCalibration(host, (inputMs) => {
      api.updateSettings({
        ...api.settings,
        offsets: { ...api.settings.offsets, inputMs },
      });
      api.openSettings(from);
    });
  });
  offsetRows.appendChild(
    row('延迟校准', calibrateButton, '跟着节拍敲空格，自动估算输入偏移'),
  );

  // Key bindings
  const keyPresetSelect = document.createElement('select');
  keyPresetSelect.innerHTML = '<option value="">自定义</option>';
  const presets: Record<string, Record<string, number>> = {
    unrolled: { KeyA: 5, KeyS: 6, KeyD: 7, KeyF: 8, KeyJ: 1, KeyK: 2, KeyL: 3, Semicolon: 4 },
    compact: { KeyS: 5, KeyD: 6, KeyF: 7, KeyG: 8, KeyH: 1, KeyJ: 2, KeyK: 3, KeyL: 4 },
    home: { KeyD: 5, KeyF: 6, KeyG: 7, KeyH: 8, KeyJ: 1, KeyK: 2, KeyL: 3, Semicolon: 4 },
  };
  for (const [id, keys] of Object.entries(presets)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id === 'unrolled' ? '默认 A S D F / J K L ;' : id === 'compact' ? '紧凑 S D F G / H J K L' : '主键区 D F G H / J K L ;';
    option.dataset.keys = JSON.stringify(keys);
    keyPresetSelect.appendChild(option);
  }
  keyPresetSelect.addEventListener('change', () => {
    const option = keyPresetSelect.selectedOptions[0];
    if (!option?.dataset.keys) return;
    update({ keys: JSON.parse(option.dataset.keys) as Record<string, number> });
    api.openSettings(from);
  });

  const keyStatus = document.createElement('p');
  keyStatus.className = 'muted key-status';
  keyStatus.textContent = '点击按键后按下新键即可重新绑定；冲突的键会自动交换。';

  for (let sector = 1; sector <= 8; sector++) {
    const code = Object.keys(settings.keys).find((key) => settings.keys[key] === sector) ?? '未绑定';
    const button = document.createElement('button');
    button.className = 'key-binding';
    button.type = 'button';
    button.textContent = keyLabel(code);
    button.addEventListener('click', () => {
      button.textContent = '按下新键…';
      const handler = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        window.removeEventListener('keydown', handler, true);
        if (event.code === 'Escape') {
          button.textContent = keyLabel(code);
          return;
        }
        const result = rebind(settings.keys, sector, event.code);
        if (!result) {
          keyStatus.textContent = '这个按键已被占用，请先给它换一个位置。';
          button.textContent = keyLabel(code);
          return;
        }
        update({ keys: result });
        api.openSettings(from);
      };
      window.addEventListener('keydown', handler, true);
    });
    keyRows.appendChild(row(`${sector} · ${SECTOR_NAMES[sector]}`, button));
  }
  keyRows.appendChild(keyStatus);
  screen.querySelector('.key-presets')?.appendChild(
    (() => {
      const wrap = document.createElement('div');
      wrap.className = 'row';
      const label = document.createElement('span');
      label.textContent = '键位预设';
      wrap.append(label, keyPresetSelect);
      return wrap;
    })(),
  );

  // Display & sound
  const hudModes: Array<{ value: HudPreset; label: string }> = [
    { value: 'beginner', label: '初学者' },
    { value: 'normal', label: '普通' },
    { value: 'pro', label: '专业' },
  ];
  const hudGroup = document.createElement('div');
  hudGroup.className = 'segmented';
  for (const mode of hudModes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = mode.label;
    button.className = settings.hudPreset === mode.value ? 'active' : '';
    button.addEventListener('click', () => {
      update({ hudPreset: mode.value });
      for (const node of hudGroup.querySelectorAll('button')) {
        node.classList.toggle('active', node === button);
      }
    });
    hudGroup.appendChild(button);
  }
  const backgroundControls = (target: BackgroundTarget): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'background-control';
    const choose = document.createElement('button');
    choose.textContent = '选择照片';
    choose.addEventListener('click', () => {
      void api.editBackground(target).then(() => refresh());
    });
    const reset = document.createElement('button');
    reset.textContent = '恢复默认';
    reset.addEventListener('click', () => {
      void api.clearBackground(target).then(() => refresh());
    });
    const refresh = () => {
      reset.disabled = !api.backgroundUrl(target);
    };
    wrap.append(choose, reset);
    refresh();
    return wrap;
  };

  displayRows.appendChild(
    row('主页面背景', backgroundControls('title'), '也可以把照片直接拖到标题界面'),
  );
  displayRows.appendChild(
    row('游戏背景', backgroundControls('game'), '也可以把照片直接拖到游戏画面'),
  );
  displayRows.appendChild(
    row('游玩界面', hudGroup, '初学者放大键位提示；专业隐藏键位与轨道'),
  );
  displayRows.appendChild(
    row(
      '输入方式',
      selectEl(
        [
          { value: 'keyboard', label: '键盘（横向琴键）' },
          { value: 'touch', label: '触摸屏（八区）' },
        ],
        settings.inputMode,
        (value) => update({ inputMode: value as InputMode }),
      ),
      '键盘使用琴键布局；触摸屏使用八个扇区，支持多点',
    ),
  );
  displayRows.appendChild(
    row(
      '音符方向',
      selectEl(
        [
          { value: 'down', label: '从上往下' },
          { value: 'up', label: '从下往上' },
        ],
        settings.noteDirection,
        (value) => update({ noteDirection: value as NoteDirection }),
      ),
      '仅影响键盘琴键布局',
    ),
  );  displayRows.appendChild(row('主音量', sliderEl(0, 100, 1, settings.volume * 100, (v) => `${v.toFixed(0)}%`, (v) => update({ volume: v / 100 }))));
  displayRows.appendChild(row('音效音量', sliderEl(0, 100, 1, settings.sfxVolume * 100, (v) => `${v.toFixed(0)}%`, (v) => update({ sfxVolume: v / 100 }))));
  displayRows.appendChild(row('帧率上限', selectEl(
    [60, 120, 144, 240, 360].map((value) => ({ value: String(value), label: `${value} FPS` })),
    String(settings.fpsCap),
    (value) => update({ fpsCap: Number(value) }),
  )));
  displayRows.appendChild(row('键帽提示', checkboxEl(settings.showKeyHints, (checked) => update({ showKeyHints: checked })), '专业模式会强制隐藏'));
  displayRows.appendChild(row('FAST / LATE 提示', checkboxEl(settings.showFastLate, (checked) => update({ showFastLate: checked }))));
  const fullscreenToggle = checkboxEl(settings.fullscreen, (checked) => {
    update({ fullscreen: checked });
    void window.maimai?.setFullscreen(checked);
  }) as HTMLInputElement;
  displayRows.appendChild(row('全屏', fullscreenToggle, api.quitAvailable ? '' : '浏览器中没有全屏接口'));
  const unsubscribeFullscreen = window.maimai?.onFullscreenChange((fullscreen) => {
    if (fullscreenToggle.checked === fullscreen) return;
    fullscreenToggle.checked = fullscreen;
    update({ fullscreen });
  });

  screen.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    if (from === 'select') api.backToSelect();
    else api.backToTitle();
  });

  const controller = new AbortController();
  window.addEventListener(
    'keydown',
    (event) => {
      if (isModalOpen()) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        if (from === 'select') api.backToSelect();
        else api.backToTitle();
      }
    },
    { signal: controller.signal },
  );
  return () => {
    unsubscribeFullscreen?.();
    controller.abort();
  };
}

export function renderResult(host: HTMLElement, api: UiApi): () => void {
  const outcome = api.lastOutcome;
  if (!outcome) {
    api.backToSelect();
    return () => undefined;
  }
  clearHost(host);
  const diff = outcome.pack.manifest.difficulties[outcome.difficultyIndex]!;
  const stats = outcome.stats;
  const best = api.lastBest;
  const screen = document.createElement('div');
  screen.className = 'screen result-screen';
  screen.innerHTML = `
    <nav class="result-nav" aria-label="结算导航">
      <button class="nav-pill" data-action="select"><span class="nav-arrow" aria-hidden="true">←</span> 选曲 <kbd>Esc</kbd></button>
      <button class="nav-pill" data-action="title">主页 <kbd>T</kbd></button>
    </nav>
    <div class="result-card">
      <header>
        <p class="eyebrow">${outcome.replayMode ? 'REPLAY' : 'RESULT'}</p>
        <h2>${escapeHtml(outcome.pack.manifest.title)}</h2>
        <p class="muted">${escapeHtml(diff.name)} ${diff.level}${outcome.auto ? ' · AUTO' : ''}${outcome.replayMode ? ' · 回放' : ''}</p>
      </header>
      <div class="result-main">
        <div class="grade grade-${outcome.grade.replace('+', 'plus')}">${outcome.grade}</div>
        <div class="result-score">
          <strong>${formatAchievement(stats.achievement)}</strong>
          <span>MAX COMBO ${stats.maxCombo}</span>
          <div class="badges">
            ${stats.isAllPerfect ? '<span class="badge ap">ALL PERFECT</span>' : ''}
            ${stats.isFullCombo && !stats.isAllPerfect ? '<span class="badge fc">FULL COMBO</span>' : ''}
            ${outcome.auto ? '<span class="badge auto">AUTO</span>' : ''}
            ${outcome.replayMode ? '<span class="badge auto">REPLAY</span>' : ''}
          </div>
        </div>
      </div>
      <div class="judge-table"></div>
      <div class="result-extra">
        <span>FAST ${stats.fast}</span><span>LATE ${stats.late}</span>
        <span>空击 ${stats.emptyPresses}</span>
        ${best ? `<span>历史最佳 ${formatAchievement(best.achievement)} · ${best.grade}</span>` : ''}
      </div>
      <div class="result-actions">
        <button class="primary" data-action="retry">${outcome.replayMode ? '再次回放' : '再来一次'} <kbd>Enter</kbd></button>
        ${!outcome.auto && !outcome.replayMode && api.lastReplay ? '<button data-action="replay">回放 <kbd>R</kbd></button>' : ''}

      </div>
    </div>
  `;
  host.appendChild(screen);

  const table = screen.querySelector<HTMLElement>('.judge-table')!;
  const judgments: Array<[keyof JudgmentCounts, string, string]> = [
    ['critical', 'CRITICAL', 'critical'],
    ['perfect', 'PERFECT', 'perfect'],
    ['great', 'GREAT', 'great'],
    ['good', 'GOOD', 'good'],
    ['miss', 'MISS', 'miss'],
  ];
  for (const [key, label, color] of judgments) {
    const cell = document.createElement('div');
    cell.className = `judge-cell judge-${color}`;
    cell.innerHTML = `<span>${label}</span><strong>${stats.counts[key]}</strong>`;
    table.appendChild(cell);
  }

  screen.querySelector('[data-action="retry"]')?.addEventListener('click', () => api.retry());
  screen.querySelector('[data-action="replay"]')?.addEventListener('click', () => api.playReplay());
  screen.querySelector('[data-action="select"]')?.addEventListener('click', () => api.backToSelect());
  screen.querySelector('[data-action="title"]')?.addEventListener('click', () => api.backToTitle());

  const controller = new AbortController();
  window.addEventListener(
    'keydown',
    (event) => {
      if (isModalOpen()) return;
      if (event.code === 'Enter' || event.code === 'Space') {
        event.preventDefault();
        api.retry();
      } else if (event.code === 'Escape') {
        api.backToSelect();
      } else if (event.code === 'KeyT') {
        api.backToTitle();
      } else if (event.code === 'KeyR' && api.lastReplay && !outcome.auto && !outcome.replayMode) {
        api.playReplay();
      }
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}

export function showPauseOverlay(
  host: HTMLElement,
  handlers: { resume: () => void; retry: () => void; home: () => void; quit: () => void },
): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay';
  overlay.innerHTML = `
    <div class="pause-card">
      <p class="eyebrow">PAUSED</p>
      <h2>已暂停</h2>
      <p class="muted">按 Esc 继续</p>
      <div class="pause-actions">
        <button class="primary" data-action="resume">继续</button>
        <button data-action="retry">重试</button>
        <button data-action="home">返回主页面</button>
        <button data-action="quit">选曲</button>
      </div>
    </div>
  `;
  overlay.querySelector('[data-action="resume"]')?.addEventListener('click', handlers.resume);
  overlay.querySelector('[data-action="retry"]')?.addEventListener('click', handlers.retry);
  overlay.querySelector('[data-action="home"]')?.addEventListener('click', handlers.home);
  overlay.querySelector('[data-action="quit"]')?.addEventListener('click', handlers.quit);
  host.appendChild(overlay);
  return () => overlay.remove();
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function row(label: string, control: HTMLElement, note?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const labelEl = document.createElement('span');
  labelEl.className = 'row-label';
  labelEl.textContent = label;
  const controlWrap = document.createElement('div');
  controlWrap.className = 'row-control';
  controlWrap.appendChild(control);
  if (note) {
    const noteEl = document.createElement('em');
    noteEl.className = 'row-note';
    noteEl.textContent = note;
    controlWrap.appendChild(noteEl);
  }
  wrap.append(labelEl, controlWrap);
  return wrap;
}

function selectEl(
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value === value;
    select.appendChild(element);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function sliderEl(
  min: number,
  max: number,
  step: number,
  value: number,
  format: (value: number) => string,
  onChange: (value: number) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const output = document.createElement('span');
  output.textContent = format(value);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    output.textContent = format(next);
    onChange(next);
  });
  wrap.append(input, output);
  return wrap;
}

function checkboxEl(checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.className = 'checkbox';
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function rebind(keys: Record<string, number>, sector: number, newCode: string): Record<string, number> | null {
  const next: Record<string, number> = { ...keys };
  const oldCode = Object.keys(next).find((code) => next[code] === sector);
  const conflictSector = next[newCode];
  if (conflictSector !== undefined && conflictSector !== sector && !oldCode) return null;
  if (oldCode) delete next[oldCode];
  if (conflictSector !== undefined && conflictSector !== sector && oldCode) {
    next[oldCode] = conflictSector;
  }
  delete next[newCode];
  next[newCode] = sector;
  return next;
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    tap: 'TAP',
    hold: 'HOLD',
    slide: 'SLIDE',
    touch: 'TOUCH',
    touchHold: 'TOUCH HOLD',
  };
  return labels[kind] ?? kind;
}

function makeJacketFallback(title: string): HTMLElement {
  const fallback = document.createElement('span');
  fallback.className = 'jacket-fallback';
  fallback.textContent = title.slice(0, 1).toUpperCase();
  return fallback;
}

function makeKeymap(settings: GameSettings): HTMLElement {
  const keyOf = (sector: number): string => {
    const code = Object.keys(settings.keys).find((key) => settings.keys[key] === sector);
    return code ? keyLabel(code) : '—';
  };
  const wrap = document.createElement('div');
  wrap.className = 'keymap';
  const chip = (sector: number) =>
    `<span class="keycap"><kbd>${escapeHtml(keyOf(sector))}</kbd><em>${sector}</em></span>`;
  wrap.innerHTML = `
    <p class="keymap-title">键位分布</p>
    <div class="keymap-row">${[5, 6, 7, 8].map(chip).join('')}</div>
    <div class="keymap-row">${[1, 2, 3, 4].map(chip).join('')}</div>
    <p class="keymap-note">滑条：先按起点键，再按顺序敲路点键${settings.slideMode === 'auto' ? '（当前为自动滑条）' : ''}。</p>
  `;
  return wrap;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
