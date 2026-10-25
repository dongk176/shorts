"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

function outside(event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) {
  if (event.target !== event.currentTarget || event.currentTarget.tagName !== "DIALOG") return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}

/** Close only for a click that starts and ends on the backdrop, never a drag from inside. */
export function useRankingBackdrop(onClose: () => void) {
  const pressedOutside = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      pressedOutside.current = event.button === 0 && outside(event);
    },
    onPointerCancel() { pressedOutside.current = false; },
    onClick(event: MouseEvent<HTMLElement>) {
      const dismiss = pressedOutside.current && outside(event);
      pressedOutside.current = false;
      if (dismiss) onClose();
    },
  };
}
