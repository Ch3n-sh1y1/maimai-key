import {
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  type Application,
} from 'pixi.js';
import type { Chart } from '../core/types';
import type { JudgeEngine, JudgmentEvent, NoteRuntime } from '../core/judge';
import { buildSlidePath, type SlidePath } from '../core/slidePath';
import { degToRad, sectorAngle } from '../core/sectors';
import { JUDGMENT_COLORS, JUDGMENT_LABELS } from '../core/balance';
import { formatAchievement, gradeOf } from '../core/score';
import type { GameSettings } from '../core/settings';
import { keyLabel } from './input';

const SECTOR_COLORS = [
  '#66d9ff',
  '#7dffce',
  '#ffe066',
  '#ff9f6e',
  '#ff7b9c',
  '#c59bff',
  '#6ea8ff',
  '#9be15d',
];

const FONT = '"Segoe UI", "Microsoft YaHei", "Noto Sans SC", sans-serif';

/** Default keyboard order (A S D F J K L ;) unrolled from sector 5. */
const PIANO_LANE_ORDER = [5, 6, 7, 8, 1, 2, 3, 4];

export interface PlayMeta {
  title: string;
  difficulty: string;
  level: number;
}

interface Popup {
  text: Text;
  startMs: number;
  active: boolean;
}

export class PlayRenderer {
  private readonly app: Application;
  private readonly settings: GameSettings;
  private readonly meta: PlayMeta;
  private readonly root = new Container();
  private readonly staticLayer = new Graphics();
  private readonly dynamicLayer = new Graphics();
  private readonly noteLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly hudLayer = new Container();

  private readonly tapTexture: Texture;
  private readonly breakTexture: Texture;
  private readonly touchTexture: Texture;

  private readonly sprites: Sprite[] = [];
  private readonly popups: Popup[] = [];
  private readonly slidePaths = new Map<number, SlidePath>();
  private readonly sectorOf = new Map<number, number>();
  private readonly pressed = new Map<number, number>();
  private readonly bursts: Array<{ sector: number; start: number; color: string }> = [];

  private scoreText!: Text;
  private gradeText!: Text;
  private comboText!: Text;
  private fastLateText!: Text;
  private titleText!: Text;
  private progressBar = new Graphics();
  private hudPanel = new Graphics();
  private comboRing = new Graphics();
  private readonly keyHints: Text[] = [];
  private bgSprite: Sprite | null = null;
  private bgDim: Graphics | null = null;
  private bgToken = 0;
  private destroyed = false;

  private centerX = 0;
  private centerY = 0;
  private radius = 300;
  private approachMs = 1350;
  private comboScale = 1;
  private lastCombo = 0;
  private lastScoreText = '';
  private lastChartMs = 0;
  private pianoMode = false;
  private pianoLeft = 0;
  private pianoLaneWidth = 0;
  private pianoGap = 0;
  private pianoJudgeY = 0;
  private pianoStartY = 0;
  private pianoKeyHeight = 0;

  private get hudScale(): number {
    return this.settings.hudPreset === 'beginner' ? 1.18 : this.settings.hudPreset === 'pro' ? 0.8 : 1;
  }

  private get hintsVisible(): boolean {
    return this.settings.hudPreset !== 'pro' && this.settings.showKeyHints;
  }

  private get hintFontSize(): number {
    return this.settings.hudPreset === 'beginner' ? 23 : 17;
  }

  private get guideAlpha(): number {
    return this.settings.hudPreset === 'beginner' ? 1.45 : this.settings.hudPreset === 'pro' ? 0.38 : 1;
  }

  constructor(
    app: Application,
    chart: Chart,
    settings: GameSettings,
    meta: PlayMeta,
    backgroundUrl: string | null = null,
  ) {
    this.app = app;
    this.settings = settings;
    this.meta = meta;
    this.approachMs = settings.approachSeconds * 1000;
    this.pianoMode = settings.inputMode === 'keyboard';

    this.root.addChild(this.staticLayer, this.dynamicLayer, this.noteLayer, this.fxLayer, this.hudLayer);
    app.stage.addChild(this.root);

    for (const note of chart.notes) {
      this.sectorOf.set(note.id, note.sector);
      if (note.kind === 'slide') {
        this.slidePaths.set(note.id, buildSlidePath(note, { radius: 1, samplesPerSegment: 22 }));
      }
    }

    this.tapTexture = this.makeTexture((g) => {
      g.circle(0, 0, 22).fill({ color: '#ffffff', alpha: 0.95 });
      g.circle(0, 0, 22).stroke({ width: 3, color: '#ffffff', alpha: 0.65 });
      g.circle(0, 0, 8).fill({ color: '#0b1020', alpha: 0.85 });
    });

    this.breakTexture = this.makeTexture((g) => {
      g.circle(0, 0, 26).fill({ color: '#ffffff', alpha: 0.95 });
      g.circle(0, 0, 34).stroke({ width: 3, color: '#ffd166', alpha: 0.9 });
      g.circle(0, 0, 26).stroke({ width: 4, color: '#ffd166', alpha: 0.9 });
      g.circle(0, 0, 9).fill({ color: '#3a2400', alpha: 0.9 });
    });

    this.touchTexture = this.makeTexture((g) => {
      g.poly([0, -20, 20, 0, 0, 20, -20, 0]).fill({ color: '#ffffff', alpha: 0.9 });
      g.poly([0, -20, 20, 0, 0, 20, -20, 0]).stroke({ width: 2, color: '#ffffff', alpha: 0.6 });
      g.circle(0, 0, 6).fill({ color: '#0b1020', alpha: 0.8 });
    });

    this.buildHud();
    this.layout();
    window.addEventListener('resize', this.handleResize);
    void this.setBackground(backgroundUrl);
  }

