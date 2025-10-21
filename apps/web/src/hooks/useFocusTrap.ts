import { RefObject, useEffect } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (root: HTMLElement) => {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    element => !element.hasAttribute('disabled') && element.tabIndex !== -1 && !element.getAttribute('aria-hidden')
  );
};

export const useFocusTrap = (containerRef: RefObject<HTMLElement>, active: boolean) => {
  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    const focusables = getFocusableElements(container);
    const firstFocusable = focusables[0];

    const ensureFocusWithin = () => {
      if (container.contains(document.activeElement)) return;
      firstFocusable?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const tabbables = getFocusableElements(container);
      if (!tabbables.length) {
        event.preventDefault();
        return;
      }

      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (activeElement === first || !container.contains(activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const focusTimeout = window.setTimeout(ensureFocusWithin, 0);
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimeout);
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, active]);
};
