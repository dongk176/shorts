"use client";

import {
  useEffect,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { claimShortsThankYouEvent } from "@/app/actions/shorts-thank-you-event";
import { useWelcomeOverlayStage } from "@/components/welcome-overlay-queue";

const subscribeToHydration = () => () => undefined;
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

function useHydrated() {
  return useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
}

function useModalBodyLock(onClose: () => void) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);
}

export function ShortsEventWelcomeController({
  onRewardAvailabilityChange,
}: {
  onRewardAvailabilityChange: (available: boolean) => void;
}) {
  const {
    active: queueActive,
    complete: completeQueueStage,
  } = useWelcomeOverlayStage("shorts-event");

  useEffect(() => {
    if (!queueActive) return;
    let cancelled = false;
    void claimShortsThankYouEvent()
      .then((claim) => {
        if (cancelled) return;
        onRewardAvailabilityChange(claim.rewardAvailable);
        completeQueueStage();
      })
      .catch(() => {
        if (cancelled) return;
        onRewardAvailabilityChange(false);
        completeQueueStage();
      });
    return () => {
      cancelled = true;
    };
  }, [
    completeQueueStage,
    onRewardAvailabilityChange,
    queueActive,
  ]);

  return null;
}

export function ShortsEventParticipationCompleteOverlay({
  open,
  grantedSeconds,
  onClose,
}: {
  open: boolean;
  grantedSeconds: number;
  onClose: () => void;
}) {
  const hydrated = useHydrated();
  if (!open || !hydrated) return null;
  return createPortal(
    <ShortsEventParticipationCompleteDialog
      grantedSeconds={grantedSeconds}
      onClose={onClose}
    />,
    document.body,
  );
}

function ShortsEventParticipationCompleteDialog({
  grantedSeconds,
  onClose,
}: {
  grantedSeconds: number;
  onClose: () => void;
}) {
  useModalBodyLock(onClose);
  const grantedMinutes = Math.floor(grantedSeconds / 60);
  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="shorts-event-participation-title"
        aria-describedby="shorts-event-participation-description"
        className="login-dialog relative w-full max-w-[480px] overflow-hidden rounded-[28px] border border-fuchsia-300/20 bg-[#0d0a13] px-6 pb-7 pt-8 text-center shadow-[0_32px_110px_rgba(0,0,0,.8),0_0_80px_rgba(147,51,234,.22)] sm:px-9 sm:pb-9 sm:pt-10"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-red-500/20 blur-[80px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-violet-600/25 blur-[80px]"
        />
        <button
          type="button"
          autoFocus
          onClick={onClose}
          aria-label="이벤트 참여 완료 안내 닫기"
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[.05] text-xl text-white/65 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
        >
          ×
        </button>

        <div
          aria-hidden="true"
          className="relative mx-auto grid h-20 w-20 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-red-500 via-fuchsia-500 to-violet-600 text-4xl shadow-[0_0_45px_rgba(217,70,239,.35)]"
        >
          🎁
        </div>
        <h2
          id="shorts-event-participation-title"
          className="relative mt-6 text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl"
        >
          이벤트 참여 완료!
        </h2>
        <p
          id="shorts-event-participation-description"
          className="relative mt-4 text-lg font-extrabold tracking-[-0.025em] text-white/85 sm:text-xl"
        >
          사용량 <span className="bg-gradient-to-r from-red-400 via-fuchsia-400 to-violet-400 bg-clip-text text-2xl font-black text-transparent sm:text-3xl">{grantedMinutes}분</span>이 지급되었습니다
        </p>
        <button
          type="button"
          onClick={onClose}
          className="relative mt-8 min-h-12 w-full rounded-xl bg-gradient-to-r from-red-500 via-fuchsia-500 to-violet-600 px-5 text-sm font-black text-white shadow-[0_10px_32px_rgba(168,85,247,.25)] transition hover:brightness-110 active:scale-[.995]"
        >
          확인
        </button>
      </section>
    </div>
  );
}