  destroy(): void {
    this.destroyed = true;
    this.bgToken += 1;
    window.removeEventListener('resize', this.handleResize);
    this.app.stage.removeChild(this.root);
    this.root.destroy({ children: true });
    for (const texture of [this.tapTexture, this.breakTexture, this.touchTexture]) {
      texture.destroy(true);
    }
  }

  async setBackground(url: string | null): Promise<void> {
    const token = ++this.bgToken;
    const removeCurrent = () => {
      if (this.bgSprite) {
        const texture = this.bgSprite.texture;
        this.root.removeChild(this.bgSprite);
        this.bgSprite.destroy();
        texture.destroy(true);
        this.bgSprite = null;
      }
      if (this.bgDim) {
        this.root.removeChild(this.bgDim);
        this.bgDim.destroy();
        this.bgDim = null;
      }
    };
    removeCurrent();
    if (!url || this.destroyed) return;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const texture = Texture.from(image);
      if (token !== this.bgToken || this.destroyed) {
        texture.destroy(true);
        return;
      }
      const sprite = new Sprite(texture);
      sprite.alpha = 0.78;
      const dim = new Graphics();
      this.root.addChildAt(sprite, 0);
      this.root.addChildAt(dim, 1);
      this.bgSprite = sprite;
      this.bgDim = dim;
      this.layoutBackground();
    } catch (error) {
      console.warn('game background load failed', error);
    }
  }

  private layoutBackground(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (this.bgDim) {
      this.bgDim.clear();
      this.bgDim.rect(0, 0, width, height).fill({ color: '#02040a', alpha: 0.34 });
    }
    if (!this.bgSprite) return;
    const texture = this.bgSprite.texture;
    const scale = Math.max(width / texture.width, height / texture.height);
    this.bgSprite.width = texture.width * scale;
    this.bgSprite.height = texture.height * scale;
    this.bgSprite.x = (width - this.bgSprite.width) / 2;
    this.bgSprite.y = (height - this.bgSprite.height) / 2;
  }
  flash(sector: number): void {
    this.pressed.set(sector, performance.now());
  }

  onJudgment(event: JudgmentEvent): void {
    const sector = this.sectorOf.get(event.noteId) ?? 1;
    this.spawnPopup(JUDGMENT_LABELS[event.judgment], JUDGMENT_COLORS[event.judgment], sector);
    if (event.judgment !== 'miss') {
      this.comboScale = 1.18;
      this.bursts.push({ sector, start: performance.now(), color: JUDGMENT_COLORS[event.judgment] });
      if (this.bursts.length > 24) this.bursts.shift();
    }
    if (this.settings.showFastLate && event.deltaMs !== null && (event.kind === 'tap' || event.kind === 'touch')) {
      const early = event.deltaMs < 0;
      this.fastLateText.text = early ? 'FAST' : 'LATE';
      this.fastLateText.style.fill = early ? '#8ab4ff' : '#ffb86b';
      this.lastFastLateMs = performance.now();
    }
  }

  update(chartMs: number, judge: JudgeEngine): void {
    const dt = Math.min(50, Math.max(0, chartMs - this.lastChartMs));
    this.lastChartMs = chartMs;

    this.dynamicLayer.clear();
    this.drawPresses();
    this.drawNoteField(chartMs, judge);
    this.updateHud(chartMs, judge, dt);
  }

  /* ------------------------------------------------------------------ */

  private layout(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.pianoMode = this.settings.inputMode === 'keyboard';
    this.centerX = width / 2;
    this.centerY = height * 0.545;
    if (this.pianoMode) {
      this.layoutPiano();
    } else {
      this.radius = Math.min(width * 0.30, height * 0.375);
    }
    this.approachMs = this.settings.approachSeconds * 1000;
    this.layoutBackground();
    this.drawStatic();
    this.layoutHud();
  }

  private layoutPiano(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const gap = Math.max(5, Math.min(10, width * 0.006));
    const available = Math.min(width * 0.78, 900);
    const laneWidth = Math.max(48, Math.min(96, (available - gap * 7) / 8));
    const total = laneWidth * 8 + gap * 7;
    this.pianoLeft = (width - total) / 2;
    this.pianoLaneWidth = laneWidth;
    this.pianoGap = gap;
    this.pianoJudgeY = height * (this.settings.noteDirection === 'down' ? 0.7 : 0.3);
    this.pianoStartY = this.settings.noteDirection === 'down' ? -70 : height + 70;
    this.pianoKeyHeight = Math.max(44, Math.min(68, height * 0.075));
    this.radius = Math.min(width * 0.3, height * 0.375);
    this.centerY = this.pianoJudgeY;
  }

  private handleResize = (): void => {
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
    this.layout();
  };

  private drawStatic(): void {
    const g = this.staticLayer;
    g.clear();
    if (this.pianoMode) {
      this.drawPianoStatic();
      return;
    }
    const { centerX: cx, centerY: cy, radius: r } = this;

    // Ambient glow rings.
    for (let i = 0; i < 6; i++) {
      g.circle(cx, cy, r * (0.42 + i * 0.1)).fill({ color: '#1d3b6e', alpha: 0.035 });
    }

    // Outer judge ring.
    g.circle(cx, cy, r).stroke({ width: 3, color: '#cfe9ff', alpha: 0.22 });
    g.circle(cx, cy, r * 0.94).stroke({ width: 1, color: '#cfe9ff', alpha: 0.1 });

    // Sector separators and lane guides.
    for (let sector = 1; sector <= 8; sector++) {
      const angleDeg = sectorAngle(sector);
      const angle = degToRad(angleDeg - 22.5);
      const inner = r * 0.30;
      const outer = r * 1.005;
      g.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      g.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      g.stroke({ width: 1, color: '#cfe9ff', alpha: 0.1 });

      const lane = degToRad(angleDeg);
      g.moveTo(cx + Math.cos(lane) * r * 0.3, cy + Math.sin(lane) * r * 0.3);
      g.lineTo(cx + Math.cos(lane) * r * 0.985, cy + Math.sin(lane) * r * 0.985);
      g.stroke({ width: 2, color: SECTOR_COLORS[sector - 1]!, alpha: 0.07 * this.guideAlpha });

      g.arc(
        cx,
        cy,
        r * 0.988,
        degToRad(angleDeg - 18),
        degToRad(angleDeg + 18),
      ).stroke({ width: 9, color: SECTOR_COLORS[sector - 1]!, alpha: 0.12 * this.guideAlpha });
    }

    // Inner decoration.
    g.circle(cx, cy, r * 0.30).stroke({ width: 1, color: '#cfe9ff', alpha: 0.1 });
    g.circle(cx, cy, r * 0.055).fill({ color: '#0d1730', alpha: 0.8 });
    g.circle(cx, cy, r * 0.055).stroke({ width: 1, color: '#7ce0ff', alpha: 0.4 });

    if (this.settings.inputMode === 'touch') this.drawTouchZones(g);

    // Beginner-friendly key caps behind the labels.
    if (this.hintsVisible) {
      const capRadius = this.settings.hudPreset === 'beginner' ? 24 : 18;
      for (let sector = 1; sector <= 8; sector++) {
        const angle = degToRad(sectorAngle(sector));
        const distance = r + (this.settings.hudPreset === 'beginner' ? 34 : 28);
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance;
        g.circle(x, y, capRadius).fill({ color: '#081120', alpha: 0.72 });
        g.circle(x, y, capRadius).stroke({
          width: 1.5,
          color: SECTOR_COLORS[sector - 1]!,
          alpha: this.settings.hudPreset === 'beginner' ? 0.6 : 0.32,
        });
      }
    }

    // Key hint labels.
    for (const hint of this.keyHints) hint.destroy();
    this.keyHints.length = 0;
    if (this.hintsVisible) {
      for (let sector = 1; sector <= 8; sector++) {
        const angle = degToRad(sectorAngle(sector));
        const hint = new Text({
          text: this.labelForSector(sector),
          style: {
            fontFamily: FONT,
            fontSize: this.hintFontSize,
            fontWeight: '800',
            fill: SECTOR_COLORS[sector - 1]!,
            stroke: { color: '#05070d', width: 4 },
          },
        });
        hint.anchor.set(0.5);
        hint.alpha = this.settings.hudPreset === 'beginner' ? 0.98 : 0.66;
        hint.position.set(cx + Math.cos(angle) * (r + (this.settings.hudPreset === 'beginner' ? 34 : 28)), cy + Math.sin(angle) * (r + (this.settings.hudPreset === 'beginner' ? 34 : 28)));
        this.root.addChild(hint);
        this.keyHints.push(hint);
      }
    }
  }

  private labelForSector(sector: number): string {
    if (this.settings.inputMode === 'touch') return String(sector);
    for (const [code, value] of Object.entries(this.settings.keys)) {
      if (value === sector) return keyLabel(code);
    }
    return String(sector);
  }

  private drawTouchZones(g: Graphics): void {
    const radius = this.radius * 1.26;
    for (let sector = 1; sector <= 8; sector++) {
      const center = sectorAngle(sector);
      const start = degToRad(center - 22.5);
      const end = degToRad(center + 22.5);
      const color = SECTOR_COLORS[sector - 1]!;
      g.moveTo(this.centerX, this.centerY);
      g.arc(this.centerX, this.centerY, radius, start, end);
      g.lineTo(this.centerX, this.centerY);
      g.fill({ color, alpha: 0.022 * this.guideAlpha });
      g.arc(this.centerX, this.centerY, radius - 10, start + 0.02, end - 0.02).stroke({
        width: 24,
        color,
        alpha: 0.055 * this.guideAlpha,
      });
      g.moveTo(this.centerX, this.centerY);
      g.lineTo(
        this.centerX + Math.cos(start) * radius,
        this.centerY + Math.sin(start) * radius,
      );
      g.stroke({ width: 1, color, alpha: 0.028 * this.guideAlpha });
    }
  }

  private drawPianoStatic(): void {
    const g = this.staticLayer;
    const height = window.innerHeight;
    const laneWidth = this.pianoLaneWidth;
    const gap = this.pianoGap;
    const left = this.pianoLeft;
    const right = left + laneWidth * 8 + gap * 7;
    const judgeY = this.pianoJudgeY;
    const keyHeight = this.pianoKeyHeight;
    const keyTop = this.settings.noteDirection === 'down' ? judgeY : judgeY - keyHeight;
    const guideTop = this.settings.noteDirection === 'down' ? 0 : judgeY;
    const guideBottom = this.settings.noteDirection === 'down' ? judgeY : height;

    g.roundRect(left - 18, guideTop, right - left + 36, guideBottom - guideTop, 18)
      .fill({ color: '#07111f', alpha: 0.2 });
    g.roundRect(left - 18, guideTop, right - left + 36, guideBottom - guideTop, 18)
      .stroke({ width: 1, color: '#7ce0ff', alpha: 0.08 });

    for (let sector = 1; sector <= 8; sector++) {
      const x = this.pianoLaneX(sector);
      const color = SECTOR_COLORS[sector - 1]!;
      const laneLeft = x - laneWidth / 2;
      g.moveTo(laneLeft, guideTop).lineTo(laneLeft, guideBottom).stroke({
        width: 1,
        color: '#cfe9ff',
        alpha: 0.06,
      });
      g.rect(x - laneWidth * 0.32, guideTop, laneWidth * 0.64, guideBottom - guideTop)
        .fill({ color, alpha: 0.022 * this.guideAlpha });
      g.rect(x - 1, guideTop, 2, guideBottom - guideTop).fill({
        color,
        alpha: 0.12 * this.guideAlpha,
      });

      g.roundRect(laneLeft + 2, keyTop, laneWidth - 4, keyHeight, 10)
        .fill({ color: '#091324', alpha: 0.94 })
        .stroke({ width: 1.5, color, alpha: this.settings.hudPreset === 'pro' ? 0.22 : 0.48 });
      g.roundRect(laneLeft + 7, keyTop + 5, laneWidth - 14, keyHeight - 10, 7)
        .fill({ color, alpha: 0.055 });
      g.rect(x - laneWidth * 0.28, keyTop + keyHeight - 5, laneWidth * 0.56, 3).fill({
        color,
        alpha: 0.58,
      });
    }

    g.moveTo(left - 12, judgeY).lineTo(right + 12, judgeY).stroke({
      width: 2,
      color: '#dff4ff',
      alpha: 0.44,
    });
    g.moveTo(left - 12, judgeY).lineTo(right + 12, judgeY).stroke({
      width: 10,
      color: '#7ce0ff',
      alpha: 0.035,
    });

    for (const hint of this.keyHints) hint.destroy();
    this.keyHints.length = 0;
    if (this.hintsVisible) {
      for (let sector = 1; sector <= 8; sector++) {
        const hint = new Text({
          text: this.labelForSector(sector),
          style: {
            fontFamily: FONT,
            fontSize: this.hintFontSize,
            fontWeight: '800',
            fill: SECTOR_COLORS[sector - 1]!,
            stroke: { color: '#05070d', width: 4 },
          },
        });
        hint.anchor.set(0.5);
        hint.alpha = this.settings.hudPreset === 'beginner' ? 0.98 : 0.72;
        hint.position.set(this.pianoLaneX(sector), keyTop + keyHeight / 2);
        this.root.addChild(hint);
        this.keyHints.push(hint);
      }
    }
  }

  private drawPianoPresses(): void {
    const now = performance.now();
    const keyTop = this.settings.noteDirection === 'down'
      ? this.pianoJudgeY
      : this.pianoJudgeY - this.pianoKeyHeight;
    for (const [sector, at] of this.pressed) {
      const age = now - at;
      if (age > 180) {
        this.pressed.delete(sector);
        continue;
      }
      const alpha = (1 - age / 180) * 0.62;
      const x = this.pianoLaneX(sector);
      const color = SECTOR_COLORS[sector - 1]!;
      const laneLeft = x - this.pianoLaneWidth / 2;
      this.dynamicLayer
        .roundRect(laneLeft + 2, keyTop, this.pianoLaneWidth - 4, this.pianoKeyHeight, 10)
        .fill({ color, alpha });
      this.dynamicLayer
        .roundRect(laneLeft + 2, keyTop, this.pianoLaneWidth - 4, this.pianoKeyHeight, 10)
        .stroke({ width: 2, color, alpha: Math.min(1, alpha * 1.8) });
      this.dynamicLayer
        .rect(x - this.pianoLaneWidth * 0.2, keyTop + this.pianoKeyHeight - 6, this.pianoLaneWidth * 0.4, 4)
        .fill({ color: '#ffffff', alpha: alpha * 0.65 });
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i]!;
      const age = now - burst.start;
      if (age > 380) {
        this.bursts.splice(i, 1);
        continue;
      }
      const t = age / 380;
      this.dynamicLayer
        .circle(this.pianoLaneX(burst.sector), this.pianoJudgeY, 16 + t * 28)
        .stroke({ width: 3 * (1 - t) + 1, color: burst.color, alpha: (1 - t) * 0.5 });
    }
  }

  private pianoLaneX(sector: number): number {
    const index = Math.max(0, PIANO_LANE_ORDER.indexOf(sector));
    return (
      this.pianoLeft +
      (index + 0.5) * this.pianoLaneWidth +
      index * this.pianoGap
    );
  }

  private pianoYAt(timeMs: number, chartMs: number): number {
    const remaining = timeMs - chartMs;
    const progress = 1 - Math.min(1, Math.max(0, remaining / this.approachMs));
    return this.pianoStartY + (this.pianoJudgeY - this.pianoStartY) * progress;
  }

  private drawPianoNoteField(chartMs: number, judge: JudgeEngine): void {
    let poolIndex = 0;
    const approach = this.approachMs;

    for (const runtime of judge.runtimes) {
      if (runtime.status === 'done') continue;
      const note = runtime.note;
      const remaining = note.timeMs - chartMs;
      if (remaining > approach + 150 || remaining < -220) continue;

      const alpha = remaining < 0
        ? Math.max(0, 1 + remaining / 220)
        : Math.min(1, (approach - remaining) / 90);

      if (note.kind === 'slide') {
        this.drawPianoSlide(runtime, chartMs, alpha);
        continue;
      }
      if (note.kind === 'hold' || note.kind === 'touchHold') {
        this.drawPianoHold(runtime, chartMs, alpha);
        continue;
      }

      const sprite = this.spriteAt(poolIndex++);
      sprite.texture = note.isBreak ? this.breakTexture : note.kind === 'touch' ? this.touchTexture : this.tapTexture;
      sprite.position.set(this.pianoLaneX(note.sector), this.pianoYAt(note.timeMs, chartMs));
      sprite.rotation = note.kind === 'touch' ? Math.PI / 4 : 0;
      sprite.tint = note.isBreak ? '#ffd166' : SECTOR_COLORS[note.sector - 1]!;
      sprite.alpha = alpha;
      sprite.scale.set(note.isBreak ? 1.08 : 1);
      sprite.visible = true;
    }

    for (let i = poolIndex; i < this.sprites.length; i++) {
      this.sprites[i]!.visible = false;
    }
  }

  private drawPianoHold(runtime: NoteRuntime, chartMs: number, alpha: number): void {
    const note = runtime.note;
    const x = this.pianoLaneX(note.sector);
    const headY = this.pianoYAt(note.timeMs, chartMs);
    const tailY = this.pianoYAt(note.endMs, chartMs);
    const color = SECTOR_COLORS[note.sector - 1]!;

    this.dynamicLayer.moveTo(x, headY).lineTo(x, tailY).stroke({
      width: 24,
      color,
      alpha: alpha * 0.28,
      cap: 'round',
    });
    this.dynamicLayer.moveTo(x, headY).lineTo(x, tailY).stroke({
      width: 10,
      color,
      alpha: alpha * 0.46,
      cap: 'round',
    });
    this.dynamicLayer.circle(x, tailY, 5).fill({ color, alpha: alpha * 0.3 });

    if (runtime.status === 'pending') {
      this.dynamicLayer.circle(x, headY, 17).fill({ color, alpha: alpha * 0.95 });
      this.dynamicLayer.circle(x, headY, 17).stroke({
        width: 2,
        color: '#0b1020',
        alpha: alpha * 0.6,
      });
      if (note.isBreak) {
        this.dynamicLayer.circle(x, headY, 25).stroke({
          width: 2,
          color: '#ffd166',
          alpha: alpha * 0.7,
        });
      }
    } else {
      this.dynamicLayer.circle(x, headY, 14).fill({ color: '#ffffff', alpha: alpha * 0.5 });
    }
  }

  private drawPianoSlide(runtime: NoteRuntime, chartMs: number, alpha: number): void {
    const note = runtime.note;
    const segments = note.slide ?? [];
    if (segments.length === 0) return;
    const color = SECTOR_COLORS[note.sector - 1]!;
    const sliding = runtime.status === 'sliding';
    const pathAlpha = (sliding ? 0.85 : 0.22) * alpha + (sliding ? 0 : 0.05);

    const points: Array<{ x: number; y: number; time: number }> = [];
    let time = note.timeMs + (note.slideWaitMs ?? 0);
    points.push({ x: this.pianoLaneX(note.sector), y: this.pianoYAt(time, chartMs), time });
    for (const segment of segments) {
      time += Math.max(1, segment.durationMs);
      points.push({ x: this.pianoLaneX(segment.to), y: this.pianoYAt(time, chartMs), time });
      if (segment.shape === 'V' && segment.inflection) {
        const midTime = time - Math.max(1, segment.durationMs) / 2;
        points.splice(points.length - 1, 0, {
          x: this.pianoLaneX(segment.inflection),
          y: this.pianoYAt(midTime, chartMs),
          time: midTime,
        });
      }
    }

    this.dynamicLayer.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) {
      this.dynamicLayer.lineTo(points[i]!.x, points[i]!.y);
    }
    this.dynamicLayer.stroke({ width: 18, color, alpha: pathAlpha * 0.22, cap: 'round', join: 'round' });
    this.dynamicLayer.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) {
      this.dynamicLayer.lineTo(points[i]!.x, points[i]!.y);
    }
    this.dynamicLayer.stroke({ width: 7, color, alpha: pathAlpha, cap: 'round', join: 'round' });

    for (let i = 1; i < points.length; i++) {
      const point = points[i]!;
      const done = sliding && i - 1 < runtime.waypointIndex;
      const next = sliding && i - 1 === runtime.waypointIndex;
      const pulse = next ? 0.7 + Math.sin(chartMs / 90) * 0.3 : 1;
      this.dynamicLayer
        .circle(point.x, point.y, next ? 9 * pulse : 6)
        .fill({ color: done ? '#ffffff' : color, alpha: (done ? 0.35 : 0.9) * alpha });
    }

    if (runtime.status === 'pending') {
      const headY = this.pianoYAt(note.timeMs, chartMs);
      this.dynamicLayer.circle(this.pianoLaneX(note.sector), headY, 20).fill({
        color,
        alpha: alpha * 0.95,
      });
      this.dynamicLayer.circle(this.pianoLaneX(note.sector), headY, 20).stroke({
        width: 3,
        color: '#ffffff',
        alpha: alpha * 0.7,
      });
      if (note.isBreak) {
        this.dynamicLayer.circle(this.pianoLaneX(note.sector), headY, 28).stroke({
          width: 2,
          color: '#ffd166',
          alpha: alpha * 0.8,
        });
      }
    }
  }

  private buildHud(): void {
    this.scoreText = new Text({
      text: '0.0000%',
      style: { fontFamily: FONT, fontSize: Math.round(30 * this.hudScale), fontWeight: '700', fill: '#eaf4ff' },
    });
    this.gradeText = new Text({
      text: 'D',
      style: { fontFamily: FONT, fontSize: Math.round(18 * this.hudScale), fontWeight: '700', fill: '#8ab4ff' },
    });
    this.comboText = new Text({
      text: '',
      style: { fontFamily: FONT, fontSize: Math.round(46 * this.hudScale), fontWeight: '800', fill: '#ffffff' },
    });
    this.comboText.anchor.set(0.5);
    this.fastLateText = new Text({
      text: '',
      style: { fontFamily: FONT, fontSize: Math.round(18 * this.hudScale), fontWeight: '700', fill: '#8ab4ff' },
    });
    this.fastLateText.anchor.set(0.5);
    this.fastLateText.alpha = 0;
    this.titleText = new Text({
      text: `${this.meta.title}  ·  ${this.meta.difficulty} ${this.meta.level}`,
      style: { fontFamily: FONT, fontSize: Math.round(17 * this.hudScale), fontWeight: '600', fill: '#cfe9ff' },
    });
    this.titleText.alpha = 0.6;

    this.hudLayer.addChild(
      this.hudPanel,
      this.comboRing,
      this.progressBar,
      this.scoreText,
      this.gradeText,
      this.comboText,
      this.fastLateText,
      this.titleText,
    );

    for (let i = 0; i < 12; i++) {
      const text = new Text({
        text: '',
        style: { fontFamily: FONT, fontSize: 24, fontWeight: '800', fill: '#ffffff' },
      });
      text.anchor.set(0.5);
      text.visible = false;
      this.fxLayer.addChild(text);
      this.popups.push({ text, startMs: 0, active: false });
    }
  }

  private layoutHud(): void {
    const scale = this.hudScale;
    this.hudPanel.clear();
    this.hudPanel
      .roundRect(22, 64, 236 * scale, 52 * scale, 13)
      .fill({ color: '#081120', alpha: 0.42 })
      .stroke({ width: 1, color: '#7ce0ff', alpha: 0.12 });
    this.comboRing.clear();
    if (!this.pianoMode) {
      this.comboRing
        .circle(this.centerX, 58, 43 * scale)
        .stroke({ width: 2, color: '#7ce0ff', alpha: 0.13 });
      this.comboRing
        .circle(this.centerX, 58, 49 * scale)
        .stroke({ width: 1, color: '#ffffff', alpha: 0.05 });
    }
    this.scoreText.position.set(36, 76);
    this.gradeText.position.set(36 + this.scoreText.width + 12, 82);
    this.titleText.position.set(window.innerWidth - this.titleText.width - 36, 32);
    this.comboText.position.set(this.centerX, 58);
    this.fastLateText.position.set(this.centerX, 104);
  }

  /* ------------------------------------------------------------------ */

  private drawPresses(): void {
    if (this.pianoMode) {
      this.drawPianoPresses();
      return;
    }
    const now = performance.now();
    for (const [sector, at] of this.pressed) {
      const age = now - at;
      if (age > 180) {
        this.pressed.delete(sector);
        continue;
      }
      const alpha = (1 - age / 180) * 0.6;
      const angle = sectorAngle(sector);
      const color = SECTOR_COLORS[sector - 1]!;
      this.dynamicLayer
        .arc(this.centerX, this.centerY, this.radius * 0.985, degToRad(angle - 20), degToRad(angle + 20))
        .stroke({ width: 14, color, alpha });
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i]!;
      const age = now - burst.start;
      if (age > 380) {
        this.bursts.splice(i, 1);
        continue;
      }
      const t = age / 380;
      const angle = degToRad(sectorAngle(burst.sector));
      const x = this.centerX + Math.cos(angle) * this.radius;
      const y = this.centerY + Math.sin(angle) * this.radius;
      this.dynamicLayer
        .circle(x, y, 18 + t * 34)
        .stroke({ width: 4 * (1 - t) + 1, color: burst.color, alpha: (1 - t) * 0.55 });
    }
  }

  private drawNoteField(chartMs: number, judge: JudgeEngine): void {
    if (this.pianoMode) {
      this.drawPianoNoteField(chartMs, judge);
      return;
    }
    let poolIndex = 0;
    const approach = this.approachMs;
    const { centerX: cx, centerY: cy, radius: r } = this;

    for (const runtime of judge.runtimes) {
      if (runtime.status === 'done') continue;
      const note = runtime.note;
      const remaining = note.timeMs - chartMs;
      if (remaining > approach + 150 || remaining < -220) continue;

      const progress = 1 - Math.min(1, Math.max(0, remaining / approach));
      const headRadius = r * progress;
      const alpha = remaining < 0 ? Math.max(0, 1 + remaining / 220) : Math.min(1, (approach - remaining) / 90);

      if (note.kind === 'slide') {
        this.drawSlide(runtime, chartMs, progress, alpha);
        continue;
      }

      if (note.kind === 'hold' || note.kind === 'touchHold') {
        this.drawHold(runtime, chartMs, headRadius, alpha);
        continue;
      }

      const angle = degToRad(sectorAngle(note.sector));
      const x = cx + Math.cos(angle) * headRadius;
      const y = cy + Math.sin(angle) * headRadius;
      const sprite = this.spriteAt(poolIndex++);
      sprite.texture = note.isBreak ? this.breakTexture : note.kind === 'touch' ? this.touchTexture : this.tapTexture;
      sprite.position.set(x, y);
      sprite.rotation = note.kind === 'touch' ? Math.PI / 4 : note.isBreak ? chartMs / 600 : 0;
      sprite.tint = note.isBreak ? '#ffd166' : SECTOR_COLORS[note.sector - 1]!;
      sprite.alpha = alpha;
      const scale = note.isBreak ? 1.08 : 1;
      sprite.scale.set(scale);
      sprite.visible = true;
    }

    for (let i = poolIndex; i < this.sprites.length; i++) {
      this.sprites[i]!.visible = false;
    }
  }

  private drawHold(runtime: NoteRuntime, chartMs: number, headRadius: number, alpha: number): void {
    const note = runtime.note;
    const angle = Math.atan2(
      Math.sin(degToRad(sectorAngle(note.sector))),
      Math.cos(degToRad(sectorAngle(note.sector))),
    );
    const remainingTail = note.endMs - chartMs;
    const tailRadius = this.radius * Math.max(0, Math.min(1, 1 - remainingTail / this.approachMs));
    const color = SECTOR_COLORS[note.sector - 1]!;
    const x1 = this.centerX + Math.cos(angle) * headRadius;
    const y1 = this.centerY + Math.sin(angle) * headRadius;
    const x2 = this.centerX + Math.cos(angle) * tailRadius;
    const y2 = this.centerY + Math.sin(angle) * tailRadius;

    this.dynamicLayer.moveTo(x1, y1).lineTo(x2, y2).stroke({
      width: 22,
      color,
      alpha: alpha * 0.32,
      cap: 'round',
    });
    this.dynamicLayer.moveTo(x1, y1).lineTo(x2, y2).stroke({
      width: 10,
      color,
      alpha: alpha * 0.5,
      cap: 'round',
    });

    if (runtime.status === 'pending') {
      this.dynamicLayer.circle(x1, y1, 17).fill({ color, alpha: alpha * 0.95 });
      this.dynamicLayer.circle(x1, y1, 17).stroke({ width: 2, color: '#0b1020', alpha: alpha * 0.6 });
      if (note.isBreak) {
        this.dynamicLayer.circle(x1, y1, 25).stroke({ width: 2, color: '#ffd166', alpha: alpha * 0.7 });
      }
    } else {
      this.dynamicLayer.circle(x1, y1, 14).fill({ color: '#ffffff', alpha: alpha * 0.5 });
    }
  }

  private drawSlide(runtime: NoteRuntime, chartMs: number, progress: number, alpha: number): void {
    const note = runtime.note;
    const path = this.slidePaths.get(note.id);
    if (!path) return;

    const color = SECTOR_COLORS[note.sector - 1]!;
    const sliding = runtime.status === 'sliding';
    const pathAlpha = (sliding ? 0.85 : 0.22) * alpha + (sliding ? 0 : 0.05);
    const points = path.points;

    this.dynamicLayer.moveTo(
      this.centerX + (points[0]?.x ?? 0) * this.radius,
      this.centerY + (points[0]?.y ?? 0) * this.radius,
    );
    for (let i = 1; i < points.length; i++) {
      this.dynamicLayer.lineTo(
        this.centerX + points[i]!.x * this.radius,
        this.centerY + points[i]!.y * this.radius,
      );
    }
    this.dynamicLayer.stroke({ width: 18, color, alpha: pathAlpha * 0.22, cap: 'round', join: 'round' });
    this.dynamicLayer.moveTo(
      this.centerX + (points[0]?.x ?? 0) * this.radius,
      this.centerY + (points[0]?.y ?? 0) * this.radius,
    );
    for (let i = 1; i < points.length; i++) {
      this.dynamicLayer.lineTo(
        this.centerX + points[i]!.x * this.radius,
        this.centerY + points[i]!.y * this.radius,
      );
    }
    this.dynamicLayer.stroke({ width: 7, color, alpha: pathAlpha, cap: 'round', join: 'round' });

    // Waypoint dots.
    for (let i = 0; i < path.waypoints.length; i++) {
      const waypoint = path.waypoints[i]!;
      const done = sliding && i < runtime.waypointIndex;
      const next = sliding && i === runtime.waypointIndex;
      const pulse = next ? 0.7 + Math.sin(chartMs / 90) * 0.3 : 1;
      const size = next ? 9 * pulse : 6;
      this.dynamicLayer
        .circle(this.centerX + waypoint.x * this.radius, this.centerY + waypoint.y * this.radius, size)
        .fill({ color: done ? '#ffffff' : color, alpha: (done ? 0.35 : 0.9) * alpha });
    }

    // Head star while the slide has not been started yet.
    if (runtime.status === 'pending') {
      const angle = degToRad(sectorAngle(note.sector));
      const headRadius = this.radius * progress;
      const x = this.centerX + Math.cos(angle) * headRadius;
      const y = this.centerY + Math.sin(angle) * headRadius;
      this.dynamicLayer.circle(x, y, 20).fill({ color, alpha: alpha * 0.95 });
      this.dynamicLayer.circle(x, y, 20).stroke({ width: 3, color: '#ffffff', alpha: alpha * 0.7 });
      if (note.isBreak) {
        this.dynamicLayer.circle(x, y, 28).stroke({ width: 2, color: '#ffd166', alpha: alpha * 0.8 });
      }
    }
  }

  private updateHud(chartMs: number, judge: JudgeEngine, dt: number): void {
    const stats = judge.stats;
    const scoreText = formatAchievement(stats.achievement);
    if (scoreText !== this.lastScoreText) {
      this.lastScoreText = scoreText;
      this.scoreText.text = scoreText;
      this.gradeText.text = gradeOf(stats.achievement);
      this.layoutHud();
    }

    if (stats.combo !== this.lastCombo) {
      this.lastCombo = stats.combo;
      this.comboText.text = stats.combo >= 2 ? String(stats.combo) : '';
      this.comboScale = 1.16;
    }
    this.comboScale += (1 - this.comboScale) * Math.min(1, dt / 90);
    this.comboText.scale.set(this.comboScale);
    this.comboText.alpha = 0.92;

    const progress = stats.total > 0 ? stats.resolved / stats.total : 0;
    const width = window.innerWidth - 72;
    this.progressBar.clear();
    this.progressBar.rect(36, 12, width, 3).fill({ color: '#ffffff', alpha: 0.08 });
    this.progressBar.rect(36, 12, width * progress, 6).fill({ color: '#7ce0ff', alpha: 0.18 });
    this.progressBar.rect(36, 12, width * progress, 3).fill({ color: '#7ce0ff', alpha: 0.7 });

    const now = performance.now();
    const fastLateAge = now - this.lastFastLateMs;
    this.fastLateText.alpha = fastLateAge < 500 ? Math.max(0, 1 - fastLateAge / 500) : 0;

    for (const popup of this.popups) {
      if (!popup.active) continue;
      const age = chartMs - popup.startMs;
      if (age > 550) {
        popup.active = false;
        popup.text.visible = false;
        continue;
      }
      const t = age / 550;
      popup.text.alpha = 1 - t * t;
      popup.text.y -= 0.16 * dt;
    }
  }

  private lastFastLateMs = 0;

  private spawnPopup(text: string, color: string, sector: number): void {
    const popup = this.popups.find((item) => !item.active);
    if (!popup) return;
    popup.text.text = text;
    popup.text.style.fill = color;
    if (this.pianoMode) {
      popup.text.position.set(
        this.pianoLaneX(sector),
        this.pianoJudgeY + (this.settings.noteDirection === 'down' ? -62 : 62),
      );
    } else {
      const angle = degToRad(sectorAngle(sector));
      popup.text.position.set(
        this.centerX + Math.cos(angle) * this.radius * 0.72,
        this.centerY + Math.sin(angle) * this.radius * 0.72,
      );
    }
    popup.text.alpha = 1;
    popup.text.visible = true;
    popup.startMs = this.lastChartMs;
    popup.active = true;
  }

  /** Maps a screen point to one of the eight ring sectors, for touch input. */
  sectorAtScreen(clientX: number, clientY: number): number | null {
    if (this.pianoMode) return null;
    const angle = (Math.atan2(clientY - this.centerY, clientX - this.centerX) * 180) / Math.PI;
    const index = Math.round((((angle - 270 + 360) % 360) / 45) % 8);
    return index + 1;
  }

  private spriteAt(index: number): Sprite {
    let sprite = this.sprites[index];
    if (!sprite) {
      sprite = new Sprite(this.tapTexture);
      sprite.anchor.set(0.5);
      this.noteLayer.addChild(sprite);
      this.sprites.push(sprite);
    }
    return sprite;
  }

  private makeTexture(draw: (g: Graphics) => void): Texture {
    const graphics = new Graphics();
    draw(graphics);
    const texture = this.app.renderer.generateTexture(graphics);
    graphics.destroy();
    return texture;
  }
}
