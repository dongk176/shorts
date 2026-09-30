"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";

import { browserLocalizedHref } from "@/lib/i18n/routing";

import { discoveryCopy } from "./trending-date-filter";
import { reconcileCatalogVisibility, type CatalogVisibility } from "@/lib/youtube-catalog-visibility";

import Image from "next/image";
import type { ReactNode } from "react";
import { SavedVideoToast } from "@/components/saved-video-toast";
import { SaveVideoButton } from "@/components/save-video-button";
import { useSavedVideos } from "@/lib/use-saved-videos";
import { savedVideoCopy } from "@/lib/saved-videos";
import { normalizePopularQuery } from "@/lib/popular-text-search";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PopularFiltersPlanOverlay } from "@/components/popular-filters-plan-overlay";
import { PopularFilterSelect } from "@/components/popular-filter-select";
import { usePopularLanguage, type PopularLanguage } from "@/lib/use-popular-language";
import type {
  PopularDiscoveryPeriod,
  PopularVideo,
  PopularVideoCategory,
  PopularVideoResponse,
  PopularVideoType,
} from "@/lib/youtube-popular";
import type { SiteLocale } from "@/lib/i18n/config";
import { formatLocale } from "@/lib/i18n/config";
import { formatNumber } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";
import { userFacingErrorMessage } from "@/lib/public-error";

const searchCopy = {
  ko: { placeholder: "제목이나 채널명을 검색하세요", submit: "검색", clear: "검색 지우기", results: "검색 결과", invalid: "검색어를 2~100자로 입력해 주세요.", empty: "검색 결과가 없습니다", hint: "검색어를 바꾸거나 필터를 조정해 보세요.", similar: "비슷한 검색 결과가 포함되어 있습니다.", error: "검색 결과를 불러오지 못했습니다." },
  en: { placeholder: "Search titles or channels", submit: "Search", clear: "Clear search", results: "Search results", invalid: "Enter 2–100 characters.", empty: "No search results", hint: "Try another search or adjust your filters.", similar: "Similar matches are included.", error: "Could not load search results." },
  ja: { placeholder: "タイトルやチャンネル名を検索", submit: "検索", clear: "検索をクリア", results: "検索結果", invalid: "検索語を2〜100文字で入力してください。", empty: "検索結果がありません", hint: "検索語を変えるか、フィルターを調整してください。", similar: "類似する検索結果を含みます。", error: "検索結果を読み込めませんでした。" },
};

const dataTypeOptions: Array<{ value: PopularVideoType }> = [
  { value: "trending" },
  { value: "views" },
];

const discoveryPeriodOptions: Array<{ value: PopularDiscoveryPeriod; labels: Record<SiteLocale, string> }> = [
  { value: "all", labels: { ko: "전체", en: "All", ja: "すべて" } },
  { value: "today", labels: { ko: "오늘 수집", en: "Collected today", ja: "今日収集" } },
  { value: "week", labels: { ko: "최근 7일", en: "Last 7 days", ja: "直近7日" } },
];

const categoryOptions: Array<{ value: PopularVideoCategory }> = [
  { value: "all" },
  { value: "entertainment" },
  { value: "gaming" },
  { value: "sports" },
  { value: "music" },
  { value: "news" },
  { value: "science" },
  { value: "howto" },
];

const compactFilterCopy = {
  ko: { title: "필터", language: "언어", allLanguages: "전체 언어", korean: "한국어", japanese: "일본어", english: "영어", period: "수집 기간", remove: "조건 해제", shortSearch: "제목·채널 검색" },
  en: { title: "Filters", language: "Language", allLanguages: "All languages", korean: "Korean", japanese: "Japanese", english: "English", period: "Collection period", remove: "Remove filter", shortSearch: "Search titles or channels" },
  ja: { title: "フィルター", language: "言語", allLanguages: "すべての言語", korean: "韓国語", japanese: "日本語", english: "英語", period: "収集期間", remove: "条件を解除", shortSearch: "タイトル・チャンネル検索" },
};

function languageOptions(locale: SiteLocale, japaneseEnabled = true): Array<{value: PopularLanguage; label: string}> {
  const copy = compactFilterCopy[locale];
  return [{value: "all", label: copy.allLanguages}, {value: "ko", label: copy.korean},
    ...(japaneseEnabled ? [{value: "ja" as const, label: copy.japanese}] : []), {value: "en", label: copy.english}];
}

const reusableGuideDismissedKey = "easycut:reusable-license-guide-dismissed:v1";

type PopularFiltersDraft = {
  category: PopularVideoCategory;
  language: PopularLanguage;
  longFormOnly: boolean;
  period: PopularDiscoveryPeriod;
};

const filterLabels: Record<SiteLocale, {
  ranking: string;
  trending: string;
  views: string;
  category: string;
  longForm: string;
  reset: string;
  apply: string;
  close: string;
  categories: Record<PopularVideoCategory, string>;
}> = {
  ko: {
    ranking: "인기 기준",
    trending: "인기 급상승",
    views: "조회수 상위",
    category: "카테고리",
    longForm: "롱폼만",
    reset: "초기화",
    apply: "적용",
    close: "필터 닫기",
    categories: {
      all: "전체",
      entertainment: "엔터테인먼트",
      gaming: "게임",
      sports: "스포츠",
      music: "음악",
      news: "뉴스·정치",
      science: "과학·기술",
      howto: "요리·노하우",
    },
  },
  en: {
    ranking: "Ranking",
    trending: "Trending",
    views: "Most viewed",
    category: "Category",
    longForm: "Long-form only",
    reset: "Reset",
    apply: "Apply",
    close: "Close filters",
    categories: {
      all: "All",
      entertainment: "Entertainment",
      gaming: "Gaming",
      sports: "Sports",
      music: "Music",
      news: "News & politics",
      science: "Science & tech",
      howto: "How-to",
    },
  },
  ja: {
    ranking: "人気基準",
    trending: "急上昇",
    views: "再生回数順",
    category: "カテゴリー",
    longForm: "長尺のみ",
    reset: "リセット",
    apply: "適用",
    close: "フィルターを閉じる",
    categories: {
      all: "すべて",
      entertainment: "エンタメ",
      gaming: "ゲーム",
      sports: "スポーツ",
      music: "音楽",
      news: "ニュース・政治",
      science: "科学・技術",
      howto: "料理・ノウハウ",
    },
  },
};

