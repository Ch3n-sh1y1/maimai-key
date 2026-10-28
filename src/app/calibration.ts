import { audioContext, outputTimeAt, primeAudio } from './audio';
import { closeModal, openModal, trapModalFocus } from './modal';

const CLICKS = 12;
const INTERVAL_MS = 550;
const LEAD_MS = 1400;
const MAX_DELTA_S = 0.25;

/**
 * A small metronome calibration overlay: the player taps Space on the beat and
 * the median offset between taps and scheduled clicks becomes the input offset.
 */
export function showCalibration(host: HTMLElement, onApply: (inputMs: number) => void): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'calibration-overlay';
  overlay.innerHTML = `
    <div class="calibration-card">
      <p class="eyebrow">CALIBRATION</p>
      <h2>输入延迟校准</h2>
      <p class="muted">跟着节拍按 <kbd>Space</kbd> 或点击圆圈，共 ${CLICKS} 次。<br />建议戴耳机，使用平时游玩的键盘。</p>
      <button class="calibration-pad" data-action="pad" type="button"><span>开始</span></button>
      <p class="calibration-status">准备就绪</p>
      <p class="calibration-result"></p>
      <div class="calibration-actions">
        <button class="primary" data-action="start">开始</button>
        <button data-action="apply" disabled>应用</button>
        <button data-action="close">取消</button>
      </div>
    </div>
  `;
  host.appendChild(overlay);
  openModal(overlay, overlay.querySelector<HTMLElement>('[data-action="start"]'));

  const pad = overlay.querySelector<HTMLButtonElement>('[data-action="pad"]')!;
  const padLabel = pad.querySelector('span')!;
  const statusEl = overlay.querySelector<HTMLElement>('.calibration-status')!;
  const resultEl = overlay.querySelector<HTMLElement>('.calibration-result')!;
  const startBtn = overlay.querySelector<HTMLButtonElement>('[data-action="start"]')!;
  const applyBtn = overlay.querySelector<HTMLButtonElement>('[data-action="apply"]')!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>('[data-action="close"]')!;

  let state: 'idle' | 'running' | 'done' = 'idle';
  let clickTimes: number[] = [];
  let taps: number[] = [];
  let timers: number[] = [];
  let suggestion: number | null = null;
  let pulseTimer = 0;

  const clearTimers = () => {
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
  };

  const pulse = () => {
    pad.classList.add('pulse');
    window.clearTimeout(pulseTimer);
    pulseTimer = window.setTimeout(() => pad.classList.remove('pulse'), 110);
  };

  const scheduleClick = (ctx: AudioContext, when: number): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.16, when + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.08);
  };

  const updateStatus = () => {
    if (state === 'running') {
      statusEl.textContent = `第 ${Math.min(taps.length + 1, CLICKS)} / ${CLICKS} 次`;
      padLabel.textContent = '敲!';
    } else if (state === 'idle') {
      statusEl.textContent = '准备就绪';
      padLabel.textContent = '开始';
    }
  };

  const finish = () => {
    if (state !== 'running') return;
    state = 'done';
    clearTimers();
    padLabel.textContent = '完成';
    if (taps.length < 6) {
      statusEl.textContent = `有效敲击太少（${taps.length} 次），请重试`;
      resultEl.textContent = '';
      applyBtn.disabled = true;
      return;
    }
    const sorted = [...taps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]! * 1000;
    suggestion = Math.round(median);
    const mean = (taps.reduce((sum, value) => sum + value, 0) / taps.length) * 1000;
    const spread = Math.max(...sorted) * 1000 - Math.min(...sorted) * 1000;
    statusEl.textContent = `完成 · 有效 ${taps.length} 次`;
    resultEl.innerHTML = `建议输入偏移 <strong>${suggestion > 0 ? '+' : ''}${suggestion} ms</strong><br /><span>中位数 ${median.toFixed(1)} ms · 平均 ${mean.toFixed(1)} ms · 离散 ${spread.toFixed(0)} ms</span>`;
    applyBtn.disabled = false;
  };

  const start = async () => {
    if (state === 'running') return;
    primeAudio();
    const ctx = audioContext();
    await ctx.resume();
    clickTimes = [];
    taps = [];
    suggestion = null;
    applyBtn.disabled = true;
    resultEl.textContent = '';
    state = 'running';
    padLabel.textContent = '敲!';
    const base = ctx.currentTime + LEAD_MS / 1000;
    for (let index = 0; index < CLICKS; index++) {
      const when = base + (index * INTERVAL_MS) / 1000;
      clickTimes.push(when);
      scheduleClick(ctx, when);
      timers.push(
        window.setTimeout(pulse, Math.max(0, (when - ctx.currentTime) * 1000)),
      );
    }
    const endAt = base + ((CLICKS - 1) * INTERVAL_MS) / 1000 + 0.7;
    timers.push(window.setTimeout(finish, Math.max(0, (endAt - ctx.currentTime) * 1000)));
    updateStatus();
  };

  const tap = () => {
    if (state === 'idle') {
      void start();
      return;
    }
    if (state !== 'running') return;
    const now = outputTimeAt(performance.now());
    let nearest = clickTimes[0] ?? now;
    for (const click of clickTimes) {
      if (Math.abs(now - click) < Math.abs(now - nearest)) nearest = click;
    }
    if (Math.abs(now - nearest) > MAX_DELTA_S) return;
    taps.push(now - nearest);
    updateStatus();
    if (taps.length >= CLICKS) finish();
  };

  const cleanup = () => {
    state = 'done';
    clearTimers();
    window.clearTimeout(pulseTimer);
    window.removeEventListener('keydown', onKey, true);
    closeModal(overlay);
    overlay.remove();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();
      tap();
    } else if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    } else if (trapModalFocus(event, overlay)) {
      event.stopPropagation();
    }
  };

  pad.addEventListener('click', tap);
  startBtn.addEventListener('click', () => void start());
  applyBtn.addEventListener('click', () => {
    if (suggestion === null) return;
    onApply(suggestion);
    cleanup();
  });
  closeBtn.addEventListener('click', cleanup);
  window.addEventListener('keydown', onKey, true);

  return cleanup;
}
