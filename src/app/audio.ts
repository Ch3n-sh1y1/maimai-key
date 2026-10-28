import type { Judgment } from '../core/types';

let sharedContext: AudioContext | null = null;

/** Create/resume the shared AudioContext from a user gesture. */
export function primeAudio(): void {
  if (!sharedContext) {
    sharedContext = new AudioContext({ latencyHint: 'interactive' });
  }
  if (sharedContext.state !== 'running') void sharedContext.resume();
}

function shared(): AudioContext {
  if (!sharedContext) primeAudio();
  return sharedContext!;
}

/**
 * Audio playback + the authoritative chart clock.
 *
 * Chart time is derived from the *output* audio timeline so that what the
 * player hears and what the judge believes stay aligned. Keyboard event
 * timestamps are mapped onto the same timeline.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startAtCtx = 0;
  private baseChartMs = 0;
  private playing = false;
  private pausedChartMs = 0;
  private hitsEnabled = true;
  private sfxVolume = 0.7;

  async ensureContext(): Promise<AudioContext> {
    const ctx = shared();
    this.ctx = ctx;
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.gain.value = 0.8;
      this.gain.connect(ctx.destination);
    }
    if (ctx.state !== 'running') await ctx.resume();
    return ctx;
  }

  async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = await this.ensureContext();
    return ctx.decodeAudioData(bytes.slice(0));
  }

  setVolume(value: number): void {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1, value));
  }

  setHitsEnabled(enabled: boolean): void {
    this.hitsEnabled = enabled;
  }

  setSfxVolume(value: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, value));
  }

  async start(buffer: AudioBuffer, fromChartMs = 0, leadMs = 320): Promise<void> {
    const ctx = await this.ensureContext();
    this.stopSource();
    this.buffer = buffer;
    this.baseChartMs = Math.max(0, fromChartMs);
    this.startAtCtx = ctx.currentTime + leadMs / 1000;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (this.gain) source.connect(this.gain);
    else source.connect(ctx.destination);
    source.start(this.startAtCtx, Math.max(0, this.baseChartMs / 1000));
    this.source = source;
    this.playing = true;
    this.pausedChartMs = this.baseChartMs;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Chart time at `performance.now()`-style timestamp. */
  chartMsAt(performanceTimeMs: number): number {
    if (!this.ctx || !this.playing) return this.pausedChartMs;
    const audioNow = this.outputContextTime(performanceTimeMs);
    return this.baseChartMs + (audioNow - this.startAtCtx) * 1000;
  }

  chartMs(): number {
    return this.chartMsAt(performance.now());
  }

  pause(): number {
    if (!this.playing) return this.pausedChartMs;
    const at = this.chartMs();
    this.pausedChartMs = at;
    this.playing = false;
    this.stopSource();
    return at;
  }

  async resume(): Promise<void> {
    if (!this.buffer || this.playing) return;
    await this.start(this.buffer, this.pausedChartMs, 180);
  }

  stop(): void {
    this.playing = false;
    this.pausedChartMs = 0;
    this.stopSource();
  }

  /** Short synthesized hit blip; placeholder until real SFX packs exist. */
  playHit(judgment: Judgment): void {
    if (!this.ctx || !this.hitsEnabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const frequencies: Record<Judgment, number> = {
      critical: 1320,
      perfect: 1046,
      great: 880,
      good: 660,
      miss: 180,
    };
    osc.type = 'triangle';
    osc.frequency.value = frequencies[judgment];
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    const peak = ((judgment === 'miss' ? 0.08 : 0.14) * this.sfxVolume) + 0.0001;
    gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
    osc.connect(gain);
    gain.connect(this.gain ?? ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  destroy(): void {
    this.stopSource();
    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
    }
    this.buffer = null;
    this.ctx = null;
  }

  private stopSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      // already stopped
    }
    this.source.disconnect();
    this.source = null;
  }

  /**
   * Best-effort estimate of the audio context time that is being heard right
   * now (or at `performanceTimeMs`). Falls back to currentTime + delta.
   */
  private outputContextTime(performanceTimeMs: number): number {
    if (!this.ctx) return 0;
    return outputTimeAt(performanceTimeMs);
  }
}

/** Shared AudioContext accessor for non-gameplay features such as calibration. */
export function audioContext(): AudioContext {
  return shared();
}

/**
 * Maps a `performance.now()` timestamp onto the audio output timeline.
 * This is the same mapping used for gameplay input timestamps.
 */
export function outputTimeAt(performanceTimeMs: number): number {
  const ctx = shared();
  const timestamp = ctx.getOutputTimestamp?.();
  const contextTime = timestamp?.contextTime;
  const performanceTime = timestamp?.performanceTime;
  if (
    typeof contextTime === 'number' &&
    contextTime > 0 &&
    typeof performanceTime === 'number' &&
    performanceTime > 0
  ) {
    const deltaSeconds = (performanceTimeMs - performanceTime) / 1000;
    if (deltaSeconds >= -0.25 && deltaSeconds <= 0.25) {
      return contextTime + deltaSeconds;
    }
  }
  return ctx.currentTime + (performanceTimeMs - performance.now()) / 1000;
}
