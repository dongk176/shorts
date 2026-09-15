"use client";

import { useCallback, useEffect, useState } from "react";

type Status = { languageTest: { enabled: boolean; publicEnabled: boolean; ready: boolean; unavailable?: boolean } };

export function AdminLanguageTest() {
  const [state, setState] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/language-test", { cache: "no-store" });
    if (!response.ok) throw new Error("언어 기능 상태를 확인하지 못했습니다.");
    const next: Status = await response.json();
    if (next.languageTest.unavailable) throw new Error("공개 상태를 확인하지 못했습니다. 다시 확인해 주세요.");
    setState(next);
  }, []);
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, [load]);
  async function toggle() {
    if (!state || busy) return;
    setBusy(true); setError(""); setMessage("");
    const publicEnabled = !state.languageTest.publicEnabled;
    try {
      const response = await fetch("/api/admin/language-test", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicEnabled }),
      });
      if (!response.ok) throw new Error("공개 설정을 변경하지 못했습니다. 실행 준비 상태를 확인해 주세요.");
      await load();
      setMessage(publicEnabled ? "전체 사용자에게 공개했습니다." : "일반 사용자 공개를 껐습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "설정을 변경하지 못했습니다.");
      // A lost response may follow a successful write. Reload the saved value.
      await load().catch(() => { setState(null); });
    } finally { setBusy(false); }
  }
  const current = state?.languageTest;
  const ready = current?.enabled && current.ready;
  return <section className="rounded-2xl border border-white/10 bg-white/[.025] p-5">
    <h2 className="text-base font-bold">언어 기능</h2>
    <p className="mt-2 text-sm text-neutral-400">공개를 끄면 신규 언어 제작이 중단됩니다. 기존 프로젝트는 계속 이용할 수 있습니다.</p>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold">일반 사용자 공개</p>
        <p className="mt-1 text-sm text-neutral-400">{current ? current.publicEnabled ? "전체 사용자에게 공개 중" : "관리자만 이용 중" : "공개 상태 확인 중"}</p>
      </div>
      <button type="button" role="switch" aria-label="일반 사용자 공개" aria-checked={current?.publicEnabled ?? false}
        disabled={!current || busy || (!current.publicEnabled && !ready)}
        onClick={() => void toggle()}
        className={`min-w-20 rounded-full border px-5 py-2 text-sm font-bold disabled:opacity-40 ${current?.publicEnabled ? "border-[#ff715e] bg-[#ff715e] text-black" : "border-white/20 bg-white/5"}`}>
        {busy ? "저장 중…" : current?.publicEnabled ? "ON" : "OFF"}
      </button>
    </div>
    {current && !ready && <p className="mt-3 text-sm text-amber-300">{current.enabled ? "제작·편집 연결의 검증이 완료되지 않아 공개할 수 없습니다." : "언어 제작 연결이 중단되어 공개할 수 없습니다."}</p>}
    <p role="status" className="mt-2 text-sm text-green-300">{message}</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    {!state && error && <button type="button" className="mt-2 text-sm underline" onClick={() => void load().then(() => setError("")).catch((e: Error) => setError(e.message))}>다시 확인</button>}
  </section>;
}
