"use client";

import { useEffect, useRef, useState } from "react";
import { claimEditorLaunchAnnouncement } from "@/app/actions/editor-launch-announcement";
import { useUsageState } from "@/components/usage-provider";
import { useWelcomeOverlayStage } from "@/components/welcome-overlay-queue";
import type { EditorLaunchAnnouncement } from "@/lib/editor-launch-announcement";
import { formatLocale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

export function EditorLaunchAnnouncementOverlay() {
  const { authenticated, refreshUsage } = useUsageState();
  const {
    active: queueActive,
    complete: completeQueueStage,
  } = useWelcomeOverlayStage("existing-welcome");
  const { locale, t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const claimStartedRef = useRef(false);
  const [announcement, setAnnouncement] = useState<EditorLaunchAnnouncement | null>(null);

  useEffect(() => {
    if (!authenticated || !queueActive) {
      claimStartedRef.current = false;
      setAnnouncement(null);
      return;
    }
    if (claimStartedRef.current) return;
    claimStartedRef.current = true;

    let cancelled = false;
    void claimEditorLaunchAnnouncement()
      .then((claimed) => {
        if (cancelled) return;
        if (!claimed) {
          completeQueueStage();
          return;
        }
        setAnnouncement(claimed);
        void refreshUsage();
      })
      .catch(() => {
        // 안내 조회 실패가 핵심 제작 흐름을 막지 않도록 조용히 종료한다.
        if (!cancelled) completeQueueStage();
      });
    return () => {
      cancelled = true;
    };
  }, [
    authenticated,
    completeQueueStage,
    queueActive,
    refreshUsage,
  ]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (announcement && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } else if (!announcement && dialog.open) {
      dialog.close();
    }
  }, [announcement]);

  if (!announcement) return null;

  const grantedMinutes = announcement.grantedSeconds / 60;
  const formattedMinutes = new Intl.NumberFormat(formatLocale(locale)).format(grantedMinutes);
  const formattedValidUntil = new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(announcement.validUntil));
  const close = () => {
    setAnnouncement(null);
    completeQueueStage();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="editor-launch-announcement-title"
      aria-describedby="editor-launch-announcement-description"
      onCancel={close}
      className="m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[620px] overflow-y-auto rounded-[28px] border border-white/10 bg-[#151719] p-0 text-white shadow-[0_34px_120px_rgba(0,0,0,.75)] backdrop:bg-black/80 backdrop:backdrop-blur-md"
    >
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_top_right,rgba(255,125,105,.25),transparent_58%)]"
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={close}
          aria-label={t("common.close")}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/20 text-xl text-neutral-400 transition hover:border-white/25 hover:text-white"
        >
          ×
        </button>

        <header className="relative px-6 pb-6 pt-8 sm:px-9 sm:pt-10">
          <span className="inline-flex rounded-full border border-[#ff9b8d]/25 bg-[#ff7d69]/10 px-3 py-1.5 text-xs font-black tracking-[0.08em] text-[#ff9b8d]">
            {t("editorLaunch.eyebrow")}
          </span>
          <h2
            ref={headingRef}
            id="editor-launch-announcement-title"
            tabIndex={-1}
            className="mt-4 max-w-lg text-2xl font-black tracking-[-0.045em] outline-none focus-visible:!outline-none sm:text-3xl"
          >
            {t("editorLaunch.title")}
          </h2>
          <p
            id="editor-launch-announcement-description"
            className="mt-3 max-w-lg text-sm leading-6 text-neutral-300 sm:text-[15px]"
          >
            {t("editorLaunch.description")}
          </p>
        </header>

        <div className="relative space-y-4 px-6 pb-7 sm:px-9 sm:pb-9">
          <section className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[.07] p-5">
            <p className="text-xs font-black tracking-[0.08em] text-emerald-300">
              {t("editorLaunch.bonusEyebrow")}
            </p>
            <p className="mt-2 text-lg font-black tracking-[-0.025em] text-white">
              {t("editorLaunch.bonusTitle", { minutes: formattedMinutes })}
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-300">
              {t("editorLaunch.bonusDescription")}
            </p>
          </section>

          <div className="rounded-2xl border border-white/10 bg-white/[.035] px-5 py-4">
            <p className="text-sm leading-6 text-neutral-300">
              {t("editorLaunch.validity", { date: formattedValidUntil })}
            </p>
            <p className="mt-2 text-xs leading-5 text-neutral-500">
              {t("editorLaunch.once")}
            </p>
          </div>

          <button
            type="button"
            onClick={close}
            className="min-h-12 w-full rounded-xl bg-white px-5 text-sm font-black text-black transition hover:bg-neutral-200"
          >
            {t("editorLaunch.confirm")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
