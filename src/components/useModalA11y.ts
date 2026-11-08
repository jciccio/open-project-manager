import { useEffect, useRef } from "react";

// Modal stack to ensure Escape and Tab only operate on the topmost modal
const modalStack: (() => void)[] = [];

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useModalA11y(onClose: () => void) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  // Assign in an effect to comply with react-hooks/refs
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Capture active element during render before child autoFocus takes over
  const previouslyFocusedElement = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null
  );

  // Focus trap, modal stack registration, and keyboard listener
  useEffect(() => {
    const restoreFocusTarget = previouslyFocusedElement.current;
    const closeHandler = () => {
      onCloseRef.current();
    };

    modalStack.push(closeHandler);

    function handleKeyDown(e: KeyboardEvent) {
      // Only topmost modal handles keys
      if (modalStack[modalStack.length - 1] !== closeHandler) {
        return;
      }

      if (e.key === "Escape") {
        if (e.isComposing || (e as any).keyCode === 229) return;
        e.stopPropagation();
        closeHandler();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

        if (focusable.length === 0) {
          e.preventDefault();
          modalRef.current.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (!modalRef.current.contains(document.activeElement) || document.activeElement === modalRef.current) {
          e.preventDefault();
          if (e.shiftKey) {
            last.focus();
          } else {
            first.focus();
          }
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const index = modalStack.indexOf(closeHandler);
      if (index !== -1) {
        modalStack.splice(index, 1);
      }
      if (restoreFocusTarget && typeof restoreFocusTarget.focus === "function") {
        restoreFocusTarget.focus();
      }
    };
  }, []);

  // Initial focus run once on mount only
  useEffect(() => {
    if (!modalRef.current) return;
    // If an element inside the dialog already has focus (e.g. from autoFocus), preserve it
    if (modalRef.current.contains(document.activeElement)) {
      return;
    }

    if (typeof modalRef.current.focus === "function") {
      modalRef.current.focus();
    }
  }, []);

  return modalRef;
}

export function useBackdropClose(onClose: () => void) {
  const mouseDownTarget = useRef<EventTarget | null>(null);

  return {
    onMouseDown: (e: React.MouseEvent) => {
      mouseDownTarget.current = e.target;
    },
    onClick: (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) {
        onClose();
      }
    },
  };
}

export function handleRowKeyDown(e: React.KeyboardEvent, action: () => void) {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}
