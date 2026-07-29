"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { claimOnboardingWelcomeAnnouncement } from "@/app/actions/onboarding-welcome";
import { useUsageState } from "@/components/usage-provider";
import type { OnboardingWelcomeAnnouncement } from "@/lib/onboarding-welcome";
import { userFacingErrorMessage } from "@/lib/public-error";
import {
  userOccupationOptions,
  userUsagePurposeOptions,
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
  const { authenticated, refreshUsage } = useUsageState();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<1 | 2 | "welcome">(1);
  const [welcome, setWelcome] = useState<OnboardingWelcomeAnnouncement | null>(null);
  const [occupation, setOccupation] = useState<UserOccupation | null>(null);
  const [occupationOther, setOccupationOther] = useState("");
  const [purposes, setPurposes] = useState<UserUsagePurpose[]>([]);
  const [purposeOther, setPurposeOther] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) {
      setVisible(false);
      setWelcome(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/onboarding", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) return;
        const status = await responseBody<UserOnboardingStatus>(response);
        if (cancelled) return;
        if (status.required) {
          setWelcome(null);
          setStep(1);
          setVisible(true);
          return;
        }
        const announcement = await claimOnboardingWelcomeAnnouncement();
        if (cancelled || !announcement) {
          setVisible(false);
          return;
        }
        setWelcome(announcement);
        setStep("welcome");
        setVisible(true);
        void refreshUsage();
      } catch {
        // 온보딩 상태 오류로 핵심 서비스 사용을 막지 않는다.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, refreshUsage]);

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
  const ready = occupationReady && purposesReady;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || submitting || occupation === null) return;
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
        }),
      });
      await responseBody<{ completed: true }>(response);
      const announcement = await claimOnboardingWelcomeAnnouncement();
      void refreshUsage();
      if (announcement) {
        setWelcome(announcement);
        setStep("welcome");
      } else {
        setVisible(false);
      }
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "응답을 저장하지 못했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  const welcomeMinutes = welcome ? Math.floor(welcome.grantedSeconds / 60) : 0;
  const closeWelcome = () => {
    setVisible(false);
    setWelcome(null);
    router.push("/");
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="user-onboarding-title"
      onCancel={(event) => {
        if (step !== "welcome") {
          event.preventDefault();
          return;
        }
        closeWelcome();
      }}
      className={`m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] overflow-y-auto rounded-[22px] border border-white/10 bg-[#17181b] p-0 text-white shadow-[0_30px_100px_rgba(0,0,0,.7)] backdrop:bg-black/80 backdrop:backdrop-blur-sm ${
        step === "welcome" ? "max-w-[440px]" : "max-w-[560px]"
      }`}
    >
      <form onSubmit={submit}>
        <header className={step === "welcome"
          ? "px-6 pb-0 pt-8 text-center sm:px-8 sm:pt-9"
          : "border-b border-white/10 px-5 pb-5 pt-6 sm:px-7 sm:pt-7"}
        >
          {step !== "welcome" && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-1 gap-2" aria-label={`온보딩 ${step}단계 중 2단계`}>
                {[1, 2].map((item) => (
                  <span
                    key={item}
                    className={`h-1.5 flex-1 rounded-full ${
                      item <= step ? "bg-[#ff8c7c]" : "bg-white/10"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs font-bold text-neutral-500">{step} / 2</span>
            </div>
          )}
          <h2
            ref={headingRef}
            id="user-onboarding-title"
            tabIndex={-1}
            className={`font-black tracking-[-0.04em] outline-none focus-visible:!outline-none ${
              step === "welcome"
                ? "text-xl sm:text-2xl"
                : "mt-4 text-xl sm:text-2xl"
            }`}
          >
            {step === "welcome"
              ? "원본 영상 처리시간이 충전됐어요"
              : step === 1
                ? "어떤 일을 하고 계신가요?"
                : "이지컷을 어떤 목적으로 사용하시나요?"}
          </h2>
        </header>

        <div className={step === "welcome"
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

          {error && (
            <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>

        <footer className={step === "welcome"
          ? "px-6 pb-8 sm:px-8 sm:pb-9"
          : "border-t border-white/10 px-5 py-4 sm:px-7"}
        >
          {step === "welcome" ? (
            <button
              type="button"
              onClick={closeWelcome}
              className="min-h-11 w-full rounded-lg bg-white px-5 text-[13px] font-black text-black transition hover:bg-neutral-200"
            >
              쇼츠 만들러 가기
            </button>
          ) : step === 1 ? (
            <button
              type="button"
              disabled={!occupationReady || submitting}
              onClick={() => setStep(2)}
              className="min-h-10 w-full rounded-lg bg-white px-5 text-[13px] font-black text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            >
              다음
            </button>
          ) : (
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
