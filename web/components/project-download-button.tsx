"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";

import { useEffect, useRef, useState } from "react";
import { startProjectDownload } from "@/lib/project-download-client";

const labels = {
  ko: { button: "↓ 모든 쇼츠 다운로드", preparing: "다운로드 준비 중…", error: "다운로드를 시작하지 못했어요. 다시 시도해 주세요.", missing: "다운로드할 쇼츠가 없어요. 프로젝트를 새로고침해 주세요.", started: "ZIP 다운로드를 시작했어요.", title: "모든 쇼츠를 ZIP 파일 하나로 저장" },
  en: { button: "↓ Download all Shorts", preparing: "Preparing download…", error: "Could not start the download. Please try again.", missing: "No Shorts are available. Please refresh the project.", started: "ZIP download started.", title: "Save all Shorts in one ZIP file" },
  ja: { button: "↓ すべてダウンロード", preparing: "ダウンロード準備中…", error: "ダウンロードを開始できませんでした。もう一度お試しください。", missing: "ダウンロードできる動画がありません。再読み込みしてください。", started: "ZIPのダウンロードを開始しました。", title: "すべてのショート動画を1つのZIPファイルに保存" },
};

export function ProjectDownloadButton({ projectNumber, disabled, canDownload, onPaywall, locale }: {
  projectNumber: number;
  disabled: boolean;
  canDownload: boolean;
  onPaywall: () => void;
  locale: "ko" | "en" | "ja";
}) {
  const ui = useUiText();
  const text = labels[locale];
  const pending = useRef<AbortController | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const download = async () => {
    if (disabled || pending.current) return;
    if (!canDownload) { onPaywall(); return; }
    const controller = new AbortController();
    pending.current = controller;
    setPreparing(true);
    setNotice(null);
    try {
      const status = await startProjectDownload(projectNumber, AbortSignal.any([
        controller.signal, AbortSignal.timeout(30_000),
      ]));
      if (controller.signal.aborted) return;
      if (status === 402) onPaywall();
      else setNotice({
        text: status >= 400 ? (status === 404 ? text.missing : text.error) : text.started,
        error: status >= 400,
      });
    } catch {
      if (!controller.signal.aborted) setNotice({ text: text.error, error: true });
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setPreparing(false);
    }
  };

  return (
    <div className="relative shrink-0">
      <button data-project-guide="bulk-download" disabled={disabled || preparing} aria-busy={preparing} title={ui(text.title)} onClick={download} className="workspace-button workspace-button-primary disabled:cursor-not-allowed disabled:opacity-40">
        {preparing ? text.preparing : text.button}
      </button>
      {notice && (
        <div role={notice.error ? "alert" : "status"} className={`absolute right-0 top-full z-30 mt-2 w-64 max-w-[calc(100vw-28px)] rounded-lg border p-3 text-xs leading-5 shadow-lg ${notice.error ? "border-red-400/30 bg-neutral-900 text-red-200" : "border-white/15 bg-neutral-900 text-neutral-200"}`}>
          {notice.text}
        </div>
      )}
    </div>
  );
}
