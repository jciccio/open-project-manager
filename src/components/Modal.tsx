"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useModalA11y, useBackdropClose } from "./useModalA11y";

const SIZE_CLASSES = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
} as const;

export type ModalSize = keyof typeof SIZE_CLASSES;

const noop = () => {};

interface ModalProps {
  labelledBy: string;
  size?: ModalSize;
  onBackdropClick?: () => void;
  onEscape?: () => void;
  panelClassName?: string;
  children: ReactNode;
}

export function Modal({
  labelledBy,
  size = "md",
  onBackdropClick,
  onEscape,
  panelClassName = "",
  children,
}: ModalProps) {
  const modalRef = useModalA11y(onEscape ?? noop);
  const backdropProps = useBackdropClose(onBackdropClick ?? noop);

  return (
    <div
      {...backdropProps}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={labelledBy}
        className={`w-full ${SIZE_CLASSES[size]} max-h-[90vh] flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl focus:outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 shrink-0 px-6 py-4 border-b border-slate-200 dark:border-slate-800 ${className}`}
    >
      {children}
    </div>
  );
}

export function ModalBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex-1 min-h-0 overflow-y-auto px-6 py-5 ${className}`}>{children}</div>;
}

export function ModalFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-end gap-2.5 shrink-0 px-6 py-4 border-t border-slate-200 dark:border-slate-800 ${className}`}
    >
      {children}
    </div>
  );
}

export function ModalCloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
    >
      <X className="h-5 w-5" />
    </button>
  );
}

export function ModalDismissButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
    >
      {children}
    </button>
  );
}
