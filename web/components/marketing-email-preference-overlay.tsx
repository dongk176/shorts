"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUsageState } from "@/components/usage-provider";
import { useWelcomeOverlayStage } from "@/components/welcome-overlay-queue";
import type {
  MarketingEmailDecision,
  MarketingEmailPreferenceResponse,
} from "@/lib/marketing-email-preference";
import {
  hasCompletedProjectViewedForFeedback,
  isProjectFeedbackProjectRoute,
} from "@/lib/project-feedback-client";
import { userFacingErrorMessage } from "@/lib/public-error";

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(body.detail || "요청을 처리하지 못했습니다.");
  return body;
}

export function MarketingEmailPreferenceOverlay() {
  const pathname = usePathname();
  const { accountId, authenticated } = useUsageState();
  const {
    active: queueActive,
    complete: completeQueueStage,
  } = useWelcomeOverlayStage("marketing-email");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [preference, setPreference] =
    useState<MarketingEmailPreferenceResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [emailEditing, setEmailEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onProjectRoute = isProjectFeedbackProjectRoute(pathname);

  useEffect(() => {
    if (!authenticated || !queueActive) {
      setPreference(null);
      setOpen(false);
      setEmail("");
      setEmailDraft("");
      setEmailEditing(false);
      setError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/account/marketing-email-preference", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          completeQueueStage();
          return;
        }
        const result = await responseBody<MarketingEmailPreferenceResponse>(response);
        if (cancelled) return;
        if (
          !result.available
          || !result.eligible
          || result.status !== "not_asked"
          || !result.email
        ) {
          setOpen(false);
          completeQueueStage();
          return;
        }
        setPreference(result);
        setEmail(result.email);
        setEmailDraft(result.email);
        setEmailEditing(false);
        if (
          result.promptDue
          && !onProjectRoute
          && hasCompletedProjectViewedForFeedback()
        ) {
          setOpen(true);
        }
      } catch {
        // 선택형 광고 알림 설정 오류가 프로젝트 이용이나 피드백을 막지 않는다.
        if (!cancelled) completeQueueStage();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    authenticated,
    completeQueueStage,
    onProjectRoute,
    pathname,
    queueActive,
  ]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const finish = () => {
    setOpen(false);
    setPreference(null);
    setEmailEditing(false);
    setError(null);
    completeQueueStage();
  };

  const saveDecision = async (status: MarketingEmailDecision) => {
    if (submitting || !preference) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/account/marketing-email-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          status,
          ...(status === "enabled" ? { email } : {}),
        }),
      });
      await responseBody<MarketingEmailPreferenceResponse>(response);
      finish();
    } catch (cause) {
      setError(userFacingErrorMessage(
        cause,
        "광고성 이메일 수신 설정을 저장하지 못했습니다.",
      ));
    } finally {
      setSubmitting(false);
    }
  };

  const startEmailEdit = () => {
    setEmailDraft(email);
    setEmailEditing(true);
    setError(null);
  };

  const cancelEmailEdit = () => {
    setEmailDraft(email);
    setEmailEditing(false);
  };

  const applyEmailEdit = () => {
    const input = emailInputRef.current;
    if (!input || !input.reportValidity()) return;
    const normalizedEmail = emailDraft.trim().toLowerCase();
    setEmail(normalizedEmail);
    setEmailDraft(normalizedEmail);
    setEmailEditing(false);
    setError(null);
  };

  if (!open || !preference) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="marketing-email-preference-title"
      onCancel={(event) => event.preventDefault()}
      className="m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[560px] overflow-y-auto rounded-[28px] border border-[#323744] bg-[#090c13] p-0 text-white shadow-[0_34px_120px_rgba(0,0,0,.8)] backdrop:bg-black/85 backdrop:backdrop-blur-md"
    >
      <header className="px-6 pb-0 pt-6 text-center sm:px-9 sm:pt-7">
        <div
          aria-hidden="true"
          className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-[#ff805f]/20 bg-gradient-to-br from-[#ff8d65]/20 to-[#f24b68]/15 text-[#ff9270]"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
            <path
              d="M4.75 9.25h14.5v10H4.75v-10ZM12 9.25v10M3.75 6.25h16.5v3H3.75v-3Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M12 6.25H8.8a1.8 1.8 0 1 1 1.53-2.75L12 6.25Zm0 0h3.2a1.8 1.8 0 1 0-1.53-2.75L12 6.25Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2
          ref={headingRef}
          id="marketing-email-preference-title"
          tabIndex={-1}
          className="mt-4 text-[25px] font-black leading-tight tracking-[-0.04em] outline-none focus-visible:!outline-none sm:text-[28px]"
        >
          할인·이벤트 소식을 받아보세요
        </h2>
        <p className="mt-3 text-[14px] font-medium leading-6 text-[#a7a9b2] sm:text-[15px]">
          무료 사용권 이벤트, 할인 쿠폰, 새 기능과 템플릿 소식을
          <br className="hidden sm:block" /> 이메일로 보내드려요.
        </p>
      </header>

      <div className="px-5 pb-5 pt-5 sm:px-9">
        <div className="rounded-[18px] border border-[#303541] bg-[#0b0e16]/80 p-3.5 text-left">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold tracking-[-0.01em] text-[#858994] sm:text-[13px]">
              광고성 이메일 수신 주소
            </p>
            {!emailEditing && (
              <button
                type="button"
                disabled={submitting}
                onClick={startEmailEdit}
                className="rounded-lg border border-[#3a3f4c] bg-white/[.025] px-3 py-1.5 text-[11px] font-bold text-[#c4c6ce] transition hover:border-[#666b78] hover:bg-white/[.055] disabled:cursor-wait disabled:opacity-50"
              >
                변경
              </button>
            )}
          </div>
          {emailEditing ? (
            <div className="mt-3">
              <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[#454b59] bg-[#070a11] px-3.5 focus-within:border-[#ff7b5f]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-5 w-5 shrink-0 text-[#8c86bd]"
                  aria-hidden="true"
                >
                  <path
                    d="M4 6.75h16v10.5H4V6.75Zm.5.75L12 13l7.5-5.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <input
                  ref={emailInputRef}
                  type="email"
                  required
                  maxLength={320}
                  autoFocus
                  autoComplete="email"
                  value={emailDraft}
                  onChange={(event) => setEmailDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyEmailEdit();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelEmailEdit();
                    }
                  }}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[13px] font-bold text-white outline-none placeholder:text-neutral-600 sm:text-sm"
                  aria-label="광고성 이메일 수신 주소"
                />
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={cancelEmailEdit}
                  className="min-h-8 rounded-lg px-3 text-[11px] font-bold text-[#8f929c] transition hover:bg-white/[.05] hover:text-neutral-200"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={applyEmailEdit}
                  className="min-h-8 rounded-lg bg-white px-3.5 text-[11px] font-black text-black transition hover:bg-neutral-200"
                >
                  저장
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2.5 flex min-h-12 items-center gap-3 rounded-xl border border-[#353a46] bg-[#070a11]/90 px-3.5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-5 w-5 shrink-0 text-[#8c86bd]"
                aria-hidden="true"
              >
                <path
                  d="M4 6.75h16v10.5H4V6.75Zm.5.75L12 13l7.5-5.5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="min-w-0 break-all text-[13px] font-bold text-[#f0f0f2] sm:text-sm">
                {email}
              </p>
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-[11px] leading-5 text-[#7b7f89] sm:text-xs">
          선택사항이며 서비스 이용에는 영향이 없습니다.
          <br /> 언제든 고객센터에서 수신 동의를 철회할 수 있어요.
        </p>
        <p className="mt-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3.5 py-3 text-center text-[11px] leading-5 text-[#8e929d] sm:text-xs">
          프로젝트 완료 알림은 광고 수신 여부와 관계없이
          <br className="hidden sm:block" /> 계정 이메일로 발송됩니다.
        </p>
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </p>
        )}
      </div>

      <footer className="grid gap-2 px-5 pb-6 sm:grid-cols-[.8fr_1.5fr] sm:px-9 sm:pb-7">
        <button
          type="button"
          disabled={submitting}
          onClick={() => void saveDecision("declined")}
          className="min-h-12 rounded-xl border border-white/10 bg-transparent px-4 text-[13px] font-black text-[#a8abb4] transition hover:border-white/20 hover:bg-white/[.045] hover:text-white disabled:cursor-wait disabled:opacity-50"
        >
          받지 않을게요
        </button>
        <button
          type="button"
          disabled={submitting || emailEditing || !email}
          onClick={() => void saveDecision("enabled")}
          className="group min-h-12 rounded-xl bg-[linear-gradient(105deg,#ff9a5b_0%,#ff654d_44%,#f52d62_100%)] px-5 text-[13px] font-black text-white shadow-[0_10px_30px_rgba(245,47,98,.28),inset_0_1px_0_rgba(255,255,255,.24)] transition hover:brightness-110 disabled:cursor-wait disabled:bg-none disabled:bg-neutral-700 disabled:text-neutral-400 disabled:shadow-none"
        >
          {submitting ? "저장 중..." : "광고성 이메일 수신에 동의하기"}
        </button>
      </footer>
    </dialog>
  );
}
