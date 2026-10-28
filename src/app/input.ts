export interface KeyboardCallbacks {
  onDown?: (sector: number, performanceTime: number, event: KeyboardEvent) => void;
  onUp?: (sector: number, performanceTime: number, event: KeyboardEvent) => void;
  onEscape?: () => void;
  onOther?: (event: KeyboardEvent) => void;
}

/** Translates KeyboardEvent.code into game sectors and timestamps presses. */
export class KeyboardInput {
  private keys: Record<string, number> = {};
  private held = new Map<string, number>();
  private callbacks: KeyboardCallbacks = {};
  private capture: ((event: KeyboardEvent) => void) | null = null;
  private attached = false;

  attach(callbacks: KeyboardCallbacks): void {
    this.callbacks = callbacks;
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    this.held.clear();
  }

  setKeys(keys: Record<string, number>): void {
    this.keys = { ...keys };
  }

  /** Wait for the next key press, used by the settings screen. */
  captureNextKey(callback: (code: string) => void): void {
    this.capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      this.capture = null;
      callback(event.code);
    };
  }

  cancelCapture(): void {
    this.capture = null;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (this.capture) {
      this.capture(event);
      return;
    }
    if (event.repeat) return;
    if (event.code === 'Escape') {
      this.callbacks.onEscape?.();
      return;
    }
    const sector = this.keys[event.code];
    if (sector === undefined) {
      this.callbacks.onOther?.(event);
      return;
    }
    event.preventDefault();
    this.held.set(event.code, sector);
    this.callbacks.onDown?.(sector, event.timeStamp, event);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (this.capture) return;
    const sector = this.keys[event.code] ?? this.held.get(event.code);
    if (sector === undefined) return;
    event.preventDefault();
    this.held.delete(event.code);
    this.callbacks.onUp?.(sector, event.timeStamp, event);
  };

  private handleBlur = (): void => {
    const now = performance.now();
    for (const sector of this.held.values()) {
      this.callbacks.onUp?.(sector, now, new KeyboardEvent('keyup'));
    }
    this.held.clear();
  };
}

const CODE_LABELS: Record<string, string> = {
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
  ShiftLeft: 'LShift',
  ShiftRight: 'RShift',
  ControlLeft: 'LCtrl',
  ControlRight: 'RCtrl',
  AltLeft: 'LAlt',
  AltRight: 'RAlt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  NumpadAdd: 'N+',
  NumpadSubtract: 'N-',
  NumpadMultiply: 'N*',
  NumpadDivide: 'N/',
  NumpadDecimal: 'N.',
  NumpadEnter: 'NEnter',
};

export function keyLabel(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code]!;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `N${code.slice(6)}`;
  return code;
}

export function keyCodeFromLabel(label: string): string {
  const found = Object.entries(CODE_LABELS).find(([, value]) => value === label);
  return found ? found[0] : label;
}
