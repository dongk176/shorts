"use client";
import { useUiText } from "@/lib/i18n/use-ui-text";

import { useEffect, useId, useRef } from "react";

export function RankingProgressOverlay({ message }: { message: string }) {
  const ui = useUiText();
  const dialog = useRef<HTMLDialogElement>(null);
  const messageId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="ranking-progress-overlay"
      aria-label={ui("영상 처리 중")}
      aria-describedby={messageId}
      onCancel={(event) => event.preventDefault()}
    >
      <span className="ranking-spinner" aria-hidden="true" />
      <p id={messageId} role="status" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </dialog>
  );
}
