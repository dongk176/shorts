"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "@/lib/i18n/navigation";
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
  deferProjectFeedback,
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
  const { authenticated, accountId } = useUsageState();
  useEffect(() => {
    if (!authenticated || !accountId) clearCompletedProjectViewedForFeedback();
    else hasCompletedProjectViewedForFeedback(accountId);
  }, [accountId, authenticated]);
  if (!authenticated || !accountId) return null;
  return <AccountProjectFeedbackOverlay key={accountId} accountId={accountId} />;
}

function AccountProjectFeedbackOverlay({ accountId }: { accountId: string }) {
  const ui = useUiText();
  const pathname = usePathname();
  const { usage } = useUsageState();
  const { active: queueActive, complete: completeQueueStage } = useWelcomeOverlayStage("feedback");
  const [status, setStatus] = useState<ProjectFeedbackPromptStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [satisfactionRating, setSatisfactionRating] = useState<number | null>(null);
  const [disappointmentReason, setDisappointmentReason] =
    useState<ProjectFeedbackDisappointmentReason | null>(null);
  const [improvementText, setImprovementText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<FeedbackSubmissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const onProjectRoute = isProjectFeedbackProjectRoute(pathname);
  const usageFingerprint = usage
    ? `${usage.usedSeconds}:${usage.reservedSeconds}:${usage.remainingSeconds}`
    : "";

  useEffect(() => {
    if (success) return;
    if (!queueActive || onProjectRoute) {
      setStatus(null);
      setOpen(false);
      return;
    }
    let active = true;
    let controller: AbortController | null = null;
    const loadStatus = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      if (!hasCompletedProjectViewedForFeedback(accountId)) {
        setStatus(null);
        setOpen(false);
        return;
      }
      try {
        const response = await fetch("/api/project-feedback", {
          cache: "no-store",
          credentials: "same-origin",
          signal: requestController.signal,
        });
        if (response.status === 401) {
          if (active && !requestController.signal.aborted) { setStatus(null); setOpen(false); }
          return;
        }
        const result = await responseBody<ProjectFeedbackPromptStatus>(response);
        if (active && !requestController.signal.aborted && hasCompletedProjectViewedForFeedback(accountId)) {
          setStatus(result);
        }
      } catch {
        // Feedback must never interrupt the core project flow.
      }
    };
    const refresh = () => { if (document.visibilityState === "visible") void loadStatus(); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener(PROJECT_FEEDBACK_STATUS_REFRESH_EVENT, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener(PROJECT_FEEDBACK_STATUS_REFRESH_EVENT, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [accountId, onProjectRoute, pathname, queueActive, success, usageFingerprint]);

  useEffect(() => {
    if (!queueActive || onProjectRoute || !status || success) return;
    if (!status.eligible) {
      clearCompletedProjectViewedForFeedback();
      completeQueueStage();
      return;
    }
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible" && hasCompletedProjectViewedForFeedback(accountId)) {
        setOpen(true);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [accountId, completeQueueStage, onProjectRoute, queueActive, status, success]);

  const closeFeedback = useCallback(() => {
    if (submitting) return;
    if (!success) deferProjectFeedback(accountId);
    else clearCompletedProjectViewedForFeedback();
    setOpen(false);
    completeQueueStage();
  }, [accountId, completeQueueStage, submitting, success]);

  useEffect(() => {
    if (!open || onProjectRoute || !queueActive) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onProjectRoute, open, queueActive]);

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
      if (!mounted.current) return;
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

  if (!open || onProjectRoute || !queueActive) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="presentation"
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeFeedback();
          }
          if (event.key !== "Tab") return;
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href]',
          );
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        aria-labelledby="project-feedback-title"
        className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#17181b] shadow-[0_30px_100px_rgba(0,0,0,.6)] sm:rounded-[28px]"
      >
        {success ? (
          <div className="px-6 py-12 text-center sm:px-10">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-2xl text-emerald-300">
              ✓
            </div>
            <h2 id="project-feedback-title" className="mt-5 text-2xl font-black tracking-[-0.03em] text-white">
              {ui("처리시간 30분을 드렸어요")}</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              {ui("솔직한 의견 감사합니다. 지급된 원본 영상 처리시간은 ")}{success.rewardValidityDays}{ui("일 동안 사용할 수 있어요.")}</p>
            <button
              type="button"
              onClick={closeFeedback}
              className="mt-7 min-h-12 rounded-xl bg-white px-7 text-sm font-black text-black transition hover:bg-neutral-200"
            >
              {ui("확인")}</button>
          </div>
        ) : (
          <form onSubmit={submitFeedback}>
            <header className="relative border-b border-white/10 px-6 pb-6 pt-7 sm:px-9 sm:pt-9">
              <button
                type="button"
                aria-label={ui("피드백 닫기")}
                disabled={submitting}
                onClick={closeFeedback}
                className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-xl text-neutral-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >×</button>
              <span className="inline-flex rounded-full bg-[#ff7d69]/15 px-3 py-1.5 text-xs font-extrabold text-[#ff9b8d]">
                {ui("30초 피드백 · 처리시간 30분")}</span>
              <h2 id="project-feedback-title" className="mt-4 text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">
                {ui("완성된 프로젝트, 어떠셨나요?")}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-400">
                {ui("좋은 이야기보다 솔직한 의견이 더 도움이 됩니다. 제출 즉시 원본 영상 처리시간 30분을 드려요.")}</p>
            </header>

            <div className="space-y-8 px-6 py-7 sm:px-9">
              <fieldset>
                <legend className="text-base font-extrabold text-white">
                  {ui("완성된 결과물에 얼마나 만족하셨나요?")}</legend>
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
                  <span>{ui("매우 불만족")}</span>
                  <span>{ui("매우 만족")}</span>
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-base font-extrabold text-white">
                  {ui("가장 아쉬웠던 점은 무엇인가요?")}</legend>
                <p className="mt-1 text-xs text-neutral-500">{ui("하나만 선택해 주세요.")}</p>
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
                  {ui("리뷰 한 마디")}</span>
                <span className="ml-2 text-xs font-medium text-neutral-500">{ui("선택 사항")}</span>
                <textarea
                  value={improvementText}
                  onChange={(event) => setImprovementText(event.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder={ui("자유롭게 적어주세요.")}
                  className="mt-4 w-full resize-none rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
                />
                <span className="mt-1 block text-right text-xs text-neutral-600">
                  {improvementText.length}/1000
                </span>
              </label>

              {error && (
                <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {ui(error)}
                </p>
              )}
            </div>

            <footer className="space-y-2 border-t border-white/10 px-6 py-5 sm:px-9">
              <button
                type="submit"
                disabled={submitting || satisfactionRating === null || disappointmentReason === null}
                className="min-h-12 w-full rounded-xl bg-white px-6 text-sm font-black text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {ui(submitting ? "보내는 중..." : "피드백 보내고 30분 받기")}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={closeFeedback}
                className="min-h-11 w-full rounded-xl px-6 text-sm font-semibold text-neutral-400 hover:bg-white/5 hover:text-white disabled:opacity-40"
              >{ui("나중에 할게요")}</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
