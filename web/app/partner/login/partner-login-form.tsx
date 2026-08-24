"use client";

import { useState } from "react";

export function PartnerLoginForm() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/partner/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ loginId, password }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail || "로그인에 실패했습니다.");
      window.location.assign("/partner/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-3xl border border-white/10 bg-[#171a1b] p-6 shadow-2xl">
      <label className="block text-xs font-black text-neutral-400">
        로그인 아이디
        <input
          required
          autoComplete="username"
          value={loginId}
          onChange={(event) => setLoginId(event.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]"
        />
      </label>
      <label className="mt-5 block text-xs font-black text-neutral-400">
        비밀번호
        <input
          required
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]"
        />
      </label>
      {message && <p role="alert" className="mt-4 text-sm font-bold text-rose-300">{message}</p>}
      <button
        disabled={submitting}
        className="mt-6 h-12 w-full rounded-xl bg-[#ff8c7c] text-sm font-black text-black transition hover:bg-[#ffa799] disabled:opacity-50"
      >
        {submitting ? "로그인 중…" : "로그인"}
      </button>
    </form>
  );
}
