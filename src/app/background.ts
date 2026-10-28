import { BACKGROUND_ACCEPT, isAcceptedImage } from '../core/imageFormat';
import { closeModal, openModal, trapModalFocus } from './modal';

export type BackgroundTarget = 'title' | 'game';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BackgroundRecord {
  target: BackgroundTarget;
  original: Blob;
  rendered: Blob;
  crop: CropRect;
  imageWidth: number;
  imageHeight: number;
  fileName: string;
  updatedAt: number;
}

const DB_NAME = 'maimai-key-backgrounds';
const STORE = 'backgrounds';
const DB_VERSION = 1;
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const records = new Map<BackgroundTarget, BackgroundRecord>();
const urls = new Map<BackgroundTarget, string>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    let timer = 0;
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(db);
    };
    const request = (() => {
      try {
        return indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        console.warn('background database open failed', error);
        finish(null);
        return null;
      }
    })();
    if (!request) return;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'target' });
      }
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => {
      console.warn('background database unavailable', request.error);
      finish(null);
    };
    request.onblocked = () => {
      console.warn('background database blocked');
      finish(null);
    };
    timer = window.setTimeout(() => finish(null), 4000);
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function initBackgrounds(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const transaction = db.transaction(STORE, 'readonly');
    const store = transaction.objectStore(STORE);
    const all = await requestResult(store.getAll() as IDBRequest<BackgroundRecord[]>);
    await transactionDone(transaction);
    for (const record of all) {
      if (record.target !== 'title' && record.target !== 'game') continue;
      records.set(record.target, record);
      urls.set(record.target, URL.createObjectURL(record.rendered));
    }
  } catch (error) {
    console.warn('background load failed', error);
  }
}

export function getBackgroundRecord(target: BackgroundTarget): BackgroundRecord | null {
  return records.get(target) ?? null;
}

export function getBackgroundUrl(target: BackgroundTarget): string | null {
  return urls.get(target) ?? null;
}

export async function saveBackgroundRecord(record: BackgroundRecord): Promise<void> {
  const db = await openDb();
  if (!db) throw new Error('浏览器存储不可用，无法保存背景');
  const transaction = db.transaction(STORE, 'readwrite');
  transaction.objectStore(STORE).put(record);
  await transactionDone(transaction);
  const previous = urls.get(record.target);
  if (previous) URL.revokeObjectURL(previous);
  records.set(record.target, record);
  urls.set(record.target, URL.createObjectURL(record.rendered));
  notifyBackgroundChanged(record.target);
}

export async function clearBackground(target: BackgroundTarget): Promise<void> {
  const db = await openDb();
  if (db) {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(target);
    await transactionDone(transaction);
  }
  const previous = urls.get(target);
  if (previous) URL.revokeObjectURL(previous);
  urls.delete(target);
  records.delete(target);
  notifyBackgroundChanged(target);
}

function notifyBackgroundChanged(target: BackgroundTarget): void {
  window.dispatchEvent(new CustomEvent('maimai:background-changed', { detail: { target } }));
}

export interface LoadedImage {
  image: HTMLImageElement;
  url: string;
  width: number;
  height: number;
}

async function decodeWithBrowser(blob: Blob, fileName: string): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`浏览器无法解码 ${fileName}`);
  }
  if (image.naturalWidth < 2 || image.naturalHeight < 2) {
    URL.revokeObjectURL(url);
    throw new Error('图片尺寸无效。');
  }
  return { image, url, width: image.naturalWidth, height: image.naturalHeight };
}

/** Decode with Chromium's image stack; HEIC/HEIF falls back to a WASM decoder. */
export async function loadImageBlob(blob: Blob, fileName = 'image'): Promise<LoadedImage> {
  if (!isAcceptedImage(fileName, blob.type)) {
    throw new Error(
      `无法识别 ${fileName}。支持 JPG、PNG、WebP、AVIF、GIF、BMP、SVG、HEIC/HEIF；` +
        'TIFF 等格式请先转成 JPG/PNG/WebP。',
    );
  }
  try {
    return await decodeWithBrowser(blob, fileName);
  } catch (error) {
    const extension = /\.[^./\\]+$/.exec(fileName)?.[0].toLowerCase() ?? '';
    if (extension !== '.heic' && extension !== '.heif') {
      throw new Error(
        `无法解码 ${fileName}。请换成 JPG、PNG、WebP、AVIF、GIF、BMP、SVG 或 HEIC。`,
      );
    }
    try {
      const { default: heic2any } = await import('heic2any');
      const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
      const jpeg = Array.isArray(converted) ? converted[0] : converted;
      if (!jpeg) throw new Error('转换结果为空');
      return await decodeWithBrowser(jpeg, fileName.replace(/\.[^.]+$/, '.jpg'));
    } catch {
      throw new Error(
        `HEIC/HEIF 转换失败：${fileName}。请把照片导出为 JPG 后重试。` +
          `（原始错误：${(error as Error).message}）`,
      );
    }
  }
}

