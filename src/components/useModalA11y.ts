import { useEffect, useRef } from "react";

// Modal stack to ensure Escape only closes the topmost modal
const modalStack: (() => void)[] = [];

export function useModalA11y(onClose: () => void) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  // Focus trap, modal stack registration, and keyboard listener
  useEffect(() => {
    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;

    const closeHandler = () => {
      onCloseRef.current();
    };

    modalStack.push(closeHandler);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (modalStack[modalStack.length - 1] === closeHandler) {
          e.stopPropagation();
          closeHandler();
        }
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
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
      if (previouslyFocusedElement.current && typeof previouslyFocusedElement.current.focus === "function") {
        previouslyFocusedElement.current.focus();
      }
    };
  }, []);

  // Initial focus run once on mount only
  useEffect(() => {
    if (modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      }
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
