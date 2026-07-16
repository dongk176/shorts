"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ProPaywall, type ProPaywallStep } from "@/components/pro-paywall";
import type {
  PopularVideo,
  PopularVideoCategory,
  PopularVideoResponse,
  PopularVideoType,
} from "@/lib/youtube-popular";

const dataTypeOptions: Array<{ value: PopularVideoType; label: string; description: string }> = [
  { value: "trending", label: "실시간 급상승", description: "현재 한국 인기 차트 영상" },
  { value: "views", label: "조회수 상위", description: "수집된 인기 영상 중 조회수 상위" },
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

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatViews(value: number) {
  return `${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}회`;
}

function formatPublishedAt(value: string) {
  const elapsedDays = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (elapsedDays === 0) return "오늘";
  if (elapsedDays < 7) return `${elapsedDays}일 전`;
  if (elapsedDays < 30) return `${Math.floor(elapsedDays / 7)}주 전`;
  if (elapsedDays < 365) return `${Math.floor(elapsedDays / 30)}개월 전`;
  return `${Math.floor(elapsedDays / 365)}년 전`;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "업데이트 확인 중";
  return new Intl.DateTimeFormat("ko-KR", {
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
) {
  const params = new URLSearchParams({
    type,
    category,
    reusable: String(reusable),
    longForm: String(longForm),
    korean: String(korean),
  });
  if (cursor) params.set("cursor", cursor);
  return params;
}

function VideoCard({ video, rank, active, onOpen, onClose, onPrepare }: {
  video: PopularVideo;
  rank: number;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPrepare: () => Promise<void>;
}) {
  const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const canCreateShorts = video.durationSeconds <= 3600;

  const prepareShorts = async () => {
    if (!canCreateShorts || preparing) return;
    setPreparing(true);
    setPrepareError(null);
    try {
      await onPrepare();
    } catch (cause) {
      setPrepareError(cause instanceof Error ? cause.message : "쇼츠 제작 화면을 준비하지 못했습니다.");
      setPreparing(false);
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
          <span>조회수 {formatViews(video.viewCount)}</span><span aria-hidden="true">·</span><span>{formatPublishedAt(video.publishedAt)}</span>
        </div>
      </div>
      {active && (
        <div id={`video-actions-${video.videoId}`} className="absolute inset-0 z-20 grid place-items-center bg-[#0b0f10]/88 p-5 backdrop-blur-md">
          <button type="button" tabIndex={-1} aria-label="영상 작업 메뉴 닫기" onClick={onClose} className="absolute inset-0 cursor-default" />
          <div className="relative z-10 grid w-full max-w-48 gap-3" role="group" aria-label={`${video.title} 작업`}>
            <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#f04435] px-4 text-sm font-extrabold text-white shadow-[0_10px_30px_rgba(240,68,53,.28)] transition hover:bg-[#ff5b4b]">
              유튜브로 <span aria-hidden="true">↗</span>
            </a>
            <button type="button" disabled={!canCreateShorts || preparing} onClick={() => void prepareShorts()} className="min-h-12 rounded-xl border border-white/15 bg-white/[.08] px-4 text-sm font-extrabold text-white transition hover:border-violet-300/50 hover:bg-violet-400/15 disabled:cursor-not-allowed disabled:opacity-45" aria-describedby={!canCreateShorts ? `video-limit-${video.videoId}` : undefined}>
              {preparing ? "준비 중..." : "쇼츠 만들기"}
            </button>
            {!canCreateShorts && <p id={`video-limit-${video.videoId}`} className="text-center text-xs font-semibold text-amber-200/80">60분 이하 영상만 만들 수 있어요.</p>}
            {prepareError && <p role="alert" className="text-center text-xs font-semibold leading-5 text-red-300">{prepareError}</p>}
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

export function PopularVideosExplorer({ hasProAccess, isAuthenticated }: { hasProAccess: boolean; isAuthenticated: boolean }) {
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
  const [paywallStep, setPaywallStep] = useState<ProPaywallStep>("closed");
  const loadMoreController = useRef<AbortController | null>(null);

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
    const endpoint = `/api/youtube/popular?${popularVideoParams(dataType, category, reusableOnly, longFormOnly, koreanOnly)}`;
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
  }, [category, dataType, koreanOnly, longFormOnly, reusableOnly, retryCount]);

  const selectedType = dataTypeOptions.find((option) => option.value === dataType) || dataTypeOptions[0];
  const selectedCategory = categoryOptions.find((option) => option.value === category) || categoryOptions[0];

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

  const preparePopularVideo = async (video: PopularVideo) => {
    const result = await fetch("/api/youtube/popular/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId: video.videoId, source: "pro" }),
    });
    if (!result.ok) {
      const body = await result.json().catch(() => ({})) as { detail?: string };
      throw new Error(body.detail || "쇼츠 제작 화면을 준비하지 못했습니다.");
    }
    const analysis = await result.json() as { analysisId: string };
    window.location.assign(`/?analysisId=${encodeURIComponent(analysis.analysisId)}#shorts-settings`);
  };

  const applyProFilter = (update: () => void) => {
    if (!hasProAccess) {
      setPaywallStep("notice");
      return;
    }
    update();
    setActiveVideoId(null);
  };

  const requestMore = () => {
    if (!hasProAccess) {
      setPaywallStep("notice");
      return;
    }
    void loadMore();
  };

  return (
    <main className="relative mx-auto w-full max-w-6xl px-5 pb-24 pt-7 sm:px-8 sm:pt-10">
      <ProPaywall step={paywallStep} onStepChange={setPaywallStep} isAuthenticated={isAuthenticated} />
      <section className="hero relative isolate mx-auto flex max-w-4xl flex-col items-center px-4 pb-2 text-center sm:pb-3">
        <span className="pointer-events-none absolute left-[8%] top-5 -z-10 h-40 w-40 rounded-full bg-[#ff5540]/20 blur-[70px] sm:h-56 sm:w-56" aria-hidden="true" />
        <span className="pointer-events-none absolute right-[7%] top-14 -z-10 h-44 w-44 rounded-full bg-[#a078ff]/20 blur-[80px] sm:h-60 sm:w-60" aria-hidden="true" />
        <h1 className="hero-title"><span>실시간 인기</span></h1>
        <p className="mt-5 max-w-2xl text-sm leading-7 text-[#d5aaa4] sm:text-base">
          <span className="block">지금 떠오르는 영상을 놓치지 마세요.</span>
          <strong className="block font-extrabold text-[#ff9b8d]">구독 회원에게는 콘텐츠가 6시간 먼저 공개됩니다.</strong>
        </p>
        <p className="mt-6 text-xs font-semibold text-neutral-500" aria-live="polite"><span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]" aria-hidden="true" /><span className="text-neutral-400">마지막 업데이트</span> {formatUpdatedAt(response?.updatedAt || null)}</p>
      </section>

      <section className="relative z-30 -mx-2 mt-2 rounded-2xl border border-white/10 bg-[#15191a]/90 p-4 shadow-[0_16px_50px_rgba(0,0,0,.22)] backdrop-blur-2xl md:mx-0 md:p-5" aria-label="인기 영상 필터">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-[11px] font-extrabold text-neutral-500">인기 기준</legend>
            <div className="flex flex-wrap gap-2 pb-1">
              {dataTypeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={dataType === option.value}
                  onClick={() => {
                    setDataType(option.value);
                    setActiveVideoId(null);
                  }}
                  className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold transition ${dataType === option.value ? "border-[#ff715e] bg-[#ff715e]/15 text-[#ffb4a8] shadow-[0_0_18px_rgba(255,85,64,.1)]" : "border-white/10 bg-white/[.025] text-neutral-400 hover:border-white/25 hover:text-white"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2 self-start sm:justify-end sm:self-auto">
            <button
              type="button"
              role="switch"
              aria-checked={koreanOnly}
              onClick={() => {
                setKoreanOnly((current) => !current);
                setActiveVideoId(null);
              }}
              className={`flex shrink-0 items-center gap-2.5 rounded-full border px-3.5 py-2 text-xs font-bold transition ${koreanOnly ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-white/[.025] text-neutral-400 hover:border-white/25 hover:text-white"}`}
            >
              <span className={`relative h-5 w-9 rounded-full transition ${koreanOnly ? "bg-emerald-400" : "bg-white/15"}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${koreanOnly ? "left-[18px]" : "left-0.5"}`} />
              </span>
              한국어만
            </button>
            <button
              type="button"
              role="switch"
              aria-label="롱폼만 보기 (Pro 전용)"
              aria-checked={longFormOnly}
              onClick={() => applyProFilter(() => setLongFormOnly((current) => !current))}
              className={`flex shrink-0 items-center gap-2.5 rounded-full border px-3.5 py-2 text-xs font-bold transition ${longFormOnly ? "border-[#ff8b7c]/60 bg-[#ff715e]/15 text-[#ffc0b7]" : "border-white/10 bg-white/[.025] text-neutral-400 hover:border-violet-300/35 hover:text-white"}`}
            >
              <span className={`relative h-5 w-9 rounded-full transition ${longFormOnly ? "bg-[#ff715e]" : "bg-white/15"}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${longFormOnly ? "left-[18px]" : "left-0.5"}`} />
              </span>
              롱폼만
            </button>
            <button
              type="button"
              role="switch"
              aria-label="재사용 허용 영상만 보기 (Pro 전용)"
              aria-checked={reusableOnly}
              onClick={() => applyProFilter(() => setReusableOnly((current) => !current))}
              className={`flex shrink-0 items-center gap-2.5 rounded-full border px-3.5 py-2 text-xs font-bold transition ${reusableOnly ? "border-violet-300/60 bg-violet-400/15 text-violet-100" : "border-white/10 bg-white/[.025] text-neutral-400 hover:border-violet-300/35 hover:text-white"}`}
            >
              <span className={`relative h-5 w-9 rounded-full transition ${reusableOnly ? "bg-violet-400" : "bg-white/15"}`} aria-hidden="true">
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${reusableOnly ? "left-[18px]" : "left-0.5"}`} />
              </span>
              재사용 허용만
            </button>
          </div>
        </div>

        <fieldset className="mt-4 min-w-0 border-t border-white/[.07] pt-4">
          <legend className="mb-2 text-[11px] font-extrabold text-neutral-500">카테고리</legend>
          <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
            {categoryOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label} 카테고리 (Pro 전용)`}
                aria-pressed={category === option.value}
                onClick={() => applyProFilter(() => setCategory(option.value))}
                className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold transition ${category === option.value ? "border-violet-300/60 bg-violet-400/15 text-violet-100 shadow-[0_0_18px_rgba(160,120,255,.1)]" : "border-white/10 bg-white/[.025] text-neutral-400 hover:border-violet-300/35 hover:text-white"}`}
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
          <p className="mt-1 text-xs text-neutral-500">{selectedType.description} · {selectedCategory.label}{koreanOnly ? " · 한국어" : ""}{longFormOnly ? " · 4분 이상" : ""}{reusableOnly ? " · 재사용 허용" : ""}</p>
        </div>
        {!loading && response && <span className="text-xs font-bold tabular-nums text-neutral-500">{response.items.length}개 영상</span>}
      </div>

      {loading ? <LoadingSkeleton /> : error ? (
        <section role="alert" className="grid min-h-64 place-items-center rounded-2xl border border-red-400/20 bg-red-950/15 px-6 py-12 text-center">
          <div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-400/10 text-xl text-red-300" aria-hidden="true">!</div><h2 className="mt-4 text-lg font-extrabold">인기 영상을 불러오지 못했습니다</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-red-200/75">{error}</p><button type="button" onClick={() => setRetryCount((value) => value + 1)} className="mt-6 rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-black transition hover:bg-neutral-200">다시 시도</button></div>
        </section>
      ) : response?.items.length ? (
        <div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{response.items.map((video, index) => <VideoCard key={video.videoId} video={video} rank={index + 1} active={activeVideoId === video.videoId} onOpen={() => setActiveVideoId(video.videoId)} onClose={() => setActiveVideoId(null)} onPrepare={() => preparePopularVideo(video)} />)}</div>
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
    </main>
  );
}
