"use client";

import { useId } from "react";
import { createPortal } from "react-dom";

import { useDialogBehavior } from "@/hooks/useDialogBehavior";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  // Focus starts on Cancel: the action behind this dialog is destructive, so a
  // reflexive Enter should do nothing rather than carry it out.
  const { dialogRef, initialFocusRef } = useDialogBehavior<HTMLButtonElement>(onCancel);

  return createPortal(
    <div
      data-testid="confirm-dialog-backdrop"
      className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="my-auto w-full max-w-md rounded-3xl border border-border-strong bg-surface-0 p-6 shadow-2xl shadow-black/60 sm:p-8"
      >
        <h2 id={titleId} className="text-lg font-bold text-text-primary">
          {title}
        </h2>
        <p id={messageId} className="mt-2 text-sm leading-relaxed text-text-secondary">
          {message}
        </p>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            ref={initialFocusRef}
            type="button"
            onClick={onCancel}
            className="button-secondary px-4 py-2 text-xs font-semibold"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl border border-danger/30 bg-danger-quiet px-4 py-2 text-xs font-semibold text-danger transition-colors hover:bg-danger/20 hover:text-text-primary"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