const popularUiCopy: Record<SiteLocale, {
  lastUpdated: string;
  filters: string;
  activePlanOnly: string;
  koreanOnly: string;
  japaneseOnly: string;
  englishOnly: string;
  longFormOnly: string;
  reusableOnly: string;
  longFormOnlyAria: string;
  reusableOnlyAria: string;
  categoryAria: (label: string) => string;
  countLoading: string;
  loadFailed: string;
  retry: string;
  loadMore: string;
  loadingMore: string;
  loadMoreFailed: string;
  nextResults: string;
  noResults: string;
  noResultsDescription: string;
  reusableBadge: string;
  openActions: (rank: number, title: string) => string;
  closeActions: string;
  actions: (title: string) => string;
  thumbnail: (title: string) => string;
  openYoutube: string;
  copying: string;
  copyLink: string;
  copyError: string;
  loadingVideos: string;
}> = {
  ko: {
    lastUpdated: "마지막 업데이트", filters: "필터", activePlanOnly: "활성 이용권 전용",
    englishOnly: "영어만", japaneseOnly: "일본어만", koreanOnly: "한국어만", longFormOnly: "롱폼만", reusableOnly: "재사용 허용만",
    longFormOnlyAria: "롱폼만 보기", reusableOnlyAria: "재사용 허용 영상만 보기",
    categoryAria: (label) => `${label} 카테고리`, countLoading: "개수 확인 중",
    loadFailed: "인기 영상을 불러오지 못했습니다", retry: "다시 시도", loadMore: "더 보기",
    loadingMore: "추가 영상 불러오는 중...", loadMoreFailed: "추가 영상을 불러오지 못했습니다.", nextResults: "다음 결과 확인",
    noResults: "조건에 맞는 영상이 없습니다",
    noResultsDescription: "인기 기준, 언어, 카테고리, 영상 길이 또는 재사용 허용 조건을 변경해 보세요.",
    reusableBadge: "재사용 허용", openActions: (rank, title) => `${rank}위 ${title} 작업 메뉴 열기`,
    closeActions: "영상 작업 메뉴 닫기", actions: (title) => `${title} 작업`,
    thumbnail: (title) => `${title} 썸네일`, openYoutube: "유튜브로", copying: "복사 중...",
    copyLink: "링크 복사", copyError: "영상 링크를 복사하지 못했습니다.", loadingVideos: "인기 영상을 불러오는 중",
  },
  en: {
    lastUpdated: "Last updated", filters: "Filters", activePlanOnly: "Active plan only",
    englishOnly: "English only", japaneseOnly: "Japanese only", koreanOnly: "Korean only", longFormOnly: "Long-form only", reusableOnly: "Reuse allowed only",
    longFormOnlyAria: "Show long-form videos only", reusableOnlyAria: "Show reusable videos only",
    categoryAria: (label) => `${label} category`, countLoading: "Checking count",
    loadFailed: "Could not load trending videos", retry: "Try again", loadMore: "Show more",
    loadingMore: "Loading more videos...", loadMoreFailed: "Could not load more videos.", nextResults: "Check next results",
    noResults: "No videos match these filters",
    noResultsDescription: "Try changing the ranking, language, category, duration, or reuse filter.",
    reusableBadge: "Reuse allowed", openActions: (rank, title) => `Open actions for #${rank} ${title}`,
    closeActions: "Close video actions", actions: (title) => `Actions for ${title}`,
    thumbnail: (title) => `${title} thumbnail`, openYoutube: "Open YouTube", copying: "Copying...",
    copyLink: "Copy link", copyError: "Could not copy the video link.", loadingVideos: "Loading trending videos",
  },
  ja: {
    lastUpdated: "最終更新", filters: "フィルター", activePlanOnly: "有効なプラン限定",
    englishOnly: "英語のみ", japaneseOnly: "日本語のみ", koreanOnly: "韓国語のみ", longFormOnly: "長尺のみ", reusableOnly: "再利用可能のみ",
    longFormOnlyAria: "長尺動画のみ表示", reusableOnlyAria: "再利用可能な動画のみ表示",
    categoryAria: (label) => `${label}カテゴリー`, countLoading: "件数を確認中",
    loadFailed: "人気動画を読み込めませんでした", retry: "もう一度試す", loadMore: "さらに表示",
    loadingMore: "さらに動画を読み込み中...", loadMoreFailed: "追加の動画を読み込めませんでした。", nextResults: "次の結果を確認",
    noResults: "条件に一致する動画がありません",
    noResultsDescription: "人気基準、言語、カテゴリー、動画の長さ、再利用条件を変更してみてください。",
    reusableBadge: "再利用可能", openActions: (rank, title) => `${rank}位 ${title} の操作メニューを開く`,
    closeActions: "動画の操作メニューを閉じる", actions: (title) => `${title} の操作`,
    thumbnail: (title) => `${title}のサムネイル`, openYoutube: "YouTubeで開く", copying: "コピー中...",
    copyLink: "リンクをコピー", copyError: "動画リンクをコピーできませんでした。", loadingVideos: "人気動画を読み込み中",
  },
};

