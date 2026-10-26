"use client";
import { useState, type FormEvent } from "react";
import { overseasPath } from "@/lib/admin-overseas-contract";

export function OverseasLogin() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      const response = await fetch("/auth/password/sign-in", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({loginId:form.get("loginId"),password:form.get("password"),next:overseasPath}),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json().catch(() => ({})) as {detail?:string};
      if (!response.ok) throw new Error(data.detail || "로그인하지 못했습니다. 다시 시도해 주세요.");
      window.location.assign(overseasPath);
    } catch (failure) {
      setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "응답이 지연되고 있습니다. 다시 시도해 주세요.");
      setPending(false);
    }
  }
  return <main className="grid min-h-screen place-items-center bg-[#080a0f] px-5 py-12 text-white">
    <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#11151e] p-8 shadow-2xl">
      <p className="text-xs font-bold tracking-widest text-violet-300">EASY CUT · GLOBAL CONSOLE</p>
      <h1 className="mt-4 text-2xl font-extrabold">해외 전용 관리자 로그인</h1>
      <p className="mt-3 text-sm leading-6 text-neutral-400">발급받은 해외 전용 관리자 계정으로 로그인하세요.</p>
      <form onSubmit={signIn} className="mt-8 space-y-5">
        <label className="block text-sm">아이디<input name="loginId" required minLength={3} maxLength={32} autoComplete="username" autoCapitalize="none" spellCheck={false} className="mt-2 block w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white outline-none focus:border-violet-400" /></label>
        <label className="block text-sm">비밀번호<input name="password" type="password" required maxLength={128} autoComplete="current-password" className="mt-2 block w-full rounded-xl border border-white/15 bg-black/20 px-4 py-3 text-white outline-none focus:border-violet-400" /></label>
        {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
        <button type="submit" disabled={pending} className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold disabled:opacity-50">{pending?"로그인 중…":"해외 관리자로 로그인"}</button>
      </form>
      <a href={`/auth/sign-in?next=${encodeURIComponent(overseasPath)}`} className="mt-6 block text-center text-xs text-neutral-400 underline">기존 관리자 계정으로 로그인</a>
    </section>
  </main>;
}
