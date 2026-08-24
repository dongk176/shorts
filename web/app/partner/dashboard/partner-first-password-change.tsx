"use client";

import { useState } from "react";

export function PartnerFirstPasswordChange({ creatorName }: { creatorName: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage("새 비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/partner/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          currentPassword,
          newPassword,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "비밀번호를 변경하지 못했습니다.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-[#0d0f10] px-5 py-14 text-neutral-100">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-white/10 bg-[#171a1b] p-6 shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[.2em] text-[#ff9585]">First login</p>
        <h1 className="mt-3 text-2xl font-black">{creatorName}님, 비밀번호를 변경해 주세요</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">대시보드를 사용하기 전에 임시 비밀번호를 새 비밀번호로 바꿔야 합니다.</p>
        {[
          ["현재 임시 비밀번호", currentPassword, setCurrentPassword, "current-password"],
          ["새 비밀번호 (10자 이상)", newPassword, setNewPassword, "new-password"],
          ["새 비밀번호 확인", confirmPassword, setConfirmPassword, "new-password"],
        ].map(([label, value, setter, autoComplete]) => (
          <label key={String(label)} className="mt-5 block text-xs font-black text-neutral-400">
            {String(label)}
            <input
              required
              type="password"
              minLength={label === "현재 임시 비밀번호" ? 1 : 10}
              autoComplete={String(autoComplete)}
              value={String(value)}
              onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 outline-none focus:border-[#ff8c7c]"
            />
          </label>
        ))}
        {message && <p role="alert" className="mt-4 text-sm font-bold text-rose-300">{message}</p>}
        <button disabled={submitting} className="mt-6 h-12 w-full rounded-xl bg-[#ff8c7c] font-black text-black disabled:opacity-50">
          {submitting ? "변경 중…" : "비밀번호 변경"}
        </button>
      </form>
    </main>
  );
}