function ReusableLicenseGuide({
  open,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const ui = useUiText();
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
              <p className="text-xs font-black uppercase tracking-[.14em] text-violet-300">{ui("필터 이용 전 확인")}</p>
              <h2 id="reusable-guide-title" className="mt-1.5 text-xl font-black tracking-[-.035em] text-white sm:text-2xl">
                {ui("영상의 라이선스를 직접 확인해 주세요")}</h2>
            </div>
          </div>
          <div className="mt-5">
            <p id="reusable-guide-description" className="text-sm font-medium leading-6 text-neutral-300">
              {ui("재사용 허용 필터는 YouTube에서")}{" "}
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
                {ui("크리에이티브 커먼즈")}</button>
              {ui("로 표시된 영상을 선별합니다. 게시자가 라이선스를 변경하거나 제3자 권리가 포함될 수 있으므로, 사용 직전에 원본 영상에서 최신 표시를 다시 확인하세요. 정확한 라이선스 확인은 데스크톱에서 진행해 주세요.")}</p>
          </div>
        </div>

        <div className="px-6 py-6 sm:px-8">
          <ol className="space-y-3 text-sm font-semibold leading-6 text-neutral-200">
            <li className="flex gap-3"><span className="text-violet-300">1.</span><span>{ui("원본 영상을 YouTube에서 엽니다.")}</span></li>
            <li className="flex gap-3"><span className="text-violet-300">2.</span><span>{ui("영상 설명의 ")}<strong className="font-black text-white">{ui("더보기")}</strong>{ui("를 선택합니다.")}</span></li>
            <li className="flex gap-3"><span className="text-violet-300">3.</span><span>{ui("설명 최하단의 ")}<strong className="font-black text-white">{ui("라이선스")}</strong> {ui(" 항목을 확인합니다.")}</span></li>
          </ol>

          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#242424]" aria-label={ui("YouTube 라이선스 표시 예시")}>
            <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
              <span className="w-20 shrink-0 text-xs font-semibold text-neutral-400">{ui("라이선스")}</span>
              <span className="text-xs font-bold leading-5 text-[#3ea6ff] sm:text-sm">{ui("크리에이티브 커먼즈 저작자 표시 라이선스 (재사용 허용)")}</span>
            </div>
          </div>
          <p className="mt-3 text-xs font-medium leading-5 text-neutral-500">
            {ui("위 화면은 확인 위치를 설명하기 위해 재구성한 예시이며 실제 YouTube 화면이 아닙니다. 음악, 방송 화면, 인물·상표 등 별도 권리는 직접 확인해야 합니다.")}</p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/[.07] bg-black/10 px-6 py-5 sm:flex-row sm:justify-end sm:px-8">
          <button type="button" onClick={() => {
            setCreativeCommonsExplainerOpen(false);
            onDismiss();
          }} className="min-h-11 rounded-xl border border-white/15 px-5 text-sm font-extrabold text-neutral-200 transition hover:border-white/30 hover:bg-white/[.06] hover:text-white">
            {ui("다시 보지 않기")}</button>
          <button ref={confirmButton} type="button" onClick={() => {
            setCreativeCommonsExplainerOpen(false);
            onConfirm();
          }} className="min-h-11 rounded-xl bg-[#ff715e] px-6 text-sm font-black text-white shadow-[0_10px_28px_rgba(255,85,64,.22)] transition hover:bg-[#ff806f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9b8d]">
            {ui("확인")}</button>
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
            {ui("크리에이티브 커먼즈(CC BY) 영상이란?")}</strong>
          <div className="mt-3 space-y-3 text-xs font-semibold leading-5 text-neutral-200 sm:text-sm sm:leading-6">
            <p>{ui("원작자가 다른 사람이 영상을 사용할 수 있도록 허용한 콘텐츠입니다.")}</p>
            <p>
              {ui("출처와 저작자를 표시하면")}<br />
              {ui("영상을 편집하거나 재사용할 수 있습니다.")}</p>
            <p>{ui("단, 영상 제목, 저작자, 원본 링크, 라이선스 정보를 반드시 표시해야 합니다.")}</p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function PopularFiltersDialog({ open, japaneseEnabled, locale, draft, onDraftChange, onClose, onReset, onApply }: {
  open: boolean;
  japaneseEnabled: boolean;
  locale: SiteLocale;
  draft: PopularFiltersDraft;
  onDraftChange: (draft: PopularFiltersDraft) => void;
  onClose: () => void;
  onReset: () => void;
  onApply: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const copy = filterLabels[locale];
  const compact = compactFilterCopy[locale];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog ref={dialogRef} aria-modal="true" aria-labelledby="popular-filters-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-white/10 bg-[#15191a] p-0 text-white shadow-2xl backdrop:bg-black/70 md:inset-0 md:m-auto md:max-w-md md:rounded-2xl">
      <div className="px-5 pb-5 pt-3 md:pt-5" onClick={event => event.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20 md:hidden" aria-hidden="true" />
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 id="popular-filters-title" className="text-xl font-bold">{compact.title}</h2>
          <button type="button" onClick={onClose} aria-label={copy.close} className="grid h-11 w-11 place-items-center rounded-lg text-2xl text-neutral-400 hover:bg-white/5 hover:text-white">×</button>
        </header>
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-neutral-300">{copy.category}</p>
            <PopularFilterSelect id="popular-draft-category" label={copy.category} closeLabel={copy.close}
              value={draft.category} options={categoryOptions.map(option => ({value: option.value, label: copy.categories[option.value]}))}
              onChange={category => onDraftChange({...draft, category})} />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-neutral-300">{compact.language}</p>
            <PopularFilterSelect id="popular-draft-language" label={compact.language} closeLabel={copy.close}
              value={draft.language} options={languageOptions(locale, japaneseEnabled || draft.language === "ja")}
              onChange={language => onDraftChange({...draft, language})} />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-neutral-300">{compact.period}</p>
            <PopularFilterSelect id="popular-draft-period" label={compact.period} closeLabel={copy.close}
              value={draft.period} options={discoveryPeriodOptions.map(option => ({value: option.value, label: option.labels[locale]}))}
              onChange={period => onDraftChange({...draft, period})} />
          </div>
          <button type="button" role="switch" aria-checked={draft.longFormOnly} onClick={() => onDraftChange({ ...draft, longFormOnly: !draft.longFormOnly })}
            className="flex min-h-11 w-full items-center justify-between gap-3 text-sm font-semibold text-neutral-200">
            {copy.longForm}<FilterSwitch checked={draft.longFormOnly} />
          </button>
        </div>
      </div>
      <footer className="sticky bottom-0 grid grid-cols-2 gap-3 border-t border-white/10 bg-[#15191a] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <button type="button" onClick={onReset} className="min-h-11 rounded-xl border border-white/15 text-sm font-bold text-neutral-300 hover:bg-white/5">{copy.reset}</button>
        <button type="button" onClick={onApply} className="min-h-11 rounded-xl bg-[#ff715e] text-sm font-bold text-[#24100d] hover:bg-[#ff8a78]">{copy.apply}</button>
      </footer>
    </dialog>
  );
}

function FilterSwitch({ checked }: { checked: boolean }) {
  return <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-[#ff715e]" : "bg-white/15"}`} aria-hidden="true">
    <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-5" : ""}`} />
  </span>;
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
  japanese: boolean,
  english: boolean,
  discoveryPeriod: PopularDiscoveryPeriod,
  cursor?: string,
  interactionId?: string,
  q?: string,
) {
  const params = new URLSearchParams({
    type,
    category,
    reusable: String(reusable),
    longForm: String(longForm),
    korean: String(korean),
    japanese: String(japanese),
    english: String(english),
  });
  params.set("period", discoveryPeriod);
  params.set("periodBasis", "collected");
  if (q) params.set("q", q);
  if (cursor) params.set("cursor", cursor);
  if (interactionId) params.set("interactionId", interactionId);
  return params;
}

export function VideoCard({ video, rank, searching = false, active, onOpen, onClose, saveAction }: {
  video: PopularVideo;
  rank: number;
  searching?: boolean;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
  saveAction?: ReactNode;
}) {
  const { locale } = useI18n();
  const uiCopy = popularUiCopy[locale];
  const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const copyLinkAndGoHome = async () => {
    if (copying) return;
    setCopying(true);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(youtubeUrl);
      window.location.assign(browserLocalizedHref("/"));
    } catch (cause) {
      setCopyError(userFacingErrorMessage(cause, uiCopy.copyError));
      setCopying(false);
    }
  };

  return (
    <article className="popular-video-card group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#191c1e]/90 shadow-[0_18px_50px_rgba(0,0,0,.18)] transition duration-200 hover:-translate-y-1 hover:border-[#d0bcff]/40 hover:shadow-[0_22px_60px_rgba(0,0,0,.28)]">
      <button
        type="button"
        aria-label={searching ? uiCopy.actions(video.title) : uiCopy.openActions(rank, video.title)}
        aria-expanded={active}
        aria-controls={`video-actions-${video.videoId}`}
        tabIndex={active ? -1 : 0}
        onClick={onOpen}
        className="absolute inset-0 z-10 rounded-2xl"
      />
      <div className="relative aspect-video overflow-hidden bg-[#0b0f10]">
        <Image src={video.thumbnailUrl} alt={uiCopy.thumbnail(video.title)} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" priority={rank === 1} unoptimized className="object-cover transition duration-300 group-hover:scale-[1.025]" />
        {saveAction && <div className="absolute right-2.5 top-2.5 z-30">{saveAction}</div>}
        {!searching && <span className="absolute left-2.5 top-2.5 grid min-w-9 place-items-center rounded-lg bg-[#f04435] px-2 py-1.5 text-sm font-black text-white shadow-lg">{rank}</span>}
        {video.license === "creativeCommon" && <span className="absolute bottom-2.5 left-2.5 z-[1] inline-flex rounded-full border border-violet-200/40 bg-violet-950/85 px-2.5 py-1 text-[10px] font-black tracking-wide text-violet-100 shadow-lg backdrop-blur-sm">{uiCopy.reusableBadge}</span>}
        <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/85 px-2 py-1 text-xs font-bold tabular-nums text-white backdrop-blur-sm">{formatDuration(video.durationSeconds)}</span>
        <span className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/40 to-transparent" aria-hidden="true" />
      </div>
      <div className="flex flex-1 flex-col p-4">
        {video.isCurrentTrending && <span className="mb-2 text-xs font-bold text-emerald-300">{discoveryCopy[locale].current}</span>}
        <h2 data-i18n-skip className="line-clamp-2 min-h-11 text-[15px] font-extrabold leading-[1.45] tracking-[-.015em] text-white">{video.title}</h2>
        <p data-i18n-skip className="mt-2 truncate text-[13px] font-semibold text-neutral-400">{video.channelName}</p>
        <div className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-neutral-400">
          <span>{locale === "ko" ? "조회수" : locale === "en" ? "Views" : "再生回数"} {formatViews(video.viewCount, locale)}</span><span aria-hidden="true">·</span><span>{formatPublishedAt(video.publishedAt, locale)}</span>
        </div>
      </div>
      {active && (
        <div id={`video-actions-${video.videoId}`} className="absolute inset-0 z-20 grid place-items-center bg-[#0b0f10]/88 p-5 backdrop-blur-md">
          <button type="button" tabIndex={-1} aria-label={uiCopy.closeActions} onClick={onClose} className="absolute inset-0 cursor-default" />
          <div className="relative z-10 grid w-full max-w-48 gap-3" role="group" aria-label={uiCopy.actions(video.title)}>
            <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#f04435] px-4 text-sm font-extrabold text-white shadow-[0_10px_30px_rgba(240,68,53,.28)] transition hover:bg-[#ff5b4b]">
              {uiCopy.openYoutube} <span aria-hidden="true">↗</span>
            </a>
            <button type="button" disabled={copying} onClick={() => void copyLinkAndGoHome()} className="min-h-12 rounded-xl border border-white/15 bg-white/[.08] px-4 text-sm font-extrabold text-white transition hover:border-violet-300/50 hover:bg-violet-400/15 disabled:cursor-wait disabled:opacity-60">
              {copying ? uiCopy.copying : uiCopy.copyLink}
            </button>
            {copyError && <p role="alert" className="text-center text-xs font-semibold leading-5 text-red-300">{copyError}</p>}
          </div>
        </div>
      )}
    </article>
  );
}

function LoadingSkeleton() {
  const { locale } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label={popularUiCopy[locale].loadingVideos} aria-busy="true">
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
  searchEnabled,
  isAuthenticated,
  accountKey,
  onRequireLogin,
  initialResponse = null,
}: {
  initialResponse?: PopularVideoResponse | null;
  canUseFilters: boolean;
  searchEnabled: boolean;
  isAuthenticated: boolean;
  accountKey?: string;
  onRequireLogin: () => void;
}) {
  const ui = useUiText();
  const { locale } = useI18n();
  const savedVideos = useSavedVideos(isAuthenticated, onRequireLogin, accountKey);
  const savedByVideoId = new Map(savedVideos.items.filter(item => item.video).map(item => [item.video!.videoId, item]));
  const savedCopy = savedVideoCopy[locale];
  const uiCopy = popularUiCopy[locale];
  const filterCopy = filterLabels[locale];
  const searchUi = searchCopy[locale];
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const searching = Boolean(searchQuery);
  const [dataType, setDataType] = useState<"trending" | "views">("trending");
  const {language, ready: languageReady, setLanguage} = usePopularLanguage(locale, canUseFilters, accountKey);
  const englishOnly = language === "en";
  const japaneseOnly = language === "ja";
  const koreanOnly = language === "ko";
  const [longFormOnly, setLongFormOnly] = useState(false);
  const [reusableOnly, setReusableOnly] = useState(false);
  const [catalogEnabled, setCatalogEnabled] = useState(Boolean(initialResponse?.catalogEnabled));
  const [japaneseEnabled, setJapaneseEnabled] = useState(Boolean(initialResponse?.japaneseEnabled));
  const [hasNewList, setHasNewList] = useState(false);
  const [cursorNotice, setCursorNotice] = useState(false);
  const [discoveryPeriod, setDiscoveryPeriod] = useState<PopularDiscoveryPeriod>("all");
  const [category, setCategory] = useState<PopularVideoCategory>("all");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(initialResponse?.updatedAt ?? null);
  const [response, setResponse] = useState<PopularVideoResponse | null>(initialResponse);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialResponse);
  const initialSnapshotPending = useRef(Boolean(initialResponse));
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [planOverlayOpen, setPlanOverlayOpen] = useState(false);
  const [planOverlayFeature, setPlanOverlayFeature] = useState<"filters" | "more">("filters");
  const [reusableGuideOpen, setReusableGuideOpen] = useState(false);
  const [filterInteractionId, setFilterInteractionId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<PopularFiltersDraft>({
    category: "all",
    language: "all",
    longFormOnly: false,
    period: "all",
  });
  const loadMoreController = useRef<AbortController | null>(null);
  const listStart = useRef<HTMLDivElement | null>(null);
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
    if (!languageReady) return;
    if (initialSnapshotPending.current) {
      initialSnapshotPending.current = false;
      if (!searching && dataType === "trending" && category === "all" && discoveryPeriod === "all" && !koreanOnly && !japaneseOnly && !englishOnly && !longFormOnly && !reusableOnly && retryCount === 0) return;
    }
    const controller = new AbortController();
    loadMoreController.current?.abort();
    setLoading(true);
    setLoadingMore(false);
    setLoadMoreError(null);
    setError(null);
    setResponse(null);
    const endpoint = `/api/youtube/popular?${popularVideoParams(searching ? "views" : dataType, category, reusableOnly, longFormOnly, koreanOnly, japaneseOnly, englishOnly, discoveryPeriod, undefined, filterInteractionId || undefined, searchQuery)}`;
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (result) => {
        if (!result.ok) {
          const body = await result.json().catch(() => ({})) as { detail?: string; code?: string };
          if (body.code === "JAPANESE_DISCOVERY_DISABLED" && !controller.signal.aborted) {
            setLanguage("all", false); setJapaneseEnabled(false);
            return null;
          }
          throw new Error(body.detail || uiCopy.loadFailed);
        }
        return result.json() as Promise<PopularVideoResponse>;
      })
      .then((result) => { if (!result || controller.signal.aborted) return; setResponse(result); setLastUpdatedAt(result.updatedAt); setCatalogEnabled(Boolean(result.catalogEnabled)); setJapaneseEnabled(Boolean(result.japaneseEnabled)); setHasNewList(false); })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setError(userFacingErrorMessage(cause, uiCopy.loadFailed));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [languageReady, searchQuery, searching, category, dataType, discoveryPeriod, filterInteractionId, koreanOnly, japaneseOnly, englishOnly, locale, longFormOnly, reusableOnly, retryCount, uiCopy.loadFailed, setLanguage]);

  const visibleVideoIds = response?.items.map(video => video.videoId).join(",") || "";
  useEffect(() => {
    if (!catalogEnabled || !response?.generation) return;
    const controller = new AbortController();
    let checking = false;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || checking) return;
      checking = true;
      const ids = visibleVideoIds ? visibleVideoIds.split(",") : [];
      const chunks = Array.from({length: Math.max(1, Math.ceil(ids.length / 200))}, (_, index) => ids.slice(index * 200, index * 200 + 200));
      Promise.all(chunks.map(chunk => fetch(`/api/youtube/popular/status?${new URLSearchParams({type:searching ? "views" : dataType, ...(chunk.length ? {ids:chunk.join(",")} : {})})}`, { cache: "no-store", signal: controller.signal })
        .then(async result => result.ok ? result.json() as Promise<{ generation?: string; collectionWindowStart?: string; collectionWindowKey?: string; japaneseEnabled?: boolean; delayed?: boolean; visibility?: CatalogVisibility[] }> : null)))
        .then(states => {
          if (controller.signal.aborted) return;
          if (states.some(state => state?.japaneseEnabled === false) && (japaneseOnly || response.japaneseEnabled)) {
            if (japaneseOnly) setLanguage("all", false);
            setRetryCount(value => value + 1); return;
          }
          if (response.collectionWindowKey && states.some(state => state?.collectionWindowKey && state.collectionWindowKey !== response.collectionWindowKey)) {
            setRetryCount(value => value + 1); return;
          }
          if (!response.collectionWindowKey && response.collectionWindowStart && states.some(state => state?.collectionWindowStart && state.collectionWindowStart !== response.collectionWindowStart)) {
            setRetryCount(value => value + 1);
            return;
          }
          if (states.some(state => state?.generation && state.generation !== response.generation)) setHasNewList(true);
          const delayed = states.some(state => state?.delayed);
          const statuses = states.flatMap(state => state?.visibility || []);
          setResponse(current => {
            if (!current) return current;
            const listDelayed = Boolean(current.delayed || delayed);
            const items = reconcileCatalogVisibility(current.items, statuses, {type:dataType,reusable:reusableOnly,date:null,delayed:listDelayed,periodBasis:"collected",searching});
            return {...current, delayed:listDelayed, items, totalCount: current.totalCount === undefined ? undefined : Math.max(0,current.totalCount-current.items.length+items.length)};
          });
        }).catch(() => undefined).finally(() => { checking = false; });
    }, 60_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [searching, catalogEnabled, dataType, response?.generation, response?.collectionWindowStart, response?.collectionWindowKey, response?.japaneseEnabled, japaneseOnly, visibleVideoIds, reusableOnly, setLanguage]);

  const loadMore = async () => {
    if (!response?.nextCursor || loadingMore) return;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const endpoint = `/api/youtube/popular?${popularVideoParams(searching ? "views" : dataType, category, reusableOnly, longFormOnly, koreanOnly, japaneseOnly, englishOnly, discoveryPeriod, response.nextCursor, undefined, searchQuery)}`;
      const result = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.status === 410) {
        setCursorNotice(true); setRetryCount(value => value + 1);
        listStart.current?.scrollIntoView({block:"start",behavior:"smooth"});
        return;
      }
      if (!result.ok) {
        const body = await result.json().catch(() => ({})) as { detail?: string; code?: string };
        if (body.code === "JAPANESE_DISCOVERY_DISABLED") {
          setLanguage("all", false); setJapaneseEnabled(false);
          return;
        }
        throw new Error(body.detail || uiCopy.loadMoreFailed);
      }
      const next = await result.json() as PopularVideoResponse;
      if (controller.signal.aborted) return;
      setResponse((current) => {
        if (!current) return next;
        const videos = new Map(current.items.map((video) => [video.videoId, video]));
        for (const video of next.items) videos.set(video.videoId, video);
        return {
          ...current,
          items: Array.from(videos.values()),
          updatedAt: current.updatedAt,
          totalCount: next.totalCount ?? current.totalCount,
          periodCounts: next.periodCounts ?? current.periodCounts,
          reusablePeriodCounts: next.reusablePeriodCounts ?? current.reusablePeriodCounts,
          includesSimilarResults: Boolean(current.includesSimilarResults || next.includesSimilarResults),
          nextCursor: next.nextCursor,
        };
      });
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return;
      setLoadMoreError(userFacingErrorMessage(cause, uiCopy.loadMoreFailed));
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
    setCursorNotice(false);
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

  const activeFilterCount = Number(category !== "all") + Number(koreanOnly || japaneseOnly || englishOnly) + Number(longFormOnly) + Number(discoveryPeriod !== "all");
  const openFilters = () => {
    if (!canUseFilters) {
      setPlanOverlayFeature("filters");
      setPlanOverlayOpen(true);
      return;
    }
    setFilterDraft({ category, language, longFormOnly, period: discoveryPeriod });
    setFiltersOpen(true);
  };
  const applyFilters = () => {
    applyFilter(() => {
      setCategory(filterDraft.category);
      setLanguage(filterDraft.language);
      setLongFormOnly(filterDraft.longFormOnly);
      setDiscoveryPeriod(filterDraft.period);
    });
    setFiltersOpen(false);
  };
  const applyRanking = (nextType: PopularVideoType) => {
    if (nextType === dataType || nextType === "reusable") return;
    applyFilter(() => setDataType(nextType));
  };
  const toggleReusable = () => {
    // Check access before opening the existing CC BY explanation.
    if (!canUseFilters) { applyFilter(() => {}); return; }
    const commit = () => applyFilter(() => setReusableOnly(current => !current));
    if (reusableOnly) commit();
    else requestReusableFilter(commit);
  };

  const clearSearch = () => {
    loadMoreController.current?.abort();
    setSearchInput(""); setSearchQuery(""); setSearchError(null); setCursorNotice(false);
    setActiveVideoId(null);
    searchInputRef.current?.focus();
  };
  const submitSearch = () => {
    const query = normalizePopularQuery(searchInput);
    if (!query) { clearSearch(); return; }
    if ([...query].length < 2 || [...query].length > 100) { setSearchError(searchUi.invalid); return; }
    applyFilter(() => {
      loadMoreController.current?.abort();
      setSearchError(null); setSearchQuery(query);
      if (query === searchQuery) setRetryCount(value => value + 1);
    });
  };

  const requestMore = () => {
    if (!canUseFilters) {
      setPlanOverlayFeature("more");
      setPlanOverlayOpen(true);
      return;
    }
    void loadMore();
  };

  const displayedTotalCount = response?.totalCount ?? response?.items.length;

  return (
    <main className="relative mx-auto w-full max-w-6xl px-4 pb-24 pt-5 sm:px-8 sm:pt-7">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:mb-5 md:pr-36">
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7 shrink-0 text-[#ff715e]" aria-hidden="true">
            <path d="M12.1 21.25c4.35 0 7.65-2.95 7.65-7.15 0-3.15-1.8-5.9-4.75-8.2.15 2.35-.75 4.05-2.4 4.95.2-3.95-1.55-6.9-4.5-9.1.25 3.75-4.35 6.25-4.35 12.35 0 4.2 3.45 7.15 8.35 7.15Z" />
            <path d="M9.1 16.2c0 2.15 1.35 3.55 3.2 3.55 1.9 0 3.25-1.35 3.25-3.35 0-1.45-.7-2.65-2.05-3.7-.05 1.1-.5 1.85-1.2 2.3-.2-1.75-.95-3.05-2.15-4 .05 1.65-1.05 3.15-1.05 5.2Z" />
          </svg>
          {ui("실시간 인기")}
        </h1>
        <p className="text-[11px] text-neutral-500 sm:text-xs" aria-live="polite"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" /><span className="sr-only">{uiCopy.lastUpdated} </span>{(error && !lastUpdatedAt ? "—" : formatUpdatedAt(lastUpdatedAt, locale))}</p>
      </header>

      {searchEnabled && <form role="search" onSubmit={event => { event.preventDefault(); if (!composing.current) submitSearch(); }} className="mb-3">
        <label htmlFor="popular-search" className="sr-only">{searchUi.placeholder}</label>
        <div className="flex min-h-12 items-center gap-1 rounded-xl border border-white/15 bg-[#15191a] p-1 pl-3 focus-within:border-[#ff715e]/70 sm:gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mr-1 h-5 w-5 shrink-0 text-neutral-500" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input ref={searchInputRef} id="popular-search" type="search" value={searchInput} maxLength={100}
            placeholder={compactFilterCopy[locale].shortSearch} enterKeyHint="search" autoComplete="off"
            aria-invalid={Boolean(searchError)} aria-describedby={searchError ? "popular-search-error" : undefined}
            onChange={event => { setSearchInput(event.target.value); setSearchError(null); }}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current)) event.preventDefault(); }}
            className="min-w-0 flex-1 bg-transparent py-2 text-base text-white outline-none placeholder:text-neutral-500 [&::-webkit-search-cancel-button]:appearance-none" />
          <button type="button" onClick={clearSearch} aria-label={searchUi.clear} disabled={!searchInput && !searching}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xl text-neutral-400 hover:text-white ${!searchInput && !searching ? "invisible" : ""}`}>×</button>
          <button type="submit" className="min-h-11 shrink-0 rounded-lg bg-[#ff715e] px-4 text-sm font-extrabold text-[#24100d] hover:bg-[#ff8a78]">{searchUi.submit}</button>
        </div>
        {searchError && <p id="popular-search-error" role="alert" className="mt-2 text-sm text-red-300">{searchError}</p>}
      </form>}

      <div role="region" aria-label={ui("인기 영상 필터")}>
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-4">
          <div className="flex min-w-0 items-center gap-4">
          {searching ? <h2 className="flex min-h-12 items-center text-lg font-bold text-white">{searchUi.results}</h2> : (
            <fieldset className="min-w-0 shrink-0 border-b border-white/10 md:border-0">
              <legend className="sr-only">{filterCopy.ranking}</legend>
              <div className="flex gap-5">
                {dataTypeOptions.map(option => <button key={option.value} type="button" aria-pressed={dataType === option.value}
                  aria-haspopup={canUseFilters ? undefined : "dialog"} onClick={() => applyRanking(option.value)}
                  className={`min-h-12 whitespace-nowrap border-b-2 px-0.5 text-sm font-bold transition sm:text-base ${dataType === option.value ? "border-[#ff715e] text-[#ff8a78]" : "border-transparent text-neutral-400 hover:text-white"}`}>
                  {option.value === "trending" ? filterCopy.trending : filterCopy.views}
                </button>)}
              </div>
            </fieldset>
          )}
          <div className="hidden shrink-0 md:block">
            <PopularFilterSelect id="popular-period" label={compactFilterCopy[locale].period} closeLabel={filterCopy.close}
              value={discoveryPeriod} options={discoveryPeriodOptions.map(option => ({value: option.value, label: option.labels[locale]}))}
              onChange={period => applyFilter(() => setDiscoveryPeriod(period))} className="min-w-32" />
          </div>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 md:hidden">
            <button type="button" role="switch" aria-label={uiCopy.reusableOnlyAria} aria-checked={reusableOnly}
              aria-haspopup={canUseFilters ? undefined : "dialog"} onClick={toggleReusable}
              className="flex min-h-11 items-center gap-2 text-sm font-semibold text-neutral-300 hover:text-white md:hidden">
              <FilterSwitch checked={reusableOnly} />{uiCopy.reusableOnly}
            </button>
            <button type="button" aria-label={compactFilterCopy[locale].title} aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={openFilters}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-bold hover:bg-white/5 ${activeFilterCount ? "border-[#ff715e]/50 text-[#ff9b8d]" : "border-white/20 text-neutral-200"}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true"><path d="M4 7h7m4 0h5M4 17h3m4 0h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
              {compactFilterCopy[locale].title}{activeFilterCount > 0 && <span className="text-xs tabular-nums">{activeFilterCount}</span>}
            </button>
          </div>
        <fieldset className="hidden min-w-0 max-w-full md:ml-auto md:block">
          <legend className="sr-only">{compactFilterCopy[locale].title}</legend>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <PopularFilterSelect id="popular-language" label={compactFilterCopy[locale].language} closeLabel={filterCopy.close}
              value={language} options={languageOptions(locale, !response || japaneseEnabled || japaneseOnly)} showLabel
              onChange={next => applyFilter(() => setLanguage(next))} className="min-w-44" />
            {[
              { tone: "coral", label: uiCopy.longFormOnly, checked: longFormOnly, toggle: () => applyFilter(() => setLongFormOnly(current => !current)) },
              { tone: "violet", label: uiCopy.reusableOnly, checked: reusableOnly, toggle: toggleReusable },
            ].map(({ label, checked, toggle, tone }) => {
              const colors = checked ? {
                violet: "border-violet-300/60 bg-violet-400/20 text-violet-100",
                emerald: "border-emerald-300/60 bg-emerald-400/20 text-emerald-100",
                sky: "border-sky-300/60 bg-sky-400/20 text-sky-100",
                amber: "border-amber-300/60 bg-amber-400/20 text-amber-100",
                coral: "border-[#ff8b7c]/60 bg-[#ff715e]/20 text-[#ffd0c9]",
              }[tone] : "border-white/20 bg-white/[.035] text-neutral-200 hover:border-white/35 hover:bg-white/[.07]";
              const switchColor = checked ? {
                violet: "bg-violet-400",
                emerald: "bg-emerald-400",
                sky: "bg-sky-400",
                amber: "bg-amber-400",
                coral: "bg-[#ff715e]",
              }[tone] : "bg-white/20";
              return <button key={label} type="button" role="switch" aria-checked={checked}
                aria-haspopup={canUseFilters ? undefined : "dialog"} onClick={toggle}
                className={`flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-bold transition ${colors}`}>
                <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${switchColor}`}>
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-4" : "translate-x-0"}`} />
                </span>
                {label}
              </button>;
            })}
          </div>
        </fieldset>
        </div>
        {activeFilterCount > 0 && <div className="mt-2 flex flex-wrap gap-2">
          {[
            ...(category !== "all" ? [{ key: "category", label: filterCopy.categories[category], clear: () => setCategory("all") }] : []),
            ...(koreanOnly || japaneseOnly || englishOnly ? [{ key: "language", label: koreanOnly ? uiCopy.koreanOnly : japaneseOnly ? uiCopy.japaneseOnly : uiCopy.englishOnly, clear: () => setLanguage("all") }] : []),
            ...(longFormOnly ? [{ key: "length", label: uiCopy.longFormOnly, clear: () => setLongFormOnly(false) }] : []),
            ...(discoveryPeriod !== "all" ? [{ key: "period", label: discoveryPeriodOptions.find(option => option.value === discoveryPeriod)!.labels[locale], clear: () => setDiscoveryPeriod("all") }] : []),
          ].map(chip => <button key={chip.key} type="button" onClick={() => applyFilter(chip.clear)} aria-label={`${chip.label} · ${compactFilterCopy[locale].remove}`}
            className="flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[.03] px-3 text-xs text-neutral-300 hover:bg-white/[.07]">{chip.label}<span aria-hidden="true">×</span></button>)}
        </div>}
      </div>

      <div ref={listStart} className="mb-4 mt-4 scroll-mt-5">
        <p className="text-xs font-medium tabular-nums text-neutral-400" aria-live="polite">{!loading && response && displayedTotalCount !== undefined ? (locale === "ko" ? `영상 ${formatNumber(displayedTotalCount, locale)}개` : locale === "en" ? `${formatNumber(displayedTotalCount, locale)} videos` : `動画 ${formatNumber(displayedTotalCount, locale)}件`) : error ? "—" : uiCopy.countLoading}</p>
      </div>

      {catalogEnabled && ((!searching && dataType === "trending" && response?.delayed) || cursorNotice || hasNewList) && <div className="mb-5 space-y-2 text-xs text-neutral-400" aria-live="polite">
        {!searching && dataType === "trending" && response?.delayed && <p className="text-amber-300">{discoveryCopy[locale].delayed}</p>}
        {cursorNotice && <p>{discoveryCopy[locale].expired}</p>}
        {hasNewList && <button type="button" className="min-h-10 rounded-lg border border-violet-300/40 px-4 font-bold text-violet-100" onClick={() => setRetryCount(value => value + 1)}>{discoveryCopy[locale].fresh}</button>}
      </div>}
      {searching && response?.includesSimilarResults && <p className="mb-4 text-xs text-neutral-400">{searchUi.similar}</p>}
      {loading ? <LoadingSkeleton /> : error ? (
        <section role="alert" className="grid min-h-64 place-items-center rounded-2xl border border-red-400/20 bg-red-950/15 px-6 py-12 text-center">
          <div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-400/10 text-xl text-red-300" aria-hidden="true">!</div><h2 className="mt-4 text-lg font-extrabold">{searching ? searchUi.error : uiCopy.loadFailed}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-red-200/75">{ui(error)}</p><button type="button" onClick={() => setRetryCount((value) => value + 1)} className="mt-6 rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-black transition hover:bg-neutral-200">{uiCopy.retry}</button></div>
        </section>
      ) : response?.items.length ? (
        <div>
          {savedVideos.loadError && <p role="alert" className="mb-3 text-sm text-amber-200">{savedCopy.error} <button type="button" onClick={() => void savedVideos.reload()} className="min-h-11 px-3 underline">{savedCopy.retry}</button></p>}
          <SavedVideoToast message={savedVideos.notice} />
          {savedVideos.error && <p role="alert" className="fixed bottom-20 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-xl border border-red-300/30 bg-[#321c22] p-4 text-sm text-red-100 shadow-xl sm:max-w-sm">{savedVideos.error}</p>}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{response.items.map((video, index) => <VideoCard key={video.videoId} video={video} rank={index + 1} searching={searching} active={activeVideoId === video.videoId} onOpen={() => setActiveVideoId(video.videoId)} onClose={() => setActiveVideoId(null)}
            saveAction={<SaveVideoButton title={video.title} saved={savedByVideoId.has(video.videoId)} busy={savedVideos.pending.has(video.videoId)} disabled={savedVideos.loading || savedVideos.loadError} onClick={() => void savedVideos.mutate(video, savedByVideoId.get(video.videoId))} />} />)}</div>
          {response.nextCursor && (
            <div className="mt-10 flex flex-col items-center gap-3">
              <button
                type="button"
                disabled={loadingMore}
                onClick={requestMore}
                className="min-h-12 rounded-xl border border-white/15 bg-white/[.06] px-7 text-sm font-extrabold text-white transition hover:border-[#d0bcff]/50 hover:bg-violet-400/10 disabled:cursor-wait disabled:opacity-60"
              >
                {loadingMore ? uiCopy.loadingMore : uiCopy.loadMore}
              </button>
              {loadMoreError && <p role="alert" className="text-center text-xs font-semibold text-red-300">{loadMoreError}</p>}
            </div>
          )}
        </div>
      ) : (
        <section className="grid min-h-64 place-items-center rounded-2xl border border-white/[.08] bg-white/[.025] px-6 py-12 text-center">
          <div>
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-400/10 text-xl text-violet-200" aria-hidden="true">⌕</div>
            <h2 className="mt-4 text-lg font-extrabold">{searching ? searchUi.empty : uiCopy.noResults}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">{searching ? searchUi.hint : uiCopy.noResultsDescription}</p>
            {response?.nextCursor && (
              <button type="button" disabled={loadingMore} onClick={requestMore} className="mt-6 min-h-12 rounded-xl border border-white/15 bg-white/[.06] px-7 text-sm font-extrabold text-white transition hover:border-[#d0bcff]/50 hover:bg-violet-400/10 disabled:cursor-wait disabled:opacity-60">
                {loadingMore ? uiCopy.loadingMore : uiCopy.nextResults}
              </button>
            )}
            {loadMoreError && <p role="alert" className="mt-3 text-center text-xs font-semibold text-red-300">{loadMoreError}</p>}
          </div>
        </section>
      )}
      <PopularFiltersDialog
        japaneseEnabled={japaneseEnabled}
        open={filtersOpen}
        locale={locale}
        draft={filterDraft}
        onDraftChange={setFilterDraft}
        onClose={() => setFiltersOpen(false)}
        onReset={() => setFilterDraft({
          category: "all",
          language: "all",
          longFormOnly: false,
          period: "all",
        })}
        onApply={applyFilters}
      />
      <PopularFiltersPlanOverlay
        open={planOverlayOpen}
        isAuthenticated={isAuthenticated}
        feature={planOverlayFeature}
        onClose={closePlanOverlay}
        onRequireLogin={onRequireLogin}
      />
      <ReusableLicenseGuide
        open={reusableGuideOpen}
        onConfirm={() => finishReusableGuide(false)}
        onDismiss={() => finishReusableGuide(true)}
      />
    </main>
  );
}
