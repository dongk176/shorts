"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AuthProfile } from "@/lib/session";
import { useI18n } from "@/lib/i18n/provider";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none">
      <path
        fill="#191919"
        d="M12 3C6.477 3 2 6.57 2 10.975c0 2.857 1.879 5.362 4.703 6.772l-.956 3.503c-.085.31.27.557.54.376l4.19-2.793c.496.077 1.005.117 1.523.117 5.523 0 10-3.57 10-7.975S17.523 3 12 3Z"
      />
    </svg>
  );
}

const loginProviders = [
  {
    id: "google",
    labelKey: "auth.google",
    Icon: GoogleIcon,
    className: "bg-white text-[#171717] hover:bg-[#f3f3f3]",
  },
  {
    id: "kakao",
    labelKey: "auth.kakao",
    Icon: KakaoIcon,
    className: "bg-[#FEE500] text-[#191919] hover:bg-[#f4dc00]",
  },
] as const;

export function AuthControls({
  user,
  next = "/",
  loginOpen: controlledLoginOpen,
  onLoginOpenChange,
}: {
  user: AuthProfile | null;
  next?: string;
  loginOpen?: boolean;
  onLoginOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [internalLoginOpen, setInternalLoginOpen] = useState(false);
  const [loginMethod, setLoginMethod] = useState<"social" | "password">("social");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordLoginPending, setPasswordLoginPending] = useState(false);
  const [passwordLoginError, setPasswordLoginError] = useState("");
  const loginOpen = controlledLoginOpen ?? internalLoginOpen;
  const setLoginOpen = useCallback((open: boolean) => {
    if (controlledLoginOpen === undefined) setInternalLoginOpen(open);
    onLoginOpenChange?.(open);
  }, [controlledLoginOpen, onLoginOpenChange]);

  useEffect(() => {
    if (!loginOpen || user) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLoginOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [loginOpen, setLoginOpen, user]);

  async function submitPasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordLoginPending) return;
    setPasswordLoginPending(true);
    setPasswordLoginError("");
    try {
      const response = await fetch("/auth/password/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password, next }),
      });
      const payload = await response.json().catch(() => ({})) as {
        detail?: string;
        next?: string;
      };
      if (!response.ok) {
        throw new Error(payload.detail || t("auth.passwordError"));
      }
      window.location.assign(payload.next || "/");
    } catch (error) {
      setPasswordLoginError(
        error instanceof Error ? error.message : t("auth.passwordError"),
      );
      setPasswordLoginPending(false);
    }
  }

  if (!user) {
    return (
      <>
        <button type="button" className="header-cta" onClick={() => setLoginOpen(true)}>
          {t("auth.login")} <span aria-hidden="true">→</span>
        </button>
        {loginOpen && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px] sm:p-6"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setLoginOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="login-dialog-title"
              aria-describedby="login-dialog-description"
              className="login-dialog relative w-full max-w-[440px] overflow-hidden rounded-[24px] border border-white/10 bg-[#272a2c] px-7 pb-9 pt-10 shadow-[0_28px_90px_rgba(0,0,0,.62),0_0_42px_rgba(255,85,64,.12)] sm:px-8 sm:pb-10"
            >
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-16 -top-24 h-40 rounded-full bg-[#ff5540]/10 blur-3xl" />
              <button
                type="button"
                autoFocus
                onClick={() => setLoginOpen(false)}
                className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-[#b9a3a0] transition hover:bg-white/10 hover:text-white active:scale-95"
                aria-label={t("auth.closeDialog")}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
              <div className="relative text-center">
                <div className="mb-7 text-[30px] font-black tracking-[-0.055em] text-[#ffb4a8]">
                  Easy <span className="italic text-[#ff715e]">Cut</span>
                </div>
                <h2 id="login-dialog-title" className="text-2xl font-extrabold tracking-[-0.025em] text-[#f3f5f6]">{t("auth.login")}</h2>
                <p id="login-dialog-description" className="sr-only">
                  {t("auth.dialogDescription")}
                </p>
                {loginMethod === "social" ? (
                  <div className="mt-8 space-y-4">
                    {loginProviders.map((provider) => (
                      <a
                        key={provider.id}
                        href={`/auth/sign-in?provider=${provider.id}&next=${encodeURIComponent(next)}`}
                        className={`flex min-h-14 w-full items-center justify-center gap-3 rounded-xl px-5 text-[15px] font-bold shadow-[0_6px_18px_rgba(0,0,0,.16)] transition duration-200 active:scale-[.98] ${provider.className}`}
                      >
                        <provider.Icon />
                        {t(provider.labelKey)}
                      </a>
                    ))}
                    <div className="flex items-center gap-3 py-1 text-[11px] font-bold text-neutral-500">
                      <span className="h-px flex-1 bg-white/10" />
                      {t("auth.or")}
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordLoginError("");
                        setLoginMethod("password");
                      }}
                      className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/[.04] px-5 text-[15px] font-bold text-white transition hover:border-white/25 hover:bg-white/[.07] active:scale-[.98]"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <circle cx="12" cy="8" r="3.5" />
                        <path d="M5 20c.4-4 2.8-6 7-6s6.6 2 7 6" strokeLinecap="round" />
                      </svg>
                      {t("auth.passwordLogin")}
                    </button>
                  </div>
                ) : (
                  <form className="mt-8 text-left" onSubmit={submitPasswordLogin}>
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordLoginError("");
                        setLoginMethod("social");
                      }}
                      className="mb-5 inline-flex items-center gap-1 text-xs font-bold text-neutral-400 transition hover:text-white"
                    >
                      <span aria-hidden="true">←</span> {t("auth.back")}
                    </button>
                    <label className="block text-xs font-bold text-neutral-300">
                      {t("auth.loginId")}
                      <input
                        value={loginId}
                        onChange={(event) => setLoginId(event.target.value)}
                        minLength={3}
                        maxLength={32}
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="username"
                        required
                        className="mt-2 h-[52px] w-full rounded-xl border border-white/10 bg-black/20 px-4 text-[15px] text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8c7c]/60 focus:ring-2 focus:ring-[#ff715e]/10"
                        placeholder={t("auth.loginIdPlaceholder")}
                      />
                    </label>
                    <label className="mt-4 block text-xs font-bold text-neutral-300">
                      {t("auth.password")}
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        maxLength={128}
                        autoComplete="current-password"
                        required
                        className="mt-2 h-[52px] w-full rounded-xl border border-white/10 bg-black/20 px-4 text-[15px] text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8c7c]/60 focus:ring-2 focus:ring-[#ff715e]/10"
                        placeholder={t("auth.passwordPlaceholder")}
                      />
                    </label>
                    {passwordLoginError ? (
                      <p className="mt-4 rounded-xl border border-red-300/15 bg-red-300/[.06] px-3 py-2.5 text-xs leading-5 text-red-100" role="alert">
                        {passwordLoginError}
                      </p>
                    ) : null}
                    <button
                      type="submit"
                      disabled={passwordLoginPending || loginId.trim().length < 3 || !password}
                      className="mt-5 flex min-h-14 w-full items-center justify-center rounded-xl bg-[#ff715e] px-5 text-[15px] font-black text-white shadow-[0_8px_24px_rgba(255,113,94,.18)] transition hover:bg-[#ff806f] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {passwordLoginPending ? t("auth.passwordSubmitting") : t("auth.passwordSubmit")}
                    </button>
                    <p className="mt-4 text-center text-xs leading-5 text-neutral-500">
                      {t("auth.passwordInviteOnly")}
                    </p>
                  </form>
                )}
                <p className="mt-7 text-center text-[11px] leading-5 text-[#b19a96]">
                  {t("auth.consentPrefix")} <Link href="/terms" className="underline underline-offset-2 hover:text-white">{t("auth.terms")}</Link> {t("auth.consentAnd")} <Link href="/privacy" className="underline underline-offset-2 hover:text-white">{t("auth.privacy")}</Link>{t("auth.consentSuffix")}
                </p>
              </div>
            </section>
          </div>,
          document.body,
        )}
      </>
    );
  }
  const label = user.displayName || user.loginId || user.email || t("auth.myAccount");
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/account/activity"
        className="hidden max-w-40 truncate rounded-md px-1.5 py-1 text-xs font-semibold text-neutral-300 transition hover:bg-white/[.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff8c7c]/70 sm:block"
        title={user.loginId || user.email || label}
        aria-label={`${label} 사용내역 보기`}
      >
        {label}
      </Link>
      <Link
        href="/settings"
        className="account-settings-link"
        title={t("auth.settings")}
        aria-label={t("auth.openSettings")}
        aria-current={pathname === "/settings" ? "page" : undefined}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.07a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.04A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.01V3a2 2 0 1 1 4 0v.01a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
      </Link>
    </div>
  );
}
