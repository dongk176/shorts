"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useUsageState } from "@/components/usage-provider";
import { useWelcomeOverlayStage } from "@/components/welcome-overlay-queue";
import type { UsageSnapshot } from "@/lib/contracts";
import {
  projectFeedbackDisappointmentReasons,
  projectFeedbackReasonLabels,
  type ProjectFeedbackDisappointmentReason,
  type ProjectFeedbackPromptStatus,
} from "@/lib/project-feedback";
import {
  clearCompletedProjectViewedForFeedback,
  hasCompletedProjectViewedForFeedback,
  isProjectFeedbackProjectRoute,
  PROJECT_FEEDBACK_STATUS_REFRESH_EVENT,
} from "@/lib/project-feedback-client";
import { userFacingErrorMessage } from "@/lib/public-error";
import { publishUsageSnapshot } from "@/lib/usage-client";

type FeedbackSubmissionResponse = {
  submitted: true;
  rewardSeconds: number;
  rewardValidityDays: number;
  usage: UsageSnapshot;
};

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(body.detail || "요청을 처리하지 못했습니다.");
  return body;
}

export function ProjectFeedbackOverlay() {
  const pathname = usePathname();
  const { authenticated, usage } = useUsageState();
  const {
    active: queueActive,
    complete: completeQueueStage,
  } = useWelcomeOverlayStage("feedback");
  const [status, setStatus] = useState<ProjectFeedbackPromptStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [satisfactionRating, setSatisfactionRating] = useState<number | null>(null);
  const [disappointmentReason, setDisappointmentReason] =
    useState<ProjectFeedbackDisappointmentReason | null>(null);
  const [improvementText, setImprovementText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<FeedbackSubmissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedProjectViewed, setCompletedProjectViewed] = useState(false);
  const skippedInitialUsageRefresh = useRef(false);
  const onProjectRoute = isProjectFeedbackProjectRoute(pathname);

  useEffect(() => {
    if (!authenticated || onProjectRoute) {
      setCompletedProjectViewed(false);
      return;
    }
    setCompletedProjectViewed(hasCompletedProjectViewedForFeedback());
  }, [authenticated, onProjectRoute, pathname]);

  const loadStatus = useCallback(async () => {
    if (
      !authenticated
      || !queueActive
      || !completedProjectViewed
      || onProjectRoute
      || success
    ) return;
    try {
      const response = await fetch("/api/project-feedback", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) return;
      setStatus(await responseBody<ProjectFeedbackPromptStatus>(response));
    } catch {
      // 피드백 요청은 핵심 작업 흐름을 방해하지 않도록 조용히 재시도한다.
    }
  }, [authenticated, completedProjectViewed, onProjectRoute, queueActive, success]);

  useEffect(() => {
    if (
      !authenticated
      || !queueActive
      || !completedProjectViewed
      || onProjectRoute
    ) {
      setStatus(null);
      setOpen(false);
      return;
    }
    void loadStatus();
    const onFocus = () => void loadStatus();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadStatus();
    };
    const onStatusRefresh = () => void loadStatus();
    window.addEventListener("focus", onFocus);
    window.addEventListener(PROJECT_FEEDBACK_STATUS_REFRESH_EVENT, onStatusRefresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(PROJECT_FEEDBACK_STATUS_REFRESH_EVENT, onStatusRefresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authenticated, completedProjectViewed, loadStatus, onProjectRoute, queueActive]);

  const usageFingerprint = usage
    ? `${usage.usedSeconds}:${usage.reservedSeconds}:${usage.remainingSeconds}`
    : "";
  useEffect(() => {
    if (!skippedInitialUsageRefresh.current) {
      skippedInitialUsageRefresh.current = true;
      return;
    }
    void loadStatus();
  }, [loadStatus, usageFingerprint]);

  useEffect(() => {
    if (
      !queueActive
      || !completedProjectViewed
      || onProjectRoute
      || !status
      || success
    ) return;
    if (!status.eligible) {
      clearCompletedProjectViewedForFeedback();
      setCompletedProjectViewed(false);
      completeQueueStage();
      return;
    }
    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [
    completeQueueStage,
    completedProjectViewed,
    onProjectRoute,
    queueActive,
    status,
    success,
  ]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const submitFeedback = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || satisfactionRating === null || disappointmentReason === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/project-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          satisfactionRating,
          disappointmentReason,
          improvementText,
        }),
      });
      const result = await responseBody<FeedbackSubmissionResponse>(response);
      publishUsageSnapshot(result.usage);
      clearCompletedProjectViewedForFeedback();
      setStatus((current) => current
        ? { ...current, eligible: false, submitted: true, promptCompletionCount: null }
        : current);
      setSuccess(result);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "피드백을 보내지 못했습니다."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-feedback-title"
        className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#17181b] shadow-[0_30px_100px_rgba(0,0,0,.6)] sm:rounded-[28px]"
      >
        {success ? (
          <div className="px-6 py-12 text-center sm:px-10">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-2xl text-emerald-300">
              ✓
            </div>
            <h2 id="project-feedback-title" className="mt-5 text-2xl font-black tracking-[-0.03em] text-white">
              처리시간 30분을 드렸어요
            </h2>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              솔직한 의견 감사합니다. 지급된 원본 영상 처리시간은 {success.rewardValidityDays}일 동안 사용할 수 있어요.
            </p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCompletedProjectViewed(false);
                completeQueueStage();
              }}
              className="mt-7 min-h-12 rounded-xl bg-white px-7 text-sm font-black text-black transition hover:bg-neutral-200"
            >
              확인
            </button>
          </div>
        ) : (
          <form onSubmit={submitFeedback}>
            <header className="border-b border-white/10 px-6 pb-6 pt-7 sm:px-9 sm:pt-9">
              <span className="inline-flex rounded-full bg-[#ff7d69]/15 px-3 py-1.5 text-xs font-extrabold text-[#ff9b8d]">
                30초 피드백 · 처리시간 30분
              </span>
              <h2 id="project-feedback-title" className="mt-4 text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">
                완성된 프로젝트, 어떠셨나요?
              </h2>
              <p className="mt-2 text-sm leading-6 text-neutral-400">
                좋은 이야기보다 솔직한 의견이 더 도움이 됩니다. 제출 즉시 원본 영상 처리시간 30분을 드려요.
              </p>
            </header>

            <div className="space-y-8 px-6 py-7 sm:px-9">
              <fieldset>
                <legend className="text-base font-extrabold text-white">
                  완성된 결과물에 얼마나 만족하셨나요?
                </legend>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      key={rating}
                      type="button"
                      aria-pressed={satisfactionRating === rating}
                      onClick={() => setSatisfactionRating(rating)}
                      className={`min-h-12 rounded-xl border text-base font-black transition ${
                        satisfactionRating === rating
                          ? "border-[#ff8c7c] bg-[#ff8c7c] text-black"
                          : "border-white/10 bg-white/[.035] text-neutral-300 hover:border-white/25 hover:bg-white/[.07]"
                      }`}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-xs text-neutral-500">
                  <span>매우 불만족</span>
                  <span>매우 만족</span>
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-base font-extrabold text-white">
                  가장 아쉬웠던 점은 무엇인가요?
                </legend>
                <p className="mt-1 text-xs text-neutral-500">하나만 선택해 주세요.</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {projectFeedbackDisappointmentReasons.map((reason) => (
                    <label
                      key={reason}
                      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                        disappointmentReason === reason
                          ? "border-[#ff8c7c] bg-[#ff8c7c]/10 text-white"
                          : "border-white/10 bg-white/[.025] text-neutral-300 hover:border-white/25"
                      }`}
                    >
                      <input
                        type="radio"
                        name="disappointmentReason"
                        value={reason}
                        checked={disappointmentReason === reason}
                        onChange={() => setDisappointmentReason(reason)}
                        className="h-4 w-4 accent-[#ff8c7c]"
                      />
                      {projectFeedbackReasonLabels[reason]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="block">
                <span className="text-base font-extrabold text-white">
                  리뷰 한 마디
                </span>
                <span className="ml-2 text-xs font-medium text-neutral-500">선택 사항</span>
                <textarea
                  value={improvementText}
                  onChange={(event) => setImprovementText(event.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="자유롭게 적어주세요."
                  className="mt-4 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
                />
                <span className="mt-1 block text-right text-xs text-neutral-600">
                  {improvementText.length}/1000
                </span>
              </label>

              {error && (
                <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </p>
              )}
            </div>

            <footer className="border-t border-white/10 px-6 py-5 sm:px-9">
              <button
                type="submit"
                disabled={submitting || satisfactionRating === null || disappointmentReason === null}
                className="min-h-12 w-full rounded-xl bg-white px-6 text-sm font-black text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "보내는 중..." : "피드백 보내고 30분 받기"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
