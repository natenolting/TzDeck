"use client";

import { useEffect, useRef, type RefObject } from "react";

// video[controls] is focusable but matches none of the usual selectors, so a
// media token's player would be skipped entirely when tabbing through a dialog.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

export interface DialogBehavior<T extends HTMLElement> {
  /** Attach to the dialog element -- bounds the focus trap. */
  dialogRef: RefObject<HTMLDivElement | null>;
  /** Attach to the control that should hold focus when the dialog opens. */
  initialFocusRef: RefObject<T | null>;
}

/**
 * The behaviour every modal in the app shares: Escape dismisses, Tab cycles
 * inside the dialog rather than reaching the page behind it, the page underneath
 * can't scroll, and focus starts on a chosen control and returns to the opener
 * on close.
 */
export function useDialogBehavior<T extends HTMLElement>(
  onDismiss: () => void,
): DialogBehavior<T> {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<T | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) || [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === first || !dialog?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog?.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    initialFocusRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onDismiss]);

  return { dialogRef, initialFocusRef };
}
