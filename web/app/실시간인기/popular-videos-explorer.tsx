"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PopularFiltersPlanOverlay } from "@/components/popular-filters-plan-overlay";
import type {
  PopularVideo,
  PopularVideoCategory,
  PopularVideoResponse,
  PopularVideoType,
} from "@/lib/youtube-popular";
import type { SiteLocale } from "@/lib/i18n/config";
import { formatLocale } from "@/lib/i18n/config";
import { formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";

const dataTypeOptions: Array<{ value: PopularVideoType; label: string }> = [
  { value: "trending", label: "실시간 급상승" },
  { value: "views", label: "조회수 상위" },
  { value: "reusable", label: "재사용 허용" },
];

const categoryOptions: Array<{ value: PopularVideoCategory; label: string }> = [
  { value: "all", label: "전체" },
  { value: "entertainment", label: "엔터테인먼트" },
  { value: "gaming", label: "게임" },
  { value: "sports", label: "스포츠" },
  { value: "music", label: "음악" },
  { value: "news", label: "뉴스·정치" },
  { value: "science", label: "과학·기술" },
  { value: "howto", label: "요리·노하우" },
];

const reusableGuideDismissedKey = "easycut:reusable-license-guide-dismissed:v1";

function ReusableLicenseGuide({
  open,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  const creativeCommonsTrigger = useRef<HTMLButtonElement>(null);
  const creativeCommonsExplainer = useRef<HTMLDivElement>(null);
  const [creativeCommonsExplainerOpen, setCreativeCommonsExplainerOpen] = useState(false);
  const [creativeCommonsExplainerPosition, setCreativeCommonsExplainerPosition] = useState({
    left: 16,
    top: 16,
    width: 360,
    above: false,
  });

  const positionCreativeCommonsExplainer = useCallback(() => {
    const trigger = creativeCommonsTrigger.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const edgeGap = 16;
    const popoverGap = 12;
    const width = Math.min(360, window.innerWidth - edgeGap * 2);
    const left = Math.min(
      window.innerWidth - width - edgeGap,
      Math.max(edgeGap, triggerRect.left + triggerRect.width / 2 - width / 2),
    );
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const above = spaceBelow < 250 && triggerRect.top > spaceBelow;
    setCreativeCommonsExplainerPosition({
      left,
      top: above ? triggerRect.top - popoverGap : triggerRect.bottom + popoverGap,
      width,
      above,
    });
  }, []);

  const openCreativeCommonsExplainer = useCallback(() => {
    positionCreativeCommonsExplainer();
    setCreativeCommonsExplainerOpen(true);
  }, [positionCreativeCommonsExplainer]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreativeCommonsExplainerOpen(false);
        onConfirm();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [onConfirm, open]);

  useEffect(() => {
    if (!creativeCommonsExplainerOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node
        && !creativeCommonsTrigger.current?.contains(event.target)
        && !creativeCommonsExplainer.current?.contains(event.target)
      ) {
        setCreativeCommonsExplainerOpen(false);
      }
    };
    window.addEventListener("resize", positionCreativeCommonsExplainer);
    document.addEventListener("scroll", positionCreativeCommonsExplainer, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => {
      window.removeEventListener("resize", positionCreativeCommonsExplainer);
      document.removeEventListener("scroll", positionCreativeCommonsExplainer, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    };
  }, [creativeCommonsExplainerOpen, positionCreativeCommonsExplainer]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/75 px-4 py-8 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reusable-guide-title"
        aria-describedby="reusable-guide-description"
        className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/10 bg-[#181a1b] shadow-[0_28px_100px_rgba(0,0,0,.65)]"
      >
        <div className="border-b border-white/[.07] px-6 py-6 sm:px-8">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-400/15 text-violet-200" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 10v6M12 7h.01" />
              </svg>
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[.14em] text-violet-300">필터 이용 전 확인</p>
              <h2 id="reusable-guide-title" className="mt-1.5 text-xl font-black tracking-[-.035em] text-white sm:text-2xl">
                영상의 라이선스를 직접 확인해 주세요
              </h2>
            </div>
          </div>
          <div className="mt-5">
            <p id="reusable-guide-description" className="text-sm font-medium leading-6 text-neutral-300">
              재사용 허용 필터는 YouTube에서{" "}
              <button
                ref={creativeCommonsTrigger}
                type="button"
                aria-expanded={creativeCommonsExplainerOpen}
                aria-controls="creative-commons-explainer"
                onMouseEnter={openCreativeCommonsExplainer}
                onFocus={openCreativeCommonsExplainer}
                onClick={openCreativeCommonsExplainer}
                className="rounded-sm font-extrabold text-[#3ea6ff] underline decoration-[#3ea6ff]/45 underline-offset-2 transition hover:text-[#70bdff] hover:decoration-[#70bdff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#70bdff]"
              >
                크리에이티브 커먼즈
              </button>
              로 표시된 영상을 선별합니다. 게시자가 라이선스를 변경하거나 제3자 권리가 포함될 수 있으므로, 사용 직전에 원본 영상에서 최신 표시를 다시 확인하세요.
            </p>
          </div>
        </div>

        <div className="px-6 py-6 sm:px-8">
          <ol className="space-y-3 text-sm font-semibold leading-6 text-neutral-200">
            <li className="flex gap-3"><span className="text-violet-300">1.</span><span>원본 영상을 YouTube에서 엽니다.</span></li>
            <li className="flex gap-3"><span className="text-violet-300">2.</span><span>영상 설명의 <strong className="font-black text-white">더보기</strong>를 선택합니다.</span></li>
            <li className="flex gap-3"><span className="text-violet-300">3.</span><span>설명 최하단의 <strong className="font-black text-white">라이선스</strong> 항목을 확인합니다.</span></li>
          </ol>

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#242424]" aria-label="YouTube 라이선스 표시 예시">
            <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
              <span className="w-20 shrink-0 text-xs font-semibold text-neutral-400">라이선스</span>
              <span className="text-xs font-bold leading-5 text-[#3ea6ff] sm:text-sm">크리에이티브 커먼즈 저작자 표시 라이선스 (재사용 허용)</span>
            </div>
          </div>
          <p className="mt-3 text-xs font-medium leading-5 text-neutral-500">
            위 화면은 확인 위치를 설명하기 위해 재구성한 예시이며 실제 YouTube 화면이 아닙니다. 음악, 방송 화면, 인물·상표 등 별도 권리는 직접 확인해야 합니다.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/[.07] bg-black/10 px-6 py-5 sm:flex-row sm:justify-end sm:px-8">
          <button type="button" onClick={() => {
            setCreativeCommonsExplainerOpen(false);
            onDismiss();
          }} className="min-h-11 rounded-xl border border-white/15 px-5 text-sm font-extrabold text-neutral-200 transition hover:border-white/30 hover:bg-white/[.06] hover:text-white">
            다시 보지 않기
          </button>
          <button ref={confirmButton} type="button" onClick={() => {
            setCreativeCommonsExplainerOpen(false);
            onConfirm();
          }} className="min-h-11 rounded-xl bg-[#ff715e] px-6 text-sm font-black text-white shadow-[0_10px_28px_rgba(255,85,64,.22)] transition hover:bg-[#ff806f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9b8d]">
            확인
          </button>
        </div>
      </section>
      {creativeCommonsExplainerOpen && createPortal(
        <div
          ref={creativeCommonsExplainer}
          id="creative-commons-explainer"
          role="tooltip"
          style={{
            left: creativeCommonsExplainerPosition.left,
            top: creativeCommonsExplainerPosition.top,
            width: creativeCommonsExplainerPosition.width,
          }}
          className={`fixed z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-[#3ea6ff]/35 bg-[#172431] p-4 text-left shadow-[0_24px_70px_rgba(0,0,0,.65)] sm:p-5 ${creativeCommonsExplainerPosition.above ? "-translate-y-full" : ""}`}
        >
          <strong className="block text-sm font-black text-white sm:text-base">
            크리에이티브 커먼즈(CC BY) 영상이란?
          </strong>
          <div className="mt-3 space-y-3 text-xs font-semibold leading-5 text-neutral-200 sm:text-sm sm:leading-6">
            <p>원작자가 다른 사람이 영상을 사용할 수 있도록 허용한 콘텐츠입니다.</p>
            <p>
              출처와 저작자를 표시하면
              <br />
              영상을 편집하거나 재사용할 수 있습니다.
            </p>
            <p>단, 영상 제목, 저작자, 원본 링크, 라이선스 정보를 반드시 표시해야 합니다.</p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatViews(value: number, locale: SiteLocale) {
  const count = new Intl.NumberFormat(formatLocale(locale), { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return locale === "ko" ? `${count}회` : locale === "en" ? count : `${count}回`;
}

function formatPublishedAt(value: string, locale: SiteLocale) {
  const elapsedDays = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (locale === "en") {
    if (elapsedDays === 0) return "Today";
    if (elapsedDays < 7) return `${elapsedDays}d ago`;
    if (elapsedDays < 30) return `${Math.floor(elapsedDays / 7)}w ago`;
    if (elapsedDays < 365) return `${Math.floor(elapsedDays / 30)}mo ago`;
    return `${Math.floor(elapsedDays / 365)}y ago`;
  }
  if (locale === "ja") {
    if (elapsedDays === 0) return "今日";
    if (elapsedDays < 7) return `${elapsedDays}日前`;
    if (elapsedDays < 30) return `${Math.floor(elapsedDays / 7)}週間前`;
    if (elapsedDays < 365) return `${Math.floor(elapsedDays / 30)}か月前`;
    return `${Math.floor(elapsedDays / 365)}年前`;
  }
  if (elapsedDays === 0) return "오늘";
  if (elapsedDays < 7) return `${elapsedDays}일 전`;
  if (elapsedDays < 30) return `${Math.floor(elapsedDays / 7)}주 전`;
  if (elapsedDays < 365) return `${Math.floor(elapsedDays / 30)}개월 전`;
  return `${Math.floor(elapsedDays / 365)}년 전`;
}

function formatUpdatedAt(value: string | null, locale: SiteLocale) {
  if (!value) return locale === "ko" ? "업데이트 확인 중" : locale === "en" ? "Checking update" : "更新を確認中";
  return new Intl.DateTimeFormat(formatLocale(locale), {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function popularVideoParams(
  type: PopularVideoType,
  category: PopularVideoCategory,
  reusable: boolean,
  longForm: boolean,
  korean: boolean,
  cursor?: string,
  interactionId?: string,
) {
  const params = new URLSearchParams({
    type,
    category,
    reusable: String(reusable),
    longForm: String(longForm),
    korean: String(korean),
  });
  if (cursor) params.set("cursor", cursor);
  if (interactionId) params.set("interactionId", interactionId);
  return params;
}

function VideoCard({ video, rank, active, onOpen, onClose }: {
  video: PopularVideo;
  rank: number;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copyLinkAndGoHome = async () => {
    if (copying) return;
    setCopying(true);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(youtubeUrl);
      window.location.assign("/");
    } catch (cause) {
      setCopyError(cause instanceof Error ? cause.message : "영상 링크를 복사하지 못했습니다.");
      setCopying(false);
    }
  };

  return (
    <article className="popular-video-card group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#191c1e]/90 shadow-[0_18px_50px_rgba(0,0,0,.18)] transition duration-200 hover:-translate-y-1 hover:border-[#d0bcff]/40 hover:shadow-[0_22px_60px_rgba(0,0,0,.28)]">
      <button
        type="button"
        aria-label={`${rank}위 ${video.title} 작업 메뉴 열기`}
        aria-expanded={active}
        aria-controls={`video-actions-${video.videoId}`}
        tabIndex={active ? -1 : 0}
        onClick={onOpen}
        className="absolute inset-0 z-10 rounded-2xl"
      />
      <div className="relative aspect-video overflow-hidden bg-[#0b0f10]">
        <Image src={video.thumbnailUrl} alt={`${video.title} 썸네일`} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" priority={rank === 1} unoptimized className="object-cover transition duration-300 group-hover:scale-[1.025]" />
        <span className="absolute left-2.5 top-2.5 grid min-w-9 place-items-center rounded-lg bg-[#f04435] px-2 py-1.5 text-sm font-black text-white shadow-lg">{rank}</span>
        {video.license === "creativeCommon" && <span className="absolute right-2.5 top-2.5 inline-flex rounded-full border border-violet-200/40 bg-violet-950/85 px-2.5 py-1 text-[10px] font-black tracking-wide text-violet-100 shadow-lg backdrop-blur-sm">재사용 허용</span>}
        <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/85 px-2 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-sm">{formatDuration(video.durationSeconds)}</span>
        <span className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/40 to-transparent" aria-hidden="true" />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="line-clamp-2 min-h-11 text-[15px] font-extrabold leading-[1.45] tracking-[-.015em] text-white">{video.title}</h2>
        <p className="mt-2 truncate text-[13px] font-semibold text-neutral-400">{video.channelName}</p>
        <div className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-neutral-400">
          <span>{locale === "ko" ? "조회수" : locale === "en" ? "Views" : "再生回数"} {formatViews(video.viewCount, locale)}</span><span aria-hidden="true">·</span><span>{formatPublishedAt(video.publishedAt, locale)}</span>
        </div>
      </div>
      {active && (
        <div id={`video-actions-${video.videoId}`} className="absolute inset-0 z-20 grid place-items-center bg-[#0b0f10]/88 p-5 backdrop-blur-md">
          <button type="button" tabIndex={-1} aria-label="영상 작업 메뉴 닫기" onClick={onClose} className="absolute inset-0 cursor-default" />
          <div className="relative z-10 grid w-full max-w-48 gap-3" role="group" aria-label={`${video.title} 작업`}>
            <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#f04435] px-4 text-sm font-extrabold text-white shadow-[0_10px_30px_rgba(240,68,53,.28)] transition hover:bg-[#ff5b4b]">
              유튜브로 <span aria-hidden="true">↗</span>
            </a>
            <button type="button" disabled={copying} onClick={() => void copyLinkAndGoHome()} className="min-h-12 rounded-xl border border-white/15 bg-white/[.08] px-4 text-sm font-extrabold text-white transition hover:border-violet-300/50 hover:bg-violet-400/15 disabled:cursor-wait disabled:opacity-60">
              {copying ? "복사 중..." : "링크 복사"}
            </button>
            {copyError && <p role="alert" className="text-center text-xs font-semibold leading-5 text-red-300">{copyError}</p>}
          </div>
        </div>
      )}
    </article>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="인기 영상을 불러오는 중" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-white/[.07] bg-[#191c1e]/70">
          <div className="aspect-video animate-pulse bg-white/[.07]" />
          <div className="space-y-3 p-4"><div className="h-4 animate-pulse rounded bg-white/[.08]" /><div className="h-4 w-4/5 animate-pulse rounded bg-white/[.08]" /><div className="h-3 w-2/5 animate-pulse rounded bg-white/[.06]" /></div>
        </div>
      ))}
    </div>
  );
}

export function PopularVideosExplorer({
  canUseFilters,
  isAuthenticated,
}: {
  canUseFilters: boolean;
  isAuthenticated: boolean;
}) {
  const { locale } = useI18n();
  const [dataType, setDataType] = useState<PopularVideoType>("trending");
  const [koreanOnly, setKoreanOnly] = useState(false);
  const [longFormOnly, setLongFormOnly] = useState(false);
  const [reusableOnly, setReusableOnly] = useState(false);
  const [category, setCategory] = useState<PopularVideoCategory>("all");
  const [response, setResponse] = useState<PopularVideoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [planOverlayOpen, setPlanOverlayOpen] = useState(false);
  const [planOverlayFeature, setPlanOverlayFeature] = useState<"filters" | "more">("filters");
  const [reusableGuideOpen, setReusableGuideOpen] = useState(false);
  const [filterInteractionId, setFilterInteractionId] = useState<string | null>(null);
  const loadMoreController = useRef<AbortController | null>(null);
  const pendingReusableAction = useRef<(() => void) | null>(null);
  const closePlanOverlay = useCallback(() => setPlanOverlayOpen(false), []);

  useEffect(() => {
    if (!activeVideoId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveVideoId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [activeVideoId]);

  useEffect(() => {
    const controller = new AbortController();
    loadMoreController.current?.abort();
    setLoading(true);
    setLoadingMore(false);
    setLoadMoreError(null);
    setError(null);
    setResponse(null);
    const endpoint = `/api/youtube/popular?${popularVideoParams(dataType, category, reusableOnly, longFormOnly, koreanOnly, undefined, filterInteractionId || undefined)}`;
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (result) => {
        if (!result.ok) {
          const body = await result.json().catch(() => ({})) as { detail?: string };
          throw new Error(body.detail || "인기 영상을 불러오지 못했습니다.");
        }
        return result.json() as Promise<PopularVideoResponse>;
      })
      .then((result) => setResponse(result))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "인기 영상을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [category, dataType, filterInteractionId, koreanOnly, longFormOnly, reusableOnly, retryCount]);

  const selectedType = dataTypeOptions.find((option) => option.value === dataType) || dataTypeOptions[0];

  const loadMore = async () => {
    if (!response?.nextCursor || loadingMore) return;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const endpoint = `/api/youtube/popular?${popularVideoParams(dataType, category, reusableOnly, longFormOnly, koreanOnly, response.nextCursor)}`;
      const result = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (!result.ok) {
        const body = await result.json().catch(() => ({})) as { detail?: string };
        throw new Error(body.detail || "추가 영상을 불러오지 못했습니다.");
      }
      const next = await result.json() as PopularVideoResponse;
      setResponse((current) => {
        if (!current) return next;
        const videos = new Map(current.items.map((video) => [video.videoId, video]));
        for (const video of next.items) videos.set(video.videoId, video);
        return {
          items: Array.from(videos.values()),
          updatedAt: current.updatedAt,
          totalCount: next.totalCount ?? current.totalCount,
          nextCursor: next.nextCursor,
        };
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setLoadMoreError(cause instanceof Error ? cause.message : "추가 영상을 불러오지 못했습니다.");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  };

  const applyFilter = (update: () => void) => {
    if (!canUseFilters) {
      setPlanOverlayFeature("filters");
      setPlanOverlayOpen(true);
      return;
    }
    setFilterInteractionId(crypto.randomUUID());
    update();
    setActiveVideoId(null);
  };

  const requestReusableFilter = (action: () => void) => {
    if (!isAuthenticated) {
      action();
      return;
    }
    try {
      if (window.localStorage.getItem(reusableGuideDismissedKey) === "1") {
        action();
        return;
      }
    } catch {
      // Storage can be unavailable in privacy-focused browser modes.
    }
    pendingReusableAction.current = action;
    setReusableGuideOpen(true);
  };

  const finishReusableGuide = useCallback((dismissPermanently: boolean) => {
    if (dismissPermanently) {
      try {
        window.localStorage.setItem(reusableGuideDismissedKey, "1");
      } catch {
        // The current action should continue even when the preference cannot be stored.
      }
    }
    setReusableGuideOpen(false);
    const action = pendingReusableAction.current;
    pendingReusableAction.current = null;
    action?.();
  }, []);

  const requestMore = () => {
    if (!canUseFilters) {
      setPlanOverlayFeature("more");
      setPlanOverlayOpen(true);
      return;
    }
    void loadMore();
  };

  return (
    <main className="relative mx-auto w-full max-w-6xl px-5 pb-24 pt-7 sm:px-8 sm:pt-10">
      <section className="hero relative isolate mx-auto flex max-w-4xl flex-col items-center px-4 pb-2 text-center sm:pb-3">
        <span className="pointer-events-none absolute left-[8%] top-5 -z-10 h-40 w-40 rounded-full bg-[#ff5540]/20 blur-[70px] sm:h-56 sm:w-56" aria-hidden="true" />
        <span className="pointer-events-none absolute right-[7%] top-14 -z-10 h-44 w-44 rounded-full bg-[#a078ff]/20 blur-[80px] sm:h-60 sm:w-60" aria-hidden="true" />
        <h1 className="hero-title"><span>실시간 인기</span></h1>
        <p className="mt-5 max-w-2xl text-sm leading-7 text-[#d5aaa4] sm:text-base">
          <span className="block">지금 떠오르는 영상을 놓치지 마세요.</span>
          <strong className="block font-extrabold text-[#ff9b8d]">활성 구독 또는 기간 패키지로 원하는 영상만 빠르게 찾아보세요.</strong>
        </p>
        <p className="mt-6 text-xs font-semibold text-neutral-500" aria-live="polite"><span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]" aria-hidden="true" /><span className="text-neutral-400">마지막 업데이트</span> {formatUpdatedAt(response?.updatedAt || null, locale)}</p>
      </section>

      <section className="relative z-30 -mx-2 mt-2 rounded-2xl border border-white/10 bg-[#15191a]/90 p-4 shadow-[0_16px_50px_rgba(0,0,0,.22)] backdrop-blur-2xl md:mx-0 md:p-5" aria-label="인기 영상 필터">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-black text-white">필터</h2>
          {!canUseFilters && (
            <button
              type="button"
              onClick={() => {
                setPlanOverlayFeature("filters");
                setPlanOverlayOpen(true);
              }}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#ff9b8d]/25 bg-[#ff715e]/10 px-3 text-[11px] font-black text-[#ffc4bb] transition hover:border-[#ff9b8d]/45 hover:bg-[#ff715e]/15"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              활성 이용권 전용
            </button>
          )}
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-black text-neutral-200">인기 기준</legend>
            <div className="flex flex-wrap gap-2 pb-1">
              {dataTypeOptions.map((option) => {
                const reusable = option.value === "reusable";
                return (
                  <div key={option.value} className={reusable ? "group/reusable relative shrink-0" : "shrink-0"}>
                    <button
                      type="button"
                      aria-pressed={dataType === option.value}
                      aria-haspopup={canUseFilters ? undefined : "dialog"}
                      aria-describedby={reusable ? "reusable-filter-help" : undefined}
                      onClick={() => reusable
                        ? requestReusableFilter(() => applyFilter(() => setDataType(option.value)))
                        : applyFilter(() => setDataType(option.value))}
                      className={`shrink-0 rounded-full border px-4 py-2.5 text-sm font-extrabold transition ${dataType === option.value ? "border-[#ff715e] bg-[#ff715e]/15 text-[#ffd0c9] shadow-[0_0_18px_rgba(255,85,64,.1)]" : "border-white/15 bg-white/[.025] text-neutral-200 hover:border-white/30 hover:text-white"}`}
                    >
                      {option.label}
                    </button>
                    {reusable && (
                      <div
                        id="reusable-filter-help"
                        role="tooltip"
                        className="pointer-events-none invisible absolute left-1/2 top-full z-50 mt-3 w-[min(24rem,calc(100vw-3rem))] -translate-x-1/2 rounded-xl border border-violet-300/25 bg-[#25212d] p-4 text-left text-xs font-semibold leading-5 text-violet-50 opacity-0 shadow-[0_20px_55px_rgba(0,0,0,.5)] transition group-hover/reusable:visible group-hover/reusable:opacity-100 group-focus-within/reusable:visible group-focus-within/reusable:opacity-100"
                      >
                        <strong className="block text-sm font-black text-white">YouTube의 CC BY 표시 영상</strong>
                        <span className="mt-2 block">
                          실제 의미는 “YouTube에서 CC BY로 표시됨”입니다. 이용자는 제목·저작자·URL·CC BY 라이선스를 표시해야 하며, 제3자 음악·방송 화면 등의 권리도 별도로 확인해야 합니다.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2 self-start sm:justify-end sm:self-auto">
            <button
              type="button"
              role="switch"
              aria-checked={koreanOnly}
              aria-haspopup={canUseFilters ? undefined : "dialog"}
              onClick={() => applyFilter(() => setKoreanOnly((current) => !current))}
              className={`flex shrink-0 items-center gap-2.5 rounded-full border px-3.5 py-2.5 text-sm font-extrabold transition ${koreanOnly ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-50" : "border-white/15 bg-white/[.025] text-neutral-200 hover:border-white/30 hover:text-white"}`}
            >
              <span className={`relative h-5 w-9 rounded-full transition ${koreanOnly ? "bg-emerald-400" : "bg-white/15"}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${koreanOnly ? "left-[18px]" : "left-0.5"}`} />
              </span>
              한국어만
            </button>
            <button
              type="button"
              role="switch"
              aria-label="롱폼만 보기"
              aria-checked={longFormOnly}
              aria-haspopup={canUseFilters ? undefined : "dialog"}
              onClick={() => applyFilter(() => setLongFormOnly((current) => !current))}
              className={`flex shrink-0 items-center gap-2.5 rounded-full border px-3.5 py-2.5 text-sm font-extrabold transition ${longFormOnly ? "border-[#ff8b7c]/60 bg-[#ff715e]/15 text-[#ffd0c9]" : "border-white/15 bg-white/[.025] text-neutral-200 hover:border-violet-300/45 hover:text-white"}`}
            >
              <span className={`relative h-5 w-9 rounded-full transition ${longFormOnly ? "bg-[#ff715e]" : "bg-white/15"}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${longFormOnly ? "left-[18px]" : "left-0.5"}`} />
              </span>
              롱폼만
            </button>
            {dataType !== "reusable" && (
              <button
                type="button"
                role="switch"
                aria-label="재사용 허용 영상만 보기"
                aria-checked={reusableOnly}
                aria-haspopup={canUseFilters ? undefined : "dialog"}
                onClick={() => requestReusableFilter(() => applyFilter(() => setReusableOnly((current) => !current)))}
                className={`flex shrink-0 items-center gap-2.5 rounded-full border px-3.5 py-2.5 text-sm font-extrabold transition ${reusableOnly ? "border-violet-300/60 bg-violet-400/15 text-violet-50" : "border-white/15 bg-white/[.025] text-neutral-200 hover:border-violet-300/45 hover:text-white"}`}
              >
                <span className={`relative h-5 w-9 rounded-full transition ${reusableOnly ? "bg-violet-400" : "bg-white/15"}`} aria-hidden="true">
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${reusableOnly ? "left-[18px]" : "left-0.5"}`} />
                </span>
                재사용 허용만
              </button>
            )}
          </div>
        </div>

        <fieldset className="mt-4 min-w-0 border-t border-white/[.07] pt-4">
          <legend className="mb-2 text-sm font-black text-neutral-200">카테고리</legend>
          <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
            {categoryOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label} 카테고리`}
                aria-pressed={category === option.value}
                aria-haspopup={canUseFilters ? undefined : "dialog"}
                onClick={() => applyFilter(() => setCategory(option.value))}
                className={`shrink-0 rounded-full border px-4 py-2.5 text-sm font-extrabold transition ${category === option.value ? "border-violet-300/60 bg-violet-400/15 text-violet-50 shadow-[0_0_18px_rgba(160,120,255,.1)]" : "border-white/15 bg-white/[.025] text-neutral-200 hover:border-violet-300/45 hover:text-white"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <div className="mb-5 mt-8 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black tracking-[-.025em] text-white">{selectedType.label}</h2>
          <p className="mt-1 text-xs font-bold tabular-nums text-neutral-500" aria-live="polite">{!loading && response ? (locale === "ko" ? `${formatNumber(response.totalCount ?? response.items.length, locale)}개` : locale === "en" ? formatNumber(response.totalCount ?? response.items.length, locale) : `${formatNumber(response.totalCount ?? response.items.length, locale)}件`) : "개수 확인 중"}</p>
        </div>
      </div>

      {loading ? <LoadingSkeleton /> : error ? (
        <section role="alert" className="grid min-h-64 place-items-center rounded-2xl border border-red-400/20 bg-red-950/15 px-6 py-12 text-center">
          <div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-400/10 text-xl text-red-300" aria-hidden="true">!</div><h2 className="mt-4 text-lg font-extrabold">인기 영상을 불러오지 못했습니다</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-red-200/75">{error}</p><button type="button" onClick={() => setRetryCount((value) => value + 1)} className="mt-6 rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-black transition hover:bg-neutral-200">다시 시도</button></div>
        </section>
      ) : response?.items.length ? (
        <div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{response.items.map((video, index) => <VideoCard key={video.videoId} video={video} rank={index + 1} active={activeVideoId === video.videoId} onOpen={() => setActiveVideoId(video.videoId)} onClose={() => setActiveVideoId(null)} />)}</div>
          {response.nextCursor && (
            <div className="mt-10 flex flex-col items-center gap-3">
              <button
                type="button"
                disabled={loadingMore}
                onClick={requestMore}
                className="min-h-12 rounded-xl border border-white/15 bg-white/[.06] px-7 text-sm font-extrabold text-white transition hover:border-[#d0bcff]/50 hover:bg-violet-400/10 disabled:cursor-wait disabled:opacity-60"
              >
                {loadingMore ? "추가 영상 불러오는 중..." : "더 보기"}
              </button>
              {loadMoreError && <p role="alert" className="text-center text-xs font-semibold text-red-300">{loadMoreError}</p>}
            </div>
          )}
        </div>
      ) : (
        <section className="grid min-h-64 place-items-center rounded-2xl border border-white/[.08] bg-white/[.025] px-6 py-12 text-center">
          <div>
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-400/10 text-xl text-violet-200" aria-hidden="true">⌕</div>
            <h2 className="mt-4 text-lg font-extrabold">조건에 맞는 영상이 없습니다</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">인기 기준, 언어, 카테고리, 영상 길이 또는 재사용 허용 조건을 변경해 보세요.</p>
            {response?.nextCursor && (
              <button type="button" disabled={loadingMore} onClick={requestMore} className="mt-6 min-h-12 rounded-xl border border-white/15 bg-white/[.06] px-7 text-sm font-extrabold text-white transition hover:border-[#d0bcff]/50 hover:bg-violet-400/10 disabled:cursor-wait disabled:opacity-60">
                {loadingMore ? "추가 영상 불러오는 중..." : "다음 결과 확인"}
              </button>
            )}
            {loadMoreError && <p role="alert" className="mt-3 text-center text-xs font-semibold text-red-300">{loadMoreError}</p>}
          </div>
        </section>
      )}
      <PopularFiltersPlanOverlay
        open={planOverlayOpen}
        isAuthenticated={isAuthenticated}
        feature={planOverlayFeature}
        onClose={closePlanOverlay}
      />
      <ReusableLicenseGuide
        open={reusableGuideOpen}
        onConfirm={() => finishReusableGuide(false)}
        onDismiss={() => finishReusableGuide(true)}
      />
    </main>
  );
}
