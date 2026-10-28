export interface PointerCallbacks {
  resolveSector: (clientX: number, clientY: number) => number | null;
  onDown?: (sector: number, performanceTime: number) => void;
  onUp?: (sector: number, performanceTime: number) => void;
}

interface ActivePointer {
  sector: number;
}

/**
 * Multi-touch input for the eight ring sectors. Tracks every pointer id, so a
 * touchscreen can press multiple sectors at once. A precision touchpad reports
 * itself as a single mouse pointer on Windows; it works as a one-finger fallback
 * (click/drag) but cannot expose eight independent trackpad contacts.
 */
export class PointerInput {
  private canvas: HTMLCanvasElement | null = null;
  private callbacks: PointerCallbacks | null = null;
  private readonly active = new Map<number, ActivePointer>();
  private previousTouchAction = '';
  private attached = false;

  attach(canvas: HTMLCanvasElement, callbacks: PointerCallbacks): void {
    if (this.attached) this.detach();
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerCancel);
    canvas.addEventListener('lostpointercapture', this.handlePointerCancel);
    window.addEventListener('blur', this.releaseAll);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    this.releaseAll();
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.handlePointerDown);
      canvas.removeEventListener('pointermove', this.handlePointerMove);
      canvas.removeEventListener('pointerup', this.handlePointerUp);
      canvas.removeEventListener('pointercancel', this.handlePointerCancel);
      canvas.removeEventListener('lostpointercapture', this.handlePointerCancel);
      canvas.style.touchAction = this.previousTouchAction;
    }
    window.removeEventListener('blur', this.releaseAll);
    this.canvas = null;
    this.callbacks = null;
    this.attached = false;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const sector = this.callbacks?.resolveSector(event.clientX, event.clientY);
    if (sector === null || sector === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      this.canvas?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best effort (a synthetic or already-lost pointer).
    }
    this.active.set(event.pointerId, { sector });
    this.callbacks?.onDown?.(sector, event.timeStamp);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const current = this.active.get(event.pointerId);
    if (!current) return;
    const sector = this.callbacks?.resolveSector(event.clientX, event.clientY);
    if (sector === null || sector === undefined || sector === current.sector) return;
    event.preventDefault();
    event.stopPropagation();
    this.callbacks?.onUp?.(current.sector, event.timeStamp);
    current.sector = sector;
    this.callbacks?.onDown?.(sector, event.timeStamp);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const current = this.active.get(event.pointerId);
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    this.active.delete(event.pointerId);
    this.callbacks?.onUp?.(current.sector, event.timeStamp);
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    const current = this.active.get(event.pointerId);
    if (!current) return;
    this.active.delete(event.pointerId);
    this.callbacks?.onUp?.(current.sector, event.timeStamp);
  };

  private releaseAll = (): void => {
    if (this.active.size === 0) return;
    const now = performance.now();
    for (const pointer of this.active.values()) {
      this.callbacks?.onUp?.(pointer.sector, now);
    }
    this.active.clear();
  };
}
