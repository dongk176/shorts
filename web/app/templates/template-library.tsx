"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CustomTemplateCanvasPreview } from "@/components/custom-template-canvas-preview";
import { TemplateFavoriteButton } from "@/components/template-favorite-button";
import { TemplateFavoriteToast } from "@/components/template-favorite-toast";
import { COMMENT_CAPTURE_BODY_FONT_CQW } from "@/lib/comment-overlay";
import type { CommentOverlay, TemplateId, VideoAspectRatio } from "@/lib/contracts";
import { videoAspectRatioOptions } from "@/lib/contracts";
import {
  COMMENT_BACKGROUND_COLOR,
  COMMENT_CAPTURE_LANDSCAPE_LIFT_PX,
  COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y,
  PRESET_SQUARE_CHANNEL_CENTER_Y,
  type CustomTemplate,
} from "@/lib/template-config";
import {
  customTemplateFavoriteKey,
  presetTemplateFavoriteKey,
  updateFavoriteTemplateKeys,
  type TemplateFavoriteKey,
} from "@/lib/template-favorites";
import { userFacingErrorMessage } from "@/lib/public-error";
import { formatLocale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { titleLineBackground, titleLineColor } from "@/lib/title-preview";
import {
  presetTemplateDisplayDescription,
  presetTemplateDisplayName,
} from "@/lib/admin-template-copy";

type TemplateShowcase = {
  id: TemplateId;
  name: string;
  description: string;
  category: string;
  label: string;
  background: string;
  primary: string;
  accent: string;
  accentBackground: string | null;
  channel: string;
};

const templates: readonly TemplateShowcase[] = [
  {
    id: "comment-capture",
    name: "댓글 캡처",
    description: "댓글 반응을 활용해 시청 흐름을 이어가는 구성",
    category: "소셜",
    label: "댓글 반응과 함께\n시청 지속시간 상승",
    background: COMMENT_BACKGROUND_COLOR,
    primary: "#ffffff",
    accent: "#35e6e3",
    accentBackground: null,
    channel: "#ffffff",
  },
  {
    id: "dark-red",
    name: "다크 레드",
    description: "강한 레드 포인트로 핵심을 각인하는 구성",
    category: "정보",
    label: "지금 꼭 알아야 할\n핵심 한 가지",
    background: "#000000",
    primary: "#ffffff",
    accent: "#ffffff",
    accentBackground: "#e32626",
    channel: "#ffffff",
  },
  {
    id: "white-yellow",
    name: "화이트 옐로",
    description: "밝고 친근하게 내용을 전달하는 구성",
    category: "교육",
    label: "생각보다 쉬운\n핵심 한 가지",
    background: "#ffffff",
    primary: "#111111",
    accent: "#111111",
    accentBackground: "#ffd84d",
    channel: "#111111",
  },
  {
    id: "dark-minimal",
    name: "다크 미니멀",
    description: "장식을 덜어내고 영상에 집중하는 구성",
    category: "뉴스",
    label: "놓치기 쉬운\n결정적 순간",
    background: "#000000",
    primary: "#ffffff",
    accent: "#f04444",
    accentBackground: null,
    channel: "#ffffff",
  },
  {
    id: "paper",
    name: "페이퍼",
    description: "차분하고 신뢰감 있게 이야기를 전하는 구성",
    category: "스토리",
    label: "오늘 바로 쓰는\n핵심 방법",
    background: "#f3f0e9",
    primary: "#111111",
    accent: "#d52b2b",
    accentBackground: null,
    channel: "#363636",
  },
] as const;

const templateCommentSample: CommentOverlay = {
  id: "template-comment-sample",
  startSeconds: 0,
  endSeconds: 10,
  text: "아 진짜 ㅋㅋㅋㅋㅋㅋㅋㅋ",
  initial: "소",
  avatarColor: "#8B2CC4",
  nickname: "소담기록24",
  likeCount: 1_312,
  ageLabel: "5개월 전",
};

function aspectLayout(value: VideoAspectRatio, reserveCommentSpace = false) {
  const layoutValue = reserveCommentSpace && value === "9:16" ? "4:5" : value;
  const option = videoAspectRatioOptions.find((item) => item.value === layoutValue)
    || videoAspectRatioOptions.find((item) => item.value === "1:1")!;
  const videoHeight = option.height / 19.2;
  const videoTop = (100 - videoHeight) / 2
    - (reserveCommentSpace && layoutValue === "16:9"
      ? COMMENT_CAPTURE_LANDSCAPE_LIFT_PX / 19.2
      : 0);
  const bottomHeight = 100 - videoTop - videoHeight;
  return { option, videoHeight, videoTop, bottomHeight, fullVertical: layoutValue === "9:16" };
}

function ChannelAvatar({ foreground, background }: { foreground: string; background: string }) {
  return (
    <span className="relative h-[6.1cqw] w-[6.1cqw] shrink-0 overflow-hidden rounded-full" style={{ background: foreground }} aria-hidden="true">
      <span className="absolute left-1/2 top-[20%] h-[35%] w-[35%] -translate-x-1/2 rounded-full" style={{ background }} />
      <span className="absolute bottom-[10%] left-1/2 h-[35%] w-[62%] -translate-x-1/2 rounded-t-full" style={{ background }} />
    </span>
  );
}

function ReactionIcon({ down = false }: { down?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-[1.08em] w-[1.08em] fill-none stroke-current stroke-[1.65] ${down ? "rotate-180" : ""}`}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.4 10.1 10.9 3.4a1.45 1.45 0 0 1 2.73.68l-.34 4.43h5.05a2.17 2.17 0 0 1 2.12 2.62l-1.38 6.51a2.17 2.17 0 0 1-2.12 1.72H7.4m0-9.26v9.26H3.55a1.1 1.1 0 0 1-1.1-1.1v-7.06a1.1 1.1 0 0 1 1.1-1.1H7.4Z" />
    </svg>
  );
}

function CommentCaptureCard({ comment }: { comment: CommentOverlay }) {
  const { locale } = useI18n();
  const compactCount = new Intl.NumberFormat(formatLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(comment.likeCount);
  const ageLabel = locale === "ko" ? comment.ageLabel : locale === "en" ? "5 months ago" : "5か月前";
  return (
    <div className="w-full pb-[0.6cqw] pl-[4.4cqw] pr-[2.8cqw] pt-[4.5cqw] text-left text-white" style={{ backgroundColor: COMMENT_BACKGROUND_COLOR }}>
      <div className="flex items-start gap-[2.7cqw]">
        <div data-i18n-skip className="grid h-[8.6cqw] w-[8.6cqw] shrink-0 place-items-center rounded-full text-[3.7cqw] font-bold text-white blur-[0.65cqw]" style={{ background: comment.avatarColor }}>{comment.initial}</div>
        <div className="min-w-0 flex-1">
          <div className="w-fit max-w-[74cqw] truncate text-[3.45cqw] font-bold leading-tight text-neutral-100 blur-[0.52cqw]"><span data-i18n-skip>@{comment.nickname}</span> <span className="font-normal text-neutral-400">{ageLabel}</span></div>
          <p data-i18n-skip className="mt-[1.5cqw] line-clamp-2 whitespace-pre-wrap font-normal leading-[1.28] text-white/95 blur-[0.05cqw]" style={{ fontSize: `${COMMENT_CAPTURE_BODY_FONT_CQW}cqw` }}>{comment.text}</p>
          <div className="mt-[2.1cqw] flex items-center gap-[1.25cqw] text-[3.4cqw] text-neutral-300/80 blur-[0.035cqw]">
            <ReactionIcon /><span>{compactCount}</span>
            <span className="ml-[2.2cqw]"><ReactionIcon down /></span>
            <span className="ml-[3cqw] text-[3.25cqw] text-neutral-200">답글</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FixedPresetChannel({ template }: { template: TemplateShowcase }) {
  const commentTemplate = template.id === "comment-capture";
  const centerY = commentTemplate
    ? COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y
    : PRESET_SQUARE_CHANNEL_CENTER_Y;
  const foreground = commentTemplate ? "#FFFFFF" : template.channel;
  const background = commentTemplate ? COMMENT_BACKGROUND_COLOR : template.background;
  return (
    <div
      className="absolute inset-x-0 z-20 flex items-center justify-center gap-[2.4cqw] px-[4.9cqw] text-[4.2cqw] font-semibold"
      style={{ top: `${centerY / 19.2}%`, color: foreground, transform: "translateY(-50%)" }}
    >
      <ChannelAvatar foreground={foreground} background={background} />
      <span className="max-w-[70cqw] truncate">Easy Cut</span>
    </div>
  );
}

function TemplatePreview({ template }: { template: TemplateShowcase }) {
  const [firstLine, secondLine] = template.label.split("\n");
  const isLight = template.id === "white-yellow" || template.id === "paper";
  const foreground = isLight ? "text-black" : "text-white";
  const layout = aspectLayout(template.id === "comment-capture" ? "16:9" : "5:4");
  const previewLine = (line: string, index: number) => {
    const lineBackground = titleLineBackground(
      index,
      layout.fullVertical,
      template.background,
      template.accentBackground,
    );
    return (
      <span
        className={`${index === 1 ? "mt-[2.4cqw]" : ""} whitespace-nowrap`}
        style={{
          color: titleLineColor(
            index,
            layout.fullVertical,
            template.primary,
            template.accent,
            template.id === "paper",
          ),
          background: lineBackground || "transparent",
          borderRadius: lineBackground ? "1cqw" : 0,
          padding: lineBackground ? "1.2cqw 3.65cqw" : 0,
        }}
      >
        {line}
      </span>
    );
  };

  return (
    <div
      data-template-preview
      className={`relative mx-auto aspect-[9/16] w-full max-w-[164px] overflow-hidden rounded-lg ${foreground}`}
      style={{ aspectRatio: "9 / 16", background: template.background, containerType: "inline-size" }}
      aria-label={`${template.name} 쇼츠 미리보기`}
    >
      <div data-template-title className={`absolute inset-x-0 z-10 flex flex-col items-center justify-end px-[4.9cqw] text-center text-[6.7cqw] font-extrabold leading-[1.25] ${layout.option.value === "4:5" ? "pb-[1.2cqw]" : "pb-[4.9cqw]"}`} style={layout.fullVertical ? { top: "5%", height: "18.75%" } : { top: 0, height: `${layout.videoTop}%` }}>
        {previewLine(firstLine, 0)}
        {previewLine(secondLine, 1)}
      </div>
      <div className={`absolute inset-x-0 flex items-center justify-center overflow-hidden ${isLight ? "bg-neutral-300" : "bg-neutral-700"}`} style={{ top: `${layout.videoTop}%`, height: `${layout.videoHeight}%` }}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
        <div className={`h-[22cqw] w-[22cqw] rounded-full border-2 ${isLight ? "border-neutral-500" : "border-neutral-400"}`} aria-hidden="true" />
      </div>
      <div className={`absolute inset-x-0 z-10 overflow-hidden text-[5.5cqw] font-semibold ${template.id === "paper" ? "text-neutral-700" : ""}`} style={{ top: `${layout.videoTop + layout.videoHeight}%`, height: `${layout.bottomHeight}%` }}>
        {template.id === "comment-capture"
          ? <div className="h-full bg-[#040404]"><CommentCaptureCard comment={templateCommentSample} /></div>
          : null}
      </div>
      <FixedPresetChannel template={template} />
    </div>
  );
}

function EmptyTemplateCard({ authenticated, canUseCustomTemplates }: { authenticated: boolean; canUseCustomTemplates: boolean }) {
  const href = !authenticated
    ? `/auth/sign-in?next=${encodeURIComponent("/templates/new")}`
    : canUseCustomTemplates ? "/templates/new" : "/pricing";
  return (
    <Link href={href} className="flex min-h-[456px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[.018] px-6 text-center transition duration-300 hover:border-[#ff715e]/50 hover:bg-[#ff715e]/[.035]">
      <span className="grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-[#1f1f22] text-3xl font-light text-neutral-400 shadow-inner" aria-hidden="true">+</span>
      <h2 className="mt-5 text-lg font-bold tracking-[-.025em] text-neutral-200">새 템플릿</h2>
      <p className="mt-2 text-xs font-semibold text-neutral-500">{canUseCustomTemplates ? "빈 화면에서 직접 디자인하기" : "유료 플랜에서 직접 디자인하기"}</p>
    </Link>
  );
}

function CustomTemplatePreview({ template }: { template: CustomTemplate }) {
  return <CustomTemplateCanvasPreview template={template} firstLine="놓치면 후회할" secondLine="핵심 한 가지" channelLabel="Easy Cut" />;
}

export function TemplateLibrary({
  personalTemplates,
  authenticated,
  canUseCustomTemplates,
  adminPresetNamesEnabled,
  initialFavoriteTemplateKeys,
}: {
  personalTemplates: CustomTemplate[];
  authenticated: boolean;
  canUseCustomTemplates: boolean;
  adminPresetNamesEnabled: boolean;
  initialFavoriteTemplateKeys: TemplateFavoriteKey[];
}) {
  const [query, setQuery] = useState("");
  const [favoriteTemplateKeys, setFavoriteTemplateKeys] = useState(initialFavoriteTemplateKeys);
  const [savingTemplateKey, setSavingTemplateKey] = useState<TemplateFavoriteKey | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const favoriteTemplateKeySet = useMemo(() => new Set(favoriteTemplateKeys), [favoriteTemplateKeys]);
  const displayedPresetTemplates = useMemo(() => templates.map((template) => ({
    ...template,
    name: presetTemplateDisplayName(
      template.id,
      template.name,
      adminPresetNamesEnabled,
    ),
    description: presetTemplateDisplayDescription(
      template.id,
      template.description,
      adminPresetNamesEnabled,
    ),
  })), [adminPresetNamesEnabled]);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2_400);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const toggleFavorite = useCallback(async (templateKey: TemplateFavoriteKey) => {
    if (!authenticated) {
      showToast("로그인 후 자주 쓰는 템플릿을 저장할 수 있습니다.");
      return;
    }
    if (savingTemplateKey) return;

    const update = updateFavoriteTemplateKeys(favoriteTemplateKeys, templateKey);
    if (update.status === "limit") {
      showToast("자주 쓰는 템플릿은 최대 4개까지 등록할 수 있습니다.");
      return;
    }

    const previousTemplateKeys = favoriteTemplateKeys;
    setFavoriteTemplateKeys(update.templateKeys);
    setSavingTemplateKey(templateKey);
    try {
      const response = await fetch("/api/template-favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKeys: update.templateKeys }),
      });
      const body = await response.json().catch(() => ({})) as { detail?: string; templateKeys?: TemplateFavoriteKey[] };
      if (!response.ok) throw new Error(body.detail || "자주 쓰는 템플릿을 저장하지 못했습니다.");
      setFavoriteTemplateKeys(body.templateKeys || update.templateKeys);
      showToast(update.status === "added"
        ? "자주 쓰는 템플릿에 등록되었습니다."
        : "자주 쓰는 템플릿에서 해제되었습니다.");
    } catch (error) {
      setFavoriteTemplateKeys(previousTemplateKeys);
      showToast(userFacingErrorMessage(error, "자주 쓰는 템플릿을 저장하지 못했습니다."));
    } finally {
      setSavingTemplateKey(null);
    }
  }, [authenticated, favoriteTemplateKeys, savingTemplateKey, showToast]);

  const visibleTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalizedQuery) return displayedPresetTemplates;
    return displayedPresetTemplates.filter((template) => (
      `${template.name} ${template.description} ${template.category}`
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedQuery)
    ));
  }, [displayedPresetTemplates, query]);
  const visiblePersonalTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalizedQuery) return personalTemplates;
    return personalTemplates.filter((template) => template.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery));
  }, [personalTemplates, query]);

  return (
    <div className="mx-auto w-full max-w-[1040px]">
      <div className="flex flex-col gap-6 border-b border-white/10 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-black tracking-[-.045em] text-[#e4e1e6] sm:text-4xl">템플릿 라이브러리</h1>
          <p className="mt-3 text-sm text-[#94949e] sm:text-base">다음 쇼츠의 시작점을 선택하세요.</p>
        </div>

        <label className="relative block w-full sm:w-64">
          <span className="sr-only">템플릿 검색</span>
          <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-neutral-500">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="템플릿 검색"
            className="h-11 w-full rounded-xl border border-white/10 bg-[#1f1f22] pl-10 pr-4 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-[#ff715e]/70 focus:ring-2 focus:ring-[#ff715e]/10"
          />
        </label>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
        {!query.trim() && <EmptyTemplateCard authenticated={authenticated} canUseCustomTemplates={canUseCustomTemplates} />}
        {visiblePersonalTemplates.map((template) => {
          const templateKey = customTemplateFavoriteKey(template.id);
          return (
            <article key={template.id} className="relative flex min-h-[456px] min-w-0 flex-col rounded-2xl border border-[#ff715e]/25 bg-[rgba(26,26,30,.72)] p-4 shadow-[0_16px_48px_rgba(0,0,0,.18)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-[#ff715e]/50 hover:shadow-[0_20px_55px_rgba(255,113,94,.09)]">
              <Link href={canUseCustomTemplates ? `/templates/${template.id}/edit` : "/pricing"} className="flex flex-1 flex-col">
                <div className="flex flex-1 items-center justify-center px-2 py-4"><CustomTemplatePreview template={template} /></div>
                <div className="flex items-start justify-between gap-4 px-2 pb-1 pt-4"><div className="min-w-0"><h2 className="truncate text-lg font-bold tracking-[-.025em] text-[#e4e1e6]">{template.name}</h2><p className="mt-1 truncate text-xs text-[#777780]">내가 저장한 템플릿</p></div><span className="shrink-0 rounded-full border border-[#ff715e]/20 bg-[#ff715e]/10 px-2.5 py-1 text-[10px] font-bold text-[#ff9b8d]">내 템플릿</span></div>
              </Link>
              <TemplateFavoriteButton
                active={favoriteTemplateKeySet.has(templateKey)}
                busy={savingTemplateKey === templateKey}
                templateName={template.name}
                onClick={() => void toggleFavorite(templateKey)}
              />
            </article>
          );
        })}
        {visibleTemplates.map((template) => {
          const templateKey = presetTemplateFavoriteKey(template.id);
          return (
            <article key={template.id} className="relative flex min-h-[456px] min-w-0 flex-col rounded-2xl border border-white/[.08] bg-[rgba(26,26,30,.72)] p-4 shadow-[0_16px_48px_rgba(0,0,0,.18)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-[#ff715e]/30 hover:shadow-[0_20px_55px_rgba(255,113,94,.09)]">
              <Link
                href={!authenticated
                  ? `/auth/sign-in?next=${encodeURIComponent(`/templates/new?base=${template.id}`)}`
                  : canUseCustomTemplates ? `/templates/new?base=${template.id}` : "/pricing"}
                className="flex flex-1 flex-col"
              >
                <div className="flex flex-1 items-center justify-center px-2 py-4">
                  <TemplatePreview template={template} />
                </div>
                <div className="flex items-start justify-between gap-4 px-2 pb-1 pt-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold tracking-[-.025em] text-[#e4e1e6]">{template.name}</h2>
                    <p className="mt-1 truncate text-xs text-[#777780]">{template.description}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/[.08] bg-[#1f1f22] px-2.5 py-1 text-[10px] font-bold text-[#94949e]">{template.category}</span>
                </div>
              </Link>
              <TemplateFavoriteButton
                active={favoriteTemplateKeySet.has(templateKey)}
                busy={savingTemplateKey === templateKey}
                templateName={template.name}
                onClick={() => void toggleFavorite(templateKey)}
              />
            </article>
          );
        })}
      </div>

      {visibleTemplates.length === 0 && visiblePersonalTemplates.length === 0 && (
        <div className="rounded-2xl border border-white/[.08] bg-white/[.02] px-6 py-16 text-center">
          <p className="font-bold text-neutral-300">검색 결과가 없습니다.</p>
          <button type="button" onClick={() => setQuery("")} className="mt-3 text-sm font-bold text-[#ff9b8d] hover:text-[#ffb4a8]">전체 템플릿 보기</button>
        </div>
      )}
      <TemplateFavoriteToast message={toastMessage} />
    </div>
  );
}
