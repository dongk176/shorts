"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { claimOnboardingWelcomeAnnouncement } from "@/app/actions/onboarding-welcome";
import { useUsageState } from "@/components/usage-provider";
import { useWelcomeOverlayStage } from "@/components/welcome-overlay-queue";
import {
  FIRST_JOB_CREATED_EMAIL_PREFERENCE_EVENT,
  type JobCompletionEmailDecision,
  type JobCompletionEmailPreferenceResponse,
  type JobCompletionEmailPreferenceStatus,
  type MarketingEmailDecision,
} from "@/lib/job-completion-preference";
import type { OnboardingWelcomeAnnouncement } from "@/lib/onboarding-welcome";
import { userFacingErrorMessage } from "@/lib/public-error";
import {
  userDiscoverySourceOptions,
  userOccupationOptions,
  userUsagePurposeOptions,
  type UserDiscoverySource,
  type UserOccupation,
  type UserOnboardingStatus,
  type UserUsagePurpose,
} from "@/lib/user-onboarding";

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(body.detail || "요청을 처리하지 못했습니다.");
  return body;
}

export function UserOnboardingOverlay() {
  const router = useRouter();
  const { accountId, authenticated, refreshUsage } = useUsageState();
  const {
    active: queueActive,
    complete: completeQueueStage,
  } = useWelcomeOverlayStage("onboarding");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | "welcome" | "completion-email">(1);
  const [welcome, setWelcome] = useState<OnboardingWelcomeAnnouncement | null>(null);
  const [completionEmail, setCompletionEmail] = useState<string | null>(null);
  const [completionEmailDraft, setCompletionEmailDraft] = useState("");
  const [emailEditing, setEmailEditing] = useState(false);
  const [completionEmailStatus, setCompletionEmailStatus] =
    useState<JobCompletionEmailPreferenceStatus>("not_asked");
  const [marketingEmailStatus, setMarketingEmailStatus] =
    useState<JobCompletionEmailPreferenceStatus>("not_asked");
  const [marketingEmailOptIn, setMarketingEmailOptIn] = useState(true);
  const [occupation, setOccupation] = useState<UserOccupation | null>(null);
  const [occupationOther, setOccupationOther] = useState("");
  const [purposes, setPurposes] = useState<UserUsagePurpose[]>([]);
  const [purposeOther, setPurposeOther] = useState("");
  const [discoverySource, setDiscoverySource] = useState<UserDiscoverySource | null>(null);
  const [discoverySourceOther, setDiscoverySourceOther] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [firstJobPromptActive, setFirstJobPromptActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || (!queueActive && !firstJobPromptActive)) {
      setVisible(false);
      setWelcome(null);
      setCompletionEmail(null);
      setCompletionEmailDraft("");
      setEmailEditing(false);
      setCompletionEmailStatus("not_asked");
      setMarketingEmailStatus("not_asked");
      setMarketingEmailOptIn(true);
      setDiscoverySource(null);
      setDiscoverySourceOther("");
      if (!authenticated) setFirstJobPromptActive(false);
      return;
    }
    if (!queueActive) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/onboarding", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          completeQueueStage();
          return;
        }
        const status = await responseBody<UserOnboardingStatus>(response);
        if (cancelled) return;
        if (status.required) {
          setWelcome(null);
          setCompletionEmail(null);
          setStep(1);
          setVisible(true);
          return;
        }
        const announcement = await claimOnboardingWelcomeAnnouncement();
        if (cancelled) return;
        if (announcement) {
          setWelcome(announcement);
          setStep("welcome");
          setVisible(true);
          void refreshUsage();
          return;
        }
        setVisible(false);
        completeQueueStage();
      } catch {
        // 온보딩 상태 오류로 핵심 서비스 사용을 막지 않는다.
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
    firstJobPromptActive,
    queueActive,
    refreshUsage,
  ]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (visible && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } else if (!visible && dialog.open) {
      dialog.close();
    }
  }, [visible]);

  const togglePurpose = (purpose: UserUsagePurpose) => {
    setPurposes((current) => current.includes(purpose)
      ? current.filter((item) => item !== purpose)
      : [...current, purpose]);
  };

  const occupationReady = occupation !== null
    && (occupation !== "other" || occupationOther.trim().length > 0);
  const purposesReady = purposes.length > 0
    && (!purposes.includes("other") || purposeOther.trim().length > 0);
  const discoverySourceReady = discoverySource !== null
    && (discoverySource !== "other" || discoverySourceOther.trim().length > 0);
  const ready = occupationReady && purposesReady && discoverySourceReady;

  const showCompletionEmailPrompt = useCallback(async () => {
    const response = await fetch("/api/account/completion-email-preference", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 401) return false;
    const preference =
      await responseBody<JobCompletionEmailPreferenceResponse>(response);
    const marketingStatus = preference.marketingStatus ?? "not_asked";
    if (
      !preference.promptDue
      ||
      (
        preference.status !== "not_asked"
        && marketingStatus !== "not_asked"
      )
      || !preference.email
    ) return false;
    setWelcome(null);
    setCompletionEmail(preference.email);
    setCompletionEmailDraft(preference.email);
    setEmailEditing(false);
    setCompletionEmailStatus(preference.status);
    setMarketingEmailStatus(marketingStatus);
    setMarketingEmailOptIn(true);
    setStep("completion-email");
    setVisible(true);
    return true;
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const handleFirstJobCreated = () => {
      setFirstJobPromptActive(true);
      setError(null);
      void showCompletionEmailPrompt()
        .then((shown) => {
          if (!shown) setFirstJobPromptActive(false);
        })
        .catch(() => {
          // 알림 설정을 불러오지 못해도 생성된 작업 처리를 막지 않는다.
          setFirstJobPromptActive(false);
        });
    };
    window.addEventListener(
      FIRST_JOB_CREATED_EMAIL_PREFERENCE_EVENT,
      handleFirstJobCreated,
    );
    return () => window.removeEventListener(
      FIRST_JOB_CREATED_EMAIL_PREFERENCE_EVENT,
      handleFirstJobCreated,
    );
  }, [authenticated, showCompletionEmailPrompt]);

  const finishOverlay = () => {
    setVisible(false);
    setWelcome(null);
    setCompletionEmail(null);
    setCompletionEmailDraft("");
    setEmailEditing(false);
    setCompletionEmailStatus("not_asked");
    setMarketingEmailStatus("not_asked");
    setMarketingEmailOptIn(true);
    setFirstJobPromptActive(false);
    setError(null);
    completeQueueStage();
    router.push("/");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      step !== 3
      || !ready
      || submitting
      || occupation === null
      || discoverySource === null
    ) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          occupation,
          occupationOther: occupation === "other" ? occupationOther.trim() : null,
          usagePurposes: purposes,
          usagePurposeOther: purposes.includes("other") ? purposeOther.trim() : null,
          discoverySource,
          discoverySourceOther: discoverySource === "other"
            ? discoverySourceOther.trim()
            : null,
        }),
      });
      await responseBody<{ completed: true }>(response);
      const announcement = await claimOnboardingWelcomeAnnouncement();
      void refreshUsage();
      if (announcement) {
        setWelcome(announcement);
        setStep("welcome");
      } else {
        finishOverlay();
      }
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "응답을 저장하지 못했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  const continueAfterWelcome = () => {
    if (preferenceSaving) return;
    finishOverlay();
  };

  const saveEmailPreferences = async (
    status: JobCompletionEmailDecision,
    marketingStatus: MarketingEmailDecision,
  ) => {
    if (preferenceSaving) return;
    setPreferenceSaving(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/account/completion-email-preference",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            status,
            marketingStatus,
            email: completionEmail,
          }),
        },
      );
      await responseBody<JobCompletionEmailPreferenceResponse>(response);
      finishOverlay();
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "완료 알림 설정을 저장하지 못했습니다."));
    } finally {
      setPreferenceSaving(false);
    }
  };

  const startEmailEdit = () => {
    if (!completionEmail) return;
    setCompletionEmailDraft(completionEmail);
    setEmailEditing(true);
    setError(null);
  };

  const cancelEmailEdit = () => {
    setCompletionEmailDraft(completionEmail || "");
    setEmailEditing(false);
  };

  const applyEmailEdit = () => {
    const input = emailInputRef.current;
    if (!input || !input.reportValidity()) return;
    const email = completionEmailDraft.trim().toLowerCase();
    setCompletionEmail(email);
    setCompletionEmailDraft(email);
    setEmailEditing(false);
    setError(null);
  };

  const deferEmailPreferencePrompt = async () => {
    if (preferenceSaving) return;
    setPreferenceSaving(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/account/email-preference-prompt/later",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: "{}",
        },
      );
      await responseBody<{
        deferred: true;
        completionDelay: number;
        nextPromptCompletedJobCount: number;
      }>(response);
      finishOverlay();
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "알림 설정을 나중으로 미루지 못했습니다."));
    } finally {
      setPreferenceSaving(false);
    }
  };

  if (!visible) return null;

  const welcomeMinutes = welcome ? Math.floor(welcome.grantedSeconds / 60) : 0;
  const isBenefitStep = step === "welcome" || step === "completion-email";
  const isCompletionEmailStep = step === "completion-email";
  const completionQuestionPending = completionEmailStatus === "not_asked";
  const marketingQuestionPending = marketingEmailStatus === "not_asked";
  const primaryCompletionDecision: JobCompletionEmailDecision =
    completionQuestionPending ? "enabled" : completionEmailStatus;
  const existingMarketingDecision: MarketingEmailDecision =
    marketingEmailStatus === "not_asked" ? "declined" : marketingEmailStatus;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="user-onboarding-title"
      onCancel={(event) => {
        event.preventDefault();
        if (step === "welcome") {
          void continueAfterWelcome();
        }
      }}
      className={`m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] overflow-y-auto border p-0 text-white backdrop:bg-black/85 backdrop:backdrop-blur-md ${
        isCompletionEmailStep
          ? "max-w-[560px] rounded-[28px] border-[#323744] bg-[#090c13] shadow-[0_34px_120px_rgba(0,0,0,.8)]"
          : "rounded-[22px] border-white/10 bg-[#17181b] shadow-[0_30px_100px_rgba(0,0,0,.7)]"
      } ${
        isBenefitStep && !isCompletionEmailStep
          ? "max-w-[440px]"
          : !isBenefitStep
            ? "max-w-[560px]"
            : ""
      }`}
    >
      <form onSubmit={submit}>
        <header className={isCompletionEmailStep
          ? "px-6 pb-0 pt-5 text-center sm:px-9 sm:pt-6"
          : isBenefitStep
            ? "px-6 pb-0 pt-8 text-center sm:px-8 sm:pt-9"
            : "border-b border-white/10 px-5 pb-5 pt-6 sm:px-7 sm:pt-7"}
        >
          {typeof step === "number" && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-1 gap-2" aria-label={`온보딩 ${step}단계 중 3단계`}>
                {[1, 2, 3].map((item) => (
                  <span
                    key={item}
                    className={`h-1.5 flex-1 rounded-full ${
                      item <= step ? "bg-[#ff8c7c]" : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs font-bold text-neutral-500">{step} / 3</span>
            </div>
          )}
          {isCompletionEmailStep && (
            <div
              aria-hidden="true"
              className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-[#ff855f]/25 bg-[radial-gradient(circle_at_50%_35%,rgba(255,130,91,.14),rgba(255,82,105,.035)_70%)] text-[#ff936d] shadow-[0_0_32px_rgba(255,116,86,.08)]"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                <path
                  d="M7.2 10.1a4.8 4.8 0 0 1 9.6 0v2.45c0 .78.25 1.54.72 2.16l.98 1.29h-13l.98-1.29c.47-.62.72-1.38.72-2.16V10.1Z"
                  stroke="currentColor"
                  strokeWidth="1.65"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 19a2.25 2.25 0 0 0 4 0M12 2.75v1.6M5.4 5.15l1.15 1.1M18.6 5.15l-1.15 1.1"
                  stroke="currentColor"
                  strokeWidth="1.65"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}
          <h2
            ref={headingRef}
            id="user-onboarding-title"
            tabIndex={-1}
            className={`font-black tracking-[-0.04em] outline-none focus-visible:!outline-none ${
              isCompletionEmailStep
                ? "mt-3 text-[25px] leading-tight sm:text-[28px]"
                : isBenefitStep
                ? "text-xl sm:text-2xl"
                : "mt-4 text-xl sm:text-2xl"
            }`}
          >
            {step === "welcome"
              ? "원본 영상 처리시간이 충전됐어요"
              : step === "completion-email"
                ? completionQuestionPending
                  ? "완성되면 바로 알려드릴게요"
                  : "이벤트·프로모션 이메일을 받아보세요"
              : step === 1
                ? "어떤 일을 하고 계신가요?"
                : step === 2
                  ? "이지컷을 어떤 목적으로 사용하시나요?"
                  : "이지컷을 어떻게 알게 되었나요?"}
          </h2>
        </header>

        <div className={isCompletionEmailStep
          ? "px-5 pb-5 pt-4 text-center sm:px-9 sm:pb-5"
          : isBenefitStep
            ? "px-6 pb-6 pt-5 text-center sm:px-8"
            : "space-y-6 px-5 py-5 sm:px-7"}
        >
          {step === "welcome" && welcome && (
            <div>
              <p className="text-5xl font-black tracking-[-0.06em] sm:text-6xl">
                <span className="inline-block bg-gradient-to-r from-[#ff715e] via-[#ffb4a8] to-[#a078ff] bg-clip-text text-transparent">
                  {welcomeMinutes}<span className="ml-1 text-2xl tracking-[-0.04em] sm:text-3xl">분</span>
                </span>
              </p>
              <p className="mt-3 text-sm text-neutral-400">
                원본 영상 길이 합계 {welcomeMinutes}분까지 쇼츠로 만들 수 있어요.
              </p>
            </div>
          )}
          {step === "completion-email" && completionEmail && (
            <div>
              {completionQuestionPending && (
                <p className="text-[14px] font-medium leading-6 text-[#a7a9b2] sm:text-[15px]">
                  영상 처리는 보통 5~10분 정도 걸려요.
                  <br />
                  완성되는 즉시 이메일로 알려드릴게요.
                </p>
              )}
              {marketingQuestionPending && (
                <div className={`${completionQuestionPending ? "mt-4" : ""} rounded-[20px] border border-[#ff735d]/75 bg-[radial-gradient(circle_at_top_left,rgba(255,126,81,.16),transparent_52%),linear-gradient(135deg,rgba(255,107,82,.07),rgba(239,48,91,.055))] p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,.03),0_12px_40px_rgba(8,9,16,.25)]`}>
                  <div className="flex items-center gap-3">
                    <div
                      aria-hidden="true"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#ff805f]/20 bg-gradient-to-br from-[#ff8d65]/20 to-[#f24b68]/15 text-[#ff9270]"
                    >
                      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
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
                    <p className="text-[14px] font-black tracking-[-0.02em] text-white sm:text-[15px]">
                      무료 사용권 이벤트와 할인 소식
                    </p>
                  </div>
                  <p className="mt-2.5 text-[12px] leading-5 text-[#9da0aa] sm:text-[13px]">
                    기간 한정 이벤트, 할인 쿠폰, 새 기능과 템플릿
                    <br className="hidden sm:block" /> 소식을 이메일로 보내드려요.
                  </p>
                  <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[#3a3e49] bg-[#090c13]/55 px-3.5 py-2.5 transition hover:border-[#5b606c]">
                    <input
                      type="checkbox"
                      checked={marketingEmailOptIn}
                      onChange={(event) => setMarketingEmailOptIn(event.target.checked)}
                      className="h-5 w-5 shrink-0 rounded-md accent-[#ff7058]"
                    />
                    <span className="text-[13px] font-bold leading-5 text-[#d6d7dc] sm:text-sm">
                      (선택) 광고성 정보 이메일 수신에 동의해요
                    </span>
                  </label>
                </div>
              )}
              <div className="mt-4 rounded-[18px] border border-[#303541] bg-[#0b0e16]/80 p-3.5 text-left">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold tracking-[-0.01em] text-[#858994] sm:text-[13px]">
                    이메일 수신 주소
                  </p>
                  {!emailEditing && (
                    <button
                      type="button"
                      disabled={preferenceSaving}
                      onClick={startEmailEdit}
                      className="rounded-lg border border-[#3a3f4c] bg-white/[.025] px-3 py-1.5 text-[11px] font-bold text-[#c4c6ce] transition hover:border-[#666b78] hover:bg-white/[.055] disabled:cursor-wait disabled:opacity-50"
                    >
                      편집
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
                        value={completionEmailDraft}
                        onChange={(event) => setCompletionEmailDraft(event.target.value)}
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
                        aria-label="이메일 수신 주소"
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
                      {completionEmail}
                    </p>
                  </div>
                )}
              </div>
              <p className="mt-2.5 text-[11px] leading-5 text-[#6f737e]">
                선택하신 소식만 이 주소로 보내드려요.
              </p>
            </div>
          )}
          {step === 1 && <fieldset disabled={submitting}>
            <legend className="sr-only">직업 선택</legend>
            <p className="text-xs text-neutral-500">하나만 선택해 주세요.</p>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {userOccupationOptions.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px] font-semibold transition sm:gap-2.5 sm:px-3 sm:text-[15px] ${
                    occupation === option.value
                      ? "border-[#ff8c7c] bg-[#ff8c7c]/10 text-white"
                      : "border-white/10 bg-white/[.025] text-neutral-300 hover:border-white/25"
                  }`}
                >
                  <input
                    type="radio"
                    name="occupation"
                    value={option.value}
                    checked={occupation === option.value}
                    onChange={() => setOccupation(option.value)}
                    className="h-4 w-4 accent-[#ff8c7c]"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {occupation === "other" && (
              <input
                value={occupationOther}
                onChange={(event) => setOccupationOther(event.target.value)}
                maxLength={100}
                placeholder="직업을 직접 입력해 주세요."
                autoFocus
                className="mt-2.5 h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-[13px] outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
            )}
          </fieldset>}

          {step === 2 && <fieldset disabled={submitting}>
            <legend className="sr-only">이용 목적 선택</legend>
            <p className="text-xs text-neutral-500">여러 개 선택할 수 있어요.</p>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {userUsagePurposeOptions.map((option) => {
                const selected = purposes.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition sm:gap-2.5 sm:px-3 sm:text-[13px] ${
                      selected
                        ? "border-[#ff8c7c] bg-[#ff8c7c]/10 text-white"
                        : "border-white/10 bg-white/[.025] text-neutral-300 hover:border-white/25"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="usagePurpose"
                      value={option.value}
                      checked={selected}
                      onChange={() => togglePurpose(option.value)}
                      className="h-4 w-4 rounded accent-[#ff8c7c]"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
            {purposes.includes("other") && (
              <input
                value={purposeOther}
                onChange={(event) => setPurposeOther(event.target.value)}
                maxLength={100}
                placeholder="이용 목적을 직접 입력해 주세요."
                className="mt-2.5 h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-[13px] outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
            )}
          </fieldset>}

          {step === 3 && <fieldset disabled={submitting}>
            <legend className="sr-only">이지컷을 알게 된 경로 선택</legend>
            <p className="text-xs text-neutral-500">하나만 선택해 주세요.</p>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {userDiscoverySourceOptions.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition sm:gap-2.5 sm:px-3 sm:text-[13px] ${
                    discoverySource === option.value
                      ? "border-[#ff8c7c] bg-[#ff8c7c]/10 text-white"
                      : "border-white/10 bg-white/[.025] text-neutral-300 hover:border-white/25"
                  }`}
                >
                  <input
                    type="radio"
                    name="discoverySource"
                    value={option.value}
                    checked={discoverySource === option.value}
                    onChange={() => setDiscoverySource(option.value)}
                    className="h-4 w-4 accent-[#ff8c7c]"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {discoverySource === "other" && (
              <input
                value={discoverySourceOther}
                onChange={(event) => setDiscoverySourceOther(event.target.value)}
                maxLength={100}
                placeholder="알게 된 경로를 직접 입력해 주세요."
                autoFocus
                className="mt-2.5 h-10 w-full rounded-lg border border-white/10 bg-black/20 px-3 text-[13px] outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
            )}
          </fieldset>}

          {error && (
            <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        <footer className={isCompletionEmailStep
          ? "px-5 pb-5 sm:px-9 sm:pb-6"
          : isBenefitStep
            ? "px-6 pb-8 sm:px-8 sm:pb-9"
            : "border-t border-white/10 px-5 py-4 sm:px-7"}
        >
          {step === "welcome" ? (
            <button
              type="button"
              disabled={preferenceSaving}
              onClick={() => void continueAfterWelcome()}
              className="min-h-11 w-full rounded-lg bg-white px-5 text-[13px] font-black text-black transition hover:bg-neutral-200 disabled:cursor-wait disabled:bg-neutral-700 disabled:text-neutral-400"
            >
              {preferenceSaving ? "확인 중..." : "계속하기"}
            </button>
          ) : step === "completion-email" ? (
            <div className="grid gap-2 sm:grid-cols-[.72fr_1.5fr]">
              <button
                type="button"
                disabled={preferenceSaving}
                onClick={() => void deferEmailPreferencePrompt()}
                className="min-h-12 rounded-xl border-0 bg-transparent px-4 text-[13px] font-black text-[#9fa2ac] transition hover:bg-white/[.045] hover:text-white disabled:cursor-wait disabled:opacity-50"
              >
                나중에
              </button>
              <button
                type="button"
                autoFocus
                disabled={
                  preferenceSaving
                  || emailEditing
                  || (!completionQuestionPending && !marketingEmailOptIn)
                }
                onClick={() => void saveEmailPreferences(
                  primaryCompletionDecision,
                  marketingQuestionPending
                    ? marketingEmailOptIn ? "enabled" : "declined"
                    : existingMarketingDecision,
                )}
                className="group min-h-12 rounded-xl bg-[linear-gradient(105deg,#ff9a5b_0%,#ff654d_44%,#f52d62_100%)] px-5 text-[13px] font-black text-white shadow-[0_10px_30px_rgba(245,47,98,.28),inset_0_1px_0_rgba(255,255,255,.24)] transition hover:brightness-110 hover:shadow-[0_12px_36px_rgba(245,47,98,.36),inset_0_1px_0_rgba(255,255,255,.28)] disabled:cursor-wait disabled:bg-none disabled:bg-neutral-700 disabled:text-neutral-400 disabled:shadow-none"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {preferenceSaving
                    ? "저장 중..."
                    : completionQuestionPending
                      ? "동의하고 이메일 알림 받기"
                      : "광고성 이메일 수신 동의"}
                  {!preferenceSaving && (
                    <span
                      aria-hidden="true"
                      className="text-lg leading-none transition group-hover:translate-x-0.5"
                    >
                      ›
                    </span>
                  )}
                </span>
              </button>
            </div>
          ) : step === 1 ? (
            <button
              type="button"
              disabled={!occupationReady || submitting}
              onClick={() => setStep(2)}
              className="min-h-10 w-full rounded-lg bg-white px-5 text-[13px] font-black text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            >
              다음
            </button>
          ) : step === 2 ? (
            <div className="grid grid-cols-[auto_1fr] gap-1.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStep(1)}
                className="min-h-10 rounded-lg border border-white/10 px-4 text-[13px] font-bold text-neutral-300 transition hover:border-white/25 hover:bg-white/[.05] disabled:cursor-not-allowed disabled:opacity-50"
              >
                이전
              </button>
              <button
                type="button"
                disabled={!purposesReady || submitting}
                onClick={() => setStep(3)}
                className="min-h-10 rounded-lg bg-white px-5 text-[13px] font-black text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
              >
                다음
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-[auto_1fr] gap-1.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStep(2)}
                className="min-h-10 rounded-lg border border-white/10 px-4 text-[13px] font-bold text-neutral-300 transition hover:border-white/25 hover:bg-white/[.05] disabled:cursor-not-allowed disabled:opacity-50"
              >
                이전
              </button>
              <button
                type="submit"
                disabled={!ready || submitting}
                className="min-h-10 rounded-lg bg-white px-5 text-[13px] font-black text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
              >
                {submitting ? "저장 중..." : "시작하기"}
              </button>
            </div>
          )}
        </footer>
      </form>
    </dialog>
  );
}
