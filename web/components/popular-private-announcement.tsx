"use client";

import { useEffect, useRef, useState } from "react";
import type { SiteLocale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import {
  POPULAR_PRIVATE_DISMISSED_STORAGE_KEY,
  shouldShowPopularPrivateAnnouncement,
} from "@/lib/popular-private-announcement";

const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
const EASYCUT_PRIVATE_OPEN_CHAT_URL = "https://open.kakao.com/o/gBO91xHi";

const announcementCopy: Record<SiteLocale, {
  eyebrow: string;
  title: string;
  description: string;
  dismiss: string;
  confirm: string;
}> = {
  ko: {
    eyebrow: "EASYCUT PRIVATE",
    title: "쇼츠 제작 정보를 한곳에서",
    description: "재사용 허용으로 표시된 영상 추천과 쇼츠 제작 노하우, 이지컷의 새로운 기능과 업데이트 소식을 확인해 보세요.",
    dismiss: "다시 보지 않기",
    confirm: "확인",
  },
  en: {
    eyebrow: "EASYCUT PRIVATE",
    title: "Everything you need to create Shorts",
    description: "Explore reusable-video recommendations, production tips, and the latest Easy Cut features and updates in one place.",
    dismiss: "Don't show again",
    confirm: "Confirm",
  },
  ja: {
    eyebrow: "EASYCUT PRIVATE",
    title: "ショート動画制作に必要な情報をひとつに",
    description: "再利用可能な動画のおすすめ、制作ノウハウ、Easy Cutの新機能やアップデート情報をまとめて確認できます。",
    dismiss: "今後表示しない",
    confirm: "確認",
  },
};

export function PopularPrivateAnnouncement() {
  const { locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closedForVisitRef = useRef(false);
  const [open, setOpen] = useState(false);
  const copy = announcementCopy[locale];

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    const syncVisibility = () => {
      let dismissed: string | null = null;
      try {
        dismissed = window.localStorage.getItem(
          POPULAR_PRIVATE_DISMISSED_STORAGE_KEY,
        );
      } catch {
        // Browser storage is optional. The announcement still works for this visit.
      }

      const shouldShow = shouldShowPopularPrivateAnnouncement({
        mobile: media.matches,
        dismissed,
      });
      setOpen(shouldShow && !closedForVisitRef.current);
    };

    syncVisibility();
    media.addEventListener("change", syncVisibility);
    return () => media.removeEventListener("change", syncVisibility);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open || dialog.open) return;
    dialog.showModal();
    window.requestAnimationFrame(() => dialog.focus({ preventScroll: true }));
  }, [open]);

  const closeForVisit = () => {
    closedForVisitRef.current = true;
    setOpen(false);
  };

  const dismissPermanently = () => {
    try {
      window.localStorage.setItem(
        POPULAR_PRIVATE_DISMISSED_STORAGE_KEY,
        "1",
      );
    } catch {
      // Closing the announcement should still work when storage is unavailable.
    }
    closeForVisit();
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      data-i18n-skip
      aria-labelledby="popular-private-announcement-title"
      aria-describedby="popular-private-announcement-description"
      onCancel={(event) => {
        event.preventDefault();
        closeForVisit();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeForVisit();
      }}
      className="m-0 mt-auto max-h-[calc(100dvh-16px)] w-full max-w-none overflow-y-auto rounded-t-[30px] border border-b-0 border-white/10 bg-[#15191a] p-0 text-white shadow-[0_-24px_90px_rgba(0,0,0,.58)] outline-none backdrop:bg-black/70 backdrop:backdrop-blur-[4px] focus-visible:!outline-none md:hidden"
    >
      <div className="mx-auto w-full max-w-[480px]">
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/15" aria-hidden="true" />

        <header className="px-6 pb-5 pt-5">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-white/10 bg-white/[.06] text-[#ff9b8d]"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4.5" y="9.5" width="15" height="10.5" rx="2.5" />
                <path d="M8 9.5V7.25a4 4 0 0 1 8 0V9.5M12 14v2" />
              </svg>
            </span>
            <span className="text-[15px] font-black tracking-[.1em] text-neutral-200">
              {copy.eyebrow}
            </span>
          </div>
          <h2
            id="popular-private-announcement-title"
            className="mt-5 text-[1.55rem] font-black leading-[1.28] tracking-[-.05em] text-white"
          >
            {copy.title}
          </h2>
          <p
            id="popular-private-announcement-description"
            className="mt-3 text-[14px] font-medium leading-6 tracking-[-.015em] text-neutral-300"
          >
            {copy.description}
          </p>
        </header>

        <div className="px-6 pb-6">
          <ul className="grid grid-cols-3 divide-x divide-white/[.08] rounded-2xl border border-white/[.06] bg-white/[.035] px-1 py-4 text-center text-[11px] font-extrabold leading-4 text-neutral-300" aria-label="EASYCUT PRIVATE 제공 정보">
            <li className="px-2">영상<br />추천</li>
            <li className="px-2">제작<br />노하우</li>
            <li className="px-2">기능·업데이트<br />소식</li>
          </ul>
        </div>

        <footer className="grid grid-cols-[1fr_1.15fr] gap-2 border-t border-white/[.07] px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
          <button
            type="button"
            onClick={dismissPermanently}
            className="min-h-12 rounded-xl px-3 text-sm font-bold text-neutral-400 transition hover:bg-white/[.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
          >
            {copy.dismiss}
          </button>
          <a
            href={EASYCUT_PRIVATE_OPEN_CHAT_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeForVisit}
            className="flex min-h-12 items-center justify-center rounded-xl bg-[#ff715e] px-4 text-sm font-black text-white transition hover:bg-[#f7604d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff715e]"
          >
            {copy.confirm}
          </a>
        </footer>
      </div>
    </dialog>
  );
}
