"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { SiteLocale } from "@/lib/i18n/config";
import { kstDate } from "@/lib/youtube-discovery-time";

export const discoveryCopy = {
  ko: {
    live: "실시간",
    choose: "날짜 선택",
    none: "수집 기록 없음",
    partial: "일부 수집 기록",
    complete: "수집 기록 있음",
    delayed: "갱신 지연",
    fresh: "새 목록 보기",
    current: "지금 급상승",
    previous: "이전 달",
    next: "다음 달",
    close: "닫기",
    loading: "불러오는 중…",
    error: "날짜를 불러오지 못했습니다.",
    expired: "목록 유효기간이 지나 첫 페이지를 다시 불러왔습니다.",
    days: ["일", "월", "화", "수", "목", "금", "토"],
  },
  en: {
    live: "Live",
    choose: "Choose date",
    none: "No collection records",
    partial: "Partial collection records",
    complete: "Collection records available",
    delayed: "Update delayed",
    fresh: "View new list",
    current: "Trending now",
    previous: "Previous month",
    next: "Next month",
    close: "Close",
    loading: "Loading…",
    error: "Could not load dates.",
    expired: "This list expired. The first page has been reloaded.",
    days: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  },
  ja: {
    live: "リアルタイム",
    choose: "日付を選択",
    none: "収集記録なし",
    partial: "一部の収集記録",
    complete: "収集記録あり",
    delayed: "更新が遅れています",
    fresh: "新しい一覧を見る",
    current: "現在急上昇",
    previous: "前月",
    next: "翌月",
    close: "閉じる",
    loading: "読み込み中…",
    error: "日付を読み込めませんでした。",
    expired: "一覧の有効期限が切れたため、最初のページを読み込みました。",
    days: ["日", "月", "火", "水", "木", "金", "土"],
  },
} as const;
type Day = {
  date: string;
  status: "none" | "partial" | "complete";
  collections: number;
  legacy: boolean;
};
export function TrendingDateFilter({
  date,
  locale,
  canUseFilters,
  onChange,
  onRequestAccess,
}: {
  date: string | null;
  locale: SiteLocale;
  canUseFilters: boolean;
  onChange: (value: string | null) => void;
  onRequestAccess: () => void;
}) {
  const ui = useUiText();
  const copy = discoveryCopy[locale];
  const today = kstDate();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((date || today).slice(0, 7));
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDialogElement>(null);
  const [mobile, setMobile] = useState(false);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const close = () => {
    popup.current?.close();
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    const dialog = popup.current;
    if (!open || !dialog) return;
    const media = window.matchMedia("(max-width: 767px)");
    const previousOverflow = document.body.style.overflow;
    const syncMode = () => {
      if (dialog.open) dialog.close();
      setMobile(media.matches);
      document.body.style.overflow = media.matches ? "hidden" : previousOverflow;
      if (media.matches) dialog.showModal();
      else dialog.show();
    };
    syncMode();
    media.addEventListener("change", syncMode);
    return () => {
      media.removeEventListener("change", syncMode);
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open, canUseFilters]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = root.current?.getBoundingClientRect();
      if (!anchor || !popup.current) return;
      if (window.innerWidth < 768) {
        setPopupStyle({});
        return;
      }
      const below = window.innerHeight - anchor.bottom - 28;
      const above = anchor.top - 28;
      const openAbove = below < popup.current.scrollHeight && above > below;
      setPopupStyle({
        top: openAbove ? "auto" : "calc(100% + 0.5rem)",
        bottom: openAbove ? "calc(100% + 0.5rem)" : "auto",
        marginTop: 0,
        maxHeight: Math.max(120, openAbove ? above : below),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, month, days, error]);
  useEffect(() => {
    if (!open || !canUseFilters) return;
    const controller = new AbortController();
    setDays(null);
    setError(false);
    fetch(`/api/youtube/popular/calendar?month=${month}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{ days: Day[] }>;
      })
      .then((result) => setDays(result.days))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [month, open, canUseFilters]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (popup.current?.matches(":modal")) return;
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const changeMonth = (delta: number) => {
    const value = new Date(`${month}-01T00:00:00Z`);
    value.setUTCMonth(value.getUTCMonth() + delta);
    setMonth(value.toISOString().slice(0, 7));
  };
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const count = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const byDate = new Map(days?.map((day) => [day.date, day]));
  const button =
    "min-h-11 rounded-lg border px-3 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300";
  return (
    <div
      ref={root}
      className="relative flex shrink-0 gap-1.5"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <button
        type="button"
        aria-pressed={!date}
        className={`${button} ${!date ? "border-violet-300/50 bg-violet-400/15" : "border-white/15"}`}
        onClick={() => {
          onChange(null);
          setOpen(false);
        }}
      >
        {copy.live}
      </button>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="trending-calendar"
        aria-haspopup="dialog"
        className={`${button} ${date ? "border-violet-300/50 bg-violet-400/15" : "border-white/15"}`}
        onClick={() => {
          if (!canUseFilters) {
            onRequestAccess();
            return;
          }
          setOpen(!open);
        }}
      >
        {date || copy.choose}
      </button>
      {open && canUseFilters && (
        <dialog
          ref={popup}
          id="trending-calendar"
          role="dialog"
          aria-label={copy.choose}
          aria-modal={mobile || undefined}
          style={popupStyle}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            if (!mobile || event.key !== "Tab") return;
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
          }}
          className="fixed inset-x-0 bottom-0 top-auto z-50 m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[28px] border border-b-0 border-white/15 bg-[#1d2025] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-white shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm md:absolute md:bottom-auto md:left-auto md:right-0 md:top-full md:mt-2 md:w-[21rem] md:rounded-2xl md:border-b md:p-4"
        >
          <style>{`body:has(#trending-calendar) .language-selector-floating { display: none; }`}</style>
          <div aria-hidden="true" className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/25 md:hidden" />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={copy.previous}
              className={button}
              onClick={() => changeMonth(-1)}
            >
              ‹
            </button>
            <strong aria-live="polite">{month}</strong>
            <button
              type="button"
              aria-label={copy.next}
              className={`${button} disabled:opacity-30`}
              disabled={month >= today.slice(0, 7)}
              onClick={() => changeMonth(1)}
            >
              ›
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
            {copy.days.map((day, index) => (
              <span key={index} className="py-1 text-neutral-400">
                {day}
              </span>
            ))}
            {Array.from({ length: first }, (_, i) => (
              <span key={`empty-${i}`} />
            ))}
            {Array.from({ length: count }, (_, i) => {
              const value = `${month}-${String(i + 1).padStart(2, "0")}`;
              const day = byDate.get(value);
              const status = day?.status || "none";
              const label = `${value} · ${copy[status]}${day?.collections ? ` · ${day.collections}` : ""}`;
              return (
                <button
                  type="button"
                  key={value}
                  disabled={value > today || !days}
                  aria-label={ui(label)}
                  aria-pressed={value === date}
                  className={`relative min-h-10 rounded-lg pb-1 disabled:opacity-25 ${value === date ? "bg-violet-400/30 ring-1 ring-violet-300" : "hover:bg-white/10"}`}
                  onClick={() => {
                    onChange(value);
                    close();
                  }}
                >
                  {i + 1}
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${status === "complete" ? "bg-emerald-300" : status === "partial" ? "bg-amber-300" : "bg-neutral-600"}`}
                  />
                </button>
              );
            })}
          </div>
          {(error || !days) && <p role="status" className="mt-3 text-xs leading-5 text-neutral-400">
            {error ? copy.error : copy.loading}
          </p>}
          <button
            type="button"
            className="mt-3 min-h-10 w-full rounded-lg border border-white/15 text-sm"
            onClick={close}
          >
            {copy.close}
          </button>
        </dialog>
      )}
    </div>
  );
}
