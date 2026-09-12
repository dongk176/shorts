"use client";

import { useCallback, useEffect, useState } from "react";

type Status = { regular: { ready: boolean }; languageTest: { enabled: boolean; ready: boolean } };

export function AdminLanguageTest() {
  const [state, setState] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/language-test", { cache: "no-store" });
    if (!response.ok) throw new Error("언어 테스트 상태를 확인하지 못했습니다.");
    setState(await response.json());
  }, []);
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, [load]);
  async function toggle() {
    if (!state || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/language-test", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !state.languageTest.enabled }),
      });
      if (!response.ok) throw new Error("설정을 변경하지 못했습니다. 테스트 준비 상태를 확인해 주세요.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "설정을 변경하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-white/10 bg-white/[.025] p-5">
    <h2 className="text-base font-bold">관리자 언어 기능 테스트</h2>
    <p className="mt-2 text-sm text-neutral-400">허용하면 제작 화면에서 관리자가 ‘언어 기능 테스트’를 켤 수 있습니다. 중단해도 기존 테스트 결과의 편집·다운로드는 유지됩니다.</p>
    <p className="mt-3 text-sm">일반 제작 연결: {state ? state.regular.ready ? "정상" : "확인 필요" : "확인 중"} · 언어 테스트: {state ? state.languageTest.ready ? "준비됨" : "준비 필요" : "확인 중"}</p>
    <button type="button" role="switch" aria-checked={state?.languageTest.enabled ?? false}
      disabled={!state || busy || (!state.languageTest.enabled && !state.languageTest.ready)}
      onClick={() => void toggle()} className="mt-4 rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold disabled:opacity-40">
      {busy ? "변경 중…" : state?.languageTest.enabled ? "신규 언어 테스트 중단" : "관리자 언어 테스트 허용"}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </section>;
}
