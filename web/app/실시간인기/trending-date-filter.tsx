"use client";
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
    note: "이날 수집된 영상 · 조회수는 최신 확인값",
    delayed: "갱신 지연",
    fresh: "새 목록 보기",
    current: "지금 급상승",
    previous: "이전 달",
    next: "다음 달",
    close: "닫기",
    loading: "수집 기록 확인 중",
    error: "수집 기록을 불러오지 못했습니다.",
    expired: "목록 유효기간이 지나 첫 페이지를 다시 불러왔습니다.",
    unavailable: "현재 정보를 확인할 수 없는 영상이 있습니다.",
    days: ["일", "월", "화", "수", "목", "금", "토"],
  },
  en: {
    live: "Live",
    choose: "Choose date",
    none: "No collection records",
    partial: "Partial collection records",
    complete: "Collection records available",
    note: "Collected on this date · Views reflect the latest check",
    delayed: "Update delayed",
    fresh: "View new list",
    current: "Trending now",
    previous: "Previous month",
    next: "Next month",
    close: "Close",
    loading: "Loading collection records",
    error: "Could not load collection records.",
    expired: "This list expired. The first page has been reloaded.",
    unavailable: "Some videos no longer have available information.",
    days: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  },
  ja: {
    live: "リアルタイム",
    choose: "日付を選択",
    none: "収集記録なし",
    partial: "一部の収集記録",
    complete: "収集記録あり",
    note: "この日に収集した動画 · 再生回数は最新の確認値",
    delayed: "更新が遅れています",
    fresh: "新しい一覧を見る",
    current: "現在急上昇",
    previous: "前月",
    next: "翌月",
    close: "閉じる",
    loading: "収集記録を確認中",
    error: "収集記録を読み込めませんでした。",
    expired: "一覧の有効期限が切れたため、最初のページを読み込みました。",
    unavailable: "現在の情報を確認できない動画があります。",
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
  const copy = discoveryCopy[locale];
  const today = kstDate();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState((date || today).slice(0, 7));
  const [days, setDays] = useState<Day[] | null>(null);
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>({});
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
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
        <div
          ref={popup}
          id="trending-calendar"
          role="dialog"
          aria-label={copy.choose}
          style={popupStyle}
          className="fixed bottom-5 right-5 z-50 max-h-[calc(100dvh-2.5rem)] w-[min(21rem,calc(100vw-2.5rem))] overflow-y-auto rounded-2xl border border-white/15 bg-[#1d2025] p-4 text-white shadow-2xl md:absolute md:bottom-auto md:right-0 md:top-full md:mt-2"
        >
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
                  aria-label={label}
                  title={label}
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
          <p role="status" className="mt-3 text-xs leading-5 text-neutral-400">
            {error
              ? copy.error
              : !days
                ? copy.loading
                : `● ${copy.complete} · ◐ ${copy.partial}`}
          </p>
          <button
            type="button"
            className="mt-3 min-h-10 w-full rounded-lg border border-white/15 text-sm"
            onClick={close}
          >
            {copy.close}
          </button>
        </div>
      )}
    </div>
  );
}
