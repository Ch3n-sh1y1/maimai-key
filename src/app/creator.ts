import { parseSimai } from '../core/simai';
import {
  classifyAudioFormat,
  SUPPORTED_AUDIO_ACCEPT,
  supportedAudioSummary,
} from '../core/audioFormat';
import type { UiApi } from './ui';
import { clearHost } from './ui';
import { isModalOpen } from './modal';
import {
  analyzeBuffer,
  decodeAudioBytes,
  generateCharts,
  type AudioAnalysis,
  type GeneratedCharts,
} from './auto-chart';

type Origin = 'title' | 'select';

interface CreatorState {
  file: File | null;
  bytes: ArrayBuffer | null;
  analysis: AudioAnalysis | null;
  charts: GeneratedCharts | null;
  active: number;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function tick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 30));
}


export function renderCreator(host: HTMLElement, api: UiApi, from: Origin): () => void {
  clearHost(host);
  const state: CreatorState = { file: null, bytes: null, analysis: null, charts: null, active: 0 };

  const screen = document.createElement('div');
  screen.className = 'screen creator-screen';
  screen.innerHTML = `
    <header class="screen-header">
      <div class="screen-heading">
        <button class="nav-pill" data-action="back" title="返回上一页">
          <span class="nav-arrow" aria-hidden="true">←</span> 返回 <kbd>Esc</kbd>
        </button>
        <div>
          <p class="eyebrow">CHART LAB</p>
          <h2>音频自动打谱</h2>
        </div>
      </div>
    </header>
    <div class="creator-body">
      <section class="panel creator-source">
        <h3>1 · 选择音频</h3>
        <label class="drop-zone" data-drop>
          <input type="file" accept="${SUPPORTED_AUDIO_ACCEPT}" data-file hidden />
          <strong>拖入音频，或点击选择</strong>
          <span>MP3 / WAV / FLAC / M4A / AAC / OGG / OPUS · 建议 1～6 分钟</span>
        </label>
        <p class="file-line" data-file-line>尚未选择文件</p>
        <details class="format-help">
          <summary>支持哪些音频格式？</summary>
          <p>支持 ${supportedAudioSummary()}。网易云 NCM、QQ 音乐 QMC/MFLAC/MGG、酷狗 KGM、酷我 KWM 等受 DRM 保护的平台缓存不能直接解析，请先在平台内合法导出无加密音频。</p>
        </details>
        <button data-action="folder" class="ghost">打开曲库文件夹</button>
        <div class="rows">
          <label class="row"><span>曲名</span><input data-title type="text" maxlength="60" placeholder="默认取文件名" /></label>
          <label class="row"><span>艺术家</span><input data-artist type="text" maxlength="60" placeholder="Unknown" /></label>
          <label class="row"><span>BPM</span><input data-bpm type="number" min="40" max="260" step="0.1" placeholder="自动检测" /></label>
          <label class="row"><span>音频偏移 (ms)</span><input data-offset type="number" min="-500" max="500" step="5" value="0" /></label>
          <label class="row"><span>密度 <em data-density-label>1.00×</em></span><input data-density type="range" min="0.75" max="1.35" step="0.05" value="1" /></label>
          <div class="row creator-checks">
            <span>自动加入</span>
            <label><input data-holds type="checkbox" checked /> 长按</label>
            <label><input data-slides type="checkbox" checked /> 滑条</label>
            <label><input data-touches type="checkbox" checked /> 触摸</label>
          </div>
        </div>
        <button class="primary" data-action="generate">分析并生成 4 个难度</button>
        <p class="creator-status" data-status>选择音频后开始分析。生成结果只是草稿，可在右侧修改谱面后再保存。</p>
      </section>
      <section class="panel creator-result">
        <h3>2 · 预览与自定义</h3>
        <div class="analysis-stats" data-stats>
          <span>BPM —</span><span>时长 —</span><span>重音 —</span>
        </div>
        <div class="creator-tabs" data-tabs></div>
        <textarea class="chart-editor" data-editor spellcheck="false" placeholder="生成后可在这里直接编辑 Simai 谱面…" disabled></textarea>
        <div class="creator-actions">
          <button class="primary" data-action="save" disabled>保存到曲库并返回</button>
          <button data-action="download" disabled>导出 .simai</button>
        </div>
        <p class="creator-status" data-save-status></p>
      </section>
    </div>
  `;
  host.appendChild(screen);

  const fileInput = screen.querySelector<HTMLInputElement>('[data-file]')!;
  const dropZone = screen.querySelector<HTMLElement>('[data-drop]')!;
  const fileLine = screen.querySelector<HTMLElement>('[data-file-line]')!;
  const titleInput = screen.querySelector<HTMLInputElement>('[data-title]')!;
  const artistInput = screen.querySelector<HTMLInputElement>('[data-artist]')!;
  const bpmInput = screen.querySelector<HTMLInputElement>('[data-bpm]')!;
  const offsetInput = screen.querySelector<HTMLInputElement>('[data-offset]')!;
  const densityInput = screen.querySelector<HTMLInputElement>('[data-density]')!;
  const densityLabel = screen.querySelector<HTMLElement>('[data-density-label]')!;
  const holdsInput = screen.querySelector<HTMLInputElement>('[data-holds]')!;
  const slidesInput = screen.querySelector<HTMLInputElement>('[data-slides]')!;
  const touchesInput = screen.querySelector<HTMLInputElement>('[data-touches]')!;
  const generateButton = screen.querySelector<HTMLButtonElement>('[data-action="generate"]')!;
  const saveButton = screen.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const downloadButton = screen.querySelector<HTMLButtonElement>('[data-action="download"]')!;
  const statusEl = screen.querySelector<HTMLElement>('[data-status]')!;
  const saveStatusEl = screen.querySelector<HTMLElement>('[data-save-status]')!;
  const statsEl = screen.querySelector<HTMLElement>('[data-stats]')!;
  const tabsEl = screen.querySelector<HTMLElement>('[data-tabs]')!;
  const editor = screen.querySelector<HTMLTextAreaElement>('[data-editor]')!;
  const controller = new AbortController();

  const setStatus = (text: string, kind: 'normal' | 'error' | 'ok' = 'normal') => {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
  };

  const selectFile = async (file: File | null) => {
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const info = classifyAudioFormat(file.name, head);
    if (info.kind !== 'supported') {
      state.file = null;
      state.bytes = null;
      state.analysis = null;
      state.charts = null;
      fileLine.textContent = '未选择音频';
      setStatus(info.message ?? '不支持的音频格式。', 'error');
      return;
    }
    state.file = file;
    state.bytes = null;
    state.analysis = null;
    state.charts = null;
    fileLine.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB · ${info.extension.toUpperCase()}`;
    if (!titleInput.value.trim()) {
      titleInput.value = file.name.replace(/\.[^.]+$/, '').slice(0, 60);
    }
    setStatus('已选择音频。点击“分析并生成”。');
  };

  fileInput.addEventListener('change', () => void selectFile(fileInput.files?.[0] ?? null));
  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
    });
  }
  dropZone.addEventListener('drop', (event) => {
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    void selectFile(file ?? null);
  });
  densityInput.addEventListener('input', () => {
    densityLabel.textContent = `${Number(densityInput.value).toFixed(2)}×`;
  });

  const renderPreview = () => {
    const charts = state.charts;
    const analysis = state.analysis;
    if (!charts || !analysis) return;
    statsEl.innerHTML = `
      <span><strong>BPM</strong> ${charts.bpm.toFixed(1)} · 置信 ${(analysis.confidence * 100).toFixed(0)}%</span>
      <span><strong>时长</strong> ${formatDuration(charts.durationMs)}</span>
      <span><strong>重音</strong> ${analysis.onsets.length}</span>
    `;
    tabsEl.replaceChildren();
    charts.difficulties.forEach((difficulty, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = index === state.active ? 'active' : '';
      tab.innerHTML = `<span>${escapeHtml(difficulty.name)} ${difficulty.level}</span><em>${difficulty.noteCount} notes</em>`;
      tab.addEventListener('click', () => {
        storeEditor();
        state.active = index;
        renderPreview();
      });
      tabsEl.appendChild(tab);
    });
    const current = charts.difficulties[state.active]!;
    editor.disabled = false;
    editor.value = current.body;
    saveButton.disabled = false;
    downloadButton.disabled = false;
    const parsed = parseSimai(current.body, { bpm: charts.bpm });
    saveStatusEl.textContent = `当前 ${current.name}：${parsed.chart.notes.length} 个音符，${parsed.warnings.length} 条警告。保存后可在曲库中继续修改。`;
  };

  const storeEditor = () => {
    if (!state.charts) return;
    const current = state.charts.difficulties[state.active];
    if (current) current.body = editor.value;
  };

  editor.addEventListener('input', () => {
    if (!state.charts) return;
    storeEditor();
    const current = state.charts.difficulties[state.active];
    if (!current) return;
    const parsed = parseSimai(current.body, { bpm: state.charts.bpm });
    current.noteCount = parsed.chart.notes.length;
    saveStatusEl.textContent = `当前 ${current.name}：${parsed.chart.notes.length} 个音符，${parsed.warnings.length} 条警告。`;
  });

  const generate = async () => {
    if (!state.file) {
      setStatus('请先选择音频文件。', 'error');
      return;
    }
    generateButton.disabled = true;
    saveButton.disabled = true;
    downloadButton.disabled = true;
    try {
      setStatus('正在读取音频…');
      await tick();
      const bytes = state.bytes ?? (await state.file.arrayBuffer());
      state.bytes = bytes;
      setStatus('正在解码音频（首次可能稍慢）…');
      await tick();
      const buffer = await decodeAudioBytes(bytes);
      setStatus('正在分析节拍与重音…');
      await tick();
      const override = Number(bpmInput.value);
      const analysis = analyzeBuffer(buffer, Number.isFinite(override) && override > 0 ? override : undefined);
      if (!bpmInput.value.trim()) bpmInput.value = String(analysis.bpm);
      setStatus('正在生成 4 个难度…');
      await tick();
      const charts = generateCharts(analysis, {
        offsetMs: Number(offsetInput.value) || 0,
        density: Number(densityInput.value) || 1,
        includeHolds: holdsInput.checked,
        includeSlides: slidesInput.checked,
        includeTouches: touchesInput.checked,
        seed: 7,
      });
      state.analysis = analysis;
      state.charts = charts;
      state.active = 0;
      setStatus(
        `完成：BPM ${charts.bpm.toFixed(1)}，检测到 ${analysis.onsets.length} 个重音。右侧可修改谱面。`,
        'ok',
      );
      renderPreview();
    } catch (error) {
      setStatus(`生成失败：${(error as Error).message}`, 'error');
    } finally {
      generateButton.disabled = false;
    }
  };

  const save = async () => {
    if (!state.charts || !state.file || !state.bytes) {
      setStatus('请先生成谱面。', 'error');
      return;
    }
    storeEditor();
    const bridge = window.maimai;
    if (!bridge) {
      saveStatusEl.textContent = '保存到曲库需要在桌面版中运行（pnpm dev:electron 或打包版）。';
      return;
    }
    saveButton.disabled = true;
    saveStatusEl.textContent = '正在保存…';
    try {
      const title = titleInput.value.trim() || state.file.name.replace(/\.[^.]+$/, '') || 'Auto Chart';
      const result = await bridge.saveGenerated({
        id: title,
        title,
        artist: artistInput.value.trim() || 'Unknown',
        charter: 'Auto Chart Lab',
        bpm: state.charts.bpm,
        offsetMs: Number(offsetInput.value) || 0,
        audioName: state.file.name,
        audioData: new Uint8Array(state.bytes),
        charts: state.charts.difficulties.map((difficulty) => ({
          name: difficulty.name,
          level: difficulty.level,
          body: difficulty.body,
        })),
      });
      saveStatusEl.textContent = `已保存到曲库（${result.id}），正在刷新…`;
      await api.refreshContent();
      api.backToSelect();
    } catch (error) {
      saveStatusEl.textContent = `保存失败：${(error as Error).message}`;
      saveButton.disabled = false;
    }
  };

  const download = () => {
    if (!state.charts) return;
    storeEditor();
    const current = state.charts.difficulties[state.active]!;
    const blob = new Blob([current.body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${current.name.toLowerCase()}.simai`;
    link.click();
    URL.revokeObjectURL(url);
  };

  screen.querySelector('[data-action="folder"]')?.addEventListener('click', async () => {
    const result = await window.maimai?.openContentFolder();
    if (!result) {
      setStatus('浏览器模式无法打开本地文件夹；桌面版会把曲库放在 Documents/MaimaiKey/content。', 'error');
      return;
    }
    setStatus(result.error ? `打开失败：${result.error}` : `已打开曲库文件夹：${result.path}`);
  });
  generateButton.addEventListener('click', () => void generate());
  saveButton.addEventListener('click', () => void save());
  downloadButton.addEventListener('click', download);
  screen.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    if (from === 'select') api.backToSelect();
    else api.backToTitle();
  });

  window.addEventListener(
    'keydown',
    (event) => {
      if (isModalOpen()) return;
      if (event.code === 'Escape' && document.activeElement !== editor) {
        if (from === 'select') api.backToSelect();
        else api.backToTitle();
      }
    },
    { signal: controller.signal },
  );

  return () => controller.abort();
}
