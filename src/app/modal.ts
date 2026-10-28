/**
 * Minimal modal state for the DOM menu layer.
 *
 * The game canvas and menu screens keep global keyboard listeners for gameplay
 * shortcuts. When a true modal (background editor / calibration) is open those
 * shortcuts must not reach the page behind it.
 */
let activeModal: HTMLElement | null = null;
let restoreFocus: HTMLElement | null = null;
let inertedRoots: HTMLElement[] = [];

function focusable(modal: HTMLElement): HTMLElement[] {
  return Array.from(
    modal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
}

export function isModalOpen(): boolean {
  return activeModal !== null;
}

/** Mark a DOM overlay as modal, focus it, and make the app root inert. */
export function openModal(modal: HTMLElement, initialFocus?: HTMLElement | null): void {
  if (activeModal && activeModal !== modal) closeModal(activeModal);
  activeModal = modal;
  restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const app = document.getElementById('ui');
  if (app && !app.contains(modal) && !app.inert) {
    app.inert = true;
    inertedRoots.push(app);
  }

  window.requestAnimationFrame(() => {
    if (activeModal !== modal) return;
    const target = initialFocus ?? focusable(modal)[0] ?? modal;
    target.focus();
  });
}

/** Release the modal state and return focus to the element that opened it. */
export function closeModal(modal: HTMLElement): void {
  if (activeModal !== modal) return;
  activeModal = null;
  for (const root of inertedRoots) root.inert = false;
  inertedRoots = [];
  const target = restoreFocus;
  restoreFocus = null;
  if (target?.isConnected) target.focus();
}

/** Keep Tab inside the active modal. Returns true when the event was handled. */
export function trapModalFocus(event: KeyboardEvent, modal: HTMLElement): boolean {
  if (event.key !== 'Tab') return false;
  const items = focusable(modal);
  if (items.length === 0) {
    event.preventDefault();
    modal.focus();
    return true;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const current = document.activeElement;
  if (event.shiftKey && (current === first || !modal.contains(current))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (current === last || !modal.contains(current))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