export function coverCrop(imageWidth: number, imageHeight: number, aspect = 16 / 9): CropRect {
  let w = imageWidth;
  let h = imageWidth / aspect;
  if (h > imageHeight) {
    h = imageHeight;
    w = imageHeight * aspect;
  }
  return {
    x: (imageWidth - w) / 2,
    y: (imageHeight - h) / 2,
    w,
    h,
  };
}

export function clampCrop(crop: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const w = Math.max(8, Math.min(crop.w, imageWidth));
  const h = Math.max(8, Math.min(crop.h, imageHeight));
  return {
    x: Math.max(0, Math.min(crop.x, imageWidth - w)),
    y: Math.max(0, Math.min(crop.y, imageHeight - h)),
    w,
    h,
  };
}

export function drawCrop(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  crop: CropRect,
): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
  if (webp) return webp;
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (jpeg) return jpeg;
  throw new Error('无法生成背景图片');
}

/** Open the crop editor. Resolves true when a new background was saved. */
export async function openBackgroundEditor(
  target: BackgroundTarget,
  initialFile?: File,
): Promise<boolean> {
  const existing = records.get(target);
  const overlay = document.createElement('div');
  overlay.className = 'bg-editor';
  overlay.setAttribute('data-bg-editor', target);
  overlay.innerHTML = `
    <div class="bg-editor-card" role="dialog" aria-modal="true" aria-label="更换背景">
      <header class="bg-editor-head">
        <div>
          <p class="eyebrow">BACKGROUND</p>
          <h2>${target === 'title' ? '主页面背景' : '游戏背景'}</h2>
          <p class="muted">拖动画面选择区域，滚轮或滑杆缩放。支持 JPG / PNG / WebP / AVIF / GIF / BMP / SVG。</p>
        </div>
        <button class="bg-editor-close" data-action="cancel" aria-label="关闭">×</button>
      </header>
      <div class="bg-editor-stage">
        <canvas data-bg-canvas width="960" height="540"></canvas>
        <div class="bg-editor-empty" data-bg-empty>
          <strong>拖入一张照片</strong>
          <span>或者</span>
          <button class="primary" data-action="pick">选择图片</button>
        </div>
      </div>
      <div class="bg-editor-controls">
        <button data-action="pick">选择照片</button>
        <label class="bg-zoom">
          <span>缩放</span>
          <input type="range" min="100" max="500" value="100" data-bg-zoom />
          <em data-bg-zoom-label>1.00×</em>
        </label>
        <button data-action="reset">重置</button>
        <span class="bg-editor-spacer"></span>
        <button data-action="cancel">取消</button>
        <button class="primary" data-action="save" disabled>保存背景</button>
      </div>
      <p class="bg-editor-note" data-bg-note>拖动照片选择构图；保存后主页面和游戏都会使用裁切结果。</p>
      <input type="file" accept="${BACKGROUND_ACCEPT}" data-bg-file hidden />
    </div>
  `;
  document.body.appendChild(overlay);
  openModal(overlay, overlay.querySelector<HTMLElement>('[data-action="pick"]'));

  const canvas = overlay.querySelector<HTMLCanvasElement>('[data-bg-canvas]')!;
  const emptyEl = overlay.querySelector<HTMLElement>('[data-bg-empty]')!;
  const fileInput = overlay.querySelector<HTMLInputElement>('[data-bg-file]')!;
  const zoomInput = overlay.querySelector<HTMLInputElement>('[data-bg-zoom]')!;
  const zoomLabel = overlay.querySelector<HTMLElement>('[data-bg-zoom-label]')!;
  const saveButton = overlay.querySelector<HTMLButtonElement>('[data-action="save"]')!;
  const noteEl = overlay.querySelector<HTMLElement>('[data-bg-note]')!;

  let loaded: LoadedImage | null = null;
  let baseCrop: CropRect = { x: 0, y: 0, w: 1, h: 1 };
  let crop: CropRect = { x: 0, y: 0, w: 1, h: 1 };
  let fileName = 'background';
  let sourceBlob: Blob | null = initialFile ?? existing?.original ?? null;
  let saved = false;
  let dragPointer: { id: number; x: number; y: number } | null = null;

  const cleanup = () => {
    window.removeEventListener('keydown', onKey, true);
    closeModal(overlay);
    overlay.remove();
    if (loaded) URL.revokeObjectURL(loaded.url);
  };

  const close = (value: boolean) => {
    if (saved) return;
    saved = true;
    cleanup();
    resolvePromise(value);
  };

  let resolvePromise!: (value: boolean) => void;
  const resultPromise = new Promise<boolean>((resolve) => {
    resolvePromise = resolve;
  });

  const onKey = (event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(false);
      return;
    }
    if (trapModalFocus(event, overlay)) event.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);

  const render = () => {
    if (!loaded) return;
    crop = clampCrop(crop, loaded.width, loaded.height);
    drawCrop(canvas, loaded.image, crop);
    zoomInput.value = String(Math.round((baseCrop.w / crop.w) * 100));
    zoomLabel.textContent = `${(baseCrop.w / crop.w).toFixed(2)}×`;
    saveButton.disabled = false;
  };

  const setImage = async (file: File | Blob) => {
    try {
      if (file.size > 50 * 1024 * 1024) {
        throw new Error('图片超过 50MB，请先缩小或压缩后再试。');
      }
      const next = await loadImageBlob(file, 'name' in file ? file.name : fileName);
      if (next.width > 16384 || next.height > 16384) {
        URL.revokeObjectURL(next.url);
        throw new Error(`图片尺寸 ${next.width}×${next.height} 过大，最大支持 16384×16384。`);
      }
      if (loaded) URL.revokeObjectURL(loaded.url);
      loaded = next;
      sourceBlob = file;
      fileName = 'name' in file ? file.name : fileName;
      baseCrop = coverCrop(next.width, next.height);
      crop = { ...baseCrop };
      emptyEl.hidden = true;
      canvas.hidden = false;
      noteEl.classList.remove('error');
      noteEl.textContent = `${fileName} · ${next.width}×${next.height} · 拖动选择区域，滑杆缩放`;
      render();
    } catch (error) {
      noteEl.textContent = (error as Error).message;
      noteEl.classList.add('error');
    }
  };

  const applyZoom = (zoom: number) => {
    if (!loaded) return;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const currentCenterX = crop.x + crop.w / 2;
    const currentCenterY = crop.y + crop.h / 2;
    const w = baseCrop.w / clamped;
    const h = baseCrop.h / clamped;
    crop = clampCrop(
      { x: currentCenterX - w / 2, y: currentCenterY - h / 2, w, h },
      loaded.width,
      loaded.height,
    );
    render();
  };

  zoomInput.addEventListener('input', () => applyZoom(Number(zoomInput.value) / 100));

  canvas.addEventListener('pointerdown', (event) => {
    if (!loaded) return;
    dragPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragPointer || !loaded || dragPointer.id !== event.pointerId) return;
    const dx = event.clientX - dragPointer.x;
    const dy = event.clientY - dragPointer.y;
    dragPointer.x = event.clientX;
    dragPointer.y = event.clientY;
    const scaleX = crop.w / Math.max(1, canvas.clientWidth);
    const scaleY = crop.h / Math.max(1, canvas.clientHeight);
    crop = clampCrop(
      { ...crop, x: crop.x - dx * scaleX, y: crop.y - dy * scaleY },
      loaded.width,
      loaded.height,
    );
    render();
  });
  const endDrag = (event: PointerEvent) => {
    if (dragPointer?.id !== event.pointerId) return;
    dragPointer = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!loaded) return;
      event.preventDefault();
      applyZoom(baseCrop.w / crop.w + (event.deltaY < 0 ? 0.12 : -0.12));
    },
    { passive: false },
  );

  overlay.querySelectorAll<HTMLElement>('[data-action="pick"]').forEach((button) => {
    button.addEventListener('click', () => fileInput.click());
  });
  overlay.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    if (!loaded) return;
    crop = { ...baseCrop };
    render();
  });
  overlay.querySelectorAll<HTMLElement>('[data-action="cancel"]').forEach((button) => {
    button.addEventListener('click', () => close(false));
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close(false);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void setImage(file);
  });

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    overlay.classList.add('dragging');
  };
  const onDragLeave = () => overlay.classList.remove('dragging');
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    overlay.classList.remove('dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) void setImage(file);
  };
  overlay.addEventListener('dragover', onDragOver);
  overlay.addEventListener('dragleave', onDragLeave);
  overlay.addEventListener('drop', onDrop);

  saveButton.addEventListener('click', () => {
    if (!loaded) return;
    saveButton.disabled = true;
    void (async () => {
      try {
        const output = document.createElement('canvas');
        output.width = OUTPUT_WIDTH;
        output.height = OUTPUT_HEIGHT;
        drawCrop(output, loaded!.image, crop);
        const rendered = await canvasBlob(output);
        const record: BackgroundRecord = {
          target,
          original: sourceBlob ?? new Blob(),
          rendered,
          crop: { ...crop },
          imageWidth: loaded!.width,
          imageHeight: loaded!.height,
          fileName,
          updatedAt: Date.now(),
        };
        await saveBackgroundRecord(record);
        saved = true;
        cleanup();
        resolvePromise(true);
      } catch (error) {
        noteEl.textContent = `保存失败：${(error as Error).message}`;
        noteEl.classList.add('error');
        saveButton.disabled = false;
      }
    })();
  });

  if (initialFile) {
    await setImage(initialFile);
  } else if (existing) {
    try {
      const loadedExisting = await loadImageBlob(existing.original, existing.fileName);
      loaded = loadedExisting;
      fileName = existing.fileName;
      baseCrop = coverCrop(loaded.width, loaded.height);
      crop = clampCrop(existing.crop, loaded.width, loaded.height);
      emptyEl.hidden = true;
      canvas.hidden = false;
      noteEl.textContent = `${fileName} · ${loaded.width}×${loaded.height} · 拖动选择区域，滑杆缩放`;
      render();
    } catch {
      emptyEl.hidden = false;
      canvas.hidden = true;
      noteEl.textContent = '原背景无法读取，请重新选择照片。';
    }
  } else {
    canvas.hidden = true;
  }

  return resultPromise;
}
