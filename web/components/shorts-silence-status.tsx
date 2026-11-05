"use client";

import { useState } from "react";
import { useUiText } from "@/lib/i18n/use-ui-text";
import type { SilenceRemovalState } from "@/lib/shorts-silence-contract";

export function ShortsSilenceStatus({ shortId, state }: { shortId: string; state: SilenceRemovalState }) {
  const ui = useUiText();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = async () => {
    setBusy(true); setFailed(false);
    try {
      const response = await fetch(`/api/shorts/${encodeURIComponent(shortId)}/silence-removal`, {
        method: "POST", signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error("silence request failed");
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };
  return <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-[#ffad9d]" role="status">
    {state.status === "completed" ? <span>{state.cutCount ? ui(`무음 ${state.cutCount}곳 정리 · ${state.removedSeconds.toFixed(1)}초 단축`) : ui("잘라낼 무음이 없어 원래 흐름을 유지했어요.")}</span>
      : state.status === "failed" || failed ? <span className="text-neutral-400">{ui("무음 정리를 완료하지 못했어요. 원본 결과를 확인할 수 있어요.")}</span>
      : <span>{ui("무음 구간을 정리하고 있어요.")}</span>}
    {state.status === "waiting" && <button type="button" disabled={busy} onClick={() => void start()}
      className="rounded-lg border border-[#ffad9d]/25 px-3 py-1.5 font-semibold hover:bg-[#ffad9d]/10 disabled:opacity-50">{ui(busy ? "정리 중…" : "지금 정리하기")}</button>}
  </div>;
}
