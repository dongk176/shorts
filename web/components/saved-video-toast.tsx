"use client";
import { createPortal } from "react-dom";

/** A viewport-centered confirmation that never intercepts clicks or focus. */
export function SavedVideoToast({ message }: { message: string | null }) {
  if (!message) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[150] flex items-center justify-center p-6" role="status" aria-live="polite" aria-atomic="true">
      <div className="flex max-w-sm items-center gap-3 rounded-2xl border border-white/15 bg-[#191b22]/95 px-6 py-4 text-center text-sm font-semibold text-white shadow-[0_12px_48px_rgba(0,0,0,.4)] backdrop-blur-xl">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-violet-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
        {message}
      </div>
    </div>,
    document.body,
  );
}
