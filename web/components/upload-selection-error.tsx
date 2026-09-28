"use client";

import { useEffect, useRef } from "react";
import { useUiText } from "@/lib/i18n/use-ui-text";

export function UploadSelectionError({ error, open, onClose, onRetry }: {
  error: string | null;
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const ui = useUiText();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !error || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open, error]);

  const dismiss = () => {
    dialogRef.current?.close();
    onClose();
  };
  if (!error) return null;
  return (
    <>
      <div id="upload-selection-error" role="alert" className="mt-3 rounded-xl border border-red-300/25 bg-red-400/[.08] px-4 py-3 text-left text-sm leading-6 text-red-100">
        {ui(error)}
      </div>
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby="upload-selection-error-title"
        aria-describedby="upload-selection-error-description"
        onCancel={(event) => { event.preventDefault(); dismiss(); }}
        onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
        className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-[460px] overflow-y-auto rounded-[24px] border border-red-300/20 bg-[#211b1d] p-0 text-white shadow-[0_28px_90px_rgba(0,0,0,.6)] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div className="p-6 sm:p-8">
          <span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-full border border-red-300/25 bg-red-400/10 text-xl text-red-200">!</span>
          <h2 id="upload-selection-error-title" className="mt-5 text-xl font-bold">{ui("선택한 영상을 확인해 주세요")}</h2>
          <p id="upload-selection-error-description" className="mt-3 break-words text-sm leading-6 text-red-100">{ui(error)}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button type="button" autoFocus onClick={() => { dismiss(); onRetry(); }} className="min-h-12 flex-1 rounded-xl bg-white px-4 py-3 text-sm font-bold text-black hover:bg-neutral-100">{ui("다른 영상 선택")}</button>
            <button type="button" onClick={dismiss} className="min-h-12 rounded-xl border border-white/20 px-5 py-3 text-sm text-neutral-200 hover:bg-white/10">{ui("닫기")}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
