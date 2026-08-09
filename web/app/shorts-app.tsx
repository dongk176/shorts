"use client";

import { FormEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  PointerEvent,
  PointerEventHandler,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { BackgroundShowcase } from "@/components/background-showcase";
import { CustomTemplateCanvasPreview } from "@/components/custom-template-canvas-preview";
import { CustomTemplateTitlePreview } from "@/components/custom-template-title-preview";
import { DesktopEditorGuide } from "@/components/desktop-editor-guide";
import {
  EditorTextOverlayPreview,
  EditorTextTimeline,
} from "@/components/editor-text-overlay-preview";
import { EstimatedProcessingOverlay, ProjectCard } from "@/components/project-card";
import { ProjectReveal } from "@/components/project-reveal";
import { PaidProjectFeatureOverlay } from "@/components/paid-project-feature-overlay";
import { ProjectActionGuide } from "@/components/project-action-guide";
import {
  ShortsEventParticipationCompleteOverlay,
  ShortsEventWelcomeController,
} from "@/components/shorts-creation-event-overlay";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SourceRangeGuide } from "@/components/source-range-guide";
import { SupportInquiryWidget } from "@/components/support-inquiry-widget";
import { TemplateCommentPreview } from "@/components/template-comment-prototype";
import { TitleOverlayPreview } from "@/components/title-overlay-preview";
import { TransformationShowcase } from "@/components/transformation-showcase";
import { VideoAspectRatioPicker } from "@/components/video-aspect-ratio-picker";
import type {
  CommentOverlay,
  GeneratedShort,
  MvpState,
  OutputLanguage,
  TemplateId,
  TitleTextStyle,
  UsageSnapshot,
  VideoAspectRatio,
  VideoJob,
  YoutubeAnalysis,
} from "@/lib/contracts";
import { expectedShortCount, videoAspectRatioOptions } from "@/lib/contracts";
import { SHOW_MONETIZATION_CONTENT } from "@/lib/content-visibility";
import { SIMULATED_PROGRESS_START } from "@/lib/creation-progress";
import { isPlaybackAvailable, shortPlaybackVersionKey } from "@/lib/project-playback";
import {
  adjustTimedRange,
  clampTimelineSeconds,
  RANGE_EDIT_MIN_SECONDS,
  roundTimelineHandleSeconds,
  scaleTimedRanges,
  snapTimedRangeHandle,
  TIMED_RANGE_SNAP_THRESHOLD_PX,
  type TimedRangeAdjustment,
} from "@/lib/range-editing";
import { userFacingErrorMessage } from "@/lib/public-error";
import { isIosDownloadDevice, shortDownloadFilename } from "@/lib/short-download";
import { stateRetryDelayMs } from "@/lib/state-loading";
import {
  SUBTITLE_TEMPLATE_BRAND_COLOR,
  subtitleTemplateStyleSnapshot,
  subtitleTemplateOptions,
  type SubtitleTemplateId,
} from "@/lib/subtitle-templates";
import { youtubePrivacyEnhancedEmbedUrl } from "@/lib/youtube-embed";
import {
  applyTitleTextStyle,
  codePointOffset,
  defaultTemplateTitleTextStyles,
  rebaseTitleTextStyles,
} from "@/lib/title-text-style";
import { titleLineBackground, titleLineColor, wrapPreviewTitle } from "@/lib/title-preview";
import {
  customCanvasWidth,
  customCenteredLayerStyle,
  customCommentLayerY,
  customVideoFrameStyle,
} from "@/lib/custom-template-preview-layout";
import {
  COMMENT_BACKGROUND_COLOR,
  COMMENT_CAPTURE_LANDSCAPE_LIFT_PX,
  COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y,
  PRESET_SQUARE_CHANNEL_CENTER_Y,
  stockBackgrounds,
  templateConfigSchema,
  templatePresetColorOptions,
  TEMPLATE_CANVAS,
  type CustomTemplate,
} from "@/lib/template-config";
import {
  DEFAULT_FAVORITE_TEMPLATE_KEYS,
  favoriteCustomTemplateId,
  favoritePresetTemplateId,
  type TemplateFavoriteKey,
} from "@/lib/template-favorites";
import {
  COMMENT_CAPTURE_BODY_FONT_CQW,
  COMMENT_LIKE_COUNT_MIN,
  randomCommentLikeCount,
} from "@/lib/comment-overlay";
import { selectRandomFallbackCommentTexts } from "@/lib/fallback-comments";
import {
  createProjectEditRefreshSignal,
  parseProjectEditRefreshSignal,
  PROJECT_EDIT_REFRESH_STORAGE_KEY,
} from "@/lib/project-edit-refresh";
import { markCompletedProjectViewedForFeedback } from "@/lib/project-feedback-client";
import {
  applyEditorFontToSelectableText,
  EDITOR_TEXT_DEFAULT_WIDTH,
  EMPTY_EDITOR_OVERLAY_GUIDES,
  canvasOffsetTranslate,
  clampCanvasDelta,
  clampCenteredOverlayOffsetAfterScale,
  clampEditorTitleFontScale,
  clientDeltaToCanvas,
  clientDistanceToCanvas,
  clientRectToCanvas,
  cloneEditorOverlayLayout,
  consolidateEditorTitleFontScale,
  createEditorTextOverlay,
  createInitialEditorOverlayLayout,
  editorOverlayLayoutsEqual,
  lockEditorTitleHorizontalOffset,
  moveEditorOverlayOrderItem,
  normalizeEditorTitleScaleLayout,
  recordEditorOverlayHistory,
  redoEditorOverlayHistory,
  resetEditorOverlayGeometry,
  resizeCanvasRectFromCorner,
  resizeEditorTextOverlayWidth,
  snapCommentToVideoBottom,
  snapRectCenterToCanvas,
  snapRectToOverlayRects,
  snapResizedCanvasRectToCanvas,
  undoEditorOverlayHistory,
  type CanvasPoint,
  type CanvasRect,
  type EditorCanvasBackground,
  type EditorCommentTheme,
  type EditorOverlayGuides,
  type EditorOverlayHistory,
  type EditorOverlayLayoutSnapshot,
  type EditorOverlayLayer,
  type EditorOverlayOrderItem,
  type EditorTextOverlay,
  type EditorTextResizeEdge,
  type EditorVideoResizeHandle,
} from "@/lib/editor-overlay-preview";
import { editorChannelAssetPreviewUrl } from "@/lib/editor-channel-asset-url";
import {
  DEFAULT_EDITOR_FONT_ID,
  editorFontFamily,
  editorFontOptions,
  type EditorFontId,
} from "@/lib/editor-fonts";
import {
  EDITOR_CHANNEL_PRESET_IMAGE_MAX_LENGTH,
  EDITOR_CHANNEL_PRESET_LIMIT,
  EDITOR_CHANNEL_PRESET_STORAGE_KEY,
  parseEditorChannelPresets,
  serializeEditorChannelPresets,
  type EditorChannelPreset,
} from "@/lib/editor-channel-presets";
import { resolveEditorHistoryShortcut } from "@/lib/editor-history-shortcuts";
import {
  cloneEditorDocumentSnapshot,
  createEditorDocumentSnapshot,
  createEditorDocumentSnapshotV3,
  type EditorDocumentSnapshot,
} from "@/lib/editor-document-snapshot";
import {
  editorDraftDocumentSnapshotSchema,
  editorDocumentSnapshotSchema,
  editorDocumentOutputDuration,
} from "@/lib/editor-document-contract";
import { createEditorRenderSpec } from "@/lib/editor-render-spec";
import { editorSubtitlesForSave } from "@/lib/editor-subtitle-save";
import {
  createEditorDraftRecord,
  deleteEditorDraft,
  editorDraftSavedAgoLabel,
  readEditorDraft,
  subscribeEditorDraftChanges,
  writeEditorDraft,
  type EditorDraftRecord,
} from "@/lib/editor-draft-store";
import { editorVideoUrlRefreshDelay } from "@/lib/editor-video-url-refresh";
import type { EditorReleaseAssignment } from "@/lib/editor-rendering-release";
import { CURRENT_PRESET_TEMPLATE_SNAPSHOT } from "@/lib/edit-template-selection";
import {
  EDITOR_VIDEO_MIN_CLIP_SECONDS,
  canSplitEditorVideoAtTime,
  createEditorVideoClips,
  deleteEditorVideoClip,
  editorVideoClipDuration,
  editorVideoDuration,
  editorVideoOutputTimeForSource,
  locateEditorVideoTime,
  splitEditorVideoAtTime,
  type EditorVideoClip,
} from "@/lib/editor-video-cuts";
import { CENTER_SNAP_THRESHOLD_PX } from "@/lib/template-editor-snap";
import { billingSupportsCustomTemplates } from "@/lib/template-entitlements";
import { currentClientLocale, localizeApiError, localizeAuthError } from "@/lib/i18n/errors";
import { messagesByLocale } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
import { localizedValue } from "@/lib/i18n/config";
import { homeAnalysisHeaderOffset } from "@/lib/home-analysis-scroll";
import { publishUsageSnapshot } from "@/lib/usage-client";
import {
  billableSelectedSourceSeconds,
  MAX_SELECTED_SOURCE_SECONDS,
  MIN_SELECTED_SOURCE_SECONDS,
  parseSourceTimestampInput,
} from "@/lib/source-range";
import { shouldShowLongSourceNotice } from "@/lib/source-video";

const templates: Array<{ id: TemplateId; name: string; label: string; background: string; primary: string; accent: string; accentBackground: string | null; channel: string }> = [
  { id: "comment-capture", name: "댓글 캡처", label: "댓글 반응과 함께\n시청 지속시간 상승", background: COMMENT_BACKGROUND_COLOR, primary: "#FFFFFF", accent: "#35E6E3", accentBackground: null, channel: "#FFFFFF" },
  { id: "dark-red", name: "다크 레드", label: "지금 꼭 알아야 할\n핵심 한 가지", background: "#000000", primary: "#FFFFFF", accent: "#FFFFFF", accentBackground: "#E32626", channel: "#FFFFFF" },
  { id: "white-yellow", name: "화이트 옐로", label: "생각보다 쉬운\n핵심 한 가지", background: "#FFFFFF", primary: "#111111", accent: "#111111", accentBackground: "#FFD84D", channel: "#111111" },
  { id: "dark-minimal", name: "다크 미니멀", label: "놓치기 쉬운\n결정적 순간", background: "#000000", primary: "#FFFFFF", accent: "#F04444", accentBackground: null, channel: "#FFFFFF" },
  { id: "paper", name: "페이퍼", label: "오늘 바로 쓰는\n핵심 방법", background: "#F3F0E9", primary: "#111111", accent: "#D52B2B", accentBackground: null, channel: "#363636" },
];

type FavoriteTemplateCard =
  | { kind: "custom"; template: CustomTemplate }
  | { kind: "preset"; template: (typeof templates)[number] };

type ProjectActionAccess = {
  canEdit: boolean;
  canDownload: boolean;
};

function editableCustomTemplate(item: GeneratedShort): CustomTemplate | null {
  const snapshot = item.templateSnapshot;
  if (
    !item.customTemplateId
    || !snapshot
    || snapshot.baseTemplateId !== item.templateId
    || typeof snapshot.name !== "string"
    || typeof snapshot.version !== "number"
  ) {
    return null;
  }
  const parsedConfig = templateConfigSchema.safeParse(snapshot.config);
  if (!parsedConfig.success) return null;
  return {
    id: item.customTemplateId,
    name: snapshot.name,
    baseTemplateId: item.templateId,
    config: parsedConfig.data,
    version: snapshot.version,
    createdAt: "",
    updatedAt: "",
  };
}

function customTemplateFromEditorDraft(
  document: EditorDocumentSnapshot,
): CustomTemplate | null {
  const snapshot = document.template.snapshot;
  if (
    !document.template.customTemplateId
    || !snapshot
    || snapshot.baseTemplateId !== document.template.id
    || typeof snapshot.name !== "string"
    || typeof snapshot.version !== "number"
  ) {
    return null;
  }
  const parsedConfig = templateConfigSchema.safeParse(snapshot.config);
  if (!parsedConfig.success) return null;
  return {
    id: document.template.customTemplateId,
    name: snapshot.name,
    baseTemplateId: document.template.id,
    config: parsedConfig.data,
    version: snapshot.version,
    createdAt: "",
    updatedAt: "",
  };
}

function customTemplateBackground(template: CustomTemplate) {
  const background = template.config.background;
  if (background.kind === "color") return { backgroundColor: background.color };
  const asset = stockBackgrounds.find((item) => item.id === background.assetId);
  return {
    backgroundImage: `url(${asset?.src || ""})`,
    backgroundPosition: "center",
    backgroundSize: "cover",
  };
}

function editorCanvasBackgroundStyle(background: EditorCanvasBackground) {
  if (background.kind === "color") {
    return { backgroundColor: background.color };
  }
  const asset = stockBackgrounds.find((item) => item.id === background.assetId);
  return {
    backgroundColor: "#111111",
    backgroundImage: `url(${asset?.src || ""})`,
    backgroundPosition: "center",
    backgroundSize: "cover",
  };
}

const titleTextColorOptions = [
  { name: "화이트", color: "#FFFFFF" },
  { name: "블랙", color: "#111111" },
  { name: "댓글 블루", color: "#35E6E3" },
  { name: "선명한 블루", color: "#3B82F6" },
  { name: "레드", color: "#FF4D4F" },
  { name: "옐로", color: "#FFD84D" },
  { name: "라임", color: "#8BFF5A" },
  { name: "오렌지", color: "#FF8A3D" },
  { name: "핑크", color: "#FF65B3" },
  { name: "퍼플", color: "#A78BFA" },
] as const;

const titleBackgroundColorOptions = [
  { name: "차콜", color: "#111111" },
  { name: "화이트", color: "#FFFFFF" },
  { name: "댓글 블루", color: "#35E6E3" },
  { name: "딥 블루", color: "#2563EB" },
  { name: "레드", color: "#E32626" },
  { name: "옐로", color: "#FFD84D" },
  { name: "그린", color: "#16A34A" },
  { name: "오렌지", color: "#F97316" },
  { name: "핑크", color: "#DB2777" },
  { name: "퍼플", color: "#7C3AED" },
] as const;

const commentAvatarColors = ["#8B2CC4", "#D84572", "#2674C8", "#257A5A", "#C76624", "#6655C7"];
const commentNicknamePrefixes = ["하루", "모카", "여름", "초코", "구름", "새벽", "라온", "소담"];
const commentNicknameSuffixes = ["기록", "한스푼", "로그", "이야기", "채널", "노트", "생활", "공간"];

function randomItem<T>(values: T[]) {
  return values[Math.floor(Math.random() * values.length)];
}

function randomComment(
  startSeconds: number,
  endSeconds: number,
  text = selectRandomFallbackCommentTexts(1)[0] || "아 진짜 ㅋㅋㅋㅋㅋㅋㅋㅋ",
): CommentOverlay {
  const nickname = `${randomItem(commentNicknamePrefixes)}${randomItem(commentNicknameSuffixes)}${Math.floor(Math.random() * 90) + 10}`;
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    startSeconds: Math.round(startSeconds * 1000) / 1000,
    endSeconds: Math.round(endSeconds * 1000) / 1000,
    text,
    initial: nickname.slice(0, 1),
    avatarColor: randomItem(commentAvatarColors),
    nickname,
    likeCount: randomCommentLikeCount(),
    ageLabel: `${Math.floor(Math.random() * 11) + 1}개월 전`,
  };
}

function defaultComments(durationSeconds: number) {
  const duration = Math.max(0.3, durationSeconds);
  const commentTexts = selectRandomFallbackCommentTexts(3);
  return [0, 1, 2].map((index) => randomComment(
    duration * index / 3,
    duration * (index + 1) / 3,
    commentTexts[index],
  ));
}

const EDITOR_CHANNEL_PRESET_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const EDITOR_CHANNEL_PRESET_IMAGE_SIZE = 256;

async function createEditorChannelPresetImageDataUrl(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일을 선택해 주세요.");
  }
  if (file.size > EDITOR_CHANNEL_PRESET_MAX_UPLOAD_BYTES) {
    throw new Error("10MB 이하 이미지를 선택해 주세요.");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = document.createElement("img");
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      image.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("이미지 크기를 확인하지 못했습니다.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = EDITOR_CHANNEL_PRESET_IMAGE_SIZE;
    canvas.height = EDITOR_CHANNEL_PRESET_IMAGE_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지를 처리하지 못했습니다.");

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = (image.naturalWidth - sourceSize) / 2;
    const sourceY = (image.naturalHeight - sourceSize) / 2;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const dataUrl = canvas.toDataURL("image/webp", 0.84);
    if (dataUrl.length > EDITOR_CHANNEL_PRESET_IMAGE_MAX_LENGTH) {
      throw new Error("저장하기에는 이미지 용량이 너무 큽니다.");
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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

function aspectLayout(
  value: VideoAspectRatio,
  reserveCommentSpace = false,
  liftLandscapeComment = false,
) {
  const layoutValue = reserveCommentSpace && value === "9:16" ? "4:5" : value;
  const option = videoAspectRatioOptions.find((item) => item.value === layoutValue)
    || videoAspectRatioOptions.find((item) => item.value === "1:1")!;
  const videoHeight = option.height / 19.2;
  const liftPercent = liftLandscapeComment && layoutValue === "16:9"
    ? COMMENT_CAPTURE_LANDSCAPE_LIFT_PX / 19.2
    : 0;
  const videoTop = (100 - videoHeight) / 2 - liftPercent;
  const bottomHeight = 100 - videoTop - videoHeight;
  const fullVertical = layoutValue === "9:16";
  const subtitleMargin = fullVertical
    ? 445
    : 1920 - (Math.round(videoTop * 19.2) + option.height - Math.max(64, Math.round(option.height * 0.08)));
  return {
    option,
    videoHeight,
    videoTop,
    bottomHeight,
    fullVertical,
    subtitleBottom: subtitleMargin / 19.2,
  };
}

const terminalStatuses = new Set(["completed", "failed", "expired", "deleted"]);
const LOGIN_OVERLAY_DELAY_MS = 1_000;
const PROJECT_REVEAL_STORAGE_PREFIX = "easycut:project-reveal:v1:";

function formatDuration(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (hours) return `${hours}시간 ${minutes}분`;
  if (minutes) return `${minutes}분 ${rest}초`;
  return `${rest}초`;
}

function formatTimestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatPreciseTimestamp(seconds: number) {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  const rest = (value % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${rest}`;
}

function formatTimelineOffset(seconds: number) {
  const prefix = seconds < -0.05 ? "−" : seconds > 0.05 ? "+" : "";
  return `${prefix}${formatPreciseTimestamp(Math.abs(seconds))}`;
}

function isProjectExpired(job: VideoJob) {
  return Boolean(job.expiresAt && new Date(job.expiresAt).getTime() <= Date.now());
}

function CountUpNumber({ value, initialValue }: { value: number; initialValue?: number }) {
  const target = Math.max(0, Math.floor(value));
  const startingValue = initialValue === undefined
    ? target > 0 ? 1 : 0
    : Math.max(0, Math.floor(initialValue));
  const [displayedValue, setDisplayedValue] = useState(startingValue);
  const displayedValueRef = useRef(startingValue);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayedValueRef.current = target;
      setDisplayedValue(target);
      return;
    }

    const startValue = displayedValueRef.current;
    const difference = target - startValue;
    if (difference === 0) return;

    let animationFrame = 0;
    const startedAt = performance.now();
    const duration = 1_600;

    const update = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const easedProgress = 1 - Math.pow(1 - progress, 4);
      const nextValue = Math.round(startValue + difference * easedProgress);
      displayedValueRef.current = nextValue;
      setDisplayedValue(nextValue);

      if (progress < 1) animationFrame = window.requestAnimationFrame(update);
    };

    animationFrame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [target]);

  return displayedValue.toLocaleString("ko-KR");
}

const customerReviews = [
  { name: "김지훈", rating: 5, role: "직장인 (부업)", review: "편집 귀찮아서 한 번 써봤는데 진짜 좋긴해요. 댓글 퀄리티가 수정이 조금 필요하긴한데 괜찮은 거 꽤 많이 나옴. 어차피 나중에 수정 가능해서 잘 쓰고 있음요." },
  { name: "Alex_Choi", rating: 5, role: "전업 크리에이터", review: "영상은 그렇다 쳐도 아니 무슨 AI가 드립을 치네요??!ㅋㅋㅋㅋㅋ 실제 댓글보다 재밌어서 좋아요." },
  { name: "이민수", rating: 5, role: "마케터 / 대행사", review: "솔직히 모르고 쇼츠 넘기다 보면 절대 모를 듯;;;" },
  { name: "jay_studio", rating: 5, role: "직장인 (부업)", review: "걍 내 인생 딸깍템임… 추천합니다." },
  { name: "박현우", rating: 5, role: "전업 크리에이터", review: "1달 결제하고 써봤는데, 조회수 바로 터짐 1년결제 합니다요!" },
  { name: "creator_09", rating: 4, role: "마케터 / 대행사", review: "다 좋은데, 댓글 패턴이 살짝 비슷비슷한 느낌? 근데 영상마다는 다르게 만들어줘서 3분 정도만 편집하면 바로 쓸 수 있을 정도." },
  { name: "최유진", rating: 4, role: "전업 크리에이터", review: "영상 퀄리티는 진짜 미쳤는데, 가끔 맥락 못 잡고 헛소리하는 댓글 하나씩 껴있음 ㅋㅋㅋ 그건 제가 알아서 지우고 올립니다." },
  { name: "David.K", rating: 4, role: "직장인 (부업)", review: "진짜 신세계고 편하긴 한데... 구독료가 살짝 부담스럽긴 하네요. ㅠㅠ 그래도 달에 10만원씩은 쓰고 있는데, 쇼츠로 100만 이상은 벌어요 감사합니다." },
  { name: "정성민", rating: 5, role: "영상 편집자", review: "진짜 혼자서 유튜브 채널 3개 거뜬하게 돌릴 수 있음. 영상 생성 속도만 쫌 더 빨라지면 평생 구독 갑니다." },
  { name: "윤서준", rating: 5, role: "직장인 (부업)", review: "댓글 진짜 존나 웃기게 다네 ㅋㅋㅋㅋㅋ 수정이 좀 필요하긴 한데 좋아요." },
  { name: "edit_master", rating: 5, role: "영상 편집자", review: "영상 편집자 해고했습니다. 죄송합니다 ㅎ" },
  { name: "송지아", rating: 4, role: "마케터 / 대행사", review: "와 미쳤다 진짜 ㅋㅋㅋ 근데 자막 폰트 종류 좀 늘려주세요!" },
  { name: "Jason12", rating: 5, role: "직장인 (부업)", review: "쇼츠 외주 주다가 이거 쓰고 돈 굳음요; 진짜 개꿀통." },
  { name: "한동훈", rating: 5, role: "전업 크리에이터", review: "조회수 복사기임 ㄹㅇ 안 쓸 이유가 없음." },
  { name: "임지수", rating: 5, role: "전업 크리에이터", review: "이거 쓰고 첫 쇼츠 50만 찍음 ㅋㅋ 연간 결제 박습니다." },
  { name: "Ryan_Kim", rating: 5, role: "직장인 (부업)", review: "부업으로 쇼츠 채널 2개 돌리는데 달에 150씩 꼬박꼬박 꽂힘. 구독료 뽕 뽑고도 남으니까 돈 안 아까워요." },
  { name: "user_9902", rating: 5, role: "마케터 / 대행사", review: "처음엔 반신반의하면서 한 달만 끊었는데, 영상 하나 터진 걸로 1년 치 구독료 한방에 회수함요. 감사해요 사장님." },
  { name: "오지훈", rating: 5, role: "전업 크리에이터", review: "편집자 동생한테 미안하지만... 걔 월급 줄 돈으로 이거 돌리니까 효율 10배는 나옴요;; 미안하다 고맙다!!!" },
  { name: "Sarah_J", rating: 5, role: "마케터 / 대행사", review: "솔직히 요즘 실시간 트렌드 바로 반영해서 템플릿 짜주는 건 반칙 아닙니까? 다른 숏폼 서비스들 긴장 좀 해야 할 듯." },
  { name: "신영우", rating: 5, role: "전업 크리에이터", review: "와 댓글 창 보고 소름 돋았네;; 이거 AI가 쓴 거 맞음? 릴스에 올렸더니 애들 진짜 사람인 줄 알고 키보드 배틀 뜨고 있음 개웃김 ㅋㅋㅋㅋ" },
  { name: "Emily_Park", rating: 5, role: "전업 크리에이터", review: "솔직히 다른 사람한테 추천 안 할 듯… 내가 다 해먹게..ㅋㅋㅋㅋㅋㅋ" },
] as const;

const monetizationRelatedReviewNames = new Set([
  "user_9902",
  "오지훈",
]);

const visibleCustomerReviews = SHOW_MONETIZATION_CONTENT
  ? customerReviews
  : customerReviews.filter((review) => (
      !review.role.includes("부업")
      && !monetizationRelatedReviewNames.has(review.name)
    ));

const CUSTOMER_REVIEW_SCROLL_PIXELS_PER_SECOND = 60;
const CUSTOMER_REVIEW_DRAG_THRESHOLD_PX = 4;

function CustomerReviews() {
  const { locale } = useI18n();
  const railRef = useRef<HTMLDivElement>(null);
  const interactionActiveRef = useRef(false);
  const pointerTrackingRef = useRef(false);
  const pointerTypeRef = useRef("");
  const dragStartXRef = useRef(0);
  const dragStartScrollLeftRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let previousTime = performance.now();
    let scrollRemainder = 0;
    let initialized = false;

    const normalizePosition = () => {
      const segmentWidth = rail.scrollWidth / 3;
      if (!segmentWidth) return;

      if (!initialized) {
        rail.scrollLeft = segmentWidth;
        initialized = true;
        return;
      }

      if (rail.scrollLeft < segmentWidth * 0.5) {
        rail.scrollLeft += segmentWidth;
      } else if (rail.scrollLeft >= segmentWidth * 1.5) {
        rail.scrollLeft -= segmentWidth;
      }
    };

    const animate = () => {
      const currentTime = performance.now();
      normalizePosition();
      const elapsed = Math.min(currentTime - previousTime, 64);
      previousTime = currentTime;

      if (
        !reducedMotion.matches
        && !interactionActiveRef.current
      ) {
        const distance = scrollRemainder
          + elapsed * CUSTOMER_REVIEW_SCROLL_PIXELS_PER_SECOND / 1_000;
        const wholePixels = Math.floor(distance);
        scrollRemainder = distance - wholePixels;
        rail.scrollLeft += wholePixels;
      }

    };

    const resizeObserver = new ResizeObserver(normalizePosition);
    resizeObserver.observe(rail);
    normalizePosition();
    const timer = window.setInterval(animate, 16);

    return () => {
      window.clearInterval(timer);
      resizeObserver.disconnect();
    };
  }, []);

  const startInteraction = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || event.button !== 0) return;

    pointerTrackingRef.current = true;
    pointerTypeRef.current = event.pointerType;
    dragStartXRef.current = event.clientX;
    dragStartScrollLeftRef.current = rail.scrollLeft;

    if (event.pointerType === "touch") {
      interactionActiveRef.current = true;
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveInteraction = (event: PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail || !pointerTrackingRef.current || pointerTypeRef.current === "touch") return;

    event.preventDefault();
    const deltaX = event.clientX - dragStartXRef.current;
    if (!interactionActiveRef.current && Math.abs(deltaX) >= CUSTOMER_REVIEW_DRAG_THRESHOLD_PX) {
      interactionActiveRef.current = true;
      setDragging(true);
    }
    if (interactionActiveRef.current) {
      rail.scrollLeft = dragStartScrollLeftRef.current - deltaX;
    }
  };

  const finishInteraction = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointerTrackingRef.current) return;
    pointerTrackingRef.current = false;
    pointerTypeRef.current = "";
    interactionActiveRef.current = false;
    setDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section className="customer-reviews-section" aria-labelledby="customer-reviews-title">
      <div className="customer-reviews-inner">
        <div className="customer-reviews-heading">
          <h2 id="customer-reviews-title">{localizedValue(locale, { ko: "사용자 후기", en: "Customer reviews", ja: "ユーザーレビュー" })}</h2>
        </div>
        <div
          id="customer-review-rail"
          ref={railRef}
          className={`customer-review-rail${dragging ? " is-dragging" : ""}`}
          tabIndex={0}
          aria-label={localizedValue(locale, { ko: "자동으로 왼쪽 이동하는 사용자 후기 목록. 좌우로 드래그할 수 있습니다.", en: "Customer reviews move left automatically. Drag sideways to browse.", ja: "自動で左へ移動するユーザーレビューです。左右にドラッグできます。" })}
          onPointerDown={startInteraction}
          onPointerMove={moveInteraction}
          onPointerUp={finishInteraction}
          onPointerCancel={finishInteraction}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="customer-review-track">
            {[0, 1, 2].map((copyIndex) => (
              <div
                key={copyIndex}
                className="customer-review-copy"
                aria-hidden={copyIndex === 1 ? undefined : true}
              >
                {visibleCustomerReviews.map((review) => (
                  <article key={`${copyIndex}-${review.name}`} className="customer-review-card">
                    <div className="customer-review-stars" role="img" aria-label={localizedValue(locale, { ko: `별점 5점 만점에 ${review.rating}점`, en: `${review.rating} out of 5 stars`, ja: `5点満点中${review.rating}点` })}>
                      {[0, 1, 2, 3, 4].map((star) => <span key={star} className={star < review.rating ? "" : "is-empty"} aria-hidden="true">★</span>)}
                    </div>
                    <blockquote>{review.review}</blockquote>
                    <footer>
                      <span className="customer-review-avatar" aria-hidden="true">{review.name.slice(0, 1)}</span>
                      <span>
                        <strong>{review.name}</strong>
                        <small>{localizedValue(locale, {
                          ko: review.role,
                          en: review.role === "전업 크리에이터" ? "Full-time creator" : review.role === "영상 편집자" ? "Video editor" : review.role === "마케터 / 대행사" ? "Marketer / agency" : "Professional with a side project",
                          ja: review.role === "전업 크리에이터" ? "専業クリエイター" : review.role === "영상 편집자" ? "動画編集者" : review.role === "마케터 / 대행사" ? "マーケター／代理店" : "会社員（副業）",
                        })}</small>
                      </span>
                    </footer>
                  </article>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const processSteps: ReadonlyArray<{
  number: string;
  icon: string;
  title: string;
  descriptionLines: readonly string[];
}> = [
  {
    number: "01",
    icon: "↗",
    title: "링크 복사 및 붙여넣기",
    descriptionLines: [
      "쇼츠로 만들고 싶은 유튜브 영상 링크를 복사해 붙여넣으세요.",
      "긴 영상일수록 더 많은 하이라이트를 찾을 수 있어요.",
    ],
  },
  {
    number: "02",
    icon: "✦",
    title: "AI가 하이라이트 추출",
    descriptionLines: [
      "AI가 가장 바이럴 터질만한 구간을 찾아냅니다.",
      "후킹 제목과 자막, 댓글까지 알아서 완성해드려요.",
    ],
  },
  {
    number: "03",
    icon: "⇩",
    title: "자유롭게 편집하고 다운로드",
    descriptionLines: [
      "완성된 쇼츠를 미리 확인하고 원하는 대로 편집한 뒤,",
      "유튜브 쇼츠·릴스·틱톡에 바로 활용하세요.",
    ],
  },
];

function ThreeStepProcess() {
  const { locale } = useI18n();
  const localizedSteps = localizedValue(locale, {
    ko: processSteps,
    en: [
      { number: "01", icon: "↗", title: "Copy and paste a link", descriptionLines: ["Paste the YouTube video link you want to turn into Shorts.", "Longer videos can provide more highlights."] },
      { number: "02", icon: "✦", title: "AI extracts highlights", descriptionLines: ["AI finds the moments most likely to go viral.", "Hook titles, captions, and comments are created for you."] },
      { number: "03", icon: "⇩", title: "Edit freely and download", descriptionLines: ["Preview the finished Shorts and edit them your way,", "then publish to YouTube Shorts, Reels, or TikTok."] },
    ],
    ja: [
      { number: "01", icon: "↗", title: "リンクをコピー＆貼り付け", descriptionLines: ["ショート動画にしたいYouTube動画のリンクを貼り付けます。", "長い動画ほど多くのハイライトを見つけられます。"] },
      { number: "02", icon: "✦", title: "AIがハイライトを抽出", descriptionLines: ["AIがバズりやすい場面を見つけます。", "フックタイトル、字幕、コメントまで自動で仕上げます。"] },
      { number: "03", icon: "⇩", title: "自由に編集してダウンロード", descriptionLines: ["完成したショート動画を確認して自由に編集し、", "YouTube Shorts・Reels・TikTokですぐに活用できます。"] },
    ],
  });
  return (
    <section className="three-step-process-section" aria-labelledby="three-step-process-title">
      <div className="three-step-process-inner">
        <div className="three-step-process-heading">
          <h2 id="three-step-process-title">{localizedValue(locale, { ko: "3단계로 끝나는 과정", en: "Done in three steps", ja: "3ステップで完成" })}</h2>
          <p>{localizedValue(locale, { ko: "유튜브 링크 하나면 충분합니다. AI가 가장 빛나는 1분을 찾아드려요.", en: "One YouTube link is all you need. AI finds the best minute.", ja: "YouTubeリンクひとつで十分です。AIが最も輝く1分を見つけます。" })}</p>
        </div>

        <ol className="process-step-list">
          {localizedSteps.map((step, index) => (
            <li key={step.number} className={`process-step process-step-${index + 1}`}>
              <div className="process-step-orb" aria-hidden="true">
                <span className="process-step-badge">STEP {step.number}</span>
                <span className="process-step-icon">{step.icon}</span>
              </div>
              <div className="process-step-copy">
                <h3>{step.title}</h3>
                <p>
                  {step.descriptionLines.map((line) => <span key={line} className="block">{line}</span>)}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="three-step-process-cta">
          <Link href="/pricing">{localizedValue(locale, { ko: "지금 시작하기", en: "Get started", ja: "今すぐ始める" })}</Link>
          <p><span aria-hidden="true">✓</span> {localizedValue(locale, { ko: "월 9,900원부터 시작 · 언제든 해지 가능", en: "From ₩9,900/month · Cancel anytime", ja: "月額₩9,900から・いつでも解約可能" })}</p>
        </div>
      </div>
    </section>
  );
}

function ChannelAvatar({
  url,
  className,
  fallbackForeground,
  fallbackBackground,
  sizes,
}: {
  url: string | null;
  className: string;
  fallbackForeground: string;
  fallbackBackground: string;
  sizes: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(url && failedUrl !== url);
  return (
    <span
      className={`relative shrink-0 overflow-hidden rounded-full ${className}`}
      style={{ background: fallbackForeground }}
      aria-hidden="true"
    >
      {showImage && url
        ? <Image src={url} alt="" fill sizes={sizes} unoptimized className="object-cover" onError={() => setFailedUrl(url)} />
        : <><span className="absolute left-1/2 top-[20%] h-[35%] w-[35%] -translate-x-1/2 rounded-full" style={{ background: fallbackBackground }} /><span className="absolute bottom-[10%] left-1/2 h-[35%] w-[62%] -translate-x-1/2 rounded-t-full" style={{ background: fallbackBackground }} /></>}
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

function formatCompactKoreanCount(value: number) {
  const compact = (amount: number) => Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
  if (value >= 10_000) return `${compact(Math.floor(value / 1_000) / 10)}만`;
  if (value >= 1_000) return `${compact(Math.floor(value / 100) / 10)}천`;
  return value.toLocaleString("ko-KR");
}

function CommentCaptureCard({
  comment,
  theme = "dark",
}: {
  comment: CommentOverlay | null;
  theme?: EditorCommentTheme;
}) {
  const dark = theme === "dark";
  const foreground = dark ? "#f5f5f6" : "#18181b";
  const muted = dark ? "#a3a3aa" : "#6b6b73";
  return (
    <div
      className="w-full pb-[0.6cqw] pl-[4.4cqw] pr-[2.8cqw] pt-[4.5cqw] text-left"
      style={{ backgroundColor: dark ? "#040404" : "#ffffff", color: foreground }}
    >
      {comment ? <div className="flex items-start gap-[2.7cqw]">
        <div className="grid h-[8.6cqw] w-[8.6cqw] shrink-0 place-items-center rounded-full text-[3.7cqw] font-bold text-white blur-[0.65cqw]" style={{ background: comment.avatarColor }}>{comment.initial}</div>
        <div className="min-w-0 flex-1">
          <div className="w-fit max-w-[74cqw] truncate text-[3.45cqw] font-bold leading-tight blur-[0.52cqw]" style={{ color: foreground }}>@{comment.nickname} <span className="font-normal" style={{ color: muted }}>{comment.ageLabel}</span></div>
          <p className="mt-[1.5cqw] line-clamp-2 whitespace-pre-wrap font-normal leading-[1.28] blur-[0.05cqw]" style={{ color: foreground, fontSize: `${COMMENT_CAPTURE_BODY_FONT_CQW}cqw` }}>{comment.text}</p>
          <div className="mt-[2.1cqw] flex items-center gap-[1.25cqw] text-[3.4cqw] blur-[0.035cqw]" style={{ color: muted }}>
            <ReactionIcon /><span>{formatCompactKoreanCount(comment.likeCount)}</span>
            <span className="ml-[2.2cqw]"><ReactionIcon down /></span>
            <span className="ml-[3cqw] text-[3.25cqw]">답글</span>
          </div>
        </div>
      </div> : null}
    </div>
  );
}

function CommentCaptureChannel({
  channelName,
  channelThumbnailUrl,
  fixedCenterY,
  fontFamily,
  fontWeight,
  selected = false,
  movementStyle,
  onPointerDown,
}: {
  channelName: string;
  channelThumbnailUrl: string | null;
  fixedCenterY?: number;
  fontFamily?: string;
  fontWeight?: number;
  selected?: boolean;
  movementStyle?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  const content = <>
    <ChannelAvatar
      url={channelThumbnailUrl}
      className="h-[6.1cqw] w-[6.1cqw]"
      fallbackForeground="#FFFFFF"
      fallbackBackground={COMMENT_BACKGROUND_COLOR}
      sizes="10px"
    />
    <span className="max-w-[70cqw] truncate">{channelName}</span>
  </>;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center text-[4.2cqw] font-semibold text-white"
      style={fixedCenterY === undefined
        ? { bottom: "13.5cqw", fontFamily, fontWeight, zIndex: movementStyle?.zIndex }
        : {
            top: `${fixedCenterY / 19.2}%`,
            fontFamily,
            fontWeight,
            transform: "translateY(-50%)",
            zIndex: movementStyle?.zIndex,
          }}
    >
      {onPointerDown
        ? <button
            type="button"
            data-editor-overlay-layer="channel"
            aria-label="채널명 오버레이 선택 및 이동"
            aria-pressed={selected}
            onPointerDown={onPointerDown}
            className={`pointer-events-auto flex cursor-move touch-none appearance-none items-center justify-center gap-[2.4cqw] border-0 bg-transparent px-[4.9cqw] text-inherit ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
            style={movementStyle}
          >
            {content}
          </button>
        : <div className="flex items-center justify-center gap-[2.4cqw] px-[4.9cqw]">{content}</div>}
    </div>
  );
}

function FixedPresetChannel({
  channelName,
  channelThumbnailUrl,
  foreground,
  background,
  fontFamily,
  fontWeight,
  selected = false,
  movementStyle,
  onPointerDown,
}: {
  channelName: string;
  channelThumbnailUrl: string | null;
  foreground: string;
  background: string;
  fontFamily?: string;
  fontWeight?: number;
  selected?: boolean;
  movementStyle?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  const content = <>
    <ChannelAvatar
      url={channelThumbnailUrl}
      className="h-[6.1cqw] w-[6.1cqw]"
      fallbackForeground={foreground}
      fallbackBackground={background}
      sizes="10px"
    />
    <span className="max-w-[70cqw] truncate">{channelName}</span>
  </>;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center text-[4.2cqw] font-semibold"
      style={{
        top: `${PRESET_SQUARE_CHANNEL_CENTER_Y / 19.2}%`,
        color: foreground,
        fontFamily,
        fontWeight,
        transform: "translateY(-50%)",
        zIndex: movementStyle?.zIndex,
      }}
    >
      {onPointerDown
        ? <button
            type="button"
            data-editor-overlay-layer="channel"
            aria-label="채널명 오버레이 선택 및 이동"
            aria-pressed={selected}
            onPointerDown={onPointerDown}
            className={`pointer-events-auto flex cursor-move touch-none appearance-none items-center justify-center gap-[2.4cqw] border-0 bg-transparent px-[4.9cqw] text-inherit ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
            style={movementStyle}
          >
            {content}
          </button>
        : <div className="flex items-center justify-center gap-[2.4cqw] px-[4.9cqw]">{content}</div>}
    </div>
  );
}

function CustomEditorChannel({
  template,
  channelName,
  channelThumbnailUrl,
  fontFamily,
  fontWeight,
  selected = false,
  forceVisible = false,
  movementStyle,
  onPointerDown,
}: {
  template: CustomTemplate;
  channelName: string;
  channelThumbnailUrl: string | null;
  fontFamily?: string;
  fontWeight?: number;
  selected?: boolean;
  forceVisible?: boolean;
  movementStyle?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  const channel = template.config.channel;
  if (!channel.visible && !forceVisible) return null;
  const style = {
    ...customCenteredLayerStyle(channel),
    color: channel.color,
    backgroundColor: channel.backgroundColor || "transparent",
    fontFamily,
    fontWeight,
    fontSize: customCanvasWidth(channel.fontSize),
    ...movementStyle,
  };
  const content = <>
    <ChannelAvatar
      url={channelThumbnailUrl}
      className="h-[5.4cqw] w-[5.4cqw]"
      fallbackForeground={channel.color}
      fallbackBackground={channel.backgroundColor || "#111111"}
      sizes="20px"
    />
    <span className="truncate">{channelName}</span>
  </>;
  if (onPointerDown) {
    return (
      <button
        type="button"
        data-editor-overlay-layer="channel"
        aria-label="채널명 오버레이 선택 및 이동"
        aria-pressed={selected}
        onPointerDown={onPointerDown}
        className={`absolute z-30 flex cursor-move touch-none appearance-none items-center justify-center gap-[2cqw] truncate rounded border-0 px-[1.5cqw] py-[.7cqw] text-center font-bold ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
        style={style}
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className="absolute z-30 flex items-center justify-center gap-[2cqw] truncate rounded px-[1.5cqw] py-[.7cqw] text-center font-bold"
      style={style}
    >
      {content}
    </div>
  );
}

function PresetInlineEditorChannel({
  channelName,
  channelThumbnailUrl,
  foreground,
  background,
  fontFamily,
  fontWeight,
  selected = false,
  movementStyle,
  onPointerDown,
}: {
  channelName: string;
  channelThumbnailUrl: string | null;
  foreground: string;
  background: string;
  fontFamily?: string;
  fontWeight?: number;
  selected?: boolean;
  movementStyle?: CSSProperties;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
}) {
  const content = <>
    <ChannelAvatar
      url={channelThumbnailUrl}
      className="mt-0.5 h-5 w-5"
      fallbackForeground={foreground}
      fallbackBackground={background}
      sizes="20px"
    />
    <span className="max-w-[72%] truncate">{channelName}</span>
  </>;
  if (!onPointerDown) {
    return <div className="flex items-start justify-center gap-2" style={{ fontFamily, fontWeight }}>{content}</div>;
  }
  return (
    <button
      type="button"
      data-editor-overlay-layer="channel"
      aria-label="채널명 오버레이 선택 및 이동"
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      className={`relative mx-auto flex w-fit cursor-move touch-none appearance-none items-start justify-center gap-2 border-0 bg-transparent p-0 text-inherit ${selected ? "outline outline-2 outline-[#ff715e]" : ""}`}
      style={{ ...movementStyle, fontFamily, fontWeight }}
    >
      {content}
    </button>
  );
}

function EditorFontPicker({
  value,
  onChange,
}: {
  value: EditorFontId;
  onChange: (fontId: EditorFontId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(
    0,
    editorFontOptions.findIndex((font) => font.id === value),
  ));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pickerId = useId();
  const labelId = `${pickerId}-label`;
  const listboxId = `${pickerId}-listbox`;
  const selectedFont = editorFontOptions.find((font) => font.id === value)
    || editorFontOptions[0];

  const closePicker = (restoreTriggerFocus = false) => {
    setOpen(false);
    if (restoreTriggerFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const focusOption = (index: number) => {
    const nextIndex = (
      index + editorFontOptions.length
    ) % editorFontOptions.length;
    setActiveIndex(nextIndex);
    window.requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());
  };

  const openPicker = (index = editorFontOptions.findIndex(
    (font) => font.id === value,
  )) => {
    const nextIndex = (
      index + editorFontOptions.length
    ) % editorFontOptions.length;
    setOpen(true);
    focusOption(nextIndex);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node
        && !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener(
      "pointerdown",
      closeOnOutsidePointer,
    );
  }, [open]);

  return (
    <div className="editor-font-setting">
      <span id={labelId}>폰트</span>
      <div
        ref={rootRef}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node
            && event.currentTarget.contains(event.relatedTarget)
          ) {
            return;
          }
          setOpen(false);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape" && open) {
            event.preventDefault();
            closePicker(true);
          }
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          className="editor-font-picker-trigger"
          aria-labelledby={labelId}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-expanded={open}
          onClick={() => {
            if (open) {
              closePicker();
              return;
            }
            openPicker();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const selectedIndex = editorFontOptions.findIndex(
                (font) => font.id === value,
              );
              openPicker(selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
            }
          }}
          style={{ fontFamily: selectedFont.family }}
        >
          <span>{selectedFont.label}</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <path
              d="m6 8 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {open && <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className="editor-font-picker-menu"
        >
          {editorFontOptions.map((font, index) => (
            <button
              key={font.id}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={font.id === value}
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={() => {
                onChange(font.id);
                closePicker(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  focusOption(activeIndex + (
                    event.key === "ArrowDown" ? 1 : -1
                  ));
                  return;
                }
                if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  focusOption(event.key === "Home"
                    ? 0
                    : editorFontOptions.length - 1);
                }
              }}
              style={{ fontFamily: font.family }}
            >
              <span>{font.label}</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path
                  d="m5 10 3 3 7-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
        </div>}
      </div>
    </div>
  );
}

function TemplatePreview({ template, videoAspectRatio, channelName, channelThumbnailUrl }: { template: (typeof templates)[number]; videoAspectRatio: VideoAspectRatio; channelName: string; channelThumbnailUrl: string | null }) {
  const [firstLine, secondLine] = template.label.split("\n");
  const isLight = template.id === "white-yellow" || template.id === "paper";
  const foreground = isLight ? "text-black" : "text-white";
  const layout = aspectLayout(
    videoAspectRatio,
    template.id === "comment-capture",
    template.id === "comment-capture",
  );
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
    >
      <div data-template-title className={`absolute inset-x-0 z-10 flex flex-col items-center justify-end px-[4.9cqw] text-center text-[6.7cqw] font-extrabold leading-[1.25] ${layout.option.value === "4:5" ? "pb-[1.2cqw]" : "pb-[4.9cqw]"}`} style={layout.fullVertical ? { top: "5%", height: "18.75%" } : { top: 0, height: `${layout.videoTop}%` }}>
        {previewLine(firstLine, 0)}
        {previewLine(secondLine, 1)}
      </div>
      <div className={`absolute inset-x-0 flex items-center justify-center overflow-hidden ${isLight ? "bg-neutral-300" : "bg-neutral-700"}`} style={{ top: `${layout.videoTop}%`, height: `${layout.videoHeight}%` }}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
        <div className={`h-[22cqw] w-[22cqw] rounded-full border-2 ${isLight ? "border-neutral-500" : "border-neutral-400"}`} aria-hidden="true" />
      </div>
      <div className={`absolute inset-x-0 z-10 overflow-hidden text-[5.5cqw] font-semibold ${template.id === "paper" ? "text-neutral-700" : ""}`} style={layout.fullVertical ? { bottom: "6.25%", height: "9.375%" } : { top: `${layout.videoTop + layout.videoHeight}%`, height: `${layout.bottomHeight}%` }}>
        {template.id === "comment-capture"
          ? <div className="h-full bg-[#040404]"><CommentCaptureCard comment={templateCommentSample} /></div>
          : null}
      </div>
      {template.id === "comment-capture"
        ? <CommentCaptureChannel channelName={channelName} channelThumbnailUrl={channelThumbnailUrl} fixedCenterY={COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y} />
        : <FixedPresetChannel channelName={channelName} channelThumbnailUrl={channelThumbnailUrl} foreground={template.channel} background={template.background} />}
    </div>
  );
}

function CustomHomeTemplatePreview({ template }: { template: CustomTemplate }) {
  return <CustomTemplateCanvasPreview template={template} firstLine="AI가 만든 제목" secondLine="핵심 포인트" channelLabel="채널 이름" />;
}

function SubtitleTemplatePreview({
  id,
  videoAspectRatio,
  channelName,
  channelThumbnailUrl,
}: {
  id: SubtitleTemplateId;
  videoAspectRatio: VideoAspectRatio;
  channelName: string;
  channelThumbnailUrl: string | null;
}) {
  const snapshot = subtitleTemplateStyleSnapshot(id, videoAspectRatio);
  const layout = snapshot.layout;
  const canvasCqw = (pixels: number) => `${pixels / 10.8}cqw`;
  const rectStyle = (rect: { x: number; y: number; width: number; height: number }) => ({
    left: `${rect.x / 10.8}%`,
    top: `${rect.y / 19.2}%`,
    width: `${rect.width / 10.8}%`,
    height: `${rect.height / 19.2}%`,
  });
  const outline = {
    WebkitTextStroke: `${canvasCqw(snapshot.outlinePx)} #080808`,
    paintOrder: "stroke fill",
  } satisfies CSSProperties;
  return (
    <div
      className="relative mx-auto aspect-[9/16] w-full max-w-[150px] overflow-hidden rounded-[10px] bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]"
      style={{ containerType: "inline-size" }}
    >
      <div
        className="absolute z-20 flex flex-col items-center justify-end text-center font-black leading-none"
        style={{
          ...rectStyle(layout.title),
          gap: canvasCqw(snapshot.title.lineGapPx),
          paddingBottom: canvasCqw(snapshot.title.bottomMarginPx),
          fontSize: canvasCqw(snapshot.title.fontSizePx),
          color: snapshot.title.firstLineColor,
        }}
      >
        <span className="block">AI가 고른 오늘의</span>
        <span className="block" style={{ color: snapshot.title.secondLineColor }}>핵심 장면</span>
      </div>
      <div className="absolute overflow-hidden bg-gradient-to-br from-neutral-600 via-neutral-800 to-neutral-950" style={rectStyle(layout.video)}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
      </div>
      <div
        className="absolute z-20 flex items-center justify-center overflow-hidden text-center font-black leading-none text-white"
        style={{
          ...rectStyle(layout.caption),
          ...outline,
          fontFamily: '"Editor Pretendard", sans-serif',
          fontSize: canvasCqw(snapshot.font.sizePx),
        }}
      >
          {id === "highlight" && (
            <span className="whitespace-nowrap">
              이게 바로 <span style={{ color: SUBTITLE_TEMPLATE_BRAND_COLOR }}>자막입니다</span>
            </span>
          )}
          {id === "pop" && (
            <span
              className="inline-flex items-center whitespace-nowrap"
              style={{
                gap: canvasCqw(snapshot.wordGapPx),
              }}
            >
              <span
                style={{
                  color: SUBTITLE_TEMPLATE_BRAND_COLOR,
                  fontSize: canvasCqw(snapshot.font.sizePx * snapshot.popScale),
                }}
              >자막</span>
              <span>입니다</span>
            </span>
          )}
      </div>
      <div
        className="absolute z-20 flex items-center justify-center font-bold text-white"
        style={{
          ...rectStyle(layout.channel),
          gap: canvasCqw(snapshot.channel.gapPx),
          fontSize: canvasCqw(snapshot.channel.fontSizePx),
        }}
      >
        <span
          className="shrink-0 rounded-full bg-white bg-cover bg-center"
          style={{
            width: canvasCqw(snapshot.channel.iconSizePx),
            height: canvasCqw(snapshot.channel.iconSizePx),
            ...(channelThumbnailUrl ? { backgroundImage: `url(${channelThumbnailUrl})` } : {}),
          }}
          aria-hidden="true"
        />
        <span className="max-w-[75%] truncate">{channelName.trim() || "YouTube 채널"}</span>
      </div>
    </div>
  );
}

function TemplatePicker({
  value,
  onChange,
  videoAspectRatio,
  onVideoAspectRatioChange,
  channelName,
  channelThumbnailUrl,
  personalTemplates,
  favoriteTemplateKeys,
  customTemplateId,
  onCustomTemplateChange,
  canUseCustomTemplates,
  subtitleTemplateSelectionEnabled,
  subtitleTemplateId,
  onSubtitleTemplateChange,
}: {
  value: TemplateId;
  onChange: (value: TemplateId) => void;
  videoAspectRatio: VideoAspectRatio;
  onVideoAspectRatioChange: (value: VideoAspectRatio) => void;
  channelName: string;
  channelThumbnailUrl: string | null;
  personalTemplates: CustomTemplate[];
  favoriteTemplateKeys: TemplateFavoriteKey[];
  customTemplateId: string | null;
  onCustomTemplateChange: (template: CustomTemplate | null) => void;
  canUseCustomTemplates: boolean;
  subtitleTemplateSelectionEnabled: boolean;
  subtitleTemplateId: SubtitleTemplateId | null;
  onSubtitleTemplateChange: (value: SubtitleTemplateId | null) => void;
}) {
  const usablePersonalTemplates = canUseCustomTemplates ? personalTemplates : [];
  const selectedCustom = usablePersonalTemplates.find((template) => template.id === customTemplateId);
  const selectedTemplate = templates.find((template) => template.id === value) || templates[0];
  const selectedSubtitleTemplate = subtitleTemplateOptions.find((template) => template.id === subtitleTemplateId);
  const effectiveAspectRatio = selectedCustom?.config.video.aspectRatio ?? videoAspectRatio;
  const disabledPresetRatios: VideoAspectRatio[] = !selectedCustom && value === "comment-capture"
    ? ["4:5", "9:16"]
    : [];
  const favoriteCards = favoriteTemplateKeys.flatMap<FavoriteTemplateCard>((templateKey) => {
    const customId = favoriteCustomTemplateId(templateKey);
    if (customId) {
      const template = usablePersonalTemplates.find((item) => item.id === customId);
      return template ? [{ kind: "custom" as const, template }] : [];
    }
    const presetId = favoritePresetTemplateId(templateKey);
    if (!presetId) return [];
    const template = templates.find((item) => item.id === presetId);
    return template ? [{ kind: "preset" as const, template }] : [];
  });
  const favoriteCustomIds = new Set(favoriteCards.flatMap((card) => card.kind === "custom" ? [card.template.id] : []));
  const remainingPersonalTemplates = usablePersonalTemplates.filter((template) => !favoriteCustomIds.has(template.id));
  return (
    <div id="template-picker">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">템플릿</h2>
          <span className="text-xs font-semibold text-red-300">{selectedSubtitleTemplate?.name || selectedCustom?.name || selectedTemplate.name}</span>
        </div>
        <VideoAspectRatioPicker
          value={effectiveAspectRatio}
          lockedValue={selectedCustom?.config.video.aspectRatio}
          disabledValues={disabledPresetRatios}
          disabledReason={disabledPresetRatios.length ? "기본 댓글 템플릿에서는 세로형과 세로 꽉참 비율을 사용할 수 없어요. 내 템플릿에서는 모든 비율을 사용할 수 있습니다." : undefined}
          onChange={onVideoAspectRatioChange}
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {favoriteCards.map((card) => {
          if (card.kind === "custom") {
            const selected = !subtitleTemplateId && customTemplateId === card.template.id;
            return <button key={`favorite-custom-${card.template.id}`} type="button" aria-pressed={selected} onClick={() => onCustomTemplateChange(card.template)} className={`rounded-xl border-2 bg-[rgba(26,26,30,.72)] p-2.5 backdrop-blur-xl transition ${selected ? "border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]" : "border-white/10 hover:border-white/30"}`}><CustomHomeTemplatePreview template={card.template} /><span className="mt-2.5 block truncate text-center text-sm font-semibold">{card.template.name}</span><span className="mt-1 block text-center text-[10px] font-bold text-[#ff9b8d]">자주 쓰는 내 템플릿</span></button>;
          }
          const selected = !subtitleTemplateId && !customTemplateId && value === card.template.id;
          return (
            <button
              key={`favorite-preset-${card.template.id}`}
              type="button"
              aria-pressed={selected}
              onClick={() => { onCustomTemplateChange(null); onChange(card.template.id); }}
              className={`rounded-xl border-2 bg-[rgba(26,26,30,.72)] p-2.5 backdrop-blur-xl transition ${selected ? "border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]" : "border-white/10 hover:border-white/30"}`}
            >
              <TemplatePreview template={card.template} videoAspectRatio={effectiveAspectRatio} channelName={channelName} channelThumbnailUrl={channelThumbnailUrl} />
              <span className="mt-2.5 block text-center text-sm font-semibold">{card.template.name}</span>
            </button>
          );
        })}
        {remainingPersonalTemplates.map((template) => {
          const selected = !subtitleTemplateId && customTemplateId === template.id;
          return <button key={template.id} type="button" aria-pressed={selected} onClick={() => onCustomTemplateChange(template)} className={`rounded-xl border-2 bg-[rgba(26,26,30,.72)] p-2.5 backdrop-blur-xl transition ${selected ? "border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]" : "border-white/10 hover:border-white/30"}`}><CustomHomeTemplatePreview template={template} /><span className="mt-2.5 block truncate text-center text-sm font-semibold">{template.name}</span><span className="mt-1 block text-center text-[10px] font-bold text-[#ff9b8d]">내 템플릿</span></button>;
        })}
      </div>
      {subtitleTemplateSelectionEnabled && (
        <section className="mt-8" aria-labelledby="subtitle-template-test-heading">
          <div className="flex items-center gap-2">
            <h3 id="subtitle-template-test-heading" className="text-base font-extrabold text-white">자막 템플릿 · 테스트</h3>
            <span className="rounded-full border border-[#ff715e]/30 bg-[#ff715e]/10 px-2 py-1 text-[10px] font-black text-[#ff9b8d]">어드민</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-neutral-400">영상 안쪽 안전영역에 자막이 완성된 형태로 적용됩니다.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {subtitleTemplateOptions.map((option) => {
              const selected = subtitleTemplateId === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onCustomTemplateChange(null);
                    onSubtitleTemplateChange(option.id);
                  }}
                  className={`rounded-xl border-2 bg-[rgba(26,26,30,.72)] p-2.5 text-left backdrop-blur-xl transition ${selected ? "border-[#ff715e] shadow-[0_0_0_3px_rgba(255,113,94,.14)]" : "border-white/10 hover:border-white/30"}`}
                >
                  <SubtitleTemplatePreview
                    id={option.id}
                    videoAspectRatio={effectiveAspectRatio}
                    channelName={channelName}
                    channelThumbnailUrl={channelThumbnailUrl}
                  />
                  <span className="mt-2.5 block text-center text-sm font-extrabold text-white">{option.name}</span>
                  <span className="mt-1 block text-center text-[11px] leading-4 text-neutral-400">{option.description}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {!subtitleTemplateId && !customTemplateId && value === "comment-capture" && (
        <p className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[.06] px-4 py-3 text-sm text-cyan-100">
          AI가 실제 사람이 작성한 것처럼 자연스러운 댓글을 만들어줘요.
        </p>
      )}
      {!canUseCustomTemplates && personalTemplates.length > 0 && (
        <p className="mt-3 rounded-xl border border-[#ff9b8d]/15 bg-[#ff715e]/[.05] px-4 py-3 text-sm text-[#ffc0b7]">
          저장한 커스텀 템플릿은 유료 이용권에서 사용할 수 있어요. <Link href="/pricing" className="font-black underline underline-offset-2">요금제 보기</Link>
        </p>
      )}
    </div>
  );
}

class HttpRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = "HttpRequestError";
  }
}

async function requestJson<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = timeoutMs === undefined
    ? undefined
    : window.setTimeout(() => controller.abort(new DOMException("요청 시간 초과", "TimeoutError")), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    const locale = currentClientLocale();
    throw new Error(locale === "ko"
      ? controller.signal.aborted
        ? "응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
        : "서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요."
      : messagesByLocale[locale]["error.HTTP_503"]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string; code?: string };
    throw new HttpRequestError(
      response.status,
      localizeApiError(body, response.status, currentClientLocale()),
      body.code,
    );
  }
  return response.json() as Promise<T>;
}

function NoticeDialog({
  open,
  dialogId,
  title,
  description,
  variant = "danger",
  confirmLabel = "확인",
  onClose,
}: {
  open: boolean;
  dialogId: string;
  title: string;
  description?: string;
  variant?: "danger" | "info";
  confirmLabel?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;
  const info = variant === "info";
  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[4px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${dialogId}-title`}
        aria-describedby={description ? `${dialogId}-description` : undefined}
        className={`relative w-full max-w-[480px] overflow-hidden rounded-[24px] border px-7 pb-8 pt-10 text-center shadow-[0_28px_90px_rgba(0,0,0,.68)] sm:px-9 sm:pb-9 ${info ? "border-violet-400/20 bg-[#24222b]" : "border-red-400/20 bg-[#272123]"}`}
      >
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-16 -top-24 h-40 rounded-full blur-3xl ${info ? "bg-violet-500/15" : "bg-red-500/15"}`} />
        <div aria-hidden="true" className={`relative mx-auto grid h-12 w-12 place-items-center rounded-full border text-2xl ${info ? "border-violet-300/20 bg-violet-500/10 text-violet-200" : "border-red-300/20 bg-red-500/10 text-red-200"}`}>{info ? "i" : "!"}</div>
        <h2 id={`${dialogId}-title`} className="relative mt-5 whitespace-pre-line text-2xl font-extrabold tracking-[-0.025em] text-white">
          {title}
        </h2>
        {description && <p id={`${dialogId}-description`} className={`relative mt-4 text-sm leading-6 ${info ? "text-violet-100/80" : "text-red-100/80"}`}>
          {description}
        </p>}
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="relative mt-8 min-h-12 w-full rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-black transition hover:bg-neutral-100 active:scale-[.99]"
        >
          {confirmLabel}
        </button>
      </section>
    </div>,
    document.body,
  );
}

function EditorDraftEntryDialog({
  draft,
  onContinue,
  onStartNew,
  onClose,
}: {
  draft: EditorDraftRecord | null;
  onContinue: () => void;
  onStartNew: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!draft) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [draft, onClose]);

  if (!draft || typeof document === "undefined") return null;
  const updatedAt = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(draft.updatedAt));
  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[5px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-draft-entry-title"
        aria-describedby="editor-draft-entry-description"
        className="relative w-full max-w-[380px] overflow-hidden rounded-[26px] border border-white/10 bg-[#151519] px-7 pb-7 pt-10 text-white shadow-[0_30px_100px_rgba(0,0,0,.72)] sm:px-8 sm:pb-8 sm:pt-11"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 z-10 rounded-md px-2 py-1 text-[12px] font-bold text-white/40 transition hover:bg-white/[.06] hover:text-white/75"
        >
          닫기
        </button>
        <div className="relative text-center">
          <h2 id="editor-draft-entry-title" className="text-[25px] font-extrabold tracking-[-0.04em]">
            이어서 <span className="text-[#ff715e]">편집</span>할까요?
          </h2>
          <p id="editor-draft-entry-description" className="mt-2 text-[13px] font-medium leading-6 text-white/45">
            <strong className="font-bold text-white/70">{updatedAt}</strong>에 마지막으로 저장했어요.
          </p>
        </div>

        <button
          type="button"
          autoFocus
          onClick={onContinue}
          className="relative mt-8 min-h-[54px] w-full rounded-[15px] border border-[#ff715e]/70 bg-[#ff715e]/[.08] px-5 text-[15px] font-extrabold text-white shadow-[0_0_28px_rgba(255,113,94,.08)] transition hover:border-[#ff715e] hover:bg-[#ff715e]/[.14] active:scale-[.99]"
        >
          이어서 편집
        </button>

        <div className="relative my-5 flex items-center gap-3">
          <span aria-hidden="true" className="h-px flex-1 bg-white/[.08]" />
          <button
            type="button"
            onClick={onStartNew}
            className="min-h-9 rounded-lg px-2 text-[12px] font-bold text-white/42 transition hover:bg-white/[.05] hover:text-white/75"
          >
            새로 시작
          </button>
          <span aria-hidden="true" className="h-px flex-1 bg-white/[.08]" />
        </div>
        <p className="text-center text-[11px] font-semibold leading-5 text-red-300/75">
          새로 시작하면 저장된 편집 내용이 삭제돼요.
        </p>
      </section>
    </div>,
    document.body,
  );
}

function EditorDraftDiscardConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onCancel, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[6px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="editor-draft-discard-title"
        aria-describedby="editor-draft-discard-description"
        className="w-full max-w-[380px] rounded-[22px] border border-red-300/15 bg-[#211b1d] p-6 text-white shadow-[0_28px_90px_rgba(0,0,0,.72)] sm:p-7"
      >
        <div aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-red-400/10 text-lg font-black text-red-200">!</div>
        <h2 id="editor-draft-discard-title" className="mt-5 text-[22px] font-extrabold tracking-[-0.035em]">
          새로 시작할까요?
        </h2>
        <p id="editor-draft-discard-description" className="mt-2 text-[13px] font-medium leading-6 text-red-100/60">
          지금까지 저장한 편집 내용이 삭제되며 되돌릴 수 없어요.
        </p>
        <div className="mt-7 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="min-h-12 rounded-[13px] border border-white/10 bg-white/[.04] px-4 text-[13px] font-extrabold text-white/70 transition hover:bg-white/[.08] hover:text-white"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 rounded-[13px] bg-red-500 px-4 text-[13px] font-extrabold text-white transition hover:bg-red-400 active:scale-[.99]"
          >
            삭제하고 시작
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ApplyEditConfirmDialog({
  open,
  saving,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel, open, saving]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[5px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="apply-edit-confirm-title"
        aria-describedby="apply-edit-confirm-description"
        className="relative w-full max-w-[480px] overflow-hidden rounded-[24px] border border-cyan-300/20 bg-[#202426] px-7 pb-8 pt-10 text-center shadow-[0_28px_90px_rgba(0,0,0,.7)] sm:px-9 sm:pb-9"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-16 -top-24 h-40 rounded-full bg-cyan-400/15 blur-3xl" />
        <div aria-hidden="true" className="relative mx-auto grid h-12 w-12 place-items-center rounded-full border border-cyan-200/20 bg-cyan-400/10 text-xl text-cyan-100">✓</div>
        <h2 id="apply-edit-confirm-title" className="relative mt-5 text-2xl font-extrabold tracking-[-0.025em] text-white">
          편집 내용을 영상에 적용할까요?
        </h2>
        <p id="apply-edit-confirm-description" className="relative mt-4 text-sm leading-6 text-cyan-50/75">
          적용하면 영상 재렌더링이 시작됩니다. 완료될 때까지 프로젝트에서 편집과 다운로드가 잠시 제한됩니다.
        </p>
        <div className="relative mt-8 grid grid-cols-2 gap-3">
          <button
            type="button"
            autoFocus
            disabled={saving}
            onClick={onCancel}
            className="min-h-12 rounded-xl border border-white/15 bg-white/[.04] px-4 py-3 text-sm font-bold text-white transition hover:bg-white/[.08] disabled:opacity-50"
          >
            계속 편집
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onConfirm}
            className="min-h-12 rounded-xl bg-white px-4 py-3 text-sm font-extrabold text-black transition hover:bg-cyan-50 active:scale-[.99] disabled:opacity-50"
          >
            {saving ? "적용 중..." : "영상에 적용"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function EditorFontApplyDialog({
  fontId,
  onCancel,
  onConfirm,
}: {
  fontId: EditorFontId | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = fontId !== null;
  const font = editorFontOptions.find((option) => option.id === fontId)
    || editorFontOptions[0];

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[155] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[6px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-font-apply-title"
        aria-describedby="editor-font-apply-description"
        className="w-full max-w-[420px] rounded-[24px] border border-[#ff8c7c]/25 bg-[#211d20] p-7 text-white shadow-[0_30px_100px_rgba(0,0,0,.75)] sm:p-8"
      >
        <p className="text-[12px] font-extrabold text-[#ff9b8d]" style={{ fontFamily: font.family }}>
          {font.label}
        </p>
        <h2 id="editor-font-apply-title" className="mt-3 text-[23px] font-extrabold tracking-[-0.035em]">
          모든 텍스트에 적용할까요?
        </h2>
        <p id="editor-font-apply-description" className="mt-3 text-[13px] font-medium leading-6 text-white/60">
          후킹 제목, 채널명과 추가한 텍스트의 폰트를 한 번에 맞출 수 있어요.
        </p>
        <div className="mt-7 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="min-h-12 rounded-[13px] border border-white/12 bg-white/[.045] px-4 text-[13px] font-extrabold text-white/75 transition hover:bg-white/[.09] hover:text-white"
          >
            현재 텍스트만
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 rounded-[13px] bg-[#ff715e] px-4 text-[13px] font-extrabold text-white transition hover:bg-[#ff8878] active:scale-[.99]"
          >
            모두 적용
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ResetTimelineConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[5px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-timeline-confirm-title"
        aria-describedby="reset-timeline-confirm-description"
        className="relative w-full max-w-[440px] overflow-hidden rounded-[24px] border border-white/15 bg-[#202024] px-7 pb-8 pt-9 text-center shadow-[0_28px_90px_rgba(0,0,0,.7)] sm:px-9"
      >
        <div aria-hidden="true" className="relative mx-auto grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/[.06] text-2xl text-white">↺</div>
        <h2 id="reset-timeline-confirm-title" className="relative mt-5 text-2xl font-extrabold tracking-[-0.025em] text-white">
          영상 구간을 초기화할까요?
        </h2>
        <p id="reset-timeline-confirm-description" className="relative mt-4 text-sm leading-6 text-white/65">
          영상의 시작점과 종료점이 처음 편집기에 들어왔을 때의 구간으로 돌아갑니다. 오버레이 배치는 유지됩니다.
        </p>
        <div className="relative mt-8 grid grid-cols-2 gap-3">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="min-h-12 rounded-xl border border-white/15 bg-white/[.04] px-4 py-3 text-sm font-bold text-white transition hover:bg-white/[.08]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-12 rounded-xl bg-white px-4 py-3 text-sm font-extrabold text-black transition hover:bg-neutral-100 active:scale-[.99]"
          >
            초기화
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function CommentRegenerationConfirmDialog({
  open,
  generating,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  generating: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !generating) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [generating, onCancel, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-[5px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !generating) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="comment-regeneration-confirm-title"
        aria-describedby="comment-regeneration-confirm-description"
        className="relative w-full max-w-[440px] overflow-hidden rounded-[24px] border border-white/15 bg-[#202024] px-7 pb-8 pt-9 text-center shadow-[0_28px_90px_rgba(0,0,0,.7)] sm:px-9"
      >
        <div aria-hidden="true" className="relative mx-auto grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/[.06] text-white">
          <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7">
            <path d="m12 3 1.25 4.2L17.5 8.5l-4.25 1.3L12 14l-1.25-4.2L6.5 8.5l4.25-1.3L12 3Z" fill="currentColor" />
            <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" fill="currentColor" opacity=".7" />
          </svg>
        </div>
        <h2 id="comment-regeneration-confirm-title" className="relative mt-5 text-2xl font-extrabold tracking-[-0.025em] text-white">
          AI로 댓글을 재생성할까요?
        </h2>
        <p id="comment-regeneration-confirm-description" className="relative mt-4 text-sm leading-6 text-white/70">
          댓글 재생성은 사용량 1분을 소모합니다.
        </p>
        {error && <p role="alert" className="relative mt-3 rounded-xl border border-red-300/20 bg-red-400/[.07] px-4 py-3 text-sm leading-5 text-red-100">
          {error}
        </p>}
        <div className="relative mt-8 grid grid-cols-2 gap-3">
          <button
            type="button"
            autoFocus
            disabled={generating}
            onClick={onCancel}
            className="min-h-12 rounded-xl border border-white/15 bg-white/[.04] px-4 py-3 text-sm font-bold text-white transition hover:bg-white/[.08] disabled:cursor-not-allowed disabled:opacity-45"
          >
            취소
          </button>
          <button
            type="button"
            disabled={generating}
            onClick={onConfirm}
            className="min-h-12 rounded-xl bg-white px-4 py-3 text-sm font-extrabold text-black transition hover:bg-neutral-100 active:scale-[.99] disabled:cursor-wait disabled:opacity-60"
          >
            {generating ? "댓글 생성 중..." : "확인"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

type CommentRegenerationChoice = "existing" | "generated";
const EDITOR_COMMENT_MAX_CHARS = 200;
type CommentRegenerationComparison = {
  before: CommentOverlay[];
  existingTexts: string[];
  generatedTexts: string[];
  choices: CommentRegenerationChoice[];
};

function CommentRegenerationComparisonDialog({
  comparison,
  onChoose,
  onTextChange,
  onChooseAll,
  onCancel,
  onApply,
}: {
  comparison: CommentRegenerationComparison | null;
  onChoose: (index: number, choice: CommentRegenerationChoice) => void;
  onTextChange: (
    index: number,
    choice: CommentRegenerationChoice,
    text: string,
  ) => void;
  onChooseAll: (choice: CommentRegenerationChoice) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const [editingTarget, setEditingTarget] = useState<{
    index: number;
    choice: CommentRegenerationChoice;
  } | null>(null);

  useEffect(() => {
    if (!comparison) setEditingTarget(null);
  }, [comparison]);

  useEffect(() => {
    if (!comparison) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [comparison, onCancel]);

  if (!comparison || typeof document === "undefined") return null;
  const generatedChoiceCount = comparison.choices.filter(
    (choice) => choice === "generated",
  ).length;
  const selectedCommentsValid = comparison.before.every((_, index) => {
    const text = comparison.choices[index] === "generated"
      ? comparison.generatedTexts[index]
      : comparison.existingTexts[index];
    return Boolean(text?.trim()) && text.length <= EDITOR_COMMENT_MAX_CHARS;
  });
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4 backdrop-blur-[7px] sm:p-7">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="comment-regeneration-comparison-title"
        aria-describedby="comment-regeneration-comparison-description"
        className="flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] border border-white/15 bg-[#1c1c20] text-white shadow-[0_32px_110px_rgba(0,0,0,.78)]"
      >
        <header className="flex flex-none items-start justify-between gap-5 border-b border-white/10 px-6 py-5 sm:px-8 sm:py-6">
          <div className="min-w-0">
            <h2 id="comment-regeneration-comparison-title" className="text-2xl font-extrabold tracking-[-0.03em] sm:text-[28px]">
              어떤 댓글을 사용할까요?
            </h2>
            <p id="comment-regeneration-comparison-description" className="mt-2 text-sm leading-6 text-white/58">
              사용할 문구를 고르거나, 댓글을 더블클릭해서 직접 수정하세요.
            </p>
          </div>
          <button
            type="button"
            aria-label="댓글 비교 닫기"
            onClick={onCancel}
            className="grid h-10 w-10 flex-none place-items-center rounded-full border border-white/12 bg-white/[.05] text-xl text-white/70 transition hover:bg-white/[.11] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            ×
          </button>
        </header>

        <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-white/[.08] bg-white/[.025] px-6 py-3.5 sm:px-8">
          <p className="text-sm font-bold text-white/60">
            {comparison.before.length}개 중 <strong className="text-white">{generatedChoiceCount}개</strong> 새 댓글 선택
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onChooseAll("existing")}
              className="min-h-10 rounded-lg border border-white/12 bg-white/[.04] px-3.5 text-sm font-extrabold text-white/75 transition hover:bg-white/[.09] hover:text-white"
            >
              모두 기존 댓글
            </button>
            <button
              type="button"
              onClick={() => onChooseAll("generated")}
              className="min-h-10 rounded-lg border border-white/20 bg-white px-3.5 text-sm font-extrabold text-black transition hover:bg-neutral-100"
            >
              모두 새 댓글
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 [scrollbar-color:rgba(255,255,255,.22)_transparent] sm:px-8 sm:py-6">
          <div>
            {comparison.before.map((comment, index) => {
              const choice = comparison.choices[index];
              const existingSelected = choice === "existing";
              const generatedSelected = choice === "generated";
              const existingEditing = editingTarget?.index === index
                && editingTarget.choice === "existing";
              const generatedEditing = editingTarget?.index === index
                && editingTarget.choice === "generated";
              return <article key={comment.id} className="py-4 first:pt-0 last:pb-0">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <strong className="text-[15px] font-extrabold text-white/85">댓글 {index + 1}</strong>
                  <span className="text-xs font-bold text-white/45">더블클릭해서 수정</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={existingSelected}
                    onClick={() => onChoose(index, "existing")}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      onChoose(index, "existing");
                      setEditingTarget({ index, choice: "existing" });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onChoose(index, "existing");
                      }
                      if (event.key === "F2") {
                        event.preventDefault();
                        onChoose(index, "existing");
                        setEditingTarget({ index, choice: "existing" });
                      }
                    }}
                    className={`relative min-h-[78px] rounded-xl border px-4 py-3 text-left transition ${existingSelected
                      ? "border-white/75 bg-white/[.11] shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]"
                      : "border-white/[.09] bg-white/[.025] hover:border-white/25 hover:bg-white/[.055]"}`}
                  >
                    <span className="mb-1.5 flex items-center justify-between gap-3 text-[13px] font-extrabold text-white/55">
                      기존 댓글
                      <span aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${existingSelected ? "border-white bg-white text-black" : "border-white/20 text-transparent"}`}>✓</span>
                    </span>
                    {existingEditing
                      ? <input
                          autoFocus
                          aria-label={`기존 댓글 ${index + 1} 수정`}
                          value={comparison.existingTexts[index]}
                          maxLength={EDITOR_COMMENT_MAX_CHARS}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onChange={(event) => onTextChange(
                            index,
                            "existing",
                            event.target.value,
                          )}
                          onBlur={() => setEditingTarget(null)}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.nativeEvent.isComposing) return;
                            if (event.key === "Enter" || event.key === "Escape") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          className="block w-full rounded-lg border border-white/35 bg-black/35 px-3 py-1.5 text-[15px] font-bold leading-6 text-white outline-none focus:border-white"
                        />
                      : <span className="block break-words text-[15px] font-bold leading-6 text-white/88">
                          {comparison.existingTexts[index]}
                        </span>}
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={generatedSelected}
                    onClick={() => onChoose(index, "generated")}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      onChoose(index, "generated");
                      setEditingTarget({ index, choice: "generated" });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onChoose(index, "generated");
                      }
                      if (event.key === "F2") {
                        event.preventDefault();
                        onChoose(index, "generated");
                        setEditingTarget({ index, choice: "generated" });
                      }
                    }}
                    className={`relative min-h-[78px] rounded-xl border px-4 py-3 text-left transition ${generatedSelected
                      ? "border-violet-300/65 bg-violet-400/[.11] shadow-[inset_0_0_0_1px_rgba(196,181,253,.1)]"
                      : "border-white/[.09] bg-white/[.025] hover:border-violet-300/30 hover:bg-violet-400/[.06]"}`}
                  >
                    <span className="mb-1.5 flex items-center justify-between gap-3 text-[13px] font-extrabold text-violet-100/75">
                      새 댓글
                      <span aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${generatedSelected ? "border-violet-200 bg-violet-100 text-violet-950" : "border-white/20 text-transparent"}`}>✓</span>
                    </span>
                    {generatedEditing
                      ? <input
                          autoFocus
                          aria-label={`새 댓글 ${index + 1} 수정`}
                          value={comparison.generatedTexts[index]}
                          maxLength={EDITOR_COMMENT_MAX_CHARS}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onChange={(event) => onTextChange(
                            index,
                            "generated",
                            event.target.value,
                          )}
                          onBlur={() => setEditingTarget(null)}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.nativeEvent.isComposing) return;
                            if (event.key === "Enter" || event.key === "Escape") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          className="block w-full rounded-lg border border-violet-200/45 bg-black/35 px-3 py-1.5 text-[15px] font-bold leading-6 text-white outline-none focus:border-violet-100"
                        />
                      : <span className="block break-words text-[15px] font-bold leading-6 text-white">
                          {comparison.generatedTexts[index]}
                        </span>}
                  </div>
                </div>
              </article>;
            })}
          </div>
        </div>

        <footer className="flex flex-none justify-end border-t border-white/10 bg-[#202024] px-6 py-4 sm:px-8 sm:py-5">
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded-xl border border-white/14 bg-white/[.04] px-5 text-sm font-extrabold text-white/75 transition hover:bg-white/[.09] hover:text-white sm:min-w-[128px]"
            >
              기존 댓글 유지
            </button>
            <button
              type="button"
              autoFocus
              onClick={onApply}
              disabled={!selectedCommentsValid}
              className="min-h-11 rounded-xl bg-white px-5 text-sm font-extrabold text-black transition hover:bg-neutral-100 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-[156px]"
            >
              선택한 댓글 적용
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

type EditorSubtitleSegment = {
  start: number;
  end: number;
  text: string;
};

type EditTimeline = {
  url: string;
  expiresAt: string;
  timelineStartSeconds: number;
  timelineEndSeconds: number;
  currentStartSeconds: number;
  currentEndSeconds: number;
  initialStartSeconds: number;
  initialEndSeconds: number;
  subtitleSegments: EditorSubtitleSegment[];
  version: number;
};

type EditorDraftSaveState = "idle" | "saving" | "saved" | "error";
type EditorVideoConnectionState = "ready" | "reconnecting" | "error";
type EditorVideoSourceEndpoint = "timeline" | "source";

type EditorHistoryAction =
  | "overlay"
  | "video"
  | "comment-delete"
  | "comment-replace"
  | "copy"
  | "template";
type EditorVideoCutHistory = {
  past: EditorVideoClip[][];
  future: EditorVideoClip[][];
};
type EditorCommentDeleteHistoryEntry = {
  comment: CommentOverlay;
  index: number;
  offset: CanvasPoint | null;
};
type EditorCommentDeleteHistory = {
  past: EditorCommentDeleteHistoryEntry[];
  future: EditorCommentDeleteHistoryEntry[];
};
type EditorCommentReplaceHistoryEntry = {
  before: CommentOverlay[];
  after: CommentOverlay[];
};
type EditorCommentReplaceHistory = {
  past: EditorCommentReplaceHistoryEntry[];
  future: EditorCommentReplaceHistoryEntry[];
};
type EditorCopySnapshot = {
  title: string;
  titleTextStyles: TitleTextStyle[];
  titleFontScale: number;
  channel: string;
  channelThumbnailUrl: string | null;
  channelThumbnailAssetKey: string | null;
  subtitleSegments: EditorSubtitleSegment[];
};
type EditorCopyHistoryEntry = {
  before: EditorCopySnapshot;
  after: EditorCopySnapshot;
};
type EditorCopyHistory = {
  past: EditorCopyHistoryEntry[];
  future: EditorCopyHistoryEntry[];
};
type EditorTemplateSnapshot = {
  templateId: TemplateId;
  activeCustomTemplate: CustomTemplate | null;
  presetVersion: number;
  templateSelectionTouched: boolean;
  overlayLayout: EditorOverlayLayoutSnapshot;
};
type EditorTemplateHistoryEntry = {
  before: EditorTemplateSnapshot;
  after: EditorTemplateSnapshot;
};
type EditorTemplateHistory = {
  past: EditorTemplateHistoryEntry[];
  future: EditorTemplateHistoryEntry[];
};

const cloneEditorVideoClips = (clips: EditorVideoClip[]) => (
  clips.map((clip) => ({ ...clip }))
);
const cloneEditorCommentDeleteHistoryEntry = (
  entry: EditorCommentDeleteHistoryEntry,
) => ({
  comment: { ...entry.comment },
  index: entry.index,
  offset: entry.offset ? { ...entry.offset } : null,
});
const cloneEditorComments = (comments: CommentOverlay[]) => (
  comments.map((comment) => ({ ...comment }))
);
const cloneEditorSubtitleSegments = (segments: EditorSubtitleSegment[]) => (
  segments.map((segment) => ({ ...segment }))
);
const editorCommentsChanged = (
  before: CommentOverlay[],
  after: CommentOverlay[],
) => (
  before.length !== after.length
  || before.some((comment, index) => {
    const next = after[index];
    return !next
      || comment.id !== next.id
      || comment.startSeconds !== next.startSeconds
      || comment.endSeconds !== next.endSeconds
      || comment.text !== next.text
      || comment.initial !== next.initial
      || comment.avatarColor !== next.avatarColor
      || comment.nickname !== next.nickname
      || comment.likeCount !== next.likeCount
      || comment.ageLabel !== next.ageLabel;
  })
);
const cloneEditorCommentReplaceHistoryEntry = (
  entry: EditorCommentReplaceHistoryEntry,
) => ({
  before: cloneEditorComments(entry.before),
  after: cloneEditorComments(entry.after),
});
const cloneEditorCopySnapshot = (
  snapshot: EditorCopySnapshot,
): EditorCopySnapshot => ({
  title: snapshot.title,
  titleTextStyles: snapshot.titleTextStyles.map((style) => ({ ...style })),
  titleFontScale: snapshot.titleFontScale,
  channel: snapshot.channel,
  channelThumbnailUrl: snapshot.channelThumbnailUrl,
  channelThumbnailAssetKey: snapshot.channelThumbnailAssetKey,
  subtitleSegments: cloneEditorSubtitleSegments(snapshot.subtitleSegments),
});
const cloneEditorCopyHistoryEntry = (
  entry: EditorCopyHistoryEntry,
): EditorCopyHistoryEntry => ({
  before: cloneEditorCopySnapshot(entry.before),
  after: cloneEditorCopySnapshot(entry.after),
});
const editorCopySnapshotsEqual = (
  left: EditorCopySnapshot,
  right: EditorCopySnapshot,
) => (
  left.title === right.title
  && left.titleFontScale === right.titleFontScale
  && left.channel === right.channel
  && left.channelThumbnailUrl === right.channelThumbnailUrl
  && left.channelThumbnailAssetKey === right.channelThumbnailAssetKey
  && JSON.stringify(left.subtitleSegments) === JSON.stringify(right.subtitleSegments)
  && JSON.stringify(left.titleTextStyles) === JSON.stringify(right.titleTextStyles)
);
const editorCopyTitleChanged = (entry: EditorCopyHistoryEntry) => (
  entry.before.title !== entry.after.title
  || entry.before.titleFontScale !== entry.after.titleFontScale
  || JSON.stringify(entry.before.titleTextStyles)
    !== JSON.stringify(entry.after.titleTextStyles)
);
const editorCopySubtitleChanged = (entry: EditorCopyHistoryEntry) => (
  JSON.stringify(entry.before.subtitleSegments)
  !== JSON.stringify(entry.after.subtitleSegments)
);
const cloneEditorTemplateSnapshot = (
  snapshot: EditorTemplateSnapshot,
): EditorTemplateSnapshot => ({
  templateId: snapshot.templateId,
  activeCustomTemplate: snapshot.activeCustomTemplate,
  presetVersion: snapshot.presetVersion,
  templateSelectionTouched: snapshot.templateSelectionTouched,
  overlayLayout: cloneEditorOverlayLayout(snapshot.overlayLayout),
});
const cloneEditorTemplateHistoryEntry = (
  entry: EditorTemplateHistoryEntry,
): EditorTemplateHistoryEntry => ({
  before: cloneEditorTemplateSnapshot(entry.before),
  after: cloneEditorTemplateSnapshot(entry.after),
});
const editorTemplateSnapshotsEqual = (
  left: EditorTemplateSnapshot,
  right: EditorTemplateSnapshot,
) => (
  left.templateId === right.templateId
  && left.activeCustomTemplate?.id === right.activeCustomTemplate?.id
  && left.activeCustomTemplate?.version === right.activeCustomTemplate?.version
  && left.presetVersion === right.presetVersion
  && left.templateSelectionTouched === right.templateSelectionTouched
  && editorOverlayLayoutsEqual(left.overlayLayout, right.overlayLayout)
);

const TIMELINE_THUMBNAIL_COUNT = 12;
const EDITOR_COMMENT_SNAP_THRESHOLD_PX = 3;
const EDITOR_OVERLAY_SNAP_THRESHOLD_PX = 3;
const EDITOR_VIDEO_SIZE_SNAP_THRESHOLD_PX = 12;
const EDITOR_VIDEO_MIN_SCALE = 0.25;
const EDITOR_VIDEO_MAX_SCALE = 2;
const EDITOR_TEXT_LAYER_MIN_SCALE = 0.5;
const EDITOR_TEXT_LAYER_MAX_SCALE = 2;
const EDITOR_TEXT_OVERLAY_LIMIT = 20;
type EditorOverlaySelection = EditorOverlayOrderItem | null;
type EditorFontApplySource = "title" | "channel" | `text:${string}`;
type EditorSidebarTool =
  | "title"
  | "text"
  | "comment"
  | "channel"
  | "background"
  | "template";
const EDITOR_OVERLAY_LABELS: Record<EditorOverlayLayer, string> = {
  video: "영상",
  title: "제목",
  comment: "댓글",
  channel: "채널명",
};
const editorTextSelection = (id: string): `text:${string}` => `text:${id}`;
const isEditorTextSelection = (
  selection: EditorOverlaySelection,
): selection is `text:${string}` => selection?.startsWith("text:") === true;
const selectedEditorTextId = (selection: EditorOverlaySelection) => (
  isEditorTextSelection(selection) ? selection.slice("text:".length) : null
);

function EditorSidebarSectionIcon({
  section,
}: {
  section: EditorSidebarTool;
}) {
  if (section === "title") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 5h12M10 5v10M7.3 15h5.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>;
  }
  if (section === "comment") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.25 4.25h11.5v8.5H9l-3.75 3v-3h-1Z" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 7.25h6M7 9.75h4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>;
  }
  if (section === "text") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.25 7h7.5M10 7v6.25M7.8 13.25h4.4" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    </svg>;
  }
  if (section === "channel") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.55" />
      <path d="M4.5 16c.55-3 2.35-4.5 5.5-4.5s4.95 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    </svg>;
  }
  if (section === "background") {
    return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3.5" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.55" />
      <circle cx="7" cy="7.5" r="1.35" fill="currentColor" />
      <path d="m4.5 14 3.7-3.7 2.35 2.3 1.7-1.7 3.25 3.1" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
  }
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3.8 8h12.4M9 8v8.2" stroke="currentColor" strokeWidth="1.5" />
  </svg>;
}

const EDITOR_SIDEBAR_TOOLS = [
  { id: "title", label: "후킹 제목" },
  { id: "text", label: "텍스트" },
  { id: "comment", label: "댓글" },
  { id: "channel", label: "채널명" },
  { id: "background", label: "배경" },
  { id: "template", label: "템플릿" },
] as const;

const EDITOR_TIMELINE_ZOOM_MIN = 1;
const EDITOR_TIMELINE_ZOOM_MAX = 3;
const EDITOR_TIMELINE_ZOOM_STEP = 0.5;

function EditorViewportZoomControl({
  label,
  value,
  min,
  max,
  step,
  className,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  className: string;
  onChange: (value: number) => void;
}) {
  const update = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + direction * step));
    onChange(Math.round(next * 100) / 100);
  };
  return <div
    className={`editor-viewport-zoom-control ${className}`}
    aria-label={`${label} 확대`}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <span>{label}</span>
    <button
      type="button"
      aria-label={`${label} 축소`}
      disabled={value <= min}
      onClick={() => update(-1)}
    >
      −
    </button>
    <output aria-label={`${label} 확대 비율`}>
      {Math.round(value * 100)}%
    </output>
    <button
      type="button"
      aria-label={`${label} 확대`}
      disabled={value >= max}
      onClick={() => update(1)}
    >
      +
    </button>
  </div>;
}

const EDITOR_VIDEO_RESIZE_HANDLES: ReadonlyArray<{
  handle: EditorVideoResizeHandle;
  label: string;
  positionClassName: string;
  cursorClassName: string;
}> = [
  {
    handle: "top-left",
    label: "영상 왼쪽 위 크기 조절",
    positionClassName: "-left-1.5 -top-1.5",
    cursorClassName: "cursor-nwse-resize",
  },
  {
    handle: "top-right",
    label: "영상 오른쪽 위 크기 조절",
    positionClassName: "-right-1.5 -top-1.5",
    cursorClassName: "cursor-nesw-resize",
  },
  {
    handle: "bottom-left",
    label: "영상 왼쪽 아래 크기 조절",
    positionClassName: "-bottom-1.5 -left-1.5",
    cursorClassName: "cursor-nesw-resize",
  },
  {
    handle: "bottom-right",
    label: "영상 오른쪽 아래 크기 조절",
    positionClassName: "-bottom-1.5 -right-1.5",
    cursorClassName: "cursor-nwse-resize",
  },
];

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("타임라인 미리보기를 만들지 못했습니다."));
    };
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function drawTimelineFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const sourceAspectRatio = sourceWidth / sourceHeight;
  const targetAspectRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceAspectRatio > targetAspectRatio) {
    cropWidth = sourceHeight * targetAspectRatio;
    sourceX = (sourceWidth - cropWidth) / 2;
  } else {
    cropHeight = sourceWidth / targetAspectRatio;
    sourceY = (sourceHeight - cropHeight) / 2;
  }
  context.drawImage(
    video,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    width,
    height,
  );
}

type CommentTimelineDrag = {
  pointerId: number;
  captureTarget: HTMLButtonElement;
  commentId: string;
  adjustment: TimedRangeAdjustment;
  startClientX: number;
  width: number;
  initialRange: { startSeconds: number; endSeconds: number };
  previousEndSeconds: number;
  nextStartSeconds: number;
  moved: boolean;
};

function CommentTimelineEditor({
  comments,
  durationSeconds,
  currentSeconds,
  onRangeChange,
  onTextChange,
  onSeek,
  onDelete,
  onSelect,
  onDeselect,
  onTextEditStart,
  onTextEditEnd,
  onRangeEditStart,
  onRangeEditEnd,
  active,
  editRequest,
  showCommentText = false,
  snapPointsSeconds = [],
  selectionLeftPercent = 0,
  selectionWidthPercent = 100,
}: {
  comments: CommentOverlay[];
  durationSeconds: number;
  currentSeconds: number;
  onRangeChange: (id: string, range: { startSeconds: number; endSeconds: number }) => void;
  onTextChange: (id: string, text: string) => void;
  onSeek: (seconds: number) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onDeselect: () => void;
  onTextEditStart: () => void;
  onTextEditEnd: () => void;
  onRangeEditStart: () => void;
  onRangeEditEnd: () => void;
  active: boolean;
  editRequest?: { commentId: string; revision: number } | null;
  showCommentText?: boolean;
  snapPointsSeconds?: number[];
  selectionLeftPercent?: number;
  selectionWidthPercent?: number;
}) {
  const orderedComments = [...comments].sort((left, right) => left.startSeconds - right.startSeconds);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<CommentTimelineDrag | null>(null);
  const commentButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const editingCommentAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [editingCommentAnchor, setEditingCommentAnchor] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const lastCommentActivationRef = useRef<{
    commentId: string;
    timestamp: number;
  } | null>(null);
  const handledEditRequestRevisionRef = useRef(0);
  const safeDuration = Math.max(0.3, durationSeconds);
  const editingComment = orderedComments.find((comment) => comment.id === editingCommentId) || null;
  const editingIndex = editingComment
    ? orderedComments.findIndex((comment) => comment.id === editingComment.id)
    : -1;

  useEffect(() => {
    if (!active) {
      setSelectedCommentId(null);
      setEditingCommentId(null);
      return;
    }
    if (selectedCommentId && !orderedComments.some((comment) => comment.id === selectedCommentId)) {
      setSelectedCommentId(null);
    }
    if (editingCommentId && !orderedComments.some((comment) => comment.id === editingCommentId)) {
      setEditingCommentId(null);
    }
  }, [active, editingCommentId, orderedComments, selectedCommentId]);

  const deselectComment = () => {
    setSelectedCommentId(null);
    setEditingCommentId(null);
    editingCommentAnchorRef.current = null;
    setEditingCommentAnchor(null);
    onDeselect();
  };

  const updateCommentEditorAnchor = useCallback((
    anchor: HTMLButtonElement | null,
  ) => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setEditingCommentAnchor({
      left: Math.max(
        162,
        Math.min(window.innerWidth - 162, rect.left + rect.width / 2),
      ),
      top: rect.top - 10,
    });
  }, []);

  const openCommentTextEditor = useCallback((
    comment: CommentOverlay,
    anchor = commentButtonRefs.current.get(comment.id) || null,
  ) => {
    editingCommentAnchorRef.current = anchor;
    updateCommentEditorAnchor(anchor);
    onTextEditStart();
    onSelect(comment.id);
    setSelectedCommentId(comment.id);
    setEditingCommentId(comment.id);
    onSeek(comment.startSeconds);
  }, [
    onSeek,
    onSelect,
    onTextEditStart,
    updateCommentEditorAnchor,
  ]);

  useEffect(() => {
    if (
      !active
      || !editRequest
      || handledEditRequestRevisionRef.current === editRequest.revision
    ) {
      return;
    }
    const comment = orderedComments.find(
      (value) => value.id === editRequest.commentId,
    );
    if (!comment) return;
    handledEditRequestRevisionRef.current = editRequest.revision;
    openCommentTextEditor(comment);
  }, [
    active,
    editRequest,
    openCommentTextEditor,
    orderedComments,
  ]);

  useEffect(() => {
    if (!editingCommentId) return;
    const update = () => updateCommentEditorAnchor(
      editingCommentAnchorRef.current,
    );
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editingCommentId, updateCommentEditorAnchor]);

  const neighborBounds = (commentId: string) => {
    const index = orderedComments.findIndex((comment) => comment.id === commentId);
    return {
      previousEndSeconds: index > 0 ? orderedComments[index - 1].endSeconds : 0,
      nextStartSeconds: index >= 0 && index < orderedComments.length - 1
        ? orderedComments[index + 1].startSeconds
        : safeDuration,
    };
  };

  const updateRange = (
    comment: CommentOverlay,
    adjustment: TimedRangeAdjustment,
    deltaSeconds: number,
    bounds = neighborBounds(comment.id),
    snapThresholdSeconds = 0,
  ) => {
    const range = snapTimedRangeHandle(
      adjustTimedRange(
        comment,
        adjustment,
        deltaSeconds,
        safeDuration,
        bounds.previousEndSeconds,
        bounds.nextStartSeconds,
      ),
      adjustment,
      snapPointsSeconds,
      snapThresholdSeconds,
      bounds.previousEndSeconds,
      bounds.nextStartSeconds,
    );
    onRangeChange(comment.id, range);
    onSeek(adjustment === "end" ? range.endSeconds : range.startSeconds);
  };

  const startDrag = (
    comment: CommentOverlay,
    adjustment: TimedRangeAdjustment,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0 || !trackRef.current) return;
    const bounds = neighborBounds(comment.id);
    onRangeEditStart();
    onSelect(comment.id);
    setSelectedCommentId(comment.id);
    setEditingCommentId(null);
    dragRef.current = {
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      commentId: comment.id,
      adjustment,
      startClientX: event.clientX,
      width: trackRef.current.getBoundingClientRect().width,
      initialRange: {
        startSeconds: comment.startSeconds,
        endSeconds: comment.endSeconds,
      },
      previousEndSeconds: bounds.previousEndSeconds,
      nextStartSeconds: bounds.nextStartSeconds,
      moved: false,
    };
    event.stopPropagation();
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId || active.width <= 0) return;
    const distance = event.clientX - active.startClientX;
    if (!active.moved) {
      if (Math.abs(distance) < 2) return;
      active.moved = true;
      if (!active.captureTarget.hasPointerCapture(active.pointerId)) {
        active.captureTarget.setPointerCapture(active.pointerId);
      }
    }
    const deltaSeconds = distance / active.width * safeDuration;
    const range = snapTimedRangeHandle(
      adjustTimedRange(
        active.initialRange,
        active.adjustment,
        deltaSeconds,
        safeDuration,
        active.previousEndSeconds,
        active.nextStartSeconds,
      ),
      active.adjustment,
      snapPointsSeconds,
      safeDuration * TIMED_RANGE_SNAP_THRESHOLD_PX / active.width,
      active.previousEndSeconds,
      active.nextStartSeconds,
    );
    onRangeChange(active.commentId, range);
    onSeek(active.adjustment === "end" ? range.endSeconds : range.startSeconds);
    event.preventDefault();
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (active.captureTarget.hasPointerCapture(event.pointerId)) {
      active.captureTarget.releasePointerCapture(event.pointerId);
    }
    onRangeEditEnd();
    if (active.moved || event.type !== "pointerup") return;
    const previousActivation = lastCommentActivationRef.current;
    const isDoubleActivation = previousActivation?.commentId === active.commentId
      && event.timeStamp - previousActivation.timestamp <= 450;
    if (isDoubleActivation) {
      lastCommentActivationRef.current = null;
      const comment = orderedComments.find(
        (value) => value.id === active.commentId,
      );
      if (comment) openCommentTextEditor(comment, active.captureTarget);
      return;
    }
    lastCommentActivationRef.current = {
      commentId: active.commentId,
      timestamp: event.timeStamp,
    };
    onSeek(active.initialRange.startSeconds);
  };

  return <section
    className="editor-comment-timeline-panel"
    aria-label="댓글 노출 구간 편집"
    onPointerDown={(event) => {
      if (event.target === event.currentTarget) deselectComment();
    }}
  >
    <div
      className="editor-comment-selection-lane"
      style={{
        left: `${selectionLeftPercent}%`,
        width: `${selectionWidthPercent}%`,
      }}
    >
      <div
        ref={trackRef}
        className="editor-comment-timeline"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) deselectComment();
        }}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
      <div className="editor-comment-track-grid" aria-hidden="true" />
      {orderedComments.map((comment, index) => {
        const selected = active && comment.id === selectedCommentId;
        const previewActive = comment.startSeconds <= currentSeconds
          && comment.endSeconds > currentSeconds;
        const left = Math.max(0, Math.min(100, comment.startSeconds / safeDuration * 100));
        const width = Math.max(0, Math.min(100 - left, (
          comment.endSeconds - comment.startSeconds
        ) / safeDuration * 100));
        const fallbackLabel = `댓글 ${index + 1}`;
        const commentText = comment.text.trim() || "내용 없는 댓글";
        const visibleLabel = showCommentText ? commentText : fallbackLabel;
        const bounds = neighborBounds(comment.id);
        return <div
          key={comment.id}
          data-editor-comment-id={comment.id}
          className={`editor-comment-range${selected ? " is-selected" : ""}${previewActive ? " is-preview-active" : ""}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        >
          <button
            ref={(element) => {
              if (element) commentButtonRefs.current.set(comment.id, element);
              else commentButtonRefs.current.delete(comment.id);
            }}
            type="button"
            className="editor-comment-range-body"
            data-editor-guide={index === 0 ? "comment-item" : undefined}
            aria-label={`${fallbackLabel}: ${commentText} 선택 및 이동`}
            aria-pressed={selected}
            title={`${commentText}: 더블클릭해서 댓글 수정 · 드래그해서 구간 이동`}
            style={{ backgroundColor: comment.avatarColor }}
            onPointerDown={(event) => startDrag(comment, "move", event)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                openCommentTextEditor(comment, event.currentTarget);
                event.preventDefault();
                event.stopPropagation();
              } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                onRangeEditStart();
                onSelect(comment.id);
                setSelectedCommentId(comment.id);
                updateRange(comment, "move", event.key === "ArrowLeft" ? -0.1 : 0.1, bounds);
                onRangeEditEnd();
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            <span>{visibleLabel}</span>
          </button>
          {selected && <>
            <button
              type="button"
              className="editor-comment-range-handle is-start"
              aria-label={`${fallbackLabel} 시작점 조절`}
              onPointerDown={(event) => startDrag(comment, "start", event)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                onRangeEditStart();
                onSelect(comment.id);
                updateRange(comment, "start", event.key === "ArrowLeft" ? -0.1 : 0.1, bounds);
                onRangeEditEnd();
                event.preventDefault();
                event.stopPropagation();
              }}
            />
            <button
              type="button"
              className="editor-comment-range-handle is-end"
              aria-label={`${fallbackLabel} 종료점 조절`}
              onPointerDown={(event) => startDrag(comment, "end", event)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                onRangeEditStart();
                onSelect(comment.id);
                updateRange(comment, "end", event.key === "ArrowLeft" ? -0.1 : 0.1, bounds);
                onRangeEditEnd();
                event.preventDefault();
                event.stopPropagation();
              }}
            />
          </>}
        </div>;
      })}
      </div>
    </div>
    {editingComment && editingCommentAnchor && createPortal(
      <div
        className="editor-comment-popover"
        style={{
          left: editingCommentAnchor.left,
          top: editingCommentAnchor.top,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="editor-comment-popover-arrow" aria-hidden="true" />
        <label>
          <span>댓글 {editingIndex + 1} 내용</span>
          <textarea
            autoFocus
            value={editingComment.text}
            maxLength={200}
            rows={3}
            onChange={(event) => onTextChange(editingComment.id, event.target.value)}
            onBlur={onTextEditEnd}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                onTextEditEnd();
                setEditingCommentId(null);
              }
            }}
          />
        </label>
        <div className="editor-comment-popover-actions">
          <button type="button" className="is-delete" onClick={() => {
            onTextEditEnd();
            setEditingCommentId(null);
            onDelete(editingComment.id);
          }}>삭제</button>
          <button type="button" onClick={() => {
            onTextEditEnd();
            setEditingCommentId(null);
          }}>완료</button>
        </div>
      </div>,
      document.body,
    )}
  </section>;
}

function Editor({ item, channelThumbnailUrl, onClose, onChanged, standalone = false, projectLabel, projectNumber, rangeEditingEnabled = false, overlayPreviewEnabled = false, editorSaveEnabled = false, editorRelease, paidAccessBlocked = false }: { item: GeneratedShort; channelThumbnailUrl: string | null; onClose: () => void; onChanged: () => Promise<void>; standalone?: boolean; projectLabel?: string; projectNumber?: number; rangeEditingEnabled?: boolean; overlayPreviewEnabled?: boolean; editorSaveEnabled?: boolean; editorRelease: EditorReleaseAssignment; paidAccessBlocked?: boolean }) {
  const savedEditorDocument = overlayPreviewEnabled
    && (item.editorDocument?.version === 2 || item.editorDocument?.version === 3)
    ? item.editorDocument
    : null;
  const initialTemplateId = savedEditorDocument?.template.id || item.templateId;
  const initialTemplate = templates.find(
    (value) => value.id === initialTemplateId,
  ) || templates[0];
  const [availableCustomTemplate] = useState<CustomTemplate | null>(() => editableCustomTemplate(item));
  const initialVideoAspectRatio = savedEditorDocument?.video.aspectRatio
    || item.videoAspectRatio;
  const initialTitle = savedEditorDocument?.title.text || item.hookTitle;
  const initialTitleAspectRatio = initialTemplateId === "comment-capture" && initialVideoAspectRatio === "9:16"
    ? "4:5"
    : initialVideoAspectRatio || "1:1";
  const initialTitleTextStyles = savedEditorDocument
    ? savedEditorDocument.title.textStyles
    : item.titleTextStylesInitialized
      ? item.titleTextStyles
    : defaultTemplateTitleTextStyles(
      initialTitle,
      initialTitleAspectRatio,
      initialTemplate.background,
      initialTemplate.accentBackground,
  );
  const [title, setTitle] = useState(initialTitle);
  const [titleTextStyles, setTitleTextStyles] = useState<TitleTextStyle[]>(initialTitleTextStyles);
  const titleRef = useRef(title);
  const titleTextStylesRef = useRef(titleTextStyles);
  const [titleSelection, setTitleSelection] = useState<{ start: number; end: number } | null>(null);
  const [titleTextColor, setTitleTextColor] = useState(initialTitleTextStyles.find((style) => style.color)?.color || "#FFFFFF");
  const [titleBackgroundColor, setTitleBackgroundColor] = useState(initialTitleTextStyles.find((style) => style.backgroundColor)?.backgroundColor || "#E32626");
  const [showAllTextColors, setShowAllTextColors] = useState(false);
  const [showAllBackgroundColors, setShowAllBackgroundColors] = useState(false);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const [channel, setChannel] = useState(
    savedEditorDocument?.channel.displayName || item.channelDisplayName,
  );
  const channelRef = useRef(channel);
  const initialChannelThumbnailAssetKey = savedEditorDocument
    ?.channel.thumbnailAssetKey || null;
  const [editorChannelThumbnailUrl, setEditorChannelThumbnailUrl] = useState(
    savedEditorDocument?.channel.thumbnailUrl
      || (initialChannelThumbnailAssetKey
        ? editorChannelAssetPreviewUrl(item.id, item.renderVersion)
        : channelThumbnailUrl),
  );
  const editorChannelThumbnailUrlRef = useRef(editorChannelThumbnailUrl);
  const [
    editorChannelThumbnailAssetKey,
    setEditorChannelThumbnailAssetKey,
  ] = useState<string | null>(initialChannelThumbnailAssetKey);
  const editorChannelThumbnailAssetKeyRef = useRef(
    editorChannelThumbnailAssetKey,
  );
  const editorChannelThumbnailObjectUrlsRef = useRef<Set<string>>(new Set());
  const [editorChannelPresets, setEditorChannelPresets] = useState<
    EditorChannelPreset[]
  >([]);
  const [channelPresetComposerOpen, setChannelPresetComposerOpen] = useState(false);
  const [channelPresetDraftName, setChannelPresetDraftName] = useState("");
  const [
    channelPresetDraftImageDataUrl,
    setChannelPresetDraftImageDataUrl,
  ] = useState<string | null>(null);
  const [channelPresetImageBusy, setChannelPresetImageBusy] = useState(false);
  const [channelPresetError, setChannelPresetError] = useState<string | null>(null);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(
    savedEditorDocument?.subtitles.enabled ?? item.subtitlesEnabled,
  );
  const [segments, setSegments] = useState(
    savedEditorDocument?.subtitles.segments || item.subtitleSegments,
  );
  const subtitleSegmentsRef = useRef<EditorSubtitleSegment[]>(
    savedEditorDocument?.subtitles.segments || item.subtitleSegments,
  );
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [activeCustomTemplate, setActiveCustomTemplate] = useState<CustomTemplate | null>(
    availableCustomTemplate,
  );
  const [presetVersion, setPresetVersion] = useState(() => (
    typeof savedEditorDocument?.template.presetVersion === "number"
      ? savedEditorDocument.template.presetVersion
      : typeof item.templateSnapshot?.presetVersion === "number"
        ? item.templateSnapshot.presetVersion
        : overlayPreviewEnabled
          ? CURRENT_PRESET_TEMPLATE_SNAPSHOT.presetVersion
          : 0
  ));
  const [templateSelectionTouched, setTemplateSelectionTouched] = useState(false);
  const templateIdRef = useRef(templateId);
  const activeCustomTemplateRef = useRef(activeCustomTemplate);
  const presetVersionRef = useRef(presetVersion);
  const templateSelectionTouchedRef = useRef(templateSelectionTouched);
  const initialTemplateProvidesComments = initialTemplateId === "comment-capture"
    && (!availableCustomTemplate || availableCustomTemplate.config.comment.visible);
  const [comments, setComments] = useState<CommentOverlay[]>(() => {
    if (savedEditorDocument) {
      return savedEditorDocument.comments.map((comment) => ({
        ...comment,
        likeCount: Math.max(COMMENT_LIKE_COUNT_MIN, comment.likeCount),
      }));
    }
    if (!initialTemplateProvidesComments) return [];
    if (item.commentOverlays?.length) return item.commentOverlays.map((comment) => ({
      ...comment,
      likeCount: Math.max(COMMENT_LIKE_COUNT_MIN, comment.likeCount),
    }));
    return defaultComments(item.durationSeconds);
  });
  const commentsRef = useRef(comments);
  const [titleFontScale, setTitleFontScale] = useState(
    consolidateEditorTitleFontScale(
      savedEditorDocument?.title.fontScale ?? item.titleFontScale ?? 1,
      savedEditorDocument?.overlays.scales.title ?? 1,
    ),
  );
  const titleFontScaleRef = useRef(titleFontScale);
  const updateEditorTitleFontScale = useCallback((value: number) => {
    const nextValue = clampEditorTitleFontScale(value);
    titleFontScaleRef.current = nextValue;
    setTitleFontScale(nextValue);
  }, []);
  const [cleanVideoUrl, setCleanVideoUrl] = useState<string | null>(null);
  const [editTimeline, setEditTimeline] = useState<EditTimeline | null>(null);
  const [selectionStart, setSelectionStart] = useState(
    savedEditorDocument?.video.selectionStartSeconds ?? item.startSeconds,
  );
  const [selectionEnd, setSelectionEnd] = useState(
    savedEditorDocument?.video.selectionEndSeconds ?? item.endSeconds,
  );
  const [timelineThumbnails, setTimelineThumbnails] = useState<string[]>([]);
  const [videoClips, setVideoClips] = useState<EditorVideoClip[]>([]);
  const videoClipsRef = useRef<EditorVideoClip[]>([]);
  const [videoSequenceTime, setVideoSequenceTime] = useState(0);
  const videoSequenceTimeRef = useRef(0);
  const activeVideoClipIndexRef = useRef(0);
  const [selectedVideoClipId, setSelectedVideoClipId] = useState<string | null>(null);
  const [videoRippleRevision, setVideoRippleRevision] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const editorPreviewPaneRef = useRef<HTMLElement>(null);
  const editorPreviewViewportRef = useRef<HTMLDivElement>(null);
  const editorCanvasRef = useRef<HTMLDivElement>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const editorTimelineScrollAreaRef = useRef<HTMLDivElement>(null);
  const editorTimelineZoomCenterRef = useRef<number | null>(null);
  const activeRangeHandleRef = useRef<"start" | "end" | null>(null);
  const timelineScrubbingRef = useRef(false);
  const overlayDragCleanupRef = useRef<(() => void) | null>(null);
  const videoClipTrimCleanupRef = useRef<(() => void) | null>(null);
  const [overlayLayout, setOverlayLayout] = useState(() => (
    savedEditorDocument
      ? normalizeEditorTitleScaleLayout(savedEditorDocument.overlays)
      : createInitialEditorOverlayLayout()
  ));
  const overlayLayoutRef = useRef(overlayLayout);
  const overlayHistoryRef = useRef<EditorOverlayHistory>({
    past: [],
    future: [],
  });
  const videoCutHistoryRef = useRef<EditorVideoCutHistory>({
    past: [],
    future: [],
  });
  const commentDeleteHistoryRef = useRef<EditorCommentDeleteHistory>({
    past: [],
    future: [],
  });
  const commentReplaceHistoryRef = useRef<EditorCommentReplaceHistory>({
    past: [],
    future: [],
  });
  const copyHistoryRef = useRef<EditorCopyHistory>({
    past: [],
    future: [],
  });
  const templateHistoryRef = useRef<EditorTemplateHistory>({
    past: [],
    future: [],
  });
  const editorHistoryOrderRef = useRef<{
    past: EditorHistoryAction[];
    future: EditorHistoryAction[];
  }>({
    past: [],
    future: [],
  });
  const overlayInteractionStartRef = useRef<EditorOverlayLayoutSnapshot | null>(null);
  const commentTextInteractionStartRef = useRef<CommentOverlay[] | null>(null);
  const copyInteractionStartRef = useRef<EditorCopySnapshot | null>(null);
  const [, setOverlayHistoryRevision] = useState(0);
  const [selectedOverlay, setSelectedOverlay] = useState<EditorOverlaySelection>(
    overlayPreviewEnabled ? null : "video",
  );
  const [inlineEditingOverlay, setInlineEditingOverlay] = useState<
    "title" | `text:${string}` | null
  >(null);
  const [editingSubtitleIndex, setEditingSubtitleIndex] = useState<number | null>(
    null,
  );
  const [commentEditRequest, setCommentEditRequest] = useState<{
    commentId: string;
    revision: number;
  } | null>(null);
  const [overlayGuides, setOverlayGuides] = useState<EditorOverlayGuides>(
    EMPTY_EDITOR_OVERLAY_GUIDES,
  );
  const [videoLoadError, setVideoLoadError] = useState(false);
  const [videoConnectionState, setVideoConnectionState] = useState<
    EditorVideoConnectionState
  >("ready");
  const [editorVideoUrlExpiresAt, setEditorVideoUrlExpiresAt] = useState<
    string | null
  >(null);
  const editorVideoSourceEndpointRef = useRef<EditorVideoSourceEndpoint | null>(
    null,
  );
  const editorVideoRefreshInFlightRef = useRef(false);
  const editorVideoRetryCountRef = useRef(0);
  const editorVideoRestoreRef = useRef<{
    currentTime: number;
    shouldPlay: boolean;
  } | null>(null);
  const [editorDraftCandidate, setEditorDraftCandidate] = useState<
    EditorDraftRecord | null
  >(null);
  const [editorDraftLookupComplete, setEditorDraftLookupComplete] = useState(
    !overlayPreviewEnabled,
  );
  const [editorDraftDecisionComplete, setEditorDraftDecisionComplete] = useState(
    !overlayPreviewEnabled,
  );
  const [editorDraftSaveState, setEditorDraftSaveState] = useState<
    EditorDraftSaveState
  >("idle");
  const [editorDraftSavedAt, setEditorDraftSavedAt] = useState<string | null>(
    null,
  );
  const [editorDraftStatusNow, setEditorDraftStatusNow] = useState(
    () => Date.now(),
  );
  const editorDraftBaselineRef = useRef<string | null>(null);
  const editorDraftWriteTimerRef = useRef<number | null>(null);
  const editorDraftWriteRevisionRef = useRef(0);
  const editorDraftHasSavedRef = useRef(false);
  const editorDraftLatestValidRef = useRef<EditorDocumentSnapshot | null>(null);
  const editorDraftNeedsWriteRef = useRef(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorSaveRequestIdRef = useRef<string | null>(null);
  const [applyConfirmationOpen, setApplyConfirmationOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [
    commentRegenerationConfirmationOpen,
    setCommentRegenerationConfirmationOpen,
  ] = useState(false);
  const [regeneratingComments, setRegeneratingComments] = useState(false);
  const [commentRegenerationError, setCommentRegenerationError] = useState<
    string | null
  >(null);
  const [commentRegenerationComparison, setCommentRegenerationComparison] = useState<
    CommentRegenerationComparison | null
  >(null);
  const commentRegenerationRequestIdRef = useRef<string | null>(null);
  const commentRegenerationInFlightRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(
    () => !overlayPreviewEnabled,
  );
  const [activeEditorSidebarTool, setActiveEditorSidebarTool] = useState<
    EditorSidebarTool
  >("title");
  const [expandedEditorTextId, setExpandedEditorTextId] = useState<
    string | null
  >(null);
  const [editorFontApplySuggestion, setEditorFontApplySuggestion] = useState<{
    source: EditorFontApplySource;
    fontId: EditorFontId;
  } | null>(null);
  const [editorTimelineZoom, setEditorTimelineZoom] = useState(1);
  const updateEditorTimelineZoom = useCallback((nextZoom: number) => {
    const scrollArea = editorTimelineScrollAreaRef.current;
    if (scrollArea && scrollArea.scrollWidth > 0) {
      editorTimelineZoomCenterRef.current = (
        scrollArea.scrollLeft + scrollArea.clientWidth / 2
      ) / scrollArea.scrollWidth;
    } else {
      editorTimelineZoomCenterRef.current = 0.5;
    }
    setEditorTimelineZoom(nextZoom);
  }, []);
  useLayoutEffect(() => {
    const scrollArea = editorTimelineScrollAreaRef.current;
    const center = editorTimelineZoomCenterRef.current;
    if (!scrollArea || center === null) return;
    editorTimelineZoomCenterRef.current = null;
    const maximumScrollLeft = Math.max(
      0,
      scrollArea.scrollWidth - scrollArea.clientWidth,
    );
    scrollArea.scrollLeft = Math.max(
      0,
      Math.min(
        maximumScrollLeft,
        center * scrollArea.scrollWidth - scrollArea.clientWidth / 2,
      ),
    );
  }, [editorTimelineZoom]);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [mobileEditorBlocked, setMobileEditorBlocked] = useState<boolean | null>(
    standalone ? null : false,
  );
  const [editorGuideReady, setEditorGuideReady] = useState(false);
  useEffect(() => {
    if (!overlayPreviewEnabled) return;
    const viewport = editorPreviewViewportRef.current;
    if (!viewport) return;

    const preventPreviewPinch = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
    };

    viewport.addEventListener("wheel", preventPreviewPinch, { passive: false });
    return () => viewport.removeEventListener("wheel", preventPreviewPinch);
  }, [overlayPreviewEnabled]);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);
  useEffect(() => {
    templateIdRef.current = templateId;
  }, [templateId]);
  useEffect(() => {
    activeCustomTemplateRef.current = activeCustomTemplate;
  }, [activeCustomTemplate]);
  useEffect(() => {
    presetVersionRef.current = presetVersion;
  }, [presetVersion]);
  useEffect(() => {
    templateSelectionTouchedRef.current = templateSelectionTouched;
  }, [templateSelectionTouched]);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    titleTextStylesRef.current = titleTextStyles;
  }, [titleTextStyles]);
  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);
  useEffect(() => {
    editorChannelThumbnailUrlRef.current = editorChannelThumbnailUrl;
  }, [editorChannelThumbnailUrl]);
  useEffect(() => {
    editorChannelThumbnailAssetKeyRef.current = editorChannelThumbnailAssetKey;
  }, [editorChannelThumbnailAssetKey]);
  useEffect(() => {
    titleFontScaleRef.current = titleFontScale;
  }, [titleFontScale]);
  useEffect(() => {
    if (selectedOverlay !== null) setSelectedVideoClipId(null);
  }, [selectedOverlay]);
  useEffect(() => {
    if (!overlayPreviewEnabled || selectedOverlay !== "title") return;
    setActiveEditorSidebarTool("title");
    setDesktopSidebarOpen(true);
  }, [overlayPreviewEnabled, selectedOverlay]);
  useEffect(() => {
    if (!overlayPreviewEnabled || selectedOverlay !== "channel") return;
    setActiveEditorSidebarTool("channel");
    setDesktopSidebarOpen(true);
  }, [overlayPreviewEnabled, selectedOverlay]);
  useEffect(() => {
    if (
      !overlayPreviewEnabled
      || !isEditorTextSelection(selectedOverlay)
    ) {
      return;
    }
    setExpandedEditorTextId(selectedEditorTextId(selectedOverlay));
    setActiveEditorSidebarTool("text");
    setDesktopSidebarOpen(true);
  }, [overlayPreviewEnabled, selectedOverlay]);
  useEffect(() => {
    if (!overlayPreviewEnabled) return;
    try {
      setEditorChannelPresets(parseEditorChannelPresets(
        window.localStorage.getItem(EDITOR_CHANNEL_PRESET_STORAGE_KEY),
      ));
    } catch {
      setEditorChannelPresets([]);
    }
  }, [overlayPreviewEnabled]);
  useEffect(() => {
    if (!overlayPreviewEnabled) return;
    let cancelled = false;
    setEditorDraftLookupComplete(false);
    setEditorDraftDecisionComplete(false);
    setEditorDraftSavedAt(null);
    setEditorDraftSaveState("idle");
    const currentUrl = new URL(window.location.href);
    const entryChoice = currentUrl.searchParams.get("draftChoice");
    if (entryChoice === "continue" || entryChoice === "new") {
      currentUrl.searchParams.delete("draftChoice");
      window.history.replaceState(
        window.history.state,
        "",
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );
    }
    if (entryChoice === "new") {
      editorDraftHasSavedRef.current = false;
      setEditorDraftCandidate(null);
      setEditorDraftDecisionComplete(true);
      void deleteEditorDraft(item.id, item.renderVersion)
        .catch(() => {
          if (!cancelled) setEditorDraftSaveState("error");
        })
        .finally(() => {
          if (!cancelled) setEditorDraftLookupComplete(true);
        });
      return () => {
        cancelled = true;
      };
    }
    void readEditorDraft(item.id, item.renderVersion)
      .then((draft) => {
        if (cancelled) return;
        editorDraftHasSavedRef.current = Boolean(draft);
        setEditorDraftSavedAt(draft?.updatedAt || null);
        setEditorDraftCandidate(draft);
        setEditorDraftDecisionComplete(!draft);
      })
      .catch(() => {
        if (cancelled) return;
        setEditorDraftSaveState("error");
        setEditorDraftDecisionComplete(true);
      })
      .finally(() => {
        if (!cancelled) setEditorDraftLookupComplete(true);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.renderVersion, overlayPreviewEnabled]);
  useEffect(() => {
    if (!overlayPreviewEnabled || !editorDraftSavedAt) return;
    setEditorDraftStatusNow(Date.now());
    const interval = window.setInterval(() => {
      setEditorDraftStatusNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [editorDraftSavedAt, overlayPreviewEnabled]);
  useEffect(() => () => {
    if (editorDraftWriteTimerRef.current !== null) {
      window.clearTimeout(editorDraftWriteTimerRef.current);
    }
    const document = editorDraftLatestValidRef.current;
    if (
      !overlayPreviewEnabled
      || !document
      || !editorDraftNeedsWriteRef.current
    ) {
      return;
    }
    void writeEditorDraft(createEditorDraftRecord(document)).catch(
      () => undefined,
    );
  }, [overlayPreviewEnabled]);
  useEffect(() => {
    if (!overlayPreviewEnabled) return;
    const persistLatestDraft = () => {
      const document = editorDraftLatestValidRef.current;
      if (!document || !editorDraftNeedsWriteRef.current) return;
      void writeEditorDraft(createEditorDraftRecord(document)).catch(
        () => undefined,
      );
    };
    window.addEventListener("pagehide", persistLatestDraft);
    return () => window.removeEventListener("pagehide", persistLatestDraft);
  }, [overlayPreviewEnabled]);
  const toggleEditorSidebarTool = (
    tool: EditorSidebarTool,
  ) => {
    if (tool === "text") {
      if (activeEditorSidebarTool === tool) {
        setDesktopSidebarOpen((current) => !current);
        return;
      }
      setActiveEditorSidebarTool(tool);
      setDesktopSidebarOpen(true);
      return;
    }
    if (isEditorTextSelection(selectedOverlay)) {
      setInlineEditingOverlay(null);
      setSelectedOverlay(
        tool === "channel" && overlayLayoutRef.current.visible.channel
          ? "channel"
          : null,
      );
      setActiveEditorSidebarTool(tool);
      setDesktopSidebarOpen(true);
      return;
    }
    if (tool === "channel" && overlayLayoutRef.current.visible.channel) {
      setInlineEditingOverlay(null);
      setSelectedOverlay("channel");
    }
    if (activeEditorSidebarTool === tool) {
      setDesktopSidebarOpen((current) => !current);
      return;
    }
    setActiveEditorSidebarTool(tool);
    setDesktopSidebarOpen(true);
  };
  const editorDocumentSnapshot = useMemo(() => {
    const input: Parameters<typeof createEditorDocumentSnapshot>[0] = {
    sourceShortId: item.id,
    baseRenderVersion: item.renderVersion,
    template: {
      id: templateId,
      customTemplateId: activeCustomTemplate?.id || null,
      presetVersion,
      snapshot: activeCustomTemplate
        ? {
            id: activeCustomTemplate.id,
            name: activeCustomTemplate.name,
            baseTemplateId: activeCustomTemplate.baseTemplateId,
            config: activeCustomTemplate.config,
            version: activeCustomTemplate.version,
          }
        : { presetVersion },
    },
    title: {
      text: title,
      textStyles: titleTextStyles,
      fontScale: titleFontScale,
    },
    channel: {
      displayName: channel,
      thumbnailUrl: editorChannelThumbnailAssetKey
        ? null
        : editorChannelThumbnailUrl,
      thumbnailAssetKey: editorChannelThumbnailAssetKey,
    },
    comments,
    subtitles: {
      enabled: subtitlesEnabled,
      segments: cloneEditorSubtitleSegments(segments),
    },
    overlays: overlayLayout,
    video: {
      clips: videoClips,
      aspectRatio: item.videoAspectRatio || "1:1",
      timelineStartSeconds: editTimeline?.timelineStartSeconds
        ?? item.startSeconds,
      timelineEndSeconds: editTimeline?.timelineEndSeconds
        ?? item.endSeconds,
      selectionStartSeconds: selectionStart,
      selectionEndSeconds: selectionEnd,
    },
    };
    return editorRelease.documentVersion === 3
      ? createEditorDocumentSnapshotV3(input)
      : createEditorDocumentSnapshot(input);
  }, [
    activeCustomTemplate,
    channel,
    comments,
    editorChannelThumbnailUrl,
    editorChannelThumbnailAssetKey,
    item.id,
    item.endSeconds,
    item.renderVersion,
    item.startSeconds,
    item.videoAspectRatio,
    overlayLayout,
    presetVersion,
    selectionEnd,
    selectionStart,
    segments,
    subtitlesEnabled,
    templateId,
    title,
    titleFontScale,
    titleTextStyles,
    videoClips,
    editTimeline?.timelineEndSeconds,
    editTimeline?.timelineStartSeconds,
    editorRelease.documentVersion,
  ]);
  const saveEditorDraftNow = useCallback(async () => {
    if (
      !overlayPreviewEnabled
      || !editorGuideReady
      || !editorDraftLookupComplete
      || !editorDraftDecisionComplete
      || editorDraftCandidate
    ) {
      return false;
    }
    const parsed = editorDraftDocumentSnapshotSchema.safeParse(
      editorDocumentSnapshot,
    );
    if (!parsed.success) {
      setEditorDraftSaveState("error");
      return false;
    }
    if (editorDraftWriteTimerRef.current !== null) {
      window.clearTimeout(editorDraftWriteTimerRef.current);
      editorDraftWriteTimerRef.current = null;
    }
    const writeRevision = editorDraftWriteRevisionRef.current + 1;
    editorDraftWriteRevisionRef.current = writeRevision;
    const document = cloneEditorDocumentSnapshot(editorDocumentSnapshot);
    const serialized = JSON.stringify(parsed.data);
    const record = createEditorDraftRecord(document);
    editorDraftLatestValidRef.current = document;
    editorDraftNeedsWriteRef.current = true;
    setEditorDraftSaveState("saving");
    try {
      await writeEditorDraft(record);
      if (editorDraftWriteRevisionRef.current !== writeRevision) return true;
      editorDraftBaselineRef.current = serialized;
      editorDraftHasSavedRef.current = true;
      editorDraftNeedsWriteRef.current = false;
      setEditorDraftSavedAt(record.updatedAt);
      setEditorDraftStatusNow(Date.now());
      setEditorDraftSaveState("saved");
      return true;
    } catch {
      if (editorDraftWriteRevisionRef.current === writeRevision) {
        editorDraftNeedsWriteRef.current = true;
        setEditorDraftSaveState("error");
      }
      return false;
    }
  }, [
    editorDocumentSnapshot,
    editorDraftCandidate,
    editorDraftDecisionComplete,
    editorDraftLookupComplete,
    editorGuideReady,
    overlayPreviewEnabled,
  ]);
  useEffect(() => {
    if (!overlayPreviewEnabled) return;
    const handleEditorDraftShortcut = (event: KeyboardEvent) => {
      if (
        event.repeat
        || event.altKey
        || event.shiftKey
        || (!event.metaKey && !event.ctrlKey)
        || event.key.toLowerCase() !== "s"
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.isComposing) return;
      void saveEditorDraftNow();
    };
    window.addEventListener("keydown", handleEditorDraftShortcut, true);
    return () => window.removeEventListener(
      "keydown",
      handleEditorDraftShortcut,
      true,
    );
  }, [overlayPreviewEnabled, saveEditorDraftNow]);
  useEffect(() => {
    if (
      !overlayPreviewEnabled
      || !editorGuideReady
      || !editorDraftLookupComplete
      || !editorDraftDecisionComplete
      || editorDraftCandidate
    ) {
      return;
    }
    const parsed = editorDraftDocumentSnapshotSchema.safeParse(
      editorDocumentSnapshot,
    );
    if (!parsed.success) return;
    editorDraftLatestValidRef.current = cloneEditorDocumentSnapshot(
      editorDocumentSnapshot,
    );
    const serialized = JSON.stringify(parsed.data);
    if (editorDraftBaselineRef.current === null) {
      editorDraftBaselineRef.current = serialized;
      editorDraftNeedsWriteRef.current = false;
      return;
    }
    if (editorDraftBaselineRef.current === serialized) {
      editorDraftNeedsWriteRef.current = false;
      if (editorDraftWriteTimerRef.current !== null) {
        window.clearTimeout(editorDraftWriteTimerRef.current);
        editorDraftWriteTimerRef.current = null;
      }
      setEditorDraftSaveState(
        editorDraftHasSavedRef.current ? "saved" : "idle",
      );
      return;
    }
    if (editorDraftWriteTimerRef.current !== null) {
      window.clearTimeout(editorDraftWriteTimerRef.current);
    }
    const writeRevision = editorDraftWriteRevisionRef.current + 1;
    editorDraftWriteRevisionRef.current = writeRevision;
    editorDraftNeedsWriteRef.current = true;
    setEditorDraftSaveState("saving");
    const record = createEditorDraftRecord(editorDocumentSnapshot);
    editorDraftWriteTimerRef.current = window.setTimeout(() => {
      editorDraftWriteTimerRef.current = null;
      void writeEditorDraft(record)
        .then(() => {
          if (editorDraftWriteRevisionRef.current !== writeRevision) return;
          editorDraftBaselineRef.current = serialized;
          editorDraftHasSavedRef.current = true;
          editorDraftNeedsWriteRef.current = false;
          setEditorDraftSavedAt(record.updatedAt);
          setEditorDraftStatusNow(Date.now());
          setEditorDraftSaveState("saved");
        })
        .catch(() => {
          if (editorDraftWriteRevisionRef.current === writeRevision) {
            setEditorDraftSaveState("error");
          }
        });
    }, 800);
  }, [
    editorDocumentSnapshot,
    editorDraftCandidate,
    editorDraftDecisionComplete,
    editorDraftLookupComplete,
    editorGuideReady,
    overlayPreviewEnabled,
  ]);
  const renderOverlayLayout = editorDocumentSnapshot.overlays;
  const renderComments = editorDocumentSnapshot.comments;
  const renderTitle = editorDocumentSnapshot.title.text;
  const renderTitleTextStyles = editorDocumentSnapshot.title.textStyles;
  const renderTitleFontScale = editorDocumentSnapshot.title.fontScale;
  const renderChannel = editorDocumentSnapshot.channel.displayName;
  const renderChannelThumbnailUrl = editorDocumentSnapshot.channel.thumbnailAssetKey
    ? editorChannelAssetPreviewUrl(item.id, item.renderVersion)
    : editorDocumentSnapshot.channel.thumbnailUrl;
  const renderVideoClips = editorDocumentSnapshot.video.clips;
  const overlayOffsets = renderOverlayLayout.offsets;
  const videoScale = renderOverlayLayout.scales.video;
  const channelScale = renderOverlayLayout.scales.channel;
  const titleFontId = renderOverlayLayout.fonts?.title || DEFAULT_EDITOR_FONT_ID;
  const channelFontId = renderOverlayLayout.fonts?.channel || DEFAULT_EDITOR_FONT_ID;
  const renderSpec = editorDocumentSnapshot.version === 3
    ? editorDocumentSnapshot.renderSpec
    : null;
  const titleFontFamily = overlayPreviewEnabled
    ? renderSpec?.title.font.family || editorFontFamily(titleFontId)
    : undefined;
  const channelFontFamily = overlayPreviewEnabled
    ? renderSpec?.channel.font.family || editorFontFamily(channelFontId)
    : undefined;
  const editorCommentTheme: EditorCommentTheme = renderOverlayLayout.commentTheme
    || activeCustomTemplate?.config.comment.theme
    || "dark";
  const textOverlays = renderOverlayLayout.textOverlays;
  const selectedTextOverlayId = selectedEditorTextId(selectedOverlay);
  const selectedTextOverlay = selectedTextOverlayId
    ? textOverlays.find((textOverlay) => textOverlay.id === selectedTextOverlayId) || null
    : null;
  useEffect(() => {
    if (
      expandedEditorTextId
      && !textOverlays.some((textOverlay) => (
        textOverlay.id === expandedEditorTextId
      ))
    ) {
      setExpandedEditorTextId(null);
    }
  }, [expandedEditorTextId, textOverlays]);
  useEffect(() => {
    if (
      editorFontApplySuggestion
      && isEditorTextSelection(editorFontApplySuggestion.source)
      && !textOverlays.some((textOverlay) => (
        textOverlay.id === selectedEditorTextId(editorFontApplySuggestion.source)
      ))
    ) {
      setEditorFontApplySuggestion(null);
    }
  }, [editorFontApplySuggestion, textOverlays]);
  const validTitle = title.trim().length > 0 && title.length <= 80 && title.split("\n").length <= 2;
  const template = templates.find((value) => value.id === templateId) || templates[0];
  const editorCanvasBackground = renderOverlayLayout.background;
  const resolvedEditorCanvasBackground = editorCanvasBackground
    ? editorCanvasBackgroundStyle(editorCanvasBackground)
    : activeCustomTemplate
      ? customTemplateBackground(activeCustomTemplate)
      : { background: template.background };
  const editorTemplateSurfaceBackground = editorCanvasBackground
    ? editorCanvasBackground.kind === "color"
      ? editorCanvasBackground.color
      : "transparent"
    : template.background;
  const originalAspectRatio = item.videoAspectRatio || "1:1";
  const commentNeedsVerticalFit = templateId === "comment-capture" && originalAspectRatio === "9:16";
  const presetCommentVersion = activeCustomTemplate ? 0 : presetVersion;
  const usesLiftedCommentLayout = templateId === "comment-capture"
    && presetCommentVersion >= 2;
  const usesFixedPresetChannel = presetCommentVersion >= 3;
  const editorLayout = aspectLayout(
    originalAspectRatio,
    templateId === "comment-capture",
    usesLiftedCommentLayout,
  );
  const selectionDuration = Math.round((selectionEnd - selectionStart) * 1_000) / 1_000;
  const videoCuttingEnabled = overlayPreviewEnabled
    && Boolean(editTimeline)
    && renderVideoClips.length > 0;
  const videoSequenceDuration = editorVideoDuration(renderVideoClips);
  const timelineDuration = editTimeline
    ? Math.max(RANGE_EDIT_MIN_SECONDS, editTimeline.timelineEndSeconds - editTimeline.timelineStartSeconds)
    : RANGE_EDIT_MIN_SECONDS;
  const sourceSelectionLeft = editTimeline
    ? Math.max(0, Math.min(100, (selectionStart - editTimeline.timelineStartSeconds) / timelineDuration * 100))
    : 0;
  const sourceSelectionWidth = editTimeline
    ? Math.max(0, Math.min(100 - sourceSelectionLeft, selectionDuration / timelineDuration * 100))
    : 0;
  const videoOutputWidthPercent = videoCuttingEnabled
    ? Math.max(
        0,
        Math.min(
          100 - sourceSelectionLeft,
          videoSequenceDuration / timelineDuration * 100,
        ),
      )
    : sourceSelectionWidth;
  const selectionLeft = sourceSelectionLeft;
  const selectionWidth = videoCuttingEnabled
    ? videoOutputWidthPercent
    : sourceSelectionWidth;
  const playheadLeft = videoCuttingEnabled
    ? Math.max(
        sourceSelectionLeft,
        Math.min(
          sourceSelectionLeft + videoOutputWidthPercent,
          sourceSelectionLeft + videoSequenceTime / timelineDuration * 100,
        ),
      )
    : editTimeline
    ? Math.max(0, Math.min(100, previewTime / timelineDuration * 100))
    : 0;
  const timelineSelectionOffset = editTimeline
    ? selectionStart - editTimeline.timelineStartSeconds
    : 0;
  const relativePreviewTime = videoCuttingEnabled
    ? videoSequenceTime
    : editTimeline
      ? previewTime - timelineSelectionOffset
      : previewTime;
  const previewDuration = videoCuttingEnabled
    ? videoSequenceDuration
    : editTimeline
      ? selectionDuration
      : item.durationSeconds;
  const videoSplitSnapPoints = videoCuttingEnabled
    ? renderVideoClips.slice(0, -1).map((_, clipIndex) => (
        editorVideoDuration(renderVideoClips.slice(0, clipIndex + 1))
      ))
    : [];
  const canSplitCurrentVideoClip = videoCuttingEnabled
    && canSplitEditorVideoAtTime(renderVideoClips, videoSequenceTime);
  const selectedVideoClipIndex = selectedVideoClipId
    ? renderVideoClips.findIndex((clip) => clip.id === selectedVideoClipId)
    : -1;
  const selectedVideoClipOutputStart = selectedVideoClipIndex >= 0
    ? renderVideoClips
        .slice(0, selectedVideoClipIndex)
        .reduce(
          (duration, clip) => duration + editorVideoClipDuration(clip),
          0,
        )
    : 0;
  const selectedVideoClip = selectedVideoClipIndex >= 0
    ? renderVideoClips[selectedVideoClipIndex]
    : null;
  const displayedPreviewTime = Math.max(0, Math.min(previewDuration, relativePreviewTime));
  const previewSegments = segments;
  const activeSubtitleIndex = previewSegments.findIndex((segment) => (
    editTimeline
      ? segment.start <= previewTime && segment.end > previewTime
      : segment.start <= relativePreviewTime && segment.end > relativePreviewTime
  ));
  const activeSubtitle = activeSubtitleIndex >= 0
    ? previewSegments[activeSubtitleIndex]
    : null;
  const commentsForPreview = editTimeline
    ? scaleTimedRanges(renderComments, item.durationSeconds, previewDuration)
    : renderComments;
  const orderedCommentsForPreview = [...commentsForPreview].sort(
    (left, right) => left.startSeconds - right.startSeconds,
  );
  const activeComment = orderedCommentsForPreview.find((comment) => (
    comment.startSeconds <= relativePreviewTime
    && comment.endSeconds > relativePreviewTime
  )) || null;
  const layoutPreviewComment = activeComment;
  const commentOffsets = renderOverlayLayout.commentOffsets || {};
  const activeCommentOffset = layoutPreviewComment
    ? commentOffsets[layoutPreviewComment.id] || overlayOffsets.comment
    : overlayOffsets.comment;
  const canApplyActiveCommentPositionToAll = Boolean(
    layoutPreviewComment
    && renderComments.length > 1
    && renderComments.some((comment) => {
      const offset = commentOffsets[comment.id] || overlayOffsets.comment;
      return offset.x !== activeCommentOffset.x || offset.y !== activeCommentOffset.y;
    }),
  );
  const orderedComments = [...comments].sort((left, right) => left.startSeconds - right.startSeconds);
  const commentsAreValid = comments.every((comment) => Number.isFinite(comment.startSeconds) && Number.isFinite(comment.endSeconds) && comment.startSeconds >= 0 && comment.endSeconds > comment.startSeconds && comment.endSeconds <= item.durationSeconds + 0.001 && comment.text.trim().length > 0)
    && orderedComments.every((comment, index) => index === 0 || comment.startSeconds >= orderedComments[index - 1].endSeconds - 0.001);
  const validComments = comments.length > 0 && commentsAreValid;
  const validSelection = !editTimeline || previewDuration >= RANGE_EDIT_MIN_SECONDS;
  const editorValid = overlayPreviewEnabled
    ? validTitle
      && validSelection
      && channel.trim().length > 0
      && commentsAreValid
    : validTitle
      && validSelection
      && (templateId === "comment-capture"
        ? validComments
        : channel.trim().length > 0);
  const customTitleLines = wrapPreviewTitle(renderTitle);
  const customCommentY = activeCustomTemplate
    ? customCommentLayerY(activeCustomTemplate.config)
    : 0;
  const templateProvidesComments = templateId === "comment-capture"
    && (!activeCustomTemplate || activeCustomTemplate.config.comment.visible);
  const editorCommentOverlayEnabled = templateProvidesComments
    || (overlayPreviewEnabled && comments.length > 0);
  const commentOverlayMovable = editorCommentOverlayEnabled;
  const channelOverlayMovable = overlayPreviewEnabled
    || !activeCustomTemplate
    || activeCustomTemplate.config.channel.visible;
  const titleOverlayMovable = !activeCustomTemplate
    || activeCustomTemplate.config.title.visible;
  const availableOverlayLayers = useMemo<EditorOverlayLayer[]>(() => [
    "video",
    ...(titleOverlayMovable ? ["title" as const] : []),
    ...(commentOverlayMovable ? ["comment" as const] : []),
    ...(channelOverlayMovable ? ["channel" as const] : []),
  ], [
    channelOverlayMovable,
    commentOverlayMovable,
    titleOverlayMovable,
  ]);
  const visibleEditorLayerOrder = renderOverlayLayout.layerOrder.filter((item) => {
    if (isEditorTextSelection(item)) {
      const textId = selectedEditorTextId(item);
      return textOverlays.some((textOverlay) => textOverlay.id === textId);
    }
    return renderOverlayLayout.visible[item] && availableOverlayLayers.includes(item);
  });
  const selectedLayerOrderIndex = selectedOverlay === null
    ? -1
    : visibleEditorLayerOrder.indexOf(selectedOverlay);
  const selectedLayerOrderLabel = selectedOverlay === null
    ? null
    : isEditorTextSelection(selectedOverlay)
      ? "텍스트"
      : EDITOR_OVERLAY_LABELS[selectedOverlay];
  const canMoveSelectedLayerBackward = selectedOverlay !== "channel"
    && selectedLayerOrderIndex > 0;
  const canMoveSelectedLayerForward = selectedLayerOrderIndex >= 0
    && selectedOverlay !== "channel"
    && selectedLayerOrderIndex < visibleEditorLayerOrder.length - 1
    && visibleEditorLayerOrder[selectedLayerOrderIndex + 1] !== "channel";
  const scalableBaseOverlaySelection = selectedOverlay === "channel"
    ? selectedOverlay
    : null;
  const scalableOverlayScale = scalableBaseOverlaySelection === "channel"
    ? channelScale
    : selectedTextOverlay?.scale ?? null;
  const scalableOverlayLabel = scalableBaseOverlaySelection
    ? EDITOR_OVERLAY_LABELS[scalableBaseOverlaySelection]
    : selectedTextOverlay
      ? "텍스트"
      : null;
  const scalableOverlaySelection = scalableBaseOverlaySelection
    || (selectedTextOverlay ? editorTextSelection(selectedTextOverlay.id) : null);
  const activeTextOverlays = textOverlays.filter((textOverlay) => (
    textOverlay.startSeconds <= displayedPreviewTime
    && textOverlay.endSeconds > displayedPreviewTime
  ));
  const editorVideoBaseRect: CanvasRect = activeCustomTemplate
    ? {
        x: activeCustomTemplate.config.video.x,
        y: activeCustomTemplate.config.video.y,
        width: activeCustomTemplate.config.video.width,
        height: activeCustomTemplate.config.video.height,
      }
    : {
        x: 0,
        y: editorLayout.videoTop * 19.2,
        width: TEMPLATE_CANVAS.width,
        height: editorLayout.videoHeight * 19.2,
      };
  const editorVideoRect: CanvasRect = {
    x: editorVideoBaseRect.x
      + overlayOffsets.video.x
      - editorVideoBaseRect.width * (videoScale - 1) / 2,
    y: editorVideoBaseRect.y
      + overlayOffsets.video.y
      - editorVideoBaseRect.height * (videoScale - 1) / 2,
    width: editorVideoBaseRect.width * videoScale,
    height: editorVideoBaseRect.height * videoScale,
  };
  const editorVideoBottom = editorVideoRect.y + editorVideoRect.height;
  const editorOverlayZIndex = (item: EditorOverlayOrderItem) => {
    const index = overlayLayout.layerOrder.indexOf(item);
    return 10 + Math.max(0, index) * 10;
  };
  const overlayMovementStyle = (
    layer: EditorOverlayLayer,
    commentId?: string,
  ): CSSProperties | undefined => {
    if (!overlayPreviewEnabled) return undefined;
    const rawOffset = layer === "comment" && commentId
      ? commentOffsets[commentId] || overlayOffsets.comment
      : overlayOffsets[layer];
    const offset = layer === "title"
      ? lockEditorTitleHorizontalOffset(rawOffset)
      : rawOffset;
    const scale = layer === "channel" ? channelScale : null;
    return {
      zIndex: editorOverlayZIndex(layer),
      translate: canvasOffsetTranslate(offset),
      ...(scale === null
        ? {}
        : {
            scale: String(scale),
            transformOrigin: "center",
          }),
    };
  };
  const videoMovementStyle: CSSProperties | undefined = overlayPreviewEnabled
    ? {
        ...overlayMovementStyle("video"),
        scale: String(videoScale),
        transformOrigin: "center",
      }
    : undefined;

  const updateEditorOverlayLayout = useCallback((
    updater: (current: EditorOverlayLayoutSnapshot) => EditorOverlayLayoutSnapshot,
  ) => {
    const next = updater(overlayLayoutRef.current);
    overlayLayoutRef.current = next;
    setOverlayLayout(next);
  }, []);

  const applyEditorOverlayLayout = useCallback((
    layout: EditorOverlayLayoutSnapshot,
  ) => {
    const next = cloneEditorOverlayLayout(layout);
    overlayLayoutRef.current = next;
    setOverlayLayout(next);
    setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);
  }, []);

  const recordEditorOverlayStep = useCallback((
    before: EditorOverlayLayoutSnapshot,
    after: EditorOverlayLayoutSnapshot,
  ) => {
    const nextHistory = recordEditorOverlayHistory(
      overlayHistoryRef.current,
      before,
      after,
    );
    if (nextHistory === overlayHistoryRef.current) return;
    overlayHistoryRef.current = nextHistory;
    videoCutHistoryRef.current = {
      ...videoCutHistoryRef.current,
      future: [],
    };
    commentDeleteHistoryRef.current = {
      ...commentDeleteHistoryRef.current,
      future: [],
    };
    commentReplaceHistoryRef.current = {
      ...commentReplaceHistoryRef.current,
      future: [],
    };
    copyHistoryRef.current = {
      ...copyHistoryRef.current,
      future: [],
    };
    templateHistoryRef.current = {
      ...templateHistoryRef.current,
      future: [],
    };
    editorHistoryOrderRef.current = {
      past: [
        ...editorHistoryOrderRef.current.past,
        "overlay" as const,
      ].slice(-100),
      future: [],
    };
    setOverlayHistoryRevision((current) => current + 1);
  }, []);

  const recordEditorVideoStep = useCallback((
    before: EditorVideoClip[],
    after: EditorVideoClip[],
  ) => {
    const clipsEqual = before.length === after.length
      && before.every((clip, index) => {
        const other = after[index];
        return Boolean(
          other
          && clip.id === other.id
          && clip.sourceStartSeconds === other.sourceStartSeconds
          && clip.sourceEndSeconds === other.sourceEndSeconds,
        );
      });
    if (clipsEqual) return;
    videoCutHistoryRef.current = {
      past: [
        ...videoCutHistoryRef.current.past,
        cloneEditorVideoClips(before),
      ].slice(-100),
      future: [],
    };
    overlayHistoryRef.current = {
      ...overlayHistoryRef.current,
      future: [],
    };
    commentDeleteHistoryRef.current = {
      ...commentDeleteHistoryRef.current,
      future: [],
    };
    commentReplaceHistoryRef.current = {
      ...commentReplaceHistoryRef.current,
      future: [],
    };
    copyHistoryRef.current = {
      ...copyHistoryRef.current,
      future: [],
    };
    templateHistoryRef.current = {
      ...templateHistoryRef.current,
      future: [],
    };
    editorHistoryOrderRef.current = {
      past: [
        ...editorHistoryOrderRef.current.past,
        "video" as const,
      ].slice(-100),
      future: [],
    };
    setOverlayHistoryRevision((current) => current + 1);
  }, []);

  const recordEditorCommentDeletion = useCallback((
    entry: EditorCommentDeleteHistoryEntry,
  ) => {
    commentDeleteHistoryRef.current = {
      past: [
        ...commentDeleteHistoryRef.current.past,
        cloneEditorCommentDeleteHistoryEntry(entry),
      ].slice(-100),
      future: [],
    };
    overlayHistoryRef.current = {
      ...overlayHistoryRef.current,
      future: [],
    };
    videoCutHistoryRef.current = {
      ...videoCutHistoryRef.current,
      future: [],
    };
    commentReplaceHistoryRef.current = {
      ...commentReplaceHistoryRef.current,
      future: [],
    };
    copyHistoryRef.current = {
      ...copyHistoryRef.current,
      future: [],
    };
    templateHistoryRef.current = {
      ...templateHistoryRef.current,
      future: [],
    };
    editorHistoryOrderRef.current = {
      past: [
        ...editorHistoryOrderRef.current.past,
        "comment-delete" as const,
      ].slice(-100),
      future: [],
    };
    setOverlayHistoryRevision((current) => current + 1);
  }, []);

  const recordEditorCommentReplacement = useCallback((
    before: CommentOverlay[],
    after: CommentOverlay[],
  ) => {
    if (!editorCommentsChanged(before, after)) return;
    commentReplaceHistoryRef.current = {
      past: [
        ...commentReplaceHistoryRef.current.past,
        cloneEditorCommentReplaceHistoryEntry({ before, after }),
      ].slice(-100),
      future: [],
    };
    overlayHistoryRef.current = {
      ...overlayHistoryRef.current,
      future: [],
    };
    videoCutHistoryRef.current = {
      ...videoCutHistoryRef.current,
      future: [],
    };
    commentDeleteHistoryRef.current = {
      ...commentDeleteHistoryRef.current,
      future: [],
    };
    copyHistoryRef.current = {
      ...copyHistoryRef.current,
      future: [],
    };
    templateHistoryRef.current = {
      ...templateHistoryRef.current,
      future: [],
    };
    editorHistoryOrderRef.current = {
      past: [
        ...editorHistoryOrderRef.current.past,
        "comment-replace" as const,
      ].slice(-100),
      future: [],
    };
    setOverlayHistoryRevision((current) => current + 1);
  }, []);

  const currentEditorCopySnapshot = useCallback((): EditorCopySnapshot => ({
    title: titleRef.current,
    titleTextStyles: titleTextStylesRef.current.map((style) => ({ ...style })),
    titleFontScale: titleFontScaleRef.current,
    channel: channelRef.current,
    channelThumbnailUrl: editorChannelThumbnailUrlRef.current,
    channelThumbnailAssetKey: editorChannelThumbnailAssetKeyRef.current,
    subtitleSegments: cloneEditorSubtitleSegments(
      subtitleSegmentsRef.current,
    ),
  }), []);

  const applyEditorCopySnapshot = useCallback((snapshot: EditorCopySnapshot) => {
    const next = cloneEditorCopySnapshot(snapshot);
    titleRef.current = next.title;
    titleTextStylesRef.current = next.titleTextStyles;
    titleFontScaleRef.current = next.titleFontScale;
    channelRef.current = next.channel;
    editorChannelThumbnailUrlRef.current = next.channelThumbnailUrl;
    editorChannelThumbnailAssetKeyRef.current = next.channelThumbnailAssetKey;
    subtitleSegmentsRef.current = next.subtitleSegments;
    setTitle(next.title);
    setTitleTextStyles(next.titleTextStyles);
    setTitleFontScale(next.titleFontScale);
    setTitleTextColor(
      next.titleTextStyles.find((style) => style.color)?.color || "#FFFFFF",
    );
    setTitleBackgroundColor(
      next.titleTextStyles.find((style) => style.backgroundColor)
        ?.backgroundColor || "#E32626",
    );
    setChannel(next.channel);
    setEditorChannelThumbnailUrl(next.channelThumbnailUrl);
    setEditorChannelThumbnailAssetKey(next.channelThumbnailAssetKey);
    setSegments(next.subtitleSegments);
    setEditingSubtitleIndex(null);
    setTitleSelection(null);
  }, []);

  const recordEditorCopyChange = useCallback((
    before: EditorCopySnapshot,
    after: EditorCopySnapshot,
  ) => {
    if (editorCopySnapshotsEqual(before, after)) return;
    copyHistoryRef.current = {
      past: [
        ...copyHistoryRef.current.past,
        cloneEditorCopyHistoryEntry({ before, after }),
      ].slice(-100),
      future: [],
    };
    overlayHistoryRef.current = {
      ...overlayHistoryRef.current,
      future: [],
    };
    videoCutHistoryRef.current = {
      ...videoCutHistoryRef.current,
      future: [],
    };
    commentDeleteHistoryRef.current = {
      ...commentDeleteHistoryRef.current,
      future: [],
    };
    commentReplaceHistoryRef.current = {
      ...commentReplaceHistoryRef.current,
      future: [],
    };
    templateHistoryRef.current = {
      ...templateHistoryRef.current,
      future: [],
    };
    editorHistoryOrderRef.current = {
      past: [
        ...editorHistoryOrderRef.current.past,
        "copy" as const,
      ].slice(-100),
      future: [],
    };
    setOverlayHistoryRevision((current) => current + 1);
  }, []);

  const currentEditorTemplateSnapshot = useCallback(
    (): EditorTemplateSnapshot => ({
      templateId: templateIdRef.current,
      activeCustomTemplate: activeCustomTemplateRef.current,
      presetVersion: presetVersionRef.current,
      templateSelectionTouched: templateSelectionTouchedRef.current,
      overlayLayout: cloneEditorOverlayLayout(overlayLayoutRef.current),
    }),
    [],
  );

  const applyEditorTemplateSnapshot = useCallback((
    snapshot: EditorTemplateSnapshot,
  ) => {
    const next = cloneEditorTemplateSnapshot(snapshot);
    templateIdRef.current = next.templateId;
    activeCustomTemplateRef.current = next.activeCustomTemplate;
    presetVersionRef.current = next.presetVersion;
    templateSelectionTouchedRef.current = next.templateSelectionTouched;
    setTemplateId(next.templateId);
    setActiveCustomTemplate(next.activeCustomTemplate);
    setPresetVersion(next.presetVersion);
    setTemplateSelectionTouched(next.templateSelectionTouched);
    applyEditorOverlayLayout(next.overlayLayout);
  }, [applyEditorOverlayLayout]);

  const continueEditorDraft = useCallback(() => {
    const draft = editorDraftCandidate;
    if (!draft) return;
    const document = cloneEditorDocumentSnapshot(draft.document);
    const draftCustomTemplate = customTemplateFromEditorDraft(draft.document);
    const channelThumbnailUrl = document.channel.thumbnailAssetKey
      ? editorChannelAssetPreviewUrl(item.id, item.renderVersion)
      : document.channel.thumbnailUrl;

    videoRef.current?.pause();
    titleRef.current = document.title.text;
    titleTextStylesRef.current = document.title.textStyles;
    titleFontScaleRef.current = document.title.fontScale;
    channelRef.current = document.channel.displayName;
    editorChannelThumbnailUrlRef.current = channelThumbnailUrl;
    editorChannelThumbnailAssetKeyRef.current = document.channel.thumbnailAssetKey;
    subtitleSegmentsRef.current = cloneEditorSubtitleSegments(
      document.subtitles.segments,
    );
    commentsRef.current = cloneEditorComments(document.comments);
    templateIdRef.current = document.template.id;
    activeCustomTemplateRef.current = draftCustomTemplate;
    presetVersionRef.current = document.template.presetVersion;
    templateSelectionTouchedRef.current = true;
    overlayLayoutRef.current = cloneEditorOverlayLayout(document.overlays);
    videoClipsRef.current = cloneEditorVideoClips(document.video.clips);

    setTitle(document.title.text);
    setTitleTextStyles(document.title.textStyles.map((style) => ({ ...style })));
    setTitleFontScale(document.title.fontScale);
    setTitleTextColor(
      document.title.textStyles.find((style) => style.color)?.color || "#FFFFFF",
    );
    setTitleBackgroundColor(
      document.title.textStyles.find((style) => style.backgroundColor)
        ?.backgroundColor || "#E32626",
    );
    setChannel(document.channel.displayName);
    setEditorChannelThumbnailUrl(channelThumbnailUrl);
    setEditorChannelThumbnailAssetKey(document.channel.thumbnailAssetKey);
    setSubtitlesEnabled(document.subtitles.enabled);
    setSegments(cloneEditorSubtitleSegments(document.subtitles.segments));
    setComments(cloneEditorComments(document.comments));
    setTemplateId(document.template.id);
    setActiveCustomTemplate(draftCustomTemplate);
    setPresetVersion(document.template.presetVersion);
    setTemplateSelectionTouched(true);
    setOverlayLayout(cloneEditorOverlayLayout(document.overlays));
    setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);
    setVideoClips(cloneEditorVideoClips(document.video.clips));
    setSelectionStart(document.video.selectionStartSeconds);
    setSelectionEnd(document.video.selectionEndSeconds);
    setSelectedVideoClipId(document.video.clips[0]?.id || null);
    setSelectedOverlay(null);
    setInlineEditingOverlay(null);
    setEditingSubtitleIndex(null);
    setTitleSelection(null);
    setVideoSequenceTime(0);
    videoSequenceTimeRef.current = 0;
    activeVideoClipIndexRef.current = 0;
    setVideoRippleRevision((current) => current + 1);

    overlayHistoryRef.current = { past: [], future: [] };
    videoCutHistoryRef.current = { past: [], future: [] };
    commentDeleteHistoryRef.current = { past: [], future: [] };
    commentReplaceHistoryRef.current = { past: [], future: [] };
    copyHistoryRef.current = { past: [], future: [] };
    templateHistoryRef.current = { past: [], future: [] };
    editorHistoryOrderRef.current = { past: [], future: [] };
    setOverlayHistoryRevision((current) => current + 1);

    editorDraftBaselineRef.current = JSON.stringify(draft.document);
    editorDraftHasSavedRef.current = true;
    editorDraftNeedsWriteRef.current = false;
    editorDraftLatestValidRef.current = cloneEditorDocumentSnapshot(
      draft.document,
    );
    setEditorDraftSavedAt(draft.updatedAt);
    setEditorDraftStatusNow(Date.now());
    setEditorDraftSaveState("saved");
    setEditorDraftCandidate(null);
    setEditorDraftDecisionComplete(true);
    window.requestAnimationFrame(() => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = document.video.clips[0]?.sourceStartSeconds || 0;
    });
  }, [editorDraftCandidate, item.id, item.renderVersion]);

  useEffect(() => {
    if (
      !overlayPreviewEnabled
      || !editorGuideReady
      || !editorDraftLookupComplete
      || !editorDraftCandidate
    ) {
      return;
    }
    continueEditorDraft();
  }, [
    continueEditorDraft,
    editorDraftCandidate,
    editorDraftLookupComplete,
    editorGuideReady,
    overlayPreviewEnabled,
  ]);

  const recordEditorTemplateChange = useCallback((
    before: EditorTemplateSnapshot,
    after: EditorTemplateSnapshot,
  ) => {
    if (editorTemplateSnapshotsEqual(before, after)) return;
    templateHistoryRef.current = {
      past: [
        ...templateHistoryRef.current.past,
        cloneEditorTemplateHistoryEntry({ before, after }),
      ].slice(-100),
      future: [],
    };
    overlayHistoryRef.current = {
      ...overlayHistoryRef.current,
      future: [],
    };
    videoCutHistoryRef.current = {
      ...videoCutHistoryRef.current,
      future: [],
    };
    commentDeleteHistoryRef.current = {
      ...commentDeleteHistoryRef.current,
      future: [],
    };
    commentReplaceHistoryRef.current = {
      ...commentReplaceHistoryRef.current,
      future: [],
    };
    copyHistoryRef.current = {
      ...copyHistoryRef.current,
      future: [],
    };
    editorHistoryOrderRef.current = {
      past: [
        ...editorHistoryOrderRef.current.past,
        "template" as const,
      ].slice(-100),
      future: [],
    };
    setOverlayHistoryRevision((current) => current + 1);
  }, []);

  const beginEditorCommentTextInteraction = useCallback(() => {
    if (!overlayPreviewEnabled || commentTextInteractionStartRef.current) return;
    commentTextInteractionStartRef.current = cloneEditorComments(commentsRef.current);
  }, [overlayPreviewEnabled]);

  const finishEditorCommentTextInteraction = useCallback(() => {
    const before = commentTextInteractionStartRef.current;
    commentTextInteractionStartRef.current = null;
    if (!before) return;
    recordEditorCommentReplacement(before, commentsRef.current);
  }, [recordEditorCommentReplacement]);

  const beginEditorCopyInteraction = useCallback(() => {
    if (!overlayPreviewEnabled || copyInteractionStartRef.current) return;
    copyInteractionStartRef.current = currentEditorCopySnapshot();
  }, [currentEditorCopySnapshot, overlayPreviewEnabled]);

  const finishEditorCopyInteraction = useCallback(() => {
    const before = copyInteractionStartRef.current;
    copyInteractionStartRef.current = null;
    if (!before) return;
    recordEditorCopyChange(before, currentEditorCopySnapshot());
  }, [currentEditorCopySnapshot, recordEditorCopyChange]);

  const chooseRegeneratedComment = useCallback((
    index: number,
    choice: CommentRegenerationChoice,
  ) => {
    setCommentRegenerationComparison((current) => {
      if (!current || index < 0 || index >= current.choices.length) return current;
      const choices = [...current.choices];
      choices[index] = choice;
      return { ...current, choices };
    });
  }, []);

  const chooseAllRegeneratedComments = useCallback((
    choice: CommentRegenerationChoice,
  ) => {
    setCommentRegenerationComparison((current) => current
      ? { ...current, choices: current.choices.map(() => choice) }
      : current);
  }, []);

  const updateRegeneratedCommentText = useCallback((
    index: number,
    choice: CommentRegenerationChoice,
    text: string,
  ) => {
    setCommentRegenerationComparison((current) => {
      if (!current || index < 0 || index >= current.choices.length) return current;
      const choices = [...current.choices];
      choices[index] = choice;
      if (choice === "existing") {
        const existingTexts = [...current.existingTexts];
        existingTexts[index] = text;
        return { ...current, choices, existingTexts };
      }
      const generatedTexts = [...current.generatedTexts];
      generatedTexts[index] = text;
      return { ...current, choices, generatedTexts };
    });
  }, []);

  const cancelRegeneratedCommentComparison = useCallback(() => {
    setCommentRegenerationComparison(null);
  }, []);

  const applyRegeneratedCommentComparison = useCallback(() => {
    const comparison = commentRegenerationComparison;
    if (!comparison) return;
    const selectedTexts = comparison.before.map((_, index) => (
      comparison.choices[index] === "generated"
        ? comparison.generatedTexts[index]
        : comparison.existingTexts[index]
    ).trim());
    if (selectedTexts.some((text) => !text || text.length > EDITOR_COMMENT_MAX_CHARS)) {
      return;
    }
    const after = comparison.before.map((comment, index) => ({
      ...comment,
      text: selectedTexts[index],
    }));
    commentsRef.current = after;
    setComments(after);
    recordEditorCommentReplacement(comparison.before, after);
    setSelectedOverlay("comment");
    setInlineEditingOverlay(null);
    setCommentRegenerationComparison(null);
  }, [commentRegenerationComparison, recordEditorCommentReplacement]);

  const regenerateEditorComments = useCallback(async () => {
    if (!overlayPreviewEnabled || commentRegenerationInFlightRef.current) return;
    const before = cloneEditorComments(commentsRef.current);
    if (before.length === 0) {
      setCommentRegenerationError("재생성할 댓글을 먼저 추가해 주세요.");
      return;
    }

    const requestId = commentRegenerationRequestIdRef.current
      || globalThis.crypto.randomUUID();
    commentRegenerationRequestIdRef.current = requestId;
    commentRegenerationInFlightRef.current = true;
    setRegeneratingComments(true);
    setCommentRegenerationError(null);
    try {
      const result = await requestJson<{
        comments: string[];
        usage: UsageSnapshot;
      }>(
        `/api/shorts/${item.id}/regenerate-comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            commentCount: before.length,
          }),
        },
        75_000,
      );
      if (
        !Array.isArray(result.comments)
        || result.comments.length !== before.length
        || result.comments.some((comment) => (
          typeof comment !== "string" || !comment.trim()
        ))
      ) {
        throw new Error("생성된 댓글 개수가 현재 댓글 오버레이와 맞지 않습니다.");
      }
      publishUsageSnapshot(result.usage);
      setCommentRegenerationComparison({
        before,
        existingTexts: before.map((comment) => comment.text),
        generatedTexts: result.comments.map((comment) => comment.trim()),
        choices: result.comments.map(() => "generated"),
      });
      commentRegenerationRequestIdRef.current = null;
      setCommentRegenerationConfirmationOpen(false);
    } catch (cause) {
      if (
        cause instanceof HttpRequestError
        && cause.code === "COMMENT_REGENERATION_FAILED"
      ) {
        commentRegenerationRequestIdRef.current = null;
      }
      setCommentRegenerationError(userFacingErrorMessage(
        cause,
        "댓글을 재생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      ));
    } finally {
      commentRegenerationInFlightRef.current = false;
      setRegeneratingComments(false);
    }
  }, [
    item.id,
    overlayPreviewEnabled,
  ]);

  const beginEditorOverlayHistoryInteraction = useCallback(() => {
    if (overlayInteractionStartRef.current) return;
    overlayInteractionStartRef.current = cloneEditorOverlayLayout(
      overlayLayoutRef.current,
    );
  }, []);

  const finishEditorOverlayHistoryInteraction = useCallback(() => {
    const before = overlayInteractionStartRef.current;
    overlayInteractionStartRef.current = null;
    if (!before) return;
    recordEditorOverlayStep(before, overlayLayoutRef.current);
  }, [recordEditorOverlayStep]);

  const commitEditorOverlayLayoutChange = useCallback((
    updater: (current: EditorOverlayLayoutSnapshot) => EditorOverlayLayoutSnapshot,
  ) => {
    const before = cloneEditorOverlayLayout(overlayLayoutRef.current);
    const after = updater(before);
    applyEditorOverlayLayout(after);
    recordEditorOverlayStep(before, after);
  }, [applyEditorOverlayLayout, recordEditorOverlayStep]);

  const applyActiveCommentPositionToAll = useCallback(() => {
    if (!layoutPreviewComment || commentsRef.current.length < 2) return;
    const activeCommentId = layoutPreviewComment.id;
    commitEditorOverlayLayoutChange((current) => {
      const position = current.commentOffsets?.[activeCommentId]
        || current.offsets.comment;
      const nextCommentOffsets = {
        ...(current.commentOffsets || {}),
      };
      commentsRef.current.forEach((comment) => {
        nextCommentOffsets[comment.id] = { ...position };
      });
      return {
        ...current,
        offsets: {
          ...current.offsets,
          comment: { ...position },
        },
        commentOffsets: nextCommentOffsets,
      };
    });
    setSelectedOverlay("comment");
  }, [
    commitEditorOverlayLayoutChange,
    layoutPreviewComment,
  ]);

  const persistEditorChannelPresets = useCallback((
    presets: EditorChannelPreset[],
  ) => {
    try {
      window.localStorage.setItem(
        EDITOR_CHANNEL_PRESET_STORAGE_KEY,
        serializeEditorChannelPresets(presets),
      );
      setEditorChannelPresets(presets);
      return true;
    } catch {
      setChannelPresetError(
        "이 브라우저에 채널명을 저장하지 못했습니다. 저장 공간을 확인해 주세요.",
      );
      return false;
    }
  }, []);

  const applyEditorChannelPreset = useCallback((
    preset: EditorChannelPreset,
  ) => {
    const before = currentEditorCopySnapshot();
    channelRef.current = preset.name;
    editorChannelThumbnailUrlRef.current = preset.imageDataUrl;
    editorChannelThumbnailAssetKeyRef.current = null;
    setChannel(preset.name);
    setEditorChannelThumbnailUrl(preset.imageDataUrl);
    setEditorChannelThumbnailAssetKey(null);
    recordEditorCopyChange(before, currentEditorCopySnapshot());
    if (!overlayLayoutRef.current.visible.channel) {
      commitEditorOverlayLayoutChange((current) => ({
        ...current,
        visible: {
          ...current.visible,
          channel: true,
        },
      }));
    }
    setInlineEditingOverlay(null);
    setSelectedOverlay("channel");
  }, [
    commitEditorOverlayLayoutChange,
    currentEditorCopySnapshot,
    recordEditorCopyChange,
  ]);

  const updateChannelPresetDraftImage = useCallback(async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setChannelPresetImageBusy(true);
    setChannelPresetError(null);
    try {
      setChannelPresetDraftImageDataUrl(
        await createEditorChannelPresetImageDataUrl(file),
      );
    } catch (cause) {
      setChannelPresetError(userFacingErrorMessage(
        cause,
        "채널 이미지를 처리하지 못했습니다.",
      ));
    } finally {
      setChannelPresetImageBusy(false);
    }
  }, []);

  const saveEditorChannelPreset = useCallback(() => {
    const name = channelPresetDraftName.trim();
    if (!name) {
      setChannelPresetError("채널명을 입력해 주세요.");
      return;
    }
    if (!channelPresetDraftImageDataUrl) {
      setChannelPresetError("채널 이미지를 선택해 주세요.");
      return;
    }
    if (editorChannelPresets.length >= EDITOR_CHANNEL_PRESET_LIMIT) {
      setChannelPresetError(`내 채널명은 최대 ${EDITOR_CHANNEL_PRESET_LIMIT}개까지 저장할 수 있습니다.`);
      return;
    }
    const preset: EditorChannelPreset = {
      id: globalThis.crypto.randomUUID(),
      name,
      imageDataUrl: channelPresetDraftImageDataUrl,
    };
    const nextPresets = [preset, ...editorChannelPresets];
    if (!persistEditorChannelPresets(nextPresets)) return;
    applyEditorChannelPreset(preset);
    setChannelPresetDraftName("");
    setChannelPresetDraftImageDataUrl(null);
    setChannelPresetError(null);
    setChannelPresetComposerOpen(false);
  }, [
    applyEditorChannelPreset,
    channelPresetDraftImageDataUrl,
    channelPresetDraftName,
    editorChannelPresets,
    persistEditorChannelPresets,
  ]);

  const deleteEditorChannelPreset = useCallback((presetId: string) => {
    const nextPresets = editorChannelPresets.filter(
      (preset) => preset.id !== presetId,
    );
    persistEditorChannelPresets(nextPresets);
  }, [editorChannelPresets, persistEditorChannelPresets]);

  const updateEditorChannelThumbnail = useCallback(async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const before = currentEditorCopySnapshot();
    setChannelPresetImageBusy(true);
    setChannelPresetError(null);
    try {
      const dataUrl = await createEditorChannelPresetImageDataUrl(file);
      editorChannelThumbnailUrlRef.current = dataUrl;
      editorChannelThumbnailAssetKeyRef.current = null;
      setEditorChannelThumbnailUrl(dataUrl);
      setEditorChannelThumbnailAssetKey(null);
      recordEditorCopyChange(before, currentEditorCopySnapshot());
    } catch (cause) {
      setChannelPresetError(userFacingErrorMessage(
        cause,
        "채널 이미지를 처리하지 못했습니다.",
      ));
    } finally {
      setChannelPresetImageBusy(false);
    }
  }, [currentEditorCopySnapshot, recordEditorCopyChange]);

  useEffect(() => () => {
    editorChannelThumbnailObjectUrlsRef.current.forEach((objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    });
    editorChannelThumbnailObjectUrlsRef.current.clear();
  }, []);

  const updateEditorTextOverlay = useCallback((
    id: string,
    updater: (current: EditorTextOverlay) => EditorTextOverlay,
  ) => {
    updateEditorOverlayLayout((current) => ({
      ...current,
      textOverlays: current.textOverlays.map((textOverlay) => (
        textOverlay.id === id ? updater(textOverlay) : textOverlay
      )),
    }));
  }, [updateEditorOverlayLayout]);

  const beginEditorTitleInlineEdit = useCallback(() => {
    if (!overlayPreviewEnabled) return;
    overlayDragCleanupRef.current?.();
    beginEditorCopyInteraction();
    setSelectedOverlay("title");
    setInlineEditingOverlay("title");
  }, [beginEditorCopyInteraction, overlayPreviewEnabled]);

  const updateEditorTitleInlineValue = useCallback((value: string) => {
    const twoLines = value.split("\n").slice(0, 2).join("\n");
    const nextTitle = Array.from(twoLines).slice(0, 80).join("");
    const nextTitleTextStyles = overlayPreviewEnabled
      ? rebaseTitleTextStyles(
        titleRef.current,
        nextTitle,
        titleTextStylesRef.current,
      )
      : [];
    titleRef.current = nextTitle;
    titleTextStylesRef.current = nextTitleTextStyles;
    setTitle(nextTitle);
    setTitleTextStyles(nextTitleTextStyles);
    setTitleSelection(null);
  }, [overlayPreviewEnabled]);

  const beginEditorTextInlineEdit = useCallback((id: string) => {
    if (!overlayPreviewEnabled) return;
    overlayDragCleanupRef.current?.();
    beginEditorOverlayHistoryInteraction();
    const selection = editorTextSelection(id);
    setSelectedOverlay(selection);
    setInlineEditingOverlay(selection);
  }, [beginEditorOverlayHistoryInteraction, overlayPreviewEnabled]);

  const updateEditorTextInlineValue = useCallback((
    id: string,
    value: string,
  ) => {
    updateEditorTextOverlay(id, (textOverlay) => ({
      ...textOverlay,
      text: value,
    }));
  }, [updateEditorTextOverlay]);

  const finishEditorInlineEdit = useCallback(() => {
    if (inlineEditingOverlay === "title") {
      finishEditorCopyInteraction();
    } else if (isEditorTextSelection(inlineEditingOverlay)) {
      finishEditorOverlayHistoryInteraction();
    }
    setInlineEditingOverlay(null);
  }, [
    finishEditorCopyInteraction,
    finishEditorOverlayHistoryInteraction,
    inlineEditingOverlay,
  ]);

  const finishPendingEditorInteractions = useCallback(() => {
    finishEditorCommentTextInteraction();
    if (inlineEditingOverlay !== null) finishEditorInlineEdit();
    finishEditorOverlayHistoryInteraction();
    finishEditorCopyInteraction();
  }, [
    finishEditorCommentTextInteraction,
    finishEditorCopyInteraction,
    finishEditorInlineEdit,
    finishEditorOverlayHistoryInteraction,
    inlineEditingOverlay,
  ]);

  const clearEditorOverlaySelection = useCallback(() => {
    finishPendingEditorInteractions();
    setSelectedOverlay(null);
    setSelectedVideoClipId(null);
    setInlineEditingOverlay(null);
    setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);
  }, [finishPendingEditorInteractions]);

  const addEditorTextOverlay = useCallback(() => {
    if (!overlayPreviewEnabled || overlayLayoutRef.current.textOverlays.length >= EDITOR_TEXT_OVERLAY_LIMIT) {
      return;
    }
    const id = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `local-${Date.now()}`;
    const before = cloneEditorOverlayLayout(overlayLayoutRef.current);
    const after = cloneEditorOverlayLayout(before);
    const selection = editorTextSelection(id);
    after.textOverlays.push(createEditorTextOverlay(id, previewDuration));
    after.layerOrder.push(selection);
    applyEditorOverlayLayout(after);
    recordEditorOverlayStep(before, after);
    setSelectedOverlay(selection);
  }, [
    applyEditorOverlayLayout,
    overlayPreviewEnabled,
    previewDuration,
    recordEditorOverlayStep,
  ]);

  const deleteSelectedEditorOverlay = useCallback(() => {
    if (
      !overlayPreviewEnabled
      || selectedOverlay === null
      || selectedOverlay === "video"
    ) {
      return;
    }
    const before = cloneEditorOverlayLayout(overlayLayoutRef.current);
    const after = cloneEditorOverlayLayout(before);
    setInlineEditingOverlay(null);
    if (isEditorTextSelection(selectedOverlay)) {
      const textId = selectedEditorTextId(selectedOverlay);
      after.textOverlays = after.textOverlays.filter(
        (textOverlay) => textOverlay.id !== textId,
      );
      after.layerOrder = after.layerOrder.filter(
        (item) => item !== selectedOverlay,
      );
    } else {
      after.visible[selectedOverlay] = false;
    }
    applyEditorOverlayLayout(after);
    recordEditorOverlayStep(before, after);
    setSelectedOverlay(null);
  }, [
    applyEditorOverlayLayout,
    overlayPreviewEnabled,
    recordEditorOverlayStep,
    selectedOverlay,
  ]);

  const deleteEditorComment = useCallback((id: string) => {
    const current = commentsRef.current;
    const commentIndex = current.findIndex((comment) => comment.id === id);
    if (commentIndex < 0) return;
    const commentOffset = overlayLayoutRef.current.commentOffsets[id] || null;
    recordEditorCommentDeletion({
      comment: current[commentIndex],
      index: commentIndex,
      offset: commentOffset ? { ...commentOffset } : null,
    });
    const next = current.filter((comment) => comment.id !== id);
    commentsRef.current = next;
    setComments(next);
    if (commentOffset) {
      const nextLayout = cloneEditorOverlayLayout(overlayLayoutRef.current);
      delete nextLayout.commentOffsets[id];
      applyEditorOverlayLayout(nextLayout);
    }
    setSelectedOverlay(null);
    setInlineEditingOverlay(null);
  }, [applyEditorOverlayLayout, recordEditorCommentDeletion]);

  const seekEditorVideoSequence = useCallback((
    outputSeconds: number,
    pauseBeforeSeek = true,
  ) => {
    const clips = videoClipsRef.current;
    const located = locateEditorVideoTime(clips, outputSeconds);
    if (!located) return;
    const video = videoRef.current;
    if (pauseBeforeSeek) video?.pause();
    activeVideoClipIndexRef.current = located.clipIndex;
    videoSequenceTimeRef.current = located.outputSeconds;
    setVideoSequenceTime(located.outputSeconds);
    setPreviewTime(located.sourceSeconds);
    if (video) video.currentTime = located.sourceSeconds;
  }, []);

  const applyEditorVideoClipsSnapshot = useCallback((
    snapshot: EditorVideoClip[],
  ) => {
    if (!editTimeline || snapshot.length === 0) return;
    const nextClips = cloneEditorVideoClips(snapshot);
    const nextDuration = editorVideoDuration(nextClips);
    const currentSelectedClipId = selectedVideoClipId;
    const nextSelectedClipId = nextClips.some(
      (clip) => clip.id === currentSelectedClipId,
    )
      ? currentSelectedClipId
      : nextClips[0]?.id || null;
    videoRef.current?.pause();
    videoClipsRef.current = nextClips;
    setVideoClips(nextClips);
    setSelectionStart(
      editTimeline.timelineStartSeconds + nextClips[0].sourceStartSeconds,
    );
    setSelectionEnd(
      editTimeline.timelineStartSeconds
        + nextClips[nextClips.length - 1].sourceEndSeconds,
    );
    setSelectedVideoClipId(nextSelectedClipId);
    setSelectedOverlay(null);
    setInlineEditingOverlay(null);
    setVideoRippleRevision((current) => current + 1);
    seekEditorVideoSequence(Math.min(
      videoSequenceTimeRef.current,
      Math.max(0, nextDuration - 0.001),
    ));
  }, [
    editTimeline,
    seekEditorVideoSequence,
    selectedVideoClipId,
  ]);

  const splitCurrentEditorVideo = useCallback(() => {
    if (!overlayPreviewEnabled || !editTimeline) return;
    const clips = cloneEditorVideoClips(videoClipsRef.current);
    const rightClipId = globalThis.crypto?.randomUUID
      ? `video-clip-${globalThis.crypto.randomUUID()}`
      : `video-clip-${Date.now()}`;
    const result = splitEditorVideoAtTime(
      clips,
      videoSequenceTimeRef.current,
      rightClipId,
    );
    if (!result) return;
    videoRef.current?.pause();
    recordEditorVideoStep(clips, result.clips);
    videoClipsRef.current = result.clips;
    setVideoClips(result.clips);
    setSelectedVideoClipId(result.selectedClipId);
    setSelectedOverlay(null);
    setInlineEditingOverlay(null);
  }, [
    editTimeline,
    overlayPreviewEnabled,
    recordEditorVideoStep,
  ]);

  const beginEditorVideoClipTrim = useCallback((
    clipId: string,
    edge: "start" | "end",
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (
      !overlayPreviewEnabled
      || !editTimeline
      || event.button !== 0
      || !filmstripRef.current
    ) {
      return;
    }
    const clips = cloneEditorVideoClips(videoClipsRef.current);
    const clipIndex = clips.findIndex((clip) => clip.id === clipId);
    const clip = clips[clipIndex];
    if (!clip) return;
    event.preventDefault();
    event.stopPropagation();
    videoClipTrimCleanupRef.current?.();
    videoRef.current?.pause();
    setSelectedVideoClipId(clipId);
    setSelectedOverlay(null);
    setInlineEditingOverlay(null);

    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    const trackWidth = filmstripRef.current.getBoundingClientRect().width;
    const initialDuration = editorVideoDuration(clips);
    const minimumSourceSeconds = clips[clipIndex - 1]?.sourceEndSeconds ?? 0;
    const maximumSourceSeconds = clips[clipIndex + 1]?.sourceStartSeconds
      ?? editTimeline.timelineEndSeconds - editTimeline.timelineStartSeconds;
    captureTarget.setPointerCapture(pointerId);

    const updateTrim = (clientX: number) => {
      const deltaSeconds = (clientX - startClientX)
        / Math.max(1, trackWidth)
        * initialDuration;
      const nextClip = edge === "start"
        ? {
            ...clip,
            sourceStartSeconds: Math.max(
              minimumSourceSeconds,
              Math.min(
                clip.sourceEndSeconds - EDITOR_VIDEO_MIN_CLIP_SECONDS,
                clip.sourceStartSeconds + deltaSeconds,
              ),
            ),
          }
        : {
            ...clip,
            sourceEndSeconds: Math.max(
              clip.sourceStartSeconds + EDITOR_VIDEO_MIN_CLIP_SECONDS,
              Math.min(
                maximumSourceSeconds,
                clip.sourceEndSeconds + deltaSeconds,
              ),
            ),
          };
      const nextClips = clips.map((value, index) => (
        index === clipIndex ? nextClip : value
      ));
      videoClipsRef.current = nextClips;
      setVideoClips(nextClips);
      if (clipIndex === 0) {
        setSelectionStart(
          editTimeline.timelineStartSeconds + nextClip.sourceStartSeconds,
        );
      }
      if (clipIndex === nextClips.length - 1) {
        setSelectionEnd(
          editTimeline.timelineStartSeconds + nextClip.sourceEndSeconds,
        );
      }
      const outputStartSeconds = nextClips
        .slice(0, clipIndex)
        .reduce(
          (duration, value) => duration + editorVideoClipDuration(value),
          0,
        );
      seekEditorVideoSequence(
        edge === "start"
          ? outputStartSeconds
          : outputStartSeconds
            + editorVideoClipDuration(nextClip)
            - 0.001,
      );
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      updateTrim(moveEvent.clientX);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      videoClipTrimCleanupRef.current = null;
    };
    const finish = (finishEvent: globalThis.PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
      recordEditorVideoStep(clips, videoClipsRef.current);
      cleanup();
    };
    videoClipTrimCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [
    editTimeline,
    overlayPreviewEnabled,
    recordEditorVideoStep,
    seekEditorVideoSequence,
  ]);

  const deleteSelectedEditorVideoClip = useCallback(() => {
    if (!overlayPreviewEnabled || !selectedVideoClipId) return;
    const clipsBeforeDelete = cloneEditorVideoClips(videoClipsRef.current);
    const result = deleteEditorVideoClip(
      clipsBeforeDelete,
      selectedVideoClipId,
      RANGE_EDIT_MIN_SECONDS,
    );
    if (!result) return;
    videoRef.current?.pause();
    recordEditorVideoStep(clipsBeforeDelete, result.clips);
    videoClipsRef.current = result.clips;
    setVideoClips(result.clips);
    setSelectedVideoClipId(result.selectedClipId);
    setVideoRippleRevision((current) => current + 1);
    const nextDuration = editorVideoDuration(result.clips);
    seekEditorVideoSequence(Math.min(
      result.removedOutputStartSeconds,
      Math.max(0, nextDuration - 0.001),
    ));
  }, [
    overlayPreviewEnabled,
    recordEditorVideoStep,
    seekEditorVideoSequence,
    selectedVideoClipId,
  ]);

  const resetEditorVideoCuts = useCallback(() => {
    if (!editTimeline) return;
    const clipsBeforeReset = cloneEditorVideoClips(videoClipsRef.current);
    const initialClips = createEditorVideoClips(
      editTimeline.initialStartSeconds - editTimeline.timelineStartSeconds,
      editTimeline.initialEndSeconds - editTimeline.timelineStartSeconds,
    );
    recordEditorVideoStep(clipsBeforeReset, initialClips);
    setSelectionStart(editTimeline.initialStartSeconds);
    setSelectionEnd(editTimeline.initialEndSeconds);
    videoClipsRef.current = initialClips;
    setVideoClips(initialClips);
    setSelectedVideoClipId(initialClips[0]?.id || null);
    setSelectedOverlay(null);
    setVideoRippleRevision((current) => current + 1);
    seekEditorVideoSequence(0);
  }, [
    editTimeline,
    recordEditorVideoStep,
    seekEditorVideoSequence,
  ]);

  const undoEditorEdit = useCallback(() => {
    const historyOrder = editorHistoryOrderRef.current;
    const action = historyOrder.past.at(-1);
    if (!action) return;
    if (action === "overlay") {
      const result = undoEditorOverlayHistory(
        overlayHistoryRef.current,
        overlayLayoutRef.current,
      );
      if (!result.layout) return;
      overlayHistoryRef.current = result.history;
      applyEditorOverlayLayout(result.layout);
    } else if (action === "video") {
      const previousClips = videoCutHistoryRef.current.past.at(-1);
      if (!previousClips) return;
      videoCutHistoryRef.current = {
        past: videoCutHistoryRef.current.past.slice(0, -1),
        future: [
          cloneEditorVideoClips(videoClipsRef.current),
          ...videoCutHistoryRef.current.future,
        ],
      };
      applyEditorVideoClipsSnapshot(previousClips);
    } else if (action === "comment-delete") {
      const deletedComment = commentDeleteHistoryRef.current.past.at(-1);
      if (!deletedComment) return;
      const nextComments = [...commentsRef.current];
      if (!nextComments.some(
        (comment) => comment.id === deletedComment.comment.id,
      )) {
        nextComments.splice(
          Math.min(deletedComment.index, nextComments.length),
          0,
          { ...deletedComment.comment },
        );
      }
      commentsRef.current = nextComments;
      setComments(nextComments);
      if (deletedComment.offset) {
        const nextLayout = cloneEditorOverlayLayout(overlayLayoutRef.current);
        nextLayout.commentOffsets[deletedComment.comment.id] = {
          ...deletedComment.offset,
        };
        applyEditorOverlayLayout(nextLayout);
      }
      commentDeleteHistoryRef.current = {
        past: commentDeleteHistoryRef.current.past.slice(0, -1),
        future: [
          cloneEditorCommentDeleteHistoryEntry(deletedComment),
          ...commentDeleteHistoryRef.current.future,
        ],
      };
      setSelectedOverlay("comment");
      setInlineEditingOverlay(null);
    } else if (action === "comment-replace") {
      const replacement = commentReplaceHistoryRef.current.past.at(-1);
      if (!replacement) return;
      const previousComments = cloneEditorComments(replacement.before);
      commentsRef.current = previousComments;
      setComments(previousComments);
      commentReplaceHistoryRef.current = {
        past: commentReplaceHistoryRef.current.past.slice(0, -1),
        future: [
          cloneEditorCommentReplaceHistoryEntry(replacement),
          ...commentReplaceHistoryRef.current.future,
        ],
      };
      setSelectedOverlay("comment");
      setInlineEditingOverlay(null);
    } else if (action === "copy") {
      const copyChange = copyHistoryRef.current.past.at(-1);
      if (!copyChange) return;
      applyEditorCopySnapshot(copyChange.before);
      copyHistoryRef.current = {
        past: copyHistoryRef.current.past.slice(0, -1),
        future: [
          cloneEditorCopyHistoryEntry(copyChange),
          ...copyHistoryRef.current.future,
        ],
      };
      setSelectedOverlay(
        editorCopyTitleChanged(copyChange)
          ? "title"
          : editorCopySubtitleChanged(copyChange)
            ? null
            : "channel",
      );
      setInlineEditingOverlay(null);
    } else {
      const templateChange = templateHistoryRef.current.past.at(-1);
      if (!templateChange) return;
      applyEditorTemplateSnapshot(templateChange.before);
      templateHistoryRef.current = {
        past: templateHistoryRef.current.past.slice(0, -1),
        future: [
          cloneEditorTemplateHistoryEntry(templateChange),
          ...templateHistoryRef.current.future,
        ],
      };
      setSelectedOverlay("video");
      setInlineEditingOverlay(null);
    }
    editorHistoryOrderRef.current = {
      past: historyOrder.past.slice(0, -1),
      future: [action, ...historyOrder.future],
    };
    setOverlayHistoryRevision((current) => current + 1);
  }, [
    applyEditorCopySnapshot,
    applyEditorOverlayLayout,
    applyEditorTemplateSnapshot,
    applyEditorVideoClipsSnapshot,
  ]);

  const redoEditorEdit = useCallback(() => {
    const historyOrder = editorHistoryOrderRef.current;
    const [action, ...futureActions] = historyOrder.future;
    if (!action) return;
    if (action === "overlay") {
      const result = redoEditorOverlayHistory(
        overlayHistoryRef.current,
        overlayLayoutRef.current,
      );
      if (!result.layout) return;
      overlayHistoryRef.current = result.history;
      applyEditorOverlayLayout(result.layout);
    } else if (action === "video") {
      const [nextClips, ...futureClips] = videoCutHistoryRef.current.future;
      if (!nextClips) return;
      videoCutHistoryRef.current = {
        past: [
          ...videoCutHistoryRef.current.past,
          cloneEditorVideoClips(videoClipsRef.current),
        ],
        future: futureClips,
      };
      applyEditorVideoClipsSnapshot(nextClips);
    } else if (action === "comment-delete") {
      const [deletedComment, ...futureComments] = commentDeleteHistoryRef.current.future;
      if (!deletedComment) return;
      const nextComments = commentsRef.current.filter(
        (comment) => comment.id !== deletedComment.comment.id,
      );
      commentsRef.current = nextComments;
      setComments(nextComments);
      const nextLayout = cloneEditorOverlayLayout(overlayLayoutRef.current);
      delete nextLayout.commentOffsets[deletedComment.comment.id];
      applyEditorOverlayLayout(nextLayout);
      commentDeleteHistoryRef.current = {
        past: [
          ...commentDeleteHistoryRef.current.past,
          cloneEditorCommentDeleteHistoryEntry(deletedComment),
        ],
        future: futureComments,
      };
      setSelectedOverlay(null);
      setInlineEditingOverlay(null);
    } else if (action === "comment-replace") {
      const [replacement, ...futureReplacements] = commentReplaceHistoryRef.current.future;
      if (!replacement) return;
      const nextComments = cloneEditorComments(replacement.after);
      commentsRef.current = nextComments;
      setComments(nextComments);
      commentReplaceHistoryRef.current = {
        past: [
          ...commentReplaceHistoryRef.current.past,
          cloneEditorCommentReplaceHistoryEntry(replacement),
        ],
        future: futureReplacements,
      };
      setSelectedOverlay("comment");
      setInlineEditingOverlay(null);
    } else if (action === "copy") {
      const [copyChange, ...futureCopyChanges] = copyHistoryRef.current.future;
      if (!copyChange) return;
      applyEditorCopySnapshot(copyChange.after);
      copyHistoryRef.current = {
        past: [
          ...copyHistoryRef.current.past,
          cloneEditorCopyHistoryEntry(copyChange),
        ],
        future: futureCopyChanges,
      };
      setSelectedOverlay(
        editorCopyTitleChanged(copyChange)
          ? "title"
          : editorCopySubtitleChanged(copyChange)
            ? null
            : "channel",
      );
      setInlineEditingOverlay(null);
    } else {
      const [templateChange, ...futureTemplateChanges] =
        templateHistoryRef.current.future;
      if (!templateChange) return;
      applyEditorTemplateSnapshot(templateChange.after);
      templateHistoryRef.current = {
        past: [
          ...templateHistoryRef.current.past,
          cloneEditorTemplateHistoryEntry(templateChange),
        ],
        future: futureTemplateChanges,
      };
      setSelectedOverlay("video");
      setInlineEditingOverlay(null);
    }
    editorHistoryOrderRef.current = {
      past: [...historyOrder.past, action],
      future: futureActions,
    };
    setOverlayHistoryRevision((current) => current + 1);
  }, [
    applyEditorCopySnapshot,
    applyEditorOverlayLayout,
    applyEditorTemplateSnapshot,
    applyEditorVideoClipsSnapshot,
  ]);

  const hasPendingOverlayHistoryChange = overlayInteractionStartRef.current !== null
    && recordEditorOverlayHistory(
      { past: [], future: [] },
      overlayInteractionStartRef.current,
      overlayLayoutRef.current,
      1,
    ).past.length > 0;
  const hasPendingCommentTextChange = commentTextInteractionStartRef.current !== null
    && editorCommentsChanged(
      commentTextInteractionStartRef.current,
      commentsRef.current,
    );
  const hasPendingCopyChange = copyInteractionStartRef.current !== null
    && !editorCopySnapshotsEqual(
      copyInteractionStartRef.current,
      currentEditorCopySnapshot(),
    );
  const canUndoEditorEdit = editorHistoryOrderRef.current.past.length > 0
    || hasPendingOverlayHistoryChange
    || hasPendingCommentTextChange
    || hasPendingCopyChange;
  const canRedoEditorEdit = editorHistoryOrderRef.current.future.length > 0
    && !hasPendingOverlayHistoryChange
    && !hasPendingCommentTextChange
    && !hasPendingCopyChange;

  const setEditorCommentTheme = useCallback((theme: EditorCommentTheme) => {
    setSelectedOverlay("comment");
    commitEditorOverlayLayoutChange((current) => ({
      ...current,
      commentTheme: theme,
    }));
  }, [commitEditorOverlayLayoutChange]);

  const moveSelectedEditorLayer = useCallback((
    direction: "forward" | "backward",
  ) => {
    if (!overlayPreviewEnabled || selectedOverlay === null) return;
    commitEditorOverlayLayoutChange((current) => ({
      ...current,
      layerOrder: moveEditorOverlayOrderItem(
        current.layerOrder,
        selectedOverlay,
        direction,
        visibleEditorLayerOrder,
      ),
    }));
  }, [
    commitEditorOverlayLayoutChange,
    overlayPreviewEnabled,
    selectedOverlay,
    visibleEditorLayerOrder,
  ]);

  const setEditorCanvasBackground = useCallback((
    background: EditorCanvasBackground | null,
  ) => {
    if (!overlayPreviewEnabled) return;
    commitEditorOverlayLayoutChange((current) => ({
      ...current,
      background,
    }));
  }, [commitEditorOverlayLayoutChange, overlayPreviewEnabled]);

  const setEditorOverlayScale = useCallback((
    selection: "title" | "channel" | `text:${string}`,
    scale: number,
  ) => {
    const nextScale = Math.min(
      EDITOR_TEXT_LAYER_MAX_SCALE,
      Math.max(EDITOR_TEXT_LAYER_MIN_SCALE, scale),
    );
    if (selection === "title") {
      updateEditorTitleFontScale(nextScale);
      return;
    }
    const textId = selectedEditorTextId(selection);
    const canvas = editorCanvasRef.current;
    const canvasClientRect = canvas?.getBoundingClientRect();
    const layerElement = canvas
      ? textId
        ? Array.from(canvas.querySelectorAll<HTMLElement>(
            "[data-editor-text-overlay-id]",
          )).find((element) => element.dataset.editorTextOverlayId === textId)
        : canvas.querySelector<HTMLElement>(
            `[data-editor-overlay-layer="${selection}"]`,
          )
      : null;
    const layerClientRect = layerElement?.getBoundingClientRect();
    const layerRect = canvasClientRect && layerClientRect
      ? clientRectToCanvas({
          x: layerClientRect.x,
          y: layerClientRect.y,
          width: layerClientRect.width,
          height: layerClientRect.height,
        }, {
          x: canvasClientRect.x,
          y: canvasClientRect.y,
          width: canvasClientRect.width,
          height: canvasClientRect.height,
        })
      : null;
    if (textId) {
      updateEditorTextOverlay(textId, (textOverlay) => ({
        ...textOverlay,
        scale: nextScale,
        offset: layerRect
          ? clampCenteredOverlayOffsetAfterScale({
              layerRect,
              offset: textOverlay.offset,
              currentScale: textOverlay.scale,
              nextScale,
            })
          : textOverlay.offset,
      }));
      return;
    }
    if (selection !== "channel") return;
    const baseSelection = selection;
    updateEditorOverlayLayout((current) => {
      const adjustedOffset = layerRect
        ? clampCenteredOverlayOffsetAfterScale({
            layerRect,
            offset: current.offsets[baseSelection],
            currentScale: current.scales[baseSelection],
            nextScale,
          })
        : current.offsets[baseSelection];
      return {
        ...current,
        offsets: {
          ...current.offsets,
          [baseSelection]: adjustedOffset,
        },
        scales: {
          ...current.scales,
          [baseSelection]: nextScale,
        },
      };
    });
  }, [
    updateEditorOverlayLayout,
    updateEditorTextOverlay,
    updateEditorTitleFontScale,
  ]);

  const beginEditorScaleHistoryInteraction = useCallback((
    selection: "title" | "channel" | `text:${string}`,
  ) => {
    if (selection === "title") {
      beginEditorCopyInteraction();
      return;
    }
    beginEditorOverlayHistoryInteraction();
  }, [beginEditorCopyInteraction, beginEditorOverlayHistoryInteraction]);

  const finishEditorScaleHistoryInteraction = useCallback((
    selection: "title" | "channel" | `text:${string}`,
  ) => {
    if (selection === "title") {
      finishEditorCopyInteraction();
      return;
    }
    finishEditorOverlayHistoryInteraction();
  }, [finishEditorCopyInteraction, finishEditorOverlayHistoryInteraction]);

  const beginEditorOverlayScaleDrag = useCallback((
    selection: "title" | "channel" | `text:${string}`,
    event: PointerEvent<HTMLInputElement>,
  ) => {
    if (!overlayPreviewEnabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    overlayDragCleanupRef.current?.();
    finishPendingEditorInteractions();
    beginEditorScaleHistoryInteraction(selection);

    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    const bounds = captureTarget.getBoundingClientRect();
    captureTarget.setPointerCapture(pointerId);
    const updateScale = (clientY: number) => {
      const ratio = Math.max(0, Math.min(
        1,
        1 - (clientY - bounds.top) / bounds.height,
      ));
      const minimumPercentage = EDITOR_TEXT_LAYER_MIN_SCALE * 100;
      const percentageRange = (
        EDITOR_TEXT_LAYER_MAX_SCALE - EDITOR_TEXT_LAYER_MIN_SCALE
      ) * 100;
      const percentage = Math.round((
        minimumPercentage + ratio * percentageRange
      ) / 5) * 5;
      setEditorOverlayScale(selection, percentage / 100);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
      if (overlayDragCleanupRef.current === cleanup) {
        overlayDragCleanupRef.current = null;
      }
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      updateScale(moveEvent.clientY);
    };
    const finish = (finishEvent: globalThis.PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      updateScale(finishEvent.clientY);
      cleanup();
      finishEditorScaleHistoryInteraction(selection);
    };
    updateScale(event.clientY);
    overlayDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [
    beginEditorScaleHistoryInteraction,
    finishEditorScaleHistoryInteraction,
    finishPendingEditorInteractions,
    overlayPreviewEnabled,
    setEditorOverlayScale,
  ]);

  const resolveEditorOverlayDelta = useCallback(({
    layer,
    layerRect,
    rawDelta,
    canvasRect,
    videoBottom,
    snapTargetRects = [],
  }: {
    layer: EditorOverlayLayer;
    layerRect: CanvasRect;
    rawDelta: CanvasPoint;
    canvasRect: CanvasRect;
    videoBottom?: number;
    snapTargetRects?: CanvasRect[];
  }): { delta: CanvasPoint; guides: EditorOverlayGuides } => {
    if (layer === "comment") {
      const clamped = clampCanvasDelta(layerRect, rawDelta, "vertical");
      const snapped = snapCommentToVideoBottom(
        layerRect,
        clamped.y,
        videoBottom ?? -1,
        clientDistanceToCanvas(
          EDITOR_COMMENT_SNAP_THRESHOLD_PX,
          canvasRect.width,
        ),
      );
      return {
        delta: clampCanvasDelta(
          layerRect,
          { x: 0, y: snapped.deltaY },
          "vertical",
        ),
        guides: {
          ...EMPTY_EDITOR_OVERLAY_GUIDES,
          commentDocked: snapped.snapped,
        },
      };
    }

    if (layer === "title") {
      const clamped = clampCanvasDelta(
        layerRect,
        { x: 0, y: rawDelta.y },
        "vertical",
      );
      const snapped = snapRectCenterToCanvas(
        layerRect,
        clamped,
        clientDistanceToCanvas(CENTER_SNAP_THRESHOLD_PX, canvasRect.width),
      );
      return {
        delta: clampCanvasDelta(
          layerRect,
          { x: 0, y: snapped.delta.y },
          "vertical",
        ),
        guides: {
          ...EMPTY_EDITOR_OVERLAY_GUIDES,
          y: snapped.guides.y,
        },
      };
    }

    const clamped = clampCanvasDelta(layerRect, rawDelta);
    const centerSnapped = layer === "video"
      ? {
          delta: clamped,
          guides: { x: false, y: false },
        }
      : snapRectCenterToCanvas(
          layerRect,
          clamped,
          clientDistanceToCanvas(CENTER_SNAP_THRESHOLD_PX, canvasRect.width),
        );
    const overlaySnapped = layer === "video"
      ? snapRectToOverlayRects(
          layerRect,
          clamped,
          snapTargetRects,
          clientDistanceToCanvas(
            EDITOR_OVERLAY_SNAP_THRESHOLD_PX,
            canvasRect.width,
          ),
        )
      : {
          delta: clamped,
          guides: { overlayX: null, overlayY: null },
        };
    const snappedDelta = {
      x: overlaySnapped.guides.overlayX === null
        ? centerSnapped.delta.x
        : overlaySnapped.delta.x,
      y: overlaySnapped.guides.overlayY === null
        ? centerSnapped.delta.y
        : overlaySnapped.delta.y,
    };
    return {
      delta: clampCanvasDelta(layerRect, snappedDelta),
      guides: {
        ...EMPTY_EDITOR_OVERLAY_GUIDES,
        x: overlaySnapped.guides.overlayX === null && centerSnapped.guides.x,
        y: overlaySnapped.guides.overlayY === null && centerSnapped.guides.y,
        ...overlaySnapped.guides,
      },
    };
  }, []);

  const beginEditorOverlayDrag = useCallback((
    layer: EditorOverlayLayer,
    event: PointerEvent<HTMLElement>,
    commentId?: string,
  ) => {
    if (!overlayPreviewEnabled || event.button !== 0) return;
    const canvas = editorCanvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    overlayDragCleanupRef.current?.();
    finishPendingEditorInteractions();
    beginEditorOverlayHistoryInteraction();
    setSelectedOverlay(layer);
    setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);
    if (layer === "comment") videoRef.current?.pause();

    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    captureTarget.setPointerCapture(pointerId);
    const canvasClientRect = canvas.getBoundingClientRect();
    const layerClientRect = captureTarget.getBoundingClientRect();
    const canvasRect: CanvasRect = {
      x: canvasClientRect.x,
      y: canvasClientRect.y,
      width: canvasClientRect.width,
      height: canvasClientRect.height,
    };
    const layerRect = clientRectToCanvas({
      x: layerClientRect.x,
      y: layerClientRect.y,
      width: layerClientRect.width,
      height: layerClientRect.height,
    }, canvasRect);
    const videoElement = canvas.querySelector<HTMLElement>(
      '[data-editor-overlay-layer="video"]',
    );
    const videoClientRect = videoElement?.getBoundingClientRect();
    const videoRect = videoClientRect
      ? clientRectToCanvas({
          x: videoClientRect.x,
          y: videoClientRect.y,
          width: videoClientRect.width,
          height: videoClientRect.height,
        }, canvasRect)
      : null;
    const videoBottom = videoRect ? videoRect.y + videoRect.height : undefined;
    const snapTargetRects = layer === "video"
      ? Array.from(canvas.querySelectorAll<HTMLElement>(
          '[data-editor-overlay-layer="comment"]',
        )).flatMap((targetElement) => {
          const targetClientRect = targetElement.getBoundingClientRect();
          if (targetClientRect.width <= 0 || targetClientRect.height <= 0) {
            return [];
          }
          return [clientRectToCanvas({
            x: targetClientRect.x,
            y: targetClientRect.y,
            width: targetClientRect.width,
            height: targetClientRect.height,
          }, canvasRect)];
        })
      : [];
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startOffset = layer === "comment" && commentId
      ? overlayLayoutRef.current.commentOffsets?.[commentId]
        || overlayLayoutRef.current.offsets.comment
      : overlayLayoutRef.current.offsets[layer];

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
      if (overlayDragCleanupRef.current === cleanup) {
        overlayDragCleanupRef.current = null;
      }
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const rawDelta = clientDeltaToCanvas({
        x: moveEvent.clientX - startClientX,
        y: moveEvent.clientY - startClientY,
      }, canvasRect);
      const resolved = resolveEditorOverlayDelta({
        layer,
        layerRect,
        rawDelta,
        canvasRect,
        videoBottom,
        snapTargetRects,
      });
      updateEditorOverlayLayout((current) => {
        const nextOffset = {
          x: layer === "comment" || layer === "title"
            ? 0
            : startOffset.x + resolved.delta.x,
          y: startOffset.y + resolved.delta.y,
        };
        if (layer === "comment" && commentId) {
          return {
            ...current,
            commentOffsets: {
              ...(current.commentOffsets || {}),
              [commentId]: nextOffset,
            },
          };
        }
        return {
          ...current,
          offsets: {
            ...current.offsets,
            [layer]: nextOffset,
          },
        };
      });
      setOverlayGuides(resolved.guides);
    };
    const finish = (finishEvent: globalThis.PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      cleanup();
      setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);
      finishEditorOverlayHistoryInteraction();
    };
    overlayDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [
    beginEditorOverlayHistoryInteraction,
    finishEditorOverlayHistoryInteraction,
    finishPendingEditorInteractions,
    overlayPreviewEnabled,
    resolveEditorOverlayDelta,
    updateEditorOverlayLayout,
  ]);

  const beginEditorTextOverlayDrag = useCallback((
    id: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (!overlayPreviewEnabled || event.button !== 0) return;
    const canvas = editorCanvasRef.current;
    const textOverlay = overlayLayoutRef.current.textOverlays.find(
      (value) => value.id === id,
    );
    if (!canvas || !textOverlay) return;
    event.preventDefault();
    event.stopPropagation();
    overlayDragCleanupRef.current?.();
    beginEditorOverlayHistoryInteraction();
    setSelectedOverlay(editorTextSelection(id));
    setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);

    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    captureTarget.setPointerCapture(pointerId);
    const canvasClientRect = canvas.getBoundingClientRect();
    const layerClientRect = captureTarget.getBoundingClientRect();
    const canvasRect: CanvasRect = {
      x: canvasClientRect.x,
      y: canvasClientRect.y,
      width: canvasClientRect.width,
      height: canvasClientRect.height,
    };
    const layerRect = clientRectToCanvas({
      x: layerClientRect.x,
      y: layerClientRect.y,
      width: layerClientRect.width,
      height: layerClientRect.height,
    }, canvasRect);
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startOffset = textOverlay.offset;

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
      if (overlayDragCleanupRef.current === cleanup) {
        overlayDragCleanupRef.current = null;
      }
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const rawDelta = clientDeltaToCanvas({
        x: moveEvent.clientX - startClientX,
        y: moveEvent.clientY - startClientY,
      }, canvasRect);
      const resolved = resolveEditorOverlayDelta({
        layer: "title",
        layerRect,
        rawDelta,
        canvasRect,
      });
      updateEditorTextOverlay(id, (current) => ({
        ...current,
        offset: {
          x: startOffset.x + resolved.delta.x,
          y: startOffset.y + resolved.delta.y,
        },
      }));
      setOverlayGuides(resolved.guides);
    };
    const finish = (finishEvent: globalThis.PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      cleanup();
      setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);
      finishEditorOverlayHistoryInteraction();
    };
    overlayDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [
    beginEditorOverlayHistoryInteraction,
    finishEditorOverlayHistoryInteraction,
    overlayPreviewEnabled,
    resolveEditorOverlayDelta,
    updateEditorTextOverlay,
  ]);

  const beginEditorTextOverlayResize = useCallback((
    id: string,
    edge: EditorTextResizeEdge,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (!overlayPreviewEnabled || event.button !== 0) return;
    const canvas = editorCanvasRef.current;
    const textOverlay = overlayLayoutRef.current.textOverlays.find(
      (value) => value.id === id,
    );
    if (!canvas || !textOverlay) return;
    event.preventDefault();
    event.stopPropagation();
    overlayDragCleanupRef.current?.();
    beginEditorOverlayHistoryInteraction();
    setSelectedOverlay(editorTextSelection(id));
    setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);

    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    const startWidth = textOverlay.width ?? EDITOR_TEXT_DEFAULT_WIDTH;
    const startOffsetX = textOverlay.offset.x;
    const startScale = Math.max(0.01, textOverlay.scale);
    const canvasClientRect = canvas.getBoundingClientRect();
    const canvasRect = {
      width: canvasClientRect.width,
      height: canvasClientRect.height,
    };
    captureTarget.setPointerCapture(pointerId);

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
      if (overlayDragCleanupRef.current === cleanup) {
        overlayDragCleanupRef.current = null;
      }
    };
    const updateWidth = (clientX: number) => {
      const deltaX = clientDeltaToCanvas({
        x: clientX - startClientX,
        y: 0,
      }, canvasRect).x / startScale;
      const resized = resizeEditorTextOverlayWidth({
        width: startWidth,
        offsetX: startOffsetX,
        deltaX,
        edge,
      });
      updateEditorTextOverlay(id, (current) => ({
        ...current,
        width: resized.width,
        offset: {
          ...current.offset,
          x: resized.offsetX,
        },
      }));
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      updateWidth(moveEvent.clientX);
    };
    const finish = (finishEvent: globalThis.PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      updateWidth(finishEvent.clientX);
      cleanup();
      finishEditorOverlayHistoryInteraction();
    };
    overlayDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [
    beginEditorOverlayHistoryInteraction,
    finishEditorOverlayHistoryInteraction,
    overlayPreviewEnabled,
    updateEditorTextOverlay,
  ]);

  const beginEditorVideoResize = useCallback((
    handle: EditorVideoResizeHandle,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (!overlayPreviewEnabled || event.button !== 0) return;
    const canvas = editorCanvasRef.current;
    const videoElement = canvas?.querySelector<HTMLElement>(
      '[data-editor-overlay-layer="video"]',
    );
    if (!canvas || !videoElement) return;
    event.preventDefault();
    event.stopPropagation();
    overlayDragCleanupRef.current?.();
    beginEditorOverlayHistoryInteraction();
    setSelectedOverlay("video");
    setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);

    const captureTarget = event.currentTarget;
    const pointerId = event.pointerId;
    captureTarget.setPointerCapture(pointerId);
    const canvasClientRect = canvas.getBoundingClientRect();
    const videoClientRect = videoElement.getBoundingClientRect();
    const canvasRect: CanvasRect = {
      x: canvasClientRect.x,
      y: canvasClientRect.y,
      width: canvasClientRect.width,
      height: canvasClientRect.height,
    };
    const startRect = clientRectToCanvas({
      x: videoClientRect.x,
      y: videoClientRect.y,
      width: videoClientRect.width,
      height: videoClientRect.height,
    }, canvasRect);
    const startOffset = overlayOffsets.video;
    const startScale = videoScale;
    const startCenter = {
      x: startRect.x + startRect.width / 2,
      y: startRect.y + startRect.height / 2,
    };
    const startClientX = event.clientX;
    const startClientY = event.clientY;

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
      if (overlayDragCleanupRef.current === cleanup) {
        overlayDragCleanupRef.current = null;
      }
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const delta = clientDeltaToCanvas({
        x: moveEvent.clientX - startClientX,
        y: moveEvent.clientY - startClientY,
      }, canvasRect);
      const resized = resizeCanvasRectFromCorner({
        rect: startRect,
        delta,
        handle,
        minimumWidth: editorVideoBaseRect.width * EDITOR_VIDEO_MIN_SCALE,
        minimumHeight: editorVideoBaseRect.height * EDITOR_VIDEO_MIN_SCALE,
        allowOverflow: true,
        maximumScaleFactor: EDITOR_VIDEO_MAX_SCALE / startScale,
      });
      const snapped = snapResizedCanvasRectToCanvas({
        initialRect: startRect,
        resized,
        handle,
        threshold: clientDistanceToCanvas(
          EDITOR_VIDEO_SIZE_SNAP_THRESHOLD_PX,
          canvasRect.width,
        ),
        minimumScaleFactor: Math.max(
          editorVideoBaseRect.width * EDITOR_VIDEO_MIN_SCALE / startRect.width,
          editorVideoBaseRect.height * EDITOR_VIDEO_MIN_SCALE / startRect.height,
        ),
        maximumScaleFactor: EDITOR_VIDEO_MAX_SCALE / startScale,
      });
      const nextCenter = {
        x: snapped.rect.x + snapped.rect.width / 2,
        y: snapped.rect.y + snapped.rect.height / 2,
      };
      updateEditorOverlayLayout((current) => ({
        ...current,
        offsets: {
          ...current.offsets,
          video: {
            x: startOffset.x + nextCenter.x - startCenter.x,
            y: startOffset.y + nextCenter.y - startCenter.y,
          },
        },
        scales: {
          ...current.scales,
          video: startScale * snapped.scaleFactor,
        },
      }));
      setOverlayGuides({
        ...EMPTY_EDITOR_OVERLAY_GUIDES,
        videoWidthFitted: snapped.snapped.width,
        videoHeightFitted: snapped.snapped.height,
      });
    };
    const finish = (finishEvent: globalThis.PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) return;
      cleanup();
      setOverlayGuides(EMPTY_EDITOR_OVERLAY_GUIDES);
      finishEditorOverlayHistoryInteraction();
    };
    overlayDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [
    beginEditorOverlayHistoryInteraction,
    editorVideoBaseRect.height,
    editorVideoBaseRect.width,
    finishEditorOverlayHistoryInteraction,
    overlayOffsets.video,
    overlayPreviewEnabled,
    updateEditorOverlayLayout,
    videoScale,
  ]);

  const nudgeSelectedEditorOverlay = useCallback((delta: CanvasPoint) => {
    if (!overlayPreviewEnabled || selectedOverlay === null) return;
    const canvas = editorCanvasRef.current;
    const textId = selectedEditorTextId(selectedOverlay);
    const layerElement = canvas?.querySelector<HTMLElement>(
      textId
        ? `[data-editor-text-overlay-id="${textId}"]`
        : `[data-editor-overlay-layer="${selectedOverlay}"]`,
    );
    if (!canvas || !layerElement) return;
    const canvasClientRect = canvas.getBoundingClientRect();
    const layerClientRect = layerElement.getBoundingClientRect();
    const canvasRect: CanvasRect = {
      x: canvasClientRect.x,
      y: canvasClientRect.y,
      width: canvasClientRect.width,
      height: canvasClientRect.height,
    };
    const layerRect = clientRectToCanvas({
      x: layerClientRect.x,
      y: layerClientRect.y,
      width: layerClientRect.width,
      height: layerClientRect.height,
    }, canvasRect);
    if (isEditorTextSelection(selectedOverlay)) {
      const selectedTextId = selectedOverlay.slice("text:".length);
      const movement = clampCanvasDelta(layerRect, delta);
      commitEditorOverlayLayoutChange((current) => ({
        ...current,
        textOverlays: current.textOverlays.map((textOverlay) => (
          textOverlay.id === selectedTextId
            ? {
                ...textOverlay,
                offset: {
                  x: textOverlay.offset.x + movement.x,
                  y: textOverlay.offset.y + movement.y,
                },
              }
            : textOverlay
        )),
      }));
      return;
    }
    const baseLayer = selectedOverlay;
    const verticallyConstrained = baseLayer === "comment" || baseLayer === "title";
    const movement = clampCanvasDelta(
      layerRect,
      verticallyConstrained ? { x: 0, y: delta.y } : delta,
      verticallyConstrained ? "vertical" : "both",
    );
    if (baseLayer === "comment" && layoutPreviewComment) {
      const commentId = layoutPreviewComment.id;
      commitEditorOverlayLayoutChange((current) => {
        const currentOffset = current.commentOffsets?.[commentId]
          || current.offsets.comment;
        return {
          ...current,
          commentOffsets: {
            ...(current.commentOffsets || {}),
            [commentId]: {
              x: 0,
              y: currentOffset.y + movement.y,
            },
          },
        };
      });
      return;
    }
    commitEditorOverlayLayoutChange((current) => ({
      ...current,
      offsets: {
        ...current.offsets,
        [baseLayer]: {
          x: baseLayer === "comment" || baseLayer === "title"
            ? 0
            : current.offsets[baseLayer].x + movement.x,
          y: current.offsets[baseLayer].y + movement.y,
        },
      },
    }));
  }, [
    commitEditorOverlayLayoutChange,
    layoutPreviewComment,
    overlayPreviewEnabled,
    selectedOverlay,
  ]);

  useEffect(() => () => {
    overlayDragCleanupRef.current?.();
    videoClipTrimCleanupRef.current?.();
  }, []);

  useEffect(() => {
    if (!overlayPreviewEnabled) return;
    const handleOverlayKeyboard = (event: KeyboardEvent) => {
      if (
        commentRegenerationConfirmationOpen
        || commentRegenerationComparison
        || editorFontApplySuggestion
      ) return;
      const target = event.target;
      const historyShortcut = resolveEditorHistoryShortcut(event);
      if (historyShortcut) {
        const textInputTarget = target instanceof HTMLTextAreaElement
          || (
            target instanceof HTMLInputElement
            && ["text", "search", "email", "url", "tel", "password"].includes(
              target.type,
            )
          )
          || (target instanceof HTMLElement && target.isContentEditable);
        const editorTextInteractionActive = copyInteractionStartRef.current !== null
          || commentTextInteractionStartRef.current !== null
          || overlayInteractionStartRef.current !== null
          || inlineEditingOverlay !== null;
        if (textInputTarget && !editorTextInteractionActive) return;
        event.preventDefault();
        event.stopPropagation();
        finishPendingEditorInteractions();
        if (historyShortcut === "undo") {
          undoEditorEdit();
        } else {
          redoEditorEdit();
        }
        return;
      }
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (selectedOverlay === null && selectedVideoClipId === null) return;
        event.preventDefault();
        clearEditorOverlaySelection();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedVideoClipId && selectedOverlay === null) {
          event.preventDefault();
          deleteSelectedEditorVideoClip();
          return;
        }
        const selectedCommentId = target instanceof HTMLElement
          ? target.closest<HTMLElement>("[data-editor-comment-id]")
            ?.dataset.editorCommentId
          : null;
        if (selectedCommentId) {
          event.preventDefault();
          deleteEditorComment(selectedCommentId);
          return;
        }
        if (selectedOverlay === "comment" && layoutPreviewComment) {
          event.preventDefault();
          deleteEditorComment(layoutPreviewComment.id);
          return;
        }
        if (selectedOverlay === null) return;
        event.preventDefault();
        deleteSelectedEditorOverlay();
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        return;
      }
      const distance = event.shiftKey ? 10 : 1;
      const delta = {
        x: event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0,
        y: event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0,
      };
      event.preventDefault();
      nudgeSelectedEditorOverlay(delta);
    };
    window.addEventListener("keydown", handleOverlayKeyboard);
    return () => window.removeEventListener("keydown", handleOverlayKeyboard);
  }, [
    clearEditorOverlaySelection,
    commentRegenerationComparison,
    commentRegenerationConfirmationOpen,
    deleteEditorComment,
    deleteSelectedEditorVideoClip,
    deleteSelectedEditorOverlay,
    editorFontApplySuggestion,
    finishPendingEditorInteractions,
    inlineEditingOverlay,
    layoutPreviewComment,
    nudgeSelectedEditorOverlay,
    overlayPreviewEnabled,
    redoEditorEdit,
    selectedOverlay,
    selectedVideoClipId,
    undoEditorEdit,
  ]);

  useEffect(() => {
    const detectMobileEditor = () => {
      const mobileBrowser = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
        window.navigator.userAgent,
      );
      const iPadDesktopBrowser = window.navigator.platform === "MacIntel"
        && window.navigator.maxTouchPoints > 1;
      const compactTouchDevice = window.navigator.maxTouchPoints > 1
        && window.matchMedia("(pointer: coarse)").matches
        && window.matchMedia("(max-width: 1024px)").matches;
      setMobileEditorBlocked(mobileBrowser || iPadDesktopBrowser || compactTouchDevice);
    };

    detectMobileEditor();
    window.addEventListener("resize", detectMobileEditor);
    return () => window.removeEventListener("resize", detectMobileEditor);
  }, []);

  useEffect(() => {
    if (mobileEditorBlocked !== true) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileEditorBlocked]);

  const refreshEditorVideoSource = useCallback(async (
    reason: "scheduled" | "error" | "manual",
  ) => {
    if (
      !overlayPreviewEnabled
      || paidAccessBlocked
      || editorVideoRefreshInFlightRef.current
    ) {
      return false;
    }
    const endpoint = editorVideoSourceEndpointRef.current;
    if (!endpoint) {
      setVideoLoadError(true);
      setVideoConnectionState("error");
      return false;
    }
    const video = videoRef.current;
    const restore = {
      currentTime: Number.isFinite(video?.currentTime)
        ? video?.currentTime || 0
        : 0,
      shouldPlay: Boolean(video && !video.paused),
    };
    editorVideoRefreshInFlightRef.current = true;
    setVideoConnectionState("reconnecting");
    setVideoLoadError(false);
    try {
      const value = await requestJson<{ url: string; expiresAt: string }>(
        endpoint === "timeline"
          ? `/api/shorts/${item.id}/edit-timeline`
          : `/api/shorts/${item.id}/edit-source`,
      );
      editorVideoRestoreRef.current = restore;
      setEditorVideoUrlExpiresAt(value.expiresAt);
      setCleanVideoUrl(value.url);
      return true;
    } catch {
      editorVideoRefreshInFlightRef.current = false;
      if (reason === "scheduled") {
        setVideoConnectionState("ready");
        setEditorVideoUrlExpiresAt(
          new Date(Date.now() + 130_000).toISOString(),
        );
      } else {
        setVideoLoadError(true);
        setVideoConnectionState("error");
      }
      return false;
    }
  }, [item.id, overlayPreviewEnabled, paidAccessBlocked]);

  const handleEditorVideoLoadError = useCallback(() => {
    if (!overlayPreviewEnabled) {
      setVideoLoadError(true);
      return;
    }
    editorVideoRefreshInFlightRef.current = false;
    if (editorVideoRetryCountRef.current >= 1) {
      setVideoLoadError(true);
      setVideoConnectionState("error");
      return;
    }
    editorVideoRetryCountRef.current += 1;
    void refreshEditorVideoSource("error");
  }, [overlayPreviewEnabled, refreshEditorVideoSource]);

  useEffect(() => {
    if (!overlayPreviewEnabled || !editorVideoUrlExpiresAt) return;
    const timeout = window.setTimeout(() => {
      void refreshEditorVideoSource("scheduled");
    }, editorVideoUrlRefreshDelay(editorVideoUrlExpiresAt));
    return () => window.clearTimeout(timeout);
  }, [
    editorVideoUrlExpiresAt,
    overlayPreviewEnabled,
    refreshEditorVideoSource,
  ]);

  useEffect(() => {
    if (paidAccessBlocked) {
      setEditorGuideReady(true);
      return;
    }
    let cancelled = false;
    setEditorGuideReady(false);
    const load = async () => {
      if (rangeEditingEnabled) {
        try {
          const value = await requestJson<EditTimeline>(`/api/shorts/${item.id}/edit-timeline`);
          if (!cancelled) {
            const savedTimelineMatches = Boolean(
              savedEditorDocument
              && Math.abs(
                savedEditorDocument.video.timelineStartSeconds
                - value.timelineStartSeconds,
              ) <= 0.051
              && Math.abs(
                savedEditorDocument.video.timelineEndSeconds
                - value.timelineEndSeconds,
              ) <= 0.051,
            );
            const initialVideoClips = savedTimelineMatches
              ? cloneEditorVideoClips(savedEditorDocument!.video.clips)
              : createEditorVideoClips(
                value.currentStartSeconds - value.timelineStartSeconds,
                value.currentEndSeconds - value.timelineStartSeconds,
              );
            const restoredSelectionStart = savedTimelineMatches
              ? savedEditorDocument!.video.selectionStartSeconds
              : value.currentStartSeconds;
            const restoredSelectionEnd = savedTimelineMatches
              ? savedEditorDocument!.video.selectionEndSeconds
              : value.currentEndSeconds;
            const restoredSubtitleSegments = cloneEditorSubtitleSegments(
              savedTimelineMatches
                ? savedEditorDocument!.subtitles.segments
                : value.subtitleSegments,
            );
            setEditTimeline(value);
            setSelectionStart(restoredSelectionStart);
            setSelectionEnd(restoredSelectionEnd);
            subtitleSegmentsRef.current = restoredSubtitleSegments;
            setSegments(restoredSubtitleSegments);
            videoClipsRef.current = initialVideoClips;
            setVideoClips(initialVideoClips);
            videoSequenceTimeRef.current = 0;
            setVideoSequenceTime(0);
            activeVideoClipIndexRef.current = 0;
            setSelectedVideoClipId(initialVideoClips[0]?.id || null);
            setSelectedOverlay(null);
            editorVideoSourceEndpointRef.current = "timeline";
            setEditorVideoUrlExpiresAt(value.expiresAt);
            setVideoLoadError(false);
            setVideoConnectionState("ready");
            setCleanVideoUrl(value.url);
          }
          return;
        } catch {
          // Projects created before timeline capture keep the existing editor.
        }
      }
      const value = await requestJson<{ url: string; expiresAt: string }>(
        `/api/shorts/${item.id}/edit-source`,
      );
      if (!cancelled) {
        editorVideoSourceEndpointRef.current = "source";
        setEditorVideoUrlExpiresAt(value.expiresAt);
        setVideoLoadError(false);
        setVideoConnectionState("ready");
        setCleanVideoUrl(value.url);
      }
    };
    void load()
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "편집용 영상을 준비하지 못했습니다.");
          if (overlayPreviewEnabled) {
            setVideoLoadError(true);
            setVideoConnectionState("error");
          }
        }
      })
      .finally(() => {
        if (!cancelled) setEditorGuideReady(true);
      });
    return () => { cancelled = true; };
  }, [
    item.id,
    paidAccessBlocked,
    rangeEditingEnabled,
    savedEditorDocument,
    overlayPreviewEnabled,
  ]);

  useEffect(() => {
    const timelineUrl = editTimeline?.url;
    setTimelineThumbnails([]);
    if (!timelineUrl) return;

    let cancelled = false;
    const thumbnailVideo = document.createElement("video");
    thumbnailVideo.crossOrigin = "anonymous";
    thumbnailVideo.muted = true;
    thumbnailVideo.playsInline = true;
    thumbnailVideo.preload = "auto";

    const captureFrames = async () => {
      const metadataReady = waitForVideoEvent(thumbnailVideo, "loadedmetadata");
      thumbnailVideo.src = timelineUrl;
      thumbnailVideo.load();
      await metadataReady;
      if (cancelled || !Number.isFinite(thumbnailVideo.duration) || thumbnailVideo.duration <= 0) return;

      const canvas = document.createElement("canvas");
      canvas.width = 144;
      canvas.height = 81;
      const context = canvas.getContext("2d");
      if (!context) return;

      const frames: string[] = [];
      for (let index = 0; index < TIMELINE_THUMBNAIL_COUNT; index += 1) {
        if (cancelled) return;
        const targetTime = Math.min(
          Math.max(0, thumbnailVideo.duration - 0.05),
          thumbnailVideo.duration * ((index + 0.5) / TIMELINE_THUMBNAIL_COUNT),
        );
        const seeked = waitForVideoEvent(thumbnailVideo, "seeked");
        thumbnailVideo.currentTime = targetTime;
        await seeked;
        if (cancelled) return;
        drawTimelineFrame(context, thumbnailVideo, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", 0.72));
        setTimelineThumbnails([...frames]);
      }
    };

    void captureFrames().catch(() => {
      if (!cancelled) setTimelineThumbnails([]);
    });
    return () => {
      cancelled = true;
      thumbnailVideo.pause();
      thumbnailVideo.removeAttribute("src");
      thumbnailVideo.load();
    };
  }, [editTimeline?.url]);

  const selectTemplate = (value: TemplateId) => {
    if (
      templateIdRef.current === value
      && activeCustomTemplateRef.current === null
    ) {
      return;
    }
    finishPendingEditorInteractions();
    const before = currentEditorTemplateSnapshot();
    const after: EditorTemplateSnapshot = {
      ...before,
      templateId: value,
      activeCustomTemplate: null,
      presetVersion: 3,
      templateSelectionTouched: true,
      overlayLayout: resetEditorOverlayGeometry(before.overlayLayout),
    };
    applyEditorTemplateSnapshot(after);
    recordEditorTemplateChange(before, after);
    setSelectedOverlay("video");
    setInlineEditingOverlay(null);
  };

  const selectCurrentCustomTemplate = () => {
    if (!availableCustomTemplate) return;
    if (
      templateIdRef.current === availableCustomTemplate.baseTemplateId
      && activeCustomTemplateRef.current?.id === availableCustomTemplate.id
      && activeCustomTemplateRef.current.version === availableCustomTemplate.version
    ) {
      return;
    }
    finishPendingEditorInteractions();
    const before = currentEditorTemplateSnapshot();
    const after: EditorTemplateSnapshot = {
      ...before,
      templateId: availableCustomTemplate.baseTemplateId,
      activeCustomTemplate: availableCustomTemplate,
      templateSelectionTouched: true,
      overlayLayout: resetEditorOverlayGeometry(before.overlayLayout),
    };
    applyEditorTemplateSnapshot(after);
    recordEditorTemplateChange(before, after);
    setSelectedOverlay("video");
    setInlineEditingOverlay(null);
  };

  const updateComment = (id: string, values: Partial<CommentOverlay>) => {
    const next = commentsRef.current.map((comment) => (
      comment.id === id ? { ...comment, ...values } : comment
    ));
    commentsRef.current = next;
    setComments(next);
  };

  const updateSubtitleText = (index: number, text: string) => {
    const next = subtitleSegmentsRef.current.map((segment, position) => (
      position === index ? { ...segment, text } : segment
    ));
    subtitleSegmentsRef.current = next;
    setSegments(next);
  };

  const requestCommentTextEdit = (commentId: string) => {
    setInlineEditingOverlay(null);
    setSelectedOverlay("comment");
    setCommentEditRequest((current) => ({
      commentId,
      revision: (current?.revision || 0) + 1,
    }));
  };

  const updateCommentRange = (
    id: string,
    range: { startSeconds: number; endSeconds: number },
  ) => {
    const storedRange = editTimeline
      ? scaleTimedRanges([range], previewDuration, item.durationSeconds)[0]
      : range;
    updateComment(id, storedRange);
  };

  const seekCommentTimeline = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    if (editTimeline) {
      if (videoCuttingEnabled) {
        seekEditorVideoSequence(seconds);
        return;
      }
      seekTimeline(selectionStart + Math.max(0, Math.min(selectionDuration, seconds)));
      return;
    }
    const next = Math.max(0, Math.min(item.durationSeconds, seconds));
    video.currentTime = next;
    setPreviewTime(next);
  };

  const selectEditorTextFromSidebar = (textOverlay: EditorTextOverlay) => {
    if (inlineEditingOverlay !== null) finishEditorInlineEdit();
    const selection = editorTextSelection(textOverlay.id);
    if (
      selectedOverlay === selection
      && expandedEditorTextId === textOverlay.id
    ) {
      setExpandedEditorTextId(null);
      return;
    }
    setSelectedVideoClipId(null);
    setSelectedOverlay(selection);
    setExpandedEditorTextId(textOverlay.id);
    setActiveEditorSidebarTool("text");
    setDesktopSidebarOpen(true);
    seekCommentTimeline(Math.max(
      textOverlay.startSeconds,
      Math.min(textOverlay.endSeconds - 0.001, textOverlay.startSeconds + 0.001),
    ));
  };

  const addComment = () => {
    if (overlayPreviewEnabled) {
      if (!overlayLayoutRef.current.visible.comment) {
        updateEditorOverlayLayout((current) => ({
          ...current,
          visible: {
            ...current.visible,
            comment: true,
          },
        }));
      }
      setInlineEditingOverlay(null);
      setSelectedOverlay("comment");
    }
    const before = cloneEditorComments(commentsRef.current);
    if (before.length >= 20) return;
    const nextCommentText = selectRandomFallbackCommentTexts(
      1,
      before.map((comment) => comment.text),
    )[0];
    let after: CommentOverlay[];
    if (before.length === 0) {
      after = [randomComment(0, item.durationSeconds, nextCommentText)];
    } else {
      const longest = before.reduce((selected, comment) => (
        comment.endSeconds - comment.startSeconds > selected.endSeconds - selected.startSeconds ? comment : selected
      ));
      const midpoint = Math.round(((longest.startSeconds + longest.endSeconds) / 2) * 1000) / 1000;
      if (midpoint <= longest.startSeconds || midpoint >= longest.endSeconds) return;
      after = [
        ...before.map((comment) => (
          comment.id === longest.id ? { ...comment, endSeconds: midpoint } : comment
        )),
        randomComment(midpoint, longest.endSeconds, nextCommentText),
      ];
    }
    commentsRef.current = after;
    setComments(after);
    recordEditorCommentReplacement(before, after);
  };

  const captureTitleSelection = () => {
    const input = titleInputRef.current;
    if (!input) return;
    if (input.selectionStart === input.selectionEnd) {
      setTitleSelection(null);
      return;
    }
    setTitleSelection({
      start: codePointOffset(title, input.selectionStart),
      end: codePointOffset(title, input.selectionEnd),
    });
    const selectedIndex = codePointOffset(title, input.selectionStart);
    const currentStyle = titleTextStyles.find((style) => style.start <= selectedIndex && style.end > selectedIndex);
    if (currentStyle?.color) setTitleTextColor(currentStyle.color);
    if (currentStyle?.backgroundColor) setTitleBackgroundColor(currentStyle.backgroundColor);
  };

  const updateSelectedTitleStyle = (patch: { color?: string | null; backgroundColor?: string | null }) => {
    const codePointLength = Array.from(title).length;
    if (codePointLength === 0) return;
    const before = currentEditorCopySnapshot();
    const selection = titleSelection || {
      start: 0,
      end: codePointLength,
    };
    const nextStyles = applyTitleTextStyle(
      titleTextStylesRef.current,
      codePointLength,
      selection.start,
      selection.end,
      patch,
    );
    titleTextStylesRef.current = nextStyles;
    setTitleTextStyles(nextStyles);
    recordEditorCopyChange(before, currentEditorCopySnapshot());
  };

  const updateSelectedEditorText = (
    patch: Partial<Pick<EditorTextOverlay, "text" | "fontId" | "color" | "effect">>,
    historyMode: "continuous" | "record" = "record",
  ) => {
    if (!selectedTextOverlayId) return;
    if (historyMode === "continuous") {
      updateEditorTextOverlay(selectedTextOverlayId, (textOverlay) => ({
        ...textOverlay,
        ...patch,
      }));
      return;
    }
    commitEditorOverlayLayoutChange((current) => ({
      ...current,
      textOverlays: current.textOverlays.map((textOverlay) => (
        textOverlay.id === selectedTextOverlayId
          ? { ...textOverlay, ...patch }
          : textOverlay
      )),
    }));
  };

  const updateEditorFont = (
    source: EditorFontApplySource,
    fontId: EditorFontId,
  ) => {
    const current = overlayLayoutRef.current;
    const currentFonts = current.fonts || {
      title: DEFAULT_EDITOR_FONT_ID,
      channel: DEFAULT_EDITOR_FONT_ID,
    };
    const sourceTextId = isEditorTextSelection(source)
      ? selectedEditorTextId(source)
      : null;
    const sourceText = sourceTextId
      ? current.textOverlays.find((textOverlay) => textOverlay.id === sourceTextId)
      : null;
    if (sourceTextId && !sourceText) return;
    const sourceFontId = source === "title"
      ? currentFonts.title
      : source === "channel"
        ? currentFonts.channel
        : sourceText?.fontId || DEFAULT_EDITOR_FONT_ID;
    if (sourceFontId === fontId) {
      setEditorFontApplySuggestion(null);
      return;
    }
    const hasOtherFont = (
      (source !== "title" && currentFonts.title !== fontId)
      || (source !== "channel" && currentFonts.channel !== fontId)
      || current.textOverlays.some((textOverlay) => (
        textOverlay.id !== sourceTextId
        && (textOverlay.fontId || DEFAULT_EDITOR_FONT_ID) !== fontId
      ))
    );
    commitEditorOverlayLayoutChange((layout) => ({
      ...layout,
      fonts: {
        ...(layout.fonts || {
          title: DEFAULT_EDITOR_FONT_ID,
          channel: DEFAULT_EDITOR_FONT_ID,
        }),
        ...(source === "title" ? { title: fontId } : {}),
        ...(source === "channel" ? { channel: fontId } : {}),
      },
      textOverlays: sourceTextId
        ? layout.textOverlays.map((textOverlay) => (
            textOverlay.id === sourceTextId
              ? { ...textOverlay, fontId }
              : textOverlay
          ))
        : layout.textOverlays,
    }));
    setEditorFontApplySuggestion(hasOtherFont
      ? { source, fontId }
      : null);
  };

  const updateSelectedEditorTextFont = (fontId: EditorFontId) => {
    if (!selectedTextOverlayId) return;
    updateEditorFont(editorTextSelection(selectedTextOverlayId), fontId);
  };

  const applySuggestedEditorFontToAll = () => {
    if (!editorFontApplySuggestion) return;
    commitEditorOverlayLayoutChange((current) => (
      applyEditorFontToSelectableText(
        current,
        editorFontApplySuggestion.fontId,
      )
    ));
    setEditorFontApplySuggestion(null);
  };

  const toggleEditorChannelVisibility = () => {
    const visible = !overlayLayoutRef.current.visible.channel;
    commitEditorOverlayLayoutChange((current) => ({
      ...current,
      visible: {
        ...current.visible,
        channel: visible,
      },
    }));
    setInlineEditingOverlay(null);
    if (visible) {
      setSelectedOverlay("channel");
    } else if (selectedOverlay === "channel") {
      setSelectedOverlay(null);
    }
  };

  const seekTimeline = (absoluteSeconds: number) => {
    if (!editTimeline || !videoRef.current) return;
    const relativeSeconds = absoluteSeconds - editTimeline.timelineStartSeconds;
    videoRef.current.currentTime = Math.max(0, relativeSeconds);
    setPreviewTime(relativeSeconds);
  };

  const updateSelectionStart = (value: number) => {
    if (!editTimeline) return;
    const firstClip = videoClipsRef.current[0];
    const maximum = videoCuttingEnabled && firstClip
      ? editTimeline.timelineStartSeconds
        + firstClip.sourceEndSeconds
        - EDITOR_VIDEO_MIN_CLIP_SECONDS
      : selectionEnd - RANGE_EDIT_MIN_SECONDS;
    const rounded = roundTimelineHandleSeconds(
      value,
      editTimeline.timelineStartSeconds,
      maximum,
    );
    setSelectionStart(rounded);
    if (videoCuttingEnabled && firstClip) {
      const nextClips = videoClipsRef.current.map((clip, index) => (
        index === 0
          ? {
              ...clip,
              sourceStartSeconds: rounded - editTimeline.timelineStartSeconds,
            }
          : clip
      ));
      videoClipsRef.current = nextClips;
      setVideoClips(nextClips);
      seekEditorVideoSequence(0);
      return;
    }
    seekTimeline(rounded);
  };

  const updateSelectionEnd = (value: number) => {
    if (!editTimeline) return;
    const lastClip = videoClipsRef.current[videoClipsRef.current.length - 1];
    const minimum = videoCuttingEnabled && lastClip
      ? editTimeline.timelineStartSeconds
        + lastClip.sourceStartSeconds
        + EDITOR_VIDEO_MIN_CLIP_SECONDS
      : selectionStart + RANGE_EDIT_MIN_SECONDS;
    const rounded = roundTimelineHandleSeconds(
      value,
      minimum,
      editTimeline.timelineEndSeconds,
    );
    setSelectionEnd(rounded);
    if (videoCuttingEnabled && lastClip) {
      const nextClips = videoClipsRef.current.map((clip, index, clips) => (
        index === clips.length - 1
          ? {
              ...clip,
              sourceEndSeconds: rounded - editTimeline.timelineStartSeconds,
            }
          : clip
      ));
      videoClipsRef.current = nextClips;
      setVideoClips(nextClips);
      seekEditorVideoSequence(Math.max(
        0,
        editorVideoDuration(nextClips) - 0.001,
      ));
      return;
    }
    seekTimeline(rounded);
  };

  const updateSelectionFromPointer = (handle: "start" | "end", clientX: number) => {
    if (!editTimeline || !filmstripRef.current) return;
    const bounds = filmstripRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const value = editTimeline.timelineStartSeconds + ratio * timelineDuration;
    if (handle === "start") updateSelectionStart(value);
    else updateSelectionEnd(value);
  };

  const startRangeInteraction = (handle: "start" | "end", event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    if (!filmstripRef.current) return;
    videoRef.current?.pause();
    timelineScrubbingRef.current = false;
    activeRangeHandleRef.current = handle;
    filmstripRef.current.setPointerCapture(event.pointerId);
    updateSelectionFromPointer(handle, event.clientX);
    event.stopPropagation();
    event.preventDefault();
  };

  const updatePlayheadFromPointer = (clientX: number) => {
    if (!editTimeline || !filmstripRef.current) return;
    const bounds = filmstripRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    if (videoCuttingEnabled) {
      const outputSeconds = (
        ratio - sourceSelectionLeft / 100
      ) * timelineDuration;
      seekEditorVideoSequence(Math.max(
        0,
        Math.min(videoSequenceDuration, outputSeconds),
      ));
      return;
    }
    const requestedSeconds = editTimeline.timelineStartSeconds + ratio * timelineDuration;
    const clampedSeconds = Math.max(selectionStart, Math.min(selectionEnd, requestedSeconds));
    videoRef.current?.pause();
    seekTimeline(clampedSeconds);
  };

  const startTimelineScrubbing = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (videoCuttingEnabled) {
      const target = event.target;
      const clipId = target instanceof HTMLElement
        ? target.closest<HTMLElement>("[data-editor-video-clip-id]")
          ?.dataset.editorVideoClipId
        : null;
      setSelectedVideoClipId(clipId || null);
      setSelectedOverlay(null);
      setInlineEditingOverlay(null);
    }
    activeRangeHandleRef.current = null;
    timelineScrubbingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePlayheadFromPointer(event.clientX);
    event.preventDefault();
  };

  const moveTimelineScrubbing = (event: PointerEvent<HTMLDivElement>) => {
    const activeHandle = activeRangeHandleRef.current;
    if (activeHandle) {
      updateSelectionFromPointer(activeHandle, event.clientX);
      event.preventDefault();
      return;
    }
    if (!timelineScrubbingRef.current) return;
    updatePlayheadFromPointer(event.clientX);
    event.preventDefault();
  };

  const finishTimelineScrubbing = (event: PointerEvent<HTMLDivElement>) => {
    activeRangeHandleRef.current = null;
    timelineScrubbingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const togglePreviewPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (videoCuttingEnabled) {
      if (videoSequenceTimeRef.current >= videoSequenceDuration - 0.03) {
        seekEditorVideoSequence(0, false);
      }
      void video.play().catch(() => undefined);
      return;
    }
    if (editTimeline) {
      const selectionEndOffset = selectionEnd - editTimeline.timelineStartSeconds;
      if (video.currentTime >= selectionEndOffset - 0.03) {
        const selectionStartOffset = selectionStart - editTimeline.timelineStartSeconds;
        video.currentTime = Math.max(0, selectionStartOffset);
        setPreviewTime(Math.max(0, selectionStartOffset));
      }
    }
    void video.play().catch(() => undefined);
  }, [
    editTimeline,
    seekEditorVideoSequence,
    selectionEnd,
    selectionStart,
    videoCuttingEnabled,
    videoSequenceDuration,
  ]);

  const togglePreviewFullscreen = useCallback(async () => {
    const previewPane = editorPreviewPaneRef.current;
    if (!previewPane || typeof previewPane.requestFullscreen !== "function") return;
    try {
      if (document.fullscreenElement === previewPane) {
        await document.exitFullscreen();
        return;
      }
      clearEditorOverlaySelection();
      if (document.fullscreenElement) await document.exitFullscreen();
      await previewPane.requestFullscreen();
    } catch {
      // Fullscreen can be blocked by browser or OS policy. Keep the editor usable.
    }
  }, [clearEditorOverlaySelection]);

  useEffect(() => {
    const syncPreviewFullscreen = () => {
      setIsPreviewFullscreen(
        document.fullscreenElement === editorPreviewPaneRef.current,
      );
    };
    document.addEventListener("fullscreenchange", syncPreviewFullscreen);
    syncPreviewFullscreen();
    return () => {
      document.removeEventListener("fullscreenchange", syncPreviewFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!standalone) return;
    const handleDesktopPlaybackShortcut = (event: KeyboardEvent) => {
      if (commentRegenerationConfirmationOpen || editorFontApplySuggestion) return;
      if (event.code !== "Space" || event.repeat || !window.matchMedia("(min-width: 921px)").matches) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      event.preventDefault();
      togglePreviewPlayback();
    };
    window.addEventListener("keydown", handleDesktopPlaybackShortcut);
    return () => window.removeEventListener("keydown", handleDesktopPlaybackShortcut);
  }, [
    commentRegenerationConfirmationOpen,
    editorFontApplySuggestion,
    standalone,
    togglePreviewPlayback,
  ]);

  const save = async () => {
    if (overlayPreviewEnabled && !editorSaveEnabled) {
      setError("로컬 오버레이 미리보기에서는 영상 저장 요청을 보내지 않습니다.");
      return;
    }
    setSaving(true); setError(null);
    try {
      if (overlayPreviewEnabled && editorSaveEnabled) {
        if (!editTimeline || editorDocumentSnapshot.video.clips.length === 0) {
          throw new Error("편집용 영상이 준비된 뒤 다시 시도해 주세요.");
        }
        const document = cloneEditorDocumentSnapshot(editorDocumentSnapshot);
        const outputDuration = editorDocumentOutputDuration(document);
        document.comments = scaleTimedRanges(
          document.comments,
          item.durationSeconds,
          outputDuration,
        );
        document.overlays.commentOffsets = Object.fromEntries(
          Object.entries(document.overlays.commentOffsets).filter(([id]) => (
            document.comments.some((comment) => comment.id === id)
          )),
        );
        document.overlays.textOverlays = document.overlays.textOverlays.map(
          (textOverlay) => {
            const startSeconds = Math.max(
              0,
              Math.min(outputDuration - 0.001, textOverlay.startSeconds),
            );
            const endSeconds = Math.max(
              startSeconds + 0.001,
              Math.min(outputDuration, textOverlay.endSeconds),
            );
            return {
              ...textOverlay,
              startSeconds,
              endSeconds,
            };
          },
        );
        document.subtitles.segments = editorSubtitlesForSave(
          document.subtitles.segments,
        );
        if (document.version === 3) {
          document.renderSpec = createEditorRenderSpec(document);
        }
        const validatedDocument = editorDocumentSnapshotSchema.safeParse(
          document,
        );
        if (!validatedDocument.success) {
          const issue = validatedDocument.error.issues[0];
          const field = issue?.path[0];
          const message = field === "subtitles"
            ? "비어 있거나 올바르지 않은 자막을 다시 확인해 주세요."
            : field === "comments"
              ? "댓글 내용과 노출 구간을 다시 확인해 주세요."
              : field === "title"
                ? "후킹 제목의 내용과 스타일을 다시 확인해 주세요."
                : field === "video"
                  ? "영상 구간을 다시 확인해 주세요."
                  : "저장할 편집 내용을 다시 확인해 주세요.";
          throw new Error(message);
        }
        const requestId = editorSaveRequestIdRef.current
          || globalThis.crypto.randomUUID();
        editorSaveRequestIdRef.current = requestId;
        await requestJson(`/api/shorts/${item.id}/apply-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId,
            release: {
              releaseId: editorRelease.releaseId,
              channel: editorRelease.channel,
              uiVersion: editorRelease.uiVersion,
              documentVersion: editorRelease.documentVersion,
            },
            document: validatedDocument.data,
          }),
        });
        editorSaveRequestIdRef.current = null;
      } else {
      const commentOverlays = editorDocumentSnapshot.template.id === "comment-capture"
        ? [...editorDocumentSnapshot.comments].sort(
            (left, right) => left.startSeconds - right.startSeconds,
          )
        : [];
      if (editTimeline) {
        const startSeconds = clampTimelineSeconds(
          editorDocumentSnapshot.video.selectionStartSeconds,
          editTimeline.timelineStartSeconds,
          editTimeline.timelineEndSeconds,
        );
        const endSeconds = clampTimelineSeconds(
          editorDocumentSnapshot.video.selectionEndSeconds,
          editTimeline.timelineStartSeconds,
          editTimeline.timelineEndSeconds,
        );
        await requestJson(`/api/shorts/${item.id}/apply-edit`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startSeconds,
            endSeconds,
            hookTitle: editorDocumentSnapshot.title.text,
            channelDisplayName: editorDocumentSnapshot.channel.displayName,
            subtitlesEnabled,
            subtitleSegments: segments,
            commentOverlays,
            templateId: editorDocumentSnapshot.template.id,
            ...(templateSelectionTouched
              ? {
                  customTemplateId:
                    editorDocumentSnapshot.template.customTemplateId,
                }
              : {}),
            titleFontScale: editorDocumentSnapshot.title.fontScale,
            titleTextStyles: editorDocumentSnapshot.title.textStyles,
          }),
        });
      } else {
        await requestJson(`/api/shorts/${item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hookTitle: editorDocumentSnapshot.title.text,
            channelDisplayName: editorDocumentSnapshot.channel.displayName,
            subtitlesEnabled,
            subtitleSegments: segments,
            commentOverlays,
            templateId: editorDocumentSnapshot.template.id,
            ...(templateSelectionTouched
              ? {
                  customTemplateId:
                    editorDocumentSnapshot.template.customTemplateId,
                }
              : {}),
            titleFontScale: editorDocumentSnapshot.title.fontScale,
            titleTextStyles: editorDocumentSnapshot.title.textStyles,
          }),
        });
        await requestJson(`/api/shorts/${item.id}/rerender`, { method: "POST" });
      }
      }
      const rerenderStartedAt = String(Date.now());
      try {
        window.localStorage.setItem(
          `estimated-progress:rerender:${item.id}:${item.renderVersion}`,
          rerenderStartedAt,
        );
      } catch {
        // Shared storage can be disabled; keep the current tab timer below.
      }
      try {
        window.sessionStorage.setItem(
          `estimated-progress:rerender:${item.id}:${item.renderVersion}`,
          rerenderStartedAt,
        );
      } catch {
        // Storage can be disabled; the overlay will start when rerendering is first observed.
      }
      if (standalone && projectNumber) {
        try {
          window.localStorage.setItem(
            PROJECT_EDIT_REFRESH_STORAGE_KEY,
            createProjectEditRefreshSignal(projectNumber, item.id),
          );
        } catch {
          // If cross-tab storage is disabled, the editor's close fallback still opens the project.
        }
        onClose();
        return;
      }
      await onChanged();
      onClose();
    } catch (cause) { setError(userFacingErrorMessage(cause, "저장하지 못했습니다.")); }
    finally { setSaving(false); }
  };

  const commentTimeline = editorCommentOverlayEnabled
    && renderOverlayLayout.visible.comment
    ? <>
      <CommentTimelineEditor
        comments={commentsForPreview}
        durationSeconds={editTimeline ? previewDuration : item.durationSeconds}
        currentSeconds={relativePreviewTime}
        onRangeChange={updateCommentRange}
        onTextChange={(id, text) => updateComment(id, { text })}
        onSeek={seekCommentTimeline}
        onDelete={deleteEditorComment}
        onSelect={() => {
          setInlineEditingOverlay(null);
          setSelectedOverlay("comment");
        }}
        onDeselect={clearEditorOverlaySelection}
        onTextEditStart={beginEditorCommentTextInteraction}
        onTextEditEnd={finishEditorCommentTextInteraction}
        onRangeEditStart={beginEditorCommentTextInteraction}
        onRangeEditEnd={finishEditorCommentTextInteraction}
        active={selectedOverlay === "comment"}
        editRequest={commentEditRequest}
        showCommentText={overlayPreviewEnabled}
        snapPointsSeconds={videoSplitSnapPoints}
        selectionLeftPercent={editTimeline ? selectionLeft : 0}
        selectionWidthPercent={editTimeline ? selectionWidth : 100}
      />
      {!commentsAreValid && <p className="editor-comment-timeline-error">댓글 내용과 노출 구간이 비어 있거나 서로 겹치지 않도록 조정해 주세요.</p>}
    </>
    : null;
  const textTimelines = overlayPreviewEnabled && textOverlays.length > 0
    ? <div className="editor-text-timeline-stack" aria-label="추가한 텍스트 타임라인">
        {textOverlays.map((textOverlay) => {
          const selection = editorTextSelection(textOverlay.id);
          return <EditorTextTimeline
            key={textOverlay.id}
            textOverlay={textOverlay}
            selected={selectedOverlay === selection}
            durationSeconds={previewDuration}
            currentSeconds={displayedPreviewTime}
            onRangeChange={(range) => updateEditorTextOverlay(
              textOverlay.id,
              (current) => ({
                ...current,
                ...range,
              }),
            )}
            onSeek={seekCommentTimeline}
            onSelect={() => {
              if (inlineEditingOverlay !== null) finishEditorInlineEdit();
              setSelectedOverlay(selection);
            }}
            onInteractionStart={beginEditorOverlayHistoryInteraction}
            onInteractionEnd={finishEditorOverlayHistoryInteraction}
            snapPointsSeconds={videoSplitSnapPoints}
            selectionLeftPercent={editTimeline ? selectionLeft : 0}
            selectionWidthPercent={editTimeline ? selectionWidth : 100}
          />;
        })}
      </div>
    : null;

  const renderSelectedEditorTextSettings = () => {
    if (!selectedTextOverlay) return null;
    return <div className="editor-element-settings">
      <label className="editor-text-content-setting">
        <span>내용</span>
        <textarea
          value={selectedTextOverlay.text}
          maxLength={120}
          rows={2}
          onFocus={beginEditorOverlayHistoryInteraction}
          onBlur={finishEditorOverlayHistoryInteraction}
          onChange={(event) => updateSelectedEditorText(
            { text: event.target.value },
            "continuous",
          )}
        />
      </label>
      <EditorFontPicker
        value={selectedTextOverlay.fontId || DEFAULT_EDITOR_FONT_ID}
        onChange={updateSelectedEditorTextFont}
      />
      <fieldset className="editor-text-color-setting">
        <legend>색상</legend>
        <div>
          {templatePresetColorOptions.map((option) => <button
            key={option.color}
            type="button"
            aria-label={`텍스트 색상 ${option.name}`}
            title={option.name}
            aria-pressed={selectedTextOverlay.color === option.color}
            onClick={() => updateSelectedEditorText({
              color: option.color,
            })}
            style={{ backgroundColor: option.color }}
          />)}
        </div>
      </fieldset>
      <fieldset className="editor-text-effect-setting">
        <legend>효과</legend>
        <div>
          <button
            type="button"
            aria-pressed={selectedTextOverlay.effect === "none"}
            onClick={() => updateSelectedEditorText({
              effect: "none",
            })}
          >
            없음
          </button>
          <button
            type="button"
            aria-pressed={(selectedTextOverlay.effect || "outline") === "outline"}
            onClick={() => updateSelectedEditorText({
              effect: "outline",
            })}
          >
            테두리
          </button>
          <button
            type="button"
            aria-pressed={selectedTextOverlay.effect === "shadow"}
            onClick={() => updateSelectedEditorText({
              effect: "shadow",
            })}
          >
            그림자
          </button>
        </div>
      </fieldset>
      <button
        type="button"
        className="editor-v2-text-delete"
        onClick={deleteSelectedEditorOverlay}
      >
        선택한 텍스트 삭제
      </button>
    </div>;
  };
  const editorTimelineZoomStyle: CSSProperties | undefined = overlayPreviewEnabled
    ? { width: `${editorTimelineZoom * 100}%` }
    : undefined;

  const editorContent = (
    <>
      <ApplyEditConfirmDialog
        open={applyConfirmationOpen && (!overlayPreviewEnabled || editorSaveEnabled)}
        saving={saving}
        onCancel={() => setApplyConfirmationOpen(false)}
        onConfirm={() => {
          setApplyConfirmationOpen(false);
          void save();
        }}
      />
      <EditorFontApplyDialog
        fontId={overlayPreviewEnabled
          ? editorFontApplySuggestion?.fontId || null
          : null}
        onCancel={() => setEditorFontApplySuggestion(null)}
        onConfirm={applySuggestedEditorFontToAll}
      />
      <ResetTimelineConfirmDialog
        open={resetConfirmationOpen && overlayPreviewEnabled && Boolean(editTimeline)}
        onCancel={() => setResetConfirmationOpen(false)}
        onConfirm={() => {
          setResetConfirmationOpen(false);
          if (!editTimeline) return;
          if (videoCuttingEnabled) {
            resetEditorVideoCuts();
            return;
          }
          setSelectionStart(editTimeline.initialStartSeconds);
          setSelectionEnd(editTimeline.initialEndSeconds);
          seekTimeline(editTimeline.initialStartSeconds);
        }}
      />
      <CommentRegenerationConfirmDialog
        open={commentRegenerationConfirmationOpen && overlayPreviewEnabled}
        generating={regeneratingComments}
        error={commentRegenerationError}
        onCancel={() => {
          if (regeneratingComments) return;
          commentRegenerationRequestIdRef.current = null;
          setCommentRegenerationError(null);
          setCommentRegenerationConfirmationOpen(false);
        }}
        onConfirm={() => {
          void regenerateEditorComments();
        }}
      />
      <CommentRegenerationComparisonDialog
        comparison={overlayPreviewEnabled ? commentRegenerationComparison : null}
        onChoose={chooseRegeneratedComment}
        onTextChange={updateRegeneratedCommentText}
        onChooseAll={chooseAllRegeneratedComments}
        onCancel={cancelRegeneratedCommentComparison}
        onApply={applyRegeneratedCommentComparison}
      />
      <DesktopEditorGuide
        enabled={standalone
          && mobileEditorBlocked === false
          && !paidAccessBlocked
          && editorGuideReady
          && editorDraftLookupComplete
          && editorDraftDecisionComplete
          && !editorDraftCandidate
          && (
            overlayPreviewEnabled
            || Boolean(editTimeline)
            || editorCommentOverlayEnabled
          )}
        rangeControlsAvailable={Boolean(editTimeline)}
        commentControlsAvailable={editorCommentOverlayEnabled}
        overlayPreviewEnabled={overlayPreviewEnabled}
        editorSaveEnabled={editorSaveEnabled}
      />
      {mobileEditorBlocked === true && <div
        className="editor-mobile-blocker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-mobile-blocker-title"
        aria-describedby="editor-mobile-blocker-description"
      >
        <section className="editor-mobile-blocker-card">
          <span className="editor-mobile-blocker-label">PC 전용 편집 기능</span>
          <h2 id="editor-mobile-blocker-title">데스크톱에서 편집해 주세요</h2>
          <p id="editor-mobile-blocker-description">영상 구간과 댓글 타임라인을 정확하게 조정하려면 데스크톱 환경이 필요합니다.</p>
          <button type="button" onClick={onClose}>프로젝트로 돌아가기</button>
        </section>
      </div>}
      <PaidProjectFeatureOverlay
        action="edit"
        open={standalone && paidAccessBlocked && mobileEditorBlocked === false}
      />
      {standalone && <header className="editor-topbar">
        <div className="editor-topbar-inner">
          <div className="editor-header-project">
            <span className="editor-header-project-number">{projectNumber ? `프로젝트 #${projectNumber}` : "영상 편집"}</span>
            <div className="editor-header-title-row">
              <h1>{projectLabel || "제목 없는 영상"}</h1>
            </div>
          </div>
          <div className="editor-header-actions">
            {overlayPreviewEnabled && editorDraftLookupComplete && <span
              className={`editor-draft-status is-${editorDraftSaveState}`}
              role="status"
              aria-live="polite"
              title="이 브라우저에 임시 저장 · ⌘S 또는 Ctrl+S로 지금 저장"
            >
              <span aria-hidden="true" />
              {editorDraftSaveState === "saving"
                ? "저장 중..."
                : editorDraftSaveState === "saved"
                  ? editorDraftSavedAgoLabel(
                      editorDraftSavedAt,
                      editorDraftStatusNow,
                    )
                  : editorDraftSaveState === "error"
                    ? "저장 실패"
                    : "자동 저장"}
            </span>}
            <button type="button" onClick={onClose} className="editor-close-button" aria-label="편집기에서 나가기">나가기</button>
            <button
              type="button"
              data-editor-guide={overlayPreviewEnabled ? "editor-save" : undefined}
              disabled={(overlayPreviewEnabled && !editorSaveEnabled) || !editorValid || saving}
              onClick={() => setApplyConfirmationOpen(true)}
              className="editor-apply-button"
            >
              {overlayPreviewEnabled && !editorSaveEnabled
                ? "저장 잠금"
                : saving
                  ? "적용 중..."
                  : "영상에 적용"}
            </button>
          </div>
        </div>
      </header>}
      <div className={standalone
        ? `editor-page-body${overlayPreviewEnabled ? " has-editor-tool-sidebar" : ""}${desktopSidebarOpen ? "" : overlayPreviewEnabled ? " is-tool-panel-closed" : " is-sidebar-collapsed"}`
        : `editor-dialog-body grid max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[#151517] sm:rounded-2xl${overlayPreviewEnabled ? " has-editor-tool-sidebar" : ""}${desktopSidebarOpen ? "" : overlayPreviewEnabled ? " is-tool-panel-closed" : " is-sidebar-collapsed"}`}
        aria-busy={!paidAccessBlocked && !editorGuideReady}
      >
        {!paidAccessBlocked && !editorGuideReady && <section
          className="editor-initial-loading"
          role="status"
          aria-live="polite"
          aria-label="편집기 준비 중"
        >
          <div>
            <span className="editor-initial-loading-spinner" aria-hidden="true" />
            <strong>편집기를 준비하고 있어요</strong>
            <p>영상과 타임라인을 불러오는 중입니다.</p>
          </div>
        </section>}
        {standalone && overlayPreviewEnabled && <div
          className="editor-history-controls"
          aria-label="편집 기록"
          data-editor-guide="editor-history"
        >
          <button
            type="button"
            aria-label="되돌리기"
            title="되돌리기 (Ctrl/⌘ + Z)"
            disabled={!canUndoEditorEdit}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              finishPendingEditorInteractions();
              undoEditorEdit();
            }}
            onClick={(event) => {
              if (event.detail !== 0) return;
              finishPendingEditorInteractions();
              undoEditorEdit();
            }}
          >
            <span aria-hidden="true">↶</span>
            되돌리기
          </button>
          <button
            type="button"
            aria-label="앞으로 가기"
            title="앞으로 가기 (Ctrl/⌘ + Shift + Z)"
            disabled={!canRedoEditorEdit}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              finishPendingEditorInteractions();
              redoEditorEdit();
            }}
            onClick={(event) => {
              if (event.detail !== 0) return;
              finishPendingEditorInteractions();
              redoEditorEdit();
            }}
          >
            <span aria-hidden="true">↷</span>
            앞으로 가기
          </button>
        </div>}
        <button
          type="button"
          className={`editor-sidebar-rail-toggle${overlayPreviewEnabled ? " editor-overlay-panel-toggle" : ""}`}
          aria-label={desktopSidebarOpen ? "편집 사이드바 닫기" : "편집 사이드바 열기"}
          aria-expanded={desktopSidebarOpen}
          aria-controls={overlayPreviewEnabled ? "editor-tool-detail" : "editor-controls-scroll"}
          onClick={() => setDesktopSidebarOpen((current) => !current)}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d={desktopSidebarOpen ? "m12.25 5.5-4.5 4.5 4.5 4.5" : "m7.75 5.5 4.5 4.5-4.5 4.5"} stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <section
          ref={editorPreviewPaneRef}
          className={standalone ? `editor-preview-pane${editTimeline ? " has-range-editor" : ""}` : "editor-dialog-preview editor-preview-stack"}
          onPointerDown={overlayPreviewEnabled
            ? clearEditorOverlaySelection
            : undefined}
        >
        <div
          data-editor-preview-canvas-wrap=""
          className={standalone ? "editor-preview-canvas-wrap" : "sticky top-0 mx-auto w-full max-w-[320px]"}
        >
        <div
          ref={editorPreviewViewportRef}
          className="editor-preview-canvas-viewport"
          aria-label={overlayPreviewEnabled ? "미리보기 화면" : undefined}
        >
        <div
          ref={editorCanvasRef}
          data-editor-preview-canvas=""
          data-editor-overlay-canvas={overlayPreviewEnabled ? "" : undefined}
          data-editor-guide={overlayPreviewEnabled ? "preview-canvas" : undefined}
          className={standalone ? "editor-video-frame" : "aspect-[9/16] w-full overflow-hidden"}
          style={{
            ...resolvedEditorCanvasBackground,
            containerType: "inline-size",
          }}
        >
          {renderOverlayLayout.visible.title && (activeCustomTemplate
            ? <CustomTemplateTitlePreview
                title={activeCustomTemplate.config.title}
                sourceTitle={renderTitle}
                firstLine={customTitleLines[0] || ""}
                secondLine={customTitleLines[1] || ""}
                fontScale={renderTitleFontScale}
                fontFamily={titleFontFamily}
                fontWeight={renderSpec?.title.font.resolvedWeight}
                resolvedLines={renderSpec?.title.lines}
                resolvedFontSize={renderSpec?.title.fontSize}
                forceCenterX={Boolean(renderSpec)}
                textStyles={renderTitleTextStyles}
                selected={overlayPreviewEnabled && selectedOverlay === "title"}
                editing={inlineEditingOverlay === "title"}
                editValue={renderTitle}
                movementStyle={overlayMovementStyle("title")}
                onPointerDown={overlayPreviewEnabled
                  ? (event) => beginEditorOverlayDrag("title", event)
                  : undefined}
                onEditStart={beginEditorTitleInlineEdit}
                onEditValueChange={updateEditorTitleInlineValue}
                onEditEnd={finishEditorInlineEdit}
              />
            : <TitleOverlayPreview
                title={renderTitle}
                fontScale={renderTitleFontScale}
                videoAspectRatio={commentNeedsVerticalFit ? "4:5" : originalAspectRatio}
                primary={template.primary}
                accent={template.accent}
                background={editorTemplateSurfaceBackground}
                fontFamily={titleFontFamily}
                fontWeight={renderSpec?.title.font.resolvedWeight}
                resolvedLines={renderSpec?.title.lines}
                resolvedFontSize={renderSpec?.title.fontSize}
                keepPrimaryFirstLine={template.id === "paper"}
                textStyles={renderTitleTextStyles}
                liftLandscape={usesLiftedCommentLayout}
                selected={overlayPreviewEnabled && selectedOverlay === "title"}
                editing={inlineEditingOverlay === "title"}
                movementStyle={overlayMovementStyle("title")}
                onPointerDown={overlayPreviewEnabled
                  ? (event) => beginEditorOverlayDrag("title", event)
                  : undefined}
                onEditStart={beginEditorTitleInlineEdit}
                onEditValueChange={updateEditorTitleInlineValue}
                onEditEnd={finishEditorInlineEdit}
              />)}
          {renderOverlayLayout.visible.video && (cleanVideoUrl ? <video
            ref={videoRef}
            data-editor-overlay-layer={overlayPreviewEnabled ? "video" : undefined}
            className={`${activeCustomTemplate
              ? "absolute bg-black object-cover"
              : `absolute inset-x-0 w-full bg-black ${commentNeedsVerticalFit ? "object-contain" : "object-cover"}`}${overlayPreviewEnabled ? " cursor-move touch-none" : ""}${overlayPreviewEnabled && selectedOverlay === "video" ? " outline outline-2 outline-white outline-offset-[-2px]" : ""}`}
            style={{
              ...(activeCustomTemplate
                ? customVideoFrameStyle(activeCustomTemplate.config.video)
                : { top: `${editorLayout.videoTop}%`, height: `${editorLayout.videoHeight}%` }),
              ...(videoMovementStyle || {}),
            }}
            src={cleanVideoUrl}
            playsInline
            disablePictureInPicture
            preload="metadata"
            onPointerDown={overlayPreviewEnabled
              ? (event) => beginEditorOverlayDrag("video", event)
              : undefined}
            onContextMenu={(event) => event.preventDefault()}
            onLoadedMetadata={(event) => {
              setVideoLoadError(false);
              editorVideoRefreshInFlightRef.current = false;
              editorVideoRetryCountRef.current = 0;
              setVideoConnectionState("ready");
              const pendingRestore = editorVideoRestoreRef.current;
              if (pendingRestore) {
                editorVideoRestoreRef.current = null;
                const maximum = Math.max(0, event.currentTarget.duration - 0.001);
                const restoredTime = Math.max(
                  0,
                  Math.min(maximum, pendingRestore.currentTime),
                );
                event.currentTarget.currentTime = restoredTime;
                setPreviewTime(restoredTime);
                if (pendingRestore.shouldPlay) {
                  void event.currentTarget.play().catch(() => undefined);
                }
                return;
              }
              if (editTimeline) {
                if (videoCuttingEnabled) {
                  const located = locateEditorVideoTime(
                    videoClipsRef.current,
                    videoSequenceTimeRef.current,
                  );
                  if (located) {
                    activeVideoClipIndexRef.current = located.clipIndex;
                    event.currentTarget.currentTime = located.sourceSeconds;
                    setPreviewTime(located.sourceSeconds);
                  }
                  return;
                }
                const offset = selectionStart - editTimeline.timelineStartSeconds;
                event.currentTarget.currentTime = Math.max(0, offset);
                setPreviewTime(offset);
              }
            }}
            onPlay={() => setIsPreviewPlaying(true)}
            onPause={() => setIsPreviewPlaying(false)}
            onEnded={() => setIsPreviewPlaying(false)}
            onError={handleEditorVideoLoadError}
            onTimeUpdate={(event) => {
              const current = event.currentTarget.currentTime;
              setPreviewTime(current);
              if (videoCuttingEnabled) {
                const clips = videoClipsRef.current;
                const clipIndex = Math.min(
                  activeVideoClipIndexRef.current,
                  Math.max(0, clips.length - 1),
                );
                const clip = clips[clipIndex];
                if (!clip) return;
                const outputTime = editorVideoOutputTimeForSource(
                  clips,
                  clipIndex,
                  current,
                );
                videoSequenceTimeRef.current = outputTime;
                setVideoSequenceTime(outputTime);
                if (
                  !event.currentTarget.paused
                  && current >= clip.sourceEndSeconds - 0.03
                ) {
                  const nextClip = clips[clipIndex + 1];
                  if (nextClip) {
                    activeVideoClipIndexRef.current = clipIndex + 1;
                    const nextOutputTime = editorVideoOutputTimeForSource(
                      clips,
                      clipIndex + 1,
                      nextClip.sourceStartSeconds,
                    );
                    videoSequenceTimeRef.current = nextOutputTime;
                    setVideoSequenceTime(nextOutputTime);
                    event.currentTarget.currentTime = nextClip.sourceStartSeconds;
                    void event.currentTarget.play().catch(() => undefined);
                    return;
                  }
                  const firstClip = clips[0];
                  if (firstClip) {
                    activeVideoClipIndexRef.current = 0;
                    videoSequenceTimeRef.current = 0;
                    setVideoSequenceTime(0);
                    event.currentTarget.currentTime = firstClip.sourceStartSeconds;
                    void event.currentTarget.play().catch(() => undefined);
                  }
                }
                return;
              }
              if (editTimeline) {
                const start = selectionStart - editTimeline.timelineStartSeconds;
                const end = selectionEnd - editTimeline.timelineStartSeconds;
                if (!event.currentTarget.paused && current >= end - 0.03) {
                  event.currentTarget.currentTime = Math.max(0, start);
                  void event.currentTarget.play().catch(() => undefined);
                }
              }
            }}
          /> : <div
            data-editor-overlay-layer={overlayPreviewEnabled ? "video" : undefined}
            className={`${activeCustomTemplate
              ? "absolute flex items-center justify-center bg-black/50 text-sm text-neutral-400"
              : "absolute inset-x-0 flex items-center justify-center bg-black/50 text-sm text-neutral-400"}${overlayPreviewEnabled ? " cursor-move touch-none" : ""}${overlayPreviewEnabled && selectedOverlay === "video" ? " outline outline-2 outline-white outline-offset-[-2px]" : ""}`}
            style={{
              ...(activeCustomTemplate
                ? customVideoFrameStyle(activeCustomTemplate.config.video)
                : { top: `${editorLayout.videoTop}%`, height: `${editorLayout.videoHeight}%` }),
              ...(videoMovementStyle || {}),
            }}
            onPointerDown={overlayPreviewEnabled
              ? (event) => beginEditorOverlayDrag("video", event)
              : undefined}
          >클린 영상 준비 중</div>)}
          {overlayPreviewEnabled && renderOverlayLayout.visible.video && selectedOverlay === "video" && <div
            data-editor-video-resize-frame
            className="pointer-events-none absolute z-[65] border-2 border-white"
            style={{
              left: `${editorVideoRect.x / (TEMPLATE_CANVAS.width / 100)}%`,
              top: `${editorVideoRect.y / (TEMPLATE_CANVAS.height / 100)}%`,
              width: `${editorVideoRect.width / (TEMPLATE_CANVAS.width / 100)}%`,
              height: `${editorVideoRect.height / (TEMPLATE_CANVAS.height / 100)}%`,
            }}
          >
            {EDITOR_VIDEO_RESIZE_HANDLES.map((resizeHandle) => <button
              key={resizeHandle.handle}
              type="button"
              data-editor-video-resize-handle={resizeHandle.handle}
              aria-label={resizeHandle.label}
              onPointerDown={(event) => beginEditorVideoResize(resizeHandle.handle, event)}
              className={`pointer-events-auto absolute h-3 w-3 touch-none rounded-sm border border-[#18181b] bg-white shadow-[0_0_0_1px_rgba(255,255,255,.9)] ${resizeHandle.positionClassName} ${resizeHandle.cursorClassName}`}
            />)}
          </div>}
          {overlayPreviewEnabled && videoConnectionState === "reconnecting" && <div
            className="pointer-events-none absolute inset-x-3 top-3 z-[70] flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#202024]/95 px-3 py-2.5 text-center text-xs font-bold text-white/80 shadow-lg backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white" aria-hidden="true" />
            편집용 영상을 다시 연결하고 있어요
          </div>}
          {videoLoadError && (overlayPreviewEnabled
            ? <div
                className="pointer-events-auto absolute inset-x-3 top-3 z-[70] flex items-center justify-between gap-3 rounded-xl border border-red-300/20 bg-[#2a2022]/95 px-3 py-2.5 text-xs font-semibold text-red-50 shadow-lg backdrop-blur"
                role="alert"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span>편집용 영상 연결이 끊어졌어요.</span>
                <button
                  type="button"
                  className="min-h-8 flex-none rounded-lg bg-white px-3 font-extrabold text-black transition hover:bg-neutral-100"
                  onClick={() => {
                    editorVideoRetryCountRef.current = 0;
                    void refreshEditorVideoSource("manual");
                  }}
                >
                  다시 시도
                </button>
              </div>
            : <div className="pointer-events-none absolute inset-x-3 top-3 z-50 rounded bg-red-950/90 px-3 py-2 text-center text-xs font-semibold text-red-100">편집용 영상을 재생하지 못했습니다. 잠시 후 다시 열어 주세요.</div>)}
          {subtitlesEnabled && activeSubtitle && <div
            className="absolute inset-x-5 bottom-[23.2%] z-50 rounded bg-black/75 px-2 py-1 text-center text-xs font-bold text-white"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {editingSubtitleIndex === activeSubtitleIndex
              ? <textarea
                  autoFocus
                  aria-label="현재 자막 수정"
                  value={activeSubtitle.text}
                  maxLength={200}
                  rows={2}
                  onFocus={beginEditorCopyInteraction}
                  onChange={(event) => updateSubtitleText(
                    activeSubtitleIndex,
                    event.target.value,
                  )}
                  onBlur={() => {
                    finishEditorCopyInteraction();
                    setEditingSubtitleIndex(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (
                      event.key === "Escape"
                      || (event.key === "Enter" && !event.shiftKey)
                    ) {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  className="block w-full resize-none rounded border border-white/35 bg-black/90 px-2 py-1 text-center text-xs font-bold leading-5 text-white outline-none focus:border-white"
                />
              : <button
                  type="button"
                  className="block w-full cursor-text text-center"
                  title="더블클릭해서 자막 수정"
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setEditingSubtitleIndex(activeSubtitleIndex);
                  }}
                >
                  {activeSubtitle.text}
                </button>}
          </div>}
          {activeCustomTemplate
            ? <>
                {renderOverlayLayout.visible.comment && templateId === "comment-capture" && layoutPreviewComment && activeCustomTemplate.config.comment.visible
                  ? <div
                      data-editor-overlay-layer={overlayPreviewEnabled ? "comment" : undefined}
                      className={`absolute inset-x-0 z-40${overlayPreviewEnabled ? " cursor-ns-resize touch-none" : ""}${overlayPreviewEnabled && selectedOverlay === "comment" ? " outline outline-2 outline-[#ff715e] outline-offset-[-2px]" : ""}`}
                      style={{
                        top: `${(customCommentY / TEMPLATE_CANVAS.height) * 100}%`,
                        ...(overlayMovementStyle("comment", layoutPreviewComment.id) || {}),
                      }}
                      onPointerDown={overlayPreviewEnabled
                        ? (event) => beginEditorOverlayDrag(
                            "comment",
                            event,
                            layoutPreviewComment.id,
                          )
                        : undefined}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        requestCommentTextEdit(layoutPreviewComment.id);
                      }}
                      title="더블클릭해서 댓글 수정"
                    >
                      <TemplateCommentPreview
                        theme={editorCommentTheme}
                        size={activeCustomTemplate.config.comment.size}
                        comment={layoutPreviewComment}
                      />
                    </div>
                  : null}
                {renderOverlayLayout.visible.channel && <CustomEditorChannel
                    template={activeCustomTemplate}
                    channelName={renderChannel}
                    channelThumbnailUrl={renderChannelThumbnailUrl}
                    fontFamily={channelFontFamily}
                    fontWeight={renderSpec?.channel.font.resolvedWeight}
                    selected={overlayPreviewEnabled && selectedOverlay === "channel"}
                    forceVisible={overlayPreviewEnabled}
                    movementStyle={overlayMovementStyle("channel")}
                    onPointerDown={overlayPreviewEnabled
                      ? (event) => beginEditorOverlayDrag("channel", event)
                      : undefined}
                  />}
              </>
            : <>
                <div className={`absolute inset-x-0 ${overlayPreviewEnabled ? "overflow-visible" : "z-10 overflow-hidden"} text-sm font-bold ${templateId === "comment-capture" ? "" : editorLayout.fullVertical ? "pt-5" : "pt-[4.4%]"}`} style={{ top: editorLayout.fullVertical ? "84.375%" : `${editorLayout.videoTop + editorLayout.videoHeight}%`, height: editorLayout.fullVertical ? "9.375%" : `${editorLayout.bottomHeight}%`, background: editorLayout.fullVertical && templateId !== "comment-capture" ? "transparent" : editorTemplateSurfaceBackground, color: template.channel }}>
                  {templateId === "comment-capture"
                    ? <div
                        data-editor-comment-capture-surface=""
                        className="h-full"
                        style={{
                          backgroundColor: overlayPreviewEnabled
                            && editorCanvasBackground
                            ? "transparent"
                            : editorCommentTheme === "dark"
                              ? "#040404"
                              : "#ffffff",
                        }}
                      >
                        {renderOverlayLayout.visible.comment && <div
                          data-editor-overlay-layer={overlayPreviewEnabled ? "comment" : undefined}
                          className={`${overlayPreviewEnabled ? "relative cursor-ns-resize touch-none" : ""}${overlayPreviewEnabled && selectedOverlay === "comment" ? " outline outline-2 outline-[#ff715e] outline-offset-[-2px]" : ""}`}
                          style={layoutPreviewComment
                            ? overlayMovementStyle("comment", layoutPreviewComment.id)
                            : undefined}
                          onPointerDown={overlayPreviewEnabled
                            ? (event) => layoutPreviewComment
                              && beginEditorOverlayDrag(
                                "comment",
                                event,
                                layoutPreviewComment.id,
                              )
                            : undefined}
                          onDoubleClick={layoutPreviewComment
                            ? (event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                requestCommentTextEdit(
                                  layoutPreviewComment.id,
                                );
                              }
                            : undefined}
                          title={layoutPreviewComment
                            ? "더블클릭해서 댓글 수정"
                            : undefined}
                        >
                          <CommentCaptureCard
                            comment={layoutPreviewComment}
                            theme={editorCommentTheme}
                          />
                        </div>}
                        {renderOverlayLayout.visible.channel && usesLiftedCommentLayout && !usesFixedPresetChannel && <CommentCaptureChannel
                          channelName={renderChannel}
                          channelThumbnailUrl={renderChannelThumbnailUrl}
                          fontFamily={channelFontFamily}
                          fontWeight={renderSpec?.channel.font.resolvedWeight}
                          selected={overlayPreviewEnabled && selectedOverlay === "channel"}
                          movementStyle={overlayMovementStyle("channel")}
                          onPointerDown={overlayPreviewEnabled
                            ? (event) => beginEditorOverlayDrag("channel", event)
                            : undefined}
                        />}
                      </div>
                    : renderOverlayLayout.visible.channel && !usesFixedPresetChannel && <PresetInlineEditorChannel
                        channelName={renderChannel}
                        channelThumbnailUrl={renderChannelThumbnailUrl}
                        foreground={template.channel}
                        background={template.background}
                        fontFamily={channelFontFamily}
                        fontWeight={renderSpec?.channel.font.resolvedWeight}
                        selected={overlayPreviewEnabled && selectedOverlay === "channel"}
                        movementStyle={overlayMovementStyle("channel")}
                        onPointerDown={overlayPreviewEnabled
                          ? (event) => beginEditorOverlayDrag("channel", event)
                          : undefined}
                      />}
                </div>
                {renderOverlayLayout.visible.channel && usesFixedPresetChannel && (templateId === "comment-capture"
                  ? <CommentCaptureChannel
                      channelName={renderChannel}
                      channelThumbnailUrl={renderChannelThumbnailUrl}
                      fixedCenterY={COMMENT_CAPTURE_SQUARE_CHANNEL_CENTER_Y}
                      fontFamily={channelFontFamily}
                      fontWeight={renderSpec?.channel.font.resolvedWeight}
                      selected={overlayPreviewEnabled && selectedOverlay === "channel"}
                      movementStyle={overlayMovementStyle("channel")}
                      onPointerDown={overlayPreviewEnabled
                        ? (event) => beginEditorOverlayDrag("channel", event)
                        : undefined}
                    />
                  : <FixedPresetChannel
                      channelName={renderChannel}
                      channelThumbnailUrl={renderChannelThumbnailUrl}
                      foreground={template.channel}
                      background={template.background}
                      fontFamily={channelFontFamily}
                      fontWeight={renderSpec?.channel.font.resolvedWeight}
                      selected={overlayPreviewEnabled && selectedOverlay === "channel"}
                      movementStyle={overlayMovementStyle("channel")}
                      onPointerDown={overlayPreviewEnabled
                        ? (event) => beginEditorOverlayDrag("channel", event)
                        : undefined}
                    />)}
              </>}
          {overlayPreviewEnabled
            && !templateProvidesComments
            && renderOverlayLayout.visible.comment
            && layoutPreviewComment
            && <div
              data-editor-overlay-layer="comment"
              className={`absolute inset-x-0 z-40 cursor-ns-resize touch-none${selectedOverlay === "comment" ? " outline outline-2 outline-[#ff715e] outline-offset-[-2px]" : ""}`}
              style={{
                top: "62%",
                ...(overlayMovementStyle("comment", layoutPreviewComment.id) || {}),
              }}
              onPointerDown={(event) => beginEditorOverlayDrag(
                "comment",
                event,
                layoutPreviewComment.id,
              )}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                requestCommentTextEdit(layoutPreviewComment.id);
              }}
              title="더블클릭해서 댓글 수정"
            >
              <TemplateCommentPreview
                theme={editorCommentTheme}
                size="medium"
                comment={layoutPreviewComment}
              />
            </div>}
          {overlayPreviewEnabled && activeTextOverlays.map((textOverlay) => (
            <EditorTextOverlayPreview
              key={textOverlay.id}
              textOverlay={textOverlay}
              renderSpec={renderSpec?.textOverlays.find((item) => (
                item.id === textOverlay.id
              ))}
              selected={selectedTextOverlayId === textOverlay.id}
              editing={inlineEditingOverlay === editorTextSelection(textOverlay.id)}
              zIndex={editorOverlayZIndex(editorTextSelection(textOverlay.id))}
              onPointerDown={(event) => beginEditorTextOverlayDrag(
                textOverlay.id,
                event,
              )}
              onResizePointerDown={(edge, event) => beginEditorTextOverlayResize(
                textOverlay.id,
                edge,
                event,
              )}
              onDelete={() => deleteSelectedEditorOverlay()}
              onEditStart={beginEditorTextInlineEdit}
              onEditValueChange={updateEditorTextInlineValue}
              onEditEnd={finishEditorInlineEdit}
            />
          ))}
          {overlayPreviewEnabled && overlayGuides.x && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 z-[70] w-px -translate-x-1/2 bg-[#ff2bd6] shadow-[0_0_5px_rgba(255,43,214,.95)]" />}
          {overlayPreviewEnabled && overlayGuides.y && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 z-[70] h-px -translate-y-1/2 bg-[#ff2bd6] shadow-[0_0_5px_rgba(255,43,214,.95)]" />}
          {overlayPreviewEnabled && overlayGuides.overlayX !== null && <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-[70] w-px -translate-x-1/2 bg-[#35e6e3] shadow-[0_0_6px_rgba(53,230,227,.95)]"
            style={{ left: `${overlayGuides.overlayX / (TEMPLATE_CANVAS.width / 100)}%` }}
          />}
          {overlayPreviewEnabled && overlayGuides.overlayY !== null && <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 z-[70] h-px -translate-y-1/2 bg-[#35e6e3] shadow-[0_0_6px_rgba(53,230,227,.95)]"
            style={{ top: `${overlayGuides.overlayY / (TEMPLATE_CANVAS.height / 100)}%` }}
          />}
          {overlayPreviewEnabled && overlayGuides.commentDocked && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[70] h-px bg-[#35e6e3] shadow-[0_0_7px_rgba(53,230,227,.9)]" style={{ top: `${editorVideoBottom / 19.2}%` }} />}
          {overlayPreviewEnabled && overlayGuides.videoWidthFitted && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 inset-x-0 z-[70] border-x-2 border-white/90 shadow-[inset_2px_0_0_rgba(0,0,0,.35),inset_-2px_0_0_rgba(0,0,0,.35)]" />}
          {overlayPreviewEnabled && overlayGuides.videoHeightFitted && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 inset-x-0 z-[70] border-y-2 border-white/90 shadow-[inset_0_2px_0_rgba(0,0,0,.35),inset_0_-2px_0_rgba(0,0,0,.35)]" />}
        </div>
        </div>
        {overlayPreviewEnabled && scalableOverlaySelection && scalableOverlayScale !== null && scalableOverlayLabel && <aside
          className="editor-overlay-size-control"
          aria-label={`${scalableOverlayLabel} 크기 조절`}
          data-editor-overlay-size-control={scalableOverlaySelection}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>{scalableOverlayLabel}</strong>
          <div className="editor-overlay-size-slider-track">
            <input
              type="range"
              min={EDITOR_TEXT_LAYER_MIN_SCALE * 100}
              max={EDITOR_TEXT_LAYER_MAX_SCALE * 100}
              step={5}
              value={Math.round(scalableOverlayScale * 100)}
              aria-label={`${scalableOverlayLabel} 크기`}
              onPointerDown={(event) => beginEditorOverlayScaleDrag(
                scalableOverlaySelection,
                event,
              )}
              onKeyDown={(event) => {
                const scaleDelta = event.key === "ArrowUp" || event.key === "ArrowRight"
                  ? 0.05
                  : event.key === "ArrowDown" || event.key === "ArrowLeft"
                    ? -0.05
                    : event.key === "PageUp"
                      ? 0.1
                      : event.key === "PageDown"
                        ? -0.1
                        : null;
                const nextScale = event.key === "Home"
                  ? EDITOR_TEXT_LAYER_MIN_SCALE
                  : event.key === "End"
                    ? EDITOR_TEXT_LAYER_MAX_SCALE
                    : scaleDelta === null
                      ? null
                      : Math.min(
                          EDITOR_TEXT_LAYER_MAX_SCALE,
                          Math.max(
                            EDITOR_TEXT_LAYER_MIN_SCALE,
                            scalableOverlayScale + scaleDelta,
                          ),
                        );
                if (nextScale === null) return;
                event.preventDefault();
                beginEditorScaleHistoryInteraction(scalableOverlaySelection);
                setEditorOverlayScale(scalableOverlaySelection, nextScale);
              }}
              onKeyUp={() => finishEditorScaleHistoryInteraction(
                scalableOverlaySelection,
              )}
              onBlur={() => finishEditorScaleHistoryInteraction(
                scalableOverlaySelection,
              )}
              onChange={(event) => setEditorOverlayScale(
                scalableOverlaySelection,
                Number(event.target.value) / 100,
              )}
            />
          </div>
          <output aria-label={`${scalableOverlayLabel} 현재 크기`}>
            {Math.round(scalableOverlayScale * 100)}%
          </output>
        </aside>}
        {overlayPreviewEnabled
          && selectedOverlay === "comment"
          && layoutPreviewComment
          && canApplyActiveCommentPositionToAll
          && <aside
            className="editor-comment-position-apply"
            aria-label="댓글 위치 일괄 적용"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={applyActiveCommentPositionToAll}
            >
              모든 댓글에 위치 적용
            </button>
          </aside>}
        {overlayPreviewEnabled && selectedOverlay !== null && selectedLayerOrderLabel && <aside
          className="editor-layer-order-control"
          aria-label={`${selectedLayerOrderLabel} 레이어 순서`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <strong>{selectedOverlay === "channel" ? "맨앞 고정" : "레이어 순서"}</strong>
          {selectedOverlay !== "channel" && <div>
            <button
              type="button"
              disabled={!canMoveSelectedLayerForward}
              onClick={() => moveSelectedEditorLayer("forward")}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m5.5 11.5 4.5-4.5 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5.5 15h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              앞으로
            </button>
            <button
              type="button"
              disabled={!canMoveSelectedLayerBackward}
              onClick={() => moveSelectedEditorLayer("backward")}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="m5.5 8.5 4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5.5 5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              뒤로
            </button>
          </div>}
        </aside>}
        {overlayPreviewEnabled && <button
          type="button"
          className="editor-preview-fullscreen-control editor-preview-edge-fullscreen-control"
          disabled={!cleanVideoUrl}
          aria-label={isPreviewFullscreen ? "전체보기 종료" : "전체보기"}
          aria-pressed={isPreviewFullscreen}
          data-tooltip={isPreviewFullscreen ? "전체보기 종료" : "전체보기"}
          onClick={() => void togglePreviewFullscreen()}
        >
          {isPreviewFullscreen
            ? <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M8 3.5V8H3.5M12 3.5V8h4.5M8 16.5V12H3.5M12 16.5V12h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            : <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M8 3.5H3.5V8M12 3.5h4.5V8M8 16.5H3.5V12M12 16.5h4.5V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>}
        </button>}
        </div>
        <div className="editor-preview-transport" aria-label="미리보기 재생 및 화면 제어">
          <div className="editor-preview-time-group" aria-label="미리보기 재생 시간">
            <span>{formatPreciseTimestamp(displayedPreviewTime)}</span>
            <span aria-hidden="true">/</span>
            <span>{formatPreciseTimestamp(previewDuration)}</span>
          </div>
          <button
            type="button"
            className="editor-preview-play-control"
            disabled={!cleanVideoUrl}
            aria-label={isPreviewPlaying ? "미리보기 일시정지" : "미리보기 재생"}
            aria-pressed={isPreviewPlaying}
            data-tooltip={overlayPreviewEnabled
              ? (isPreviewPlaying ? "정지" : "재생")
              : undefined}
            onClick={togglePreviewPlayback}
          >
            {isPreviewPlaying
              ? <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 5.5v9M13 5.5v9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              : <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7.5 5.4 7 4.6-7 4.6V5.4Z" fill="currentColor" /></svg>}
          </button>
          {!overlayPreviewEnabled && <button
            type="button"
            className="editor-preview-fullscreen-control"
            disabled={!cleanVideoUrl}
            aria-label={isPreviewFullscreen ? "전체보기 종료" : "전체보기"}
            aria-pressed={isPreviewFullscreen}
            title={isPreviewFullscreen ? "전체보기 종료" : "전체보기"}
            onClick={() => void togglePreviewFullscreen()}
          >
            {isPreviewFullscreen
              ? <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M8 3.5V8H3.5M12 3.5V8h4.5M8 16.5V12H3.5M12 16.5V12h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              : <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M8 3.5H3.5V8M12 3.5h4.5V8M8 16.5H3.5V12M12 16.5h4.5V12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>}
          </button>}
        </div>
        {overlayPreviewEnabled && <div
          className="editor-range-actions editor-preview-quick-actions"
          aria-label="미리보기 빠른 편집"
          data-editor-guide="overlay-actions"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            data-editor-guide="add-comment"
            disabled={comments.length >= 20}
            onClick={addComment}
          >
            + 댓글
          </button>
        </div>}
        {videoCuttingEnabled && <div
          className="editor-preview-cut-actions"
          aria-label="영상 자르기"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {selectedOverlay === null
            && selectedVideoClipId
            && renderVideoClips.length > 1
            && <button
            type="button"
            className="is-delete"
            onClick={deleteSelectedEditorVideoClip}
          >
            구간 삭제
          </button>}
          <button
            type="button"
            data-editor-guide="video-split"
            disabled={!canSplitCurrentVideoClip}
            onClick={splitCurrentEditorVideo}
          >
            <span aria-hidden="true">✂</span>
            분할
          </button>
        </div>}
        </section>
        <section className={standalone
          ? `editor-controls-pane${mobileControlsOpen ? " is-mobile-open" : ""}${overlayPreviewEnabled ? " has-editor-tool-rail" : ""}`
          : `editor-dialog-controls${overlayPreviewEnabled ? " has-editor-tool-rail" : ""}`}
        >
          {overlayPreviewEnabled && <nav
            className="editor-tool-rail"
            aria-label="편집 도구"
          >
            <div
              className="editor-tool-rail-buttons"
              data-editor-guide="sidebar-tools"
            >
            {EDITOR_SIDEBAR_TOOLS.map((tool) => {
              const active = activeEditorSidebarTool === tool.id
                && desktopSidebarOpen;
              return (
                <button
                  key={tool.id}
                  type="button"
                  aria-pressed={active}
                  aria-expanded={active}
                  aria-controls="editor-tool-detail"
                  onClick={() => toggleEditorSidebarTool(tool.id)}
                >
                  <span>
                    <EditorSidebarSectionIcon section={tool.id} />
                  </span>
                  {tool.label}
                </button>
              );
            })}
            </div>
          </nav>}
          <div
            id={overlayPreviewEnabled ? "editor-tool-detail" : undefined}
            className="editor-controls-detail"
          >
          <div className="editor-controls-sheet-header">
            <span id="editor-title" className="sr-only">편집 설정</span>
            <button type="button" className="editor-controls-sheet-toggle" aria-expanded={mobileControlsOpen} aria-controls="editor-controls-scroll" onClick={() => setMobileControlsOpen((current) => !current)}>
              <span className="editor-controls-title">편집 설정</span>
              <span className="editor-controls-chevron" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="m5.5 12.25 4.5-4.5 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            {!standalone && <button onClick={onClose} className="editor-dialog-close-button rounded-lg px-3 py-2 text-sm text-white hover:bg-white/10">닫기</button>}
          </div>
          <div id="editor-controls-scroll" className="editor-controls-scroll">
          {overlayPreviewEnabled && <section
            className={`editor-sidebar-tool-panel editor-v2-text-tool-panel${activeEditorSidebarTool === "text" ? " is-active" : ""}`}
            aria-label="텍스트 설정"
          >
            <header className="editor-tool-panel-header">
              <strong>텍스트</strong>
            </header>
            <button
              type="button"
              className="editor-v2-text-add"
              disabled={textOverlays.length >= EDITOR_TEXT_OVERLAY_LIMIT}
              onClick={addEditorTextOverlay}
            >
              <span aria-hidden="true">+</span>
              텍스트 추가
            </button>
            {textOverlays.length > 0
              ? <div className="editor-v2-text-list" aria-label="추가한 텍스트 목록">
                {textOverlays.map((textOverlay, index) => {
                  const selection = editorTextSelection(textOverlay.id);
                  const textLabel = textOverlay.text.trim() || `텍스트 ${index + 1}`;
                  const selected = selectedOverlay === selection;
                  const expanded = selected
                    && expandedEditorTextId === textOverlay.id;
                  const detailId = `editor-v2-text-detail-${textOverlay.id}`;
                  return <div
                    key={textOverlay.id}
                    className={`editor-v2-text-list-entry${expanded ? " is-expanded" : ""}`}
                  >
                    <button
                      type="button"
                      className="editor-v2-text-list-item"
                      aria-pressed={selected}
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      onClick={() => selectEditorTextFromSidebar(textOverlay)}
                    >
                      <span className="editor-v2-text-list-icon" aria-hidden="true">T</span>
                      <span className="editor-v2-text-list-copy">
                        <strong>{textLabel}</strong>
                        <small>{formatPreciseTimestamp(textOverlay.startSeconds)} – {formatPreciseTimestamp(textOverlay.endSeconds)}</small>
                      </span>
                      <span className="editor-v2-text-list-chevron" aria-hidden="true">
                        <svg viewBox="0 0 20 20" fill="none">
                          <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                    {expanded && <div
                      id={detailId}
                      className="editor-v2-text-accordion-detail"
                    >
                      {renderSelectedEditorTextSettings()}
                    </div>}
                  </div>;
                })}
              </div>
              : <p className="editor-v2-text-empty">
                추가한 텍스트가 없습니다.
              </p>}
          </section>}
          {overlayPreviewEnabled && <section
            className={`editor-sidebar-tool-panel${!selectedTextOverlay && activeEditorSidebarTool === "channel" ? " is-active" : ""}`}
            aria-label="채널명 설정"
          >
            <header className="editor-tool-panel-header">
              <strong>채널명</strong>
              <button
                type="button"
                className="editor-channel-visibility-toggle"
                aria-label={renderOverlayLayout.visible.channel
                  ? "채널명 숨기기"
                  : "채널명 보이기"}
                aria-pressed={renderOverlayLayout.visible.channel}
                onClick={toggleEditorChannelVisibility}
              >
                <span aria-hidden="true"><i /></span>
                {renderOverlayLayout.visible.channel ? "숨기기" : "보이기"}
              </button>
            </header>
            <div className="editor-channel-preset-library">
              <button
                type="button"
                className="editor-channel-preset-add"
                disabled={editorChannelPresets.length >= EDITOR_CHANNEL_PRESET_LIMIT}
                onClick={() => {
                  setChannelPresetComposerOpen((current) => !current);
                  setChannelPresetError(null);
                }}
              >
                <span aria-hidden="true">+</span>
                내 채널명 추가하기
              </button>
              {channelPresetComposerOpen && <div
                className="editor-channel-preset-composer"
                aria-label="내 채널명 추가"
              >
                <div className="editor-channel-preset-image-input">
                  <ChannelAvatar
                    url={channelPresetDraftImageDataUrl}
                    className="h-12 w-12"
                    fallbackForeground="#ffffff"
                    fallbackBackground="#202024"
                    sizes="48px"
                  />
                  <label>
                    {channelPresetImageBusy
                      ? "이미지 준비 중..."
                      : channelPresetDraftImageDataUrl
                        ? "이미지 바꾸기"
                        : "이미지 선택"}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={channelPresetImageBusy}
                      onChange={(event) => {
                        void updateChannelPresetDraftImage(event);
                      }}
                    />
                  </label>
                </div>
                <label className="editor-channel-preset-name-input">
                  <span>채널명</span>
                  <input
                    type="text"
                    value={channelPresetDraftName}
                    maxLength={50}
                    placeholder="채널명을 입력하세요"
                    onChange={(event) => setChannelPresetDraftName(
                      event.target.value,
                    )}
                  />
                </label>
                {channelPresetError && <p role="alert">
                  {channelPresetError}
                </p>}
                <div className="editor-channel-preset-composer-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setChannelPresetComposerOpen(false);
                      setChannelPresetDraftName("");
                      setChannelPresetDraftImageDataUrl(null);
                      setChannelPresetError(null);
                    }}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={channelPresetImageBusy}
                    onClick={saveEditorChannelPreset}
                  >
                    저장
                  </button>
                </div>
              </div>}
              {editorChannelPresets.length > 0 && <div
                className="editor-channel-preset-list"
                aria-label="저장한 내 채널명"
              >
                {editorChannelPresets.map((preset) => {
                  const selected = channel === preset.name
                    && editorChannelThumbnailUrl === preset.imageDataUrl;
                  return <div
                    key={preset.id}
                    className="editor-channel-preset-item"
                  >
                    <button
                      type="button"
                      className="editor-channel-preset-select"
                      aria-pressed={selected}
                      onClick={() => applyEditorChannelPreset(preset)}
                    >
                      <ChannelAvatar
                        url={preset.imageDataUrl}
                        className="h-10 w-10"
                        fallbackForeground="#ffffff"
                        fallbackBackground="#202024"
                        sizes="40px"
                      />
                      <span>{preset.name}</span>
                      {selected && <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path d="m5 10 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>}
                    </button>
                    <button
                      type="button"
                      className="editor-channel-preset-delete"
                      aria-label={`${preset.name} 삭제`}
                      onClick={() => deleteEditorChannelPreset(preset.id)}
                    >
                      ×
                    </button>
                  </div>;
                })}
              </div>}
            </div>
            <div className="editor-element-settings editor-channel-settings">
              <strong className="editor-channel-current-title">현재 채널명</strong>
              <div className="editor-channel-image-setting">
                <ChannelAvatar
                  url={editorChannelThumbnailUrl}
                  className="h-11 w-11"
                  fallbackForeground="#ffffff"
                  fallbackBackground="#202024"
                  sizes="44px"
                />
                <label>
                  사진 바꾸기
                  <input
                    type="file"
                    accept="image/*"
                    onChange={updateEditorChannelThumbnail}
                  />
                </label>
              </div>
              <label className="editor-channel-name-setting">
                <span>채널명</span>
                <input
                  type="text"
                  value={channel}
                  maxLength={50}
                  onFocus={beginEditorCopyInteraction}
                  onBlur={finishEditorCopyInteraction}
                  onChange={(event) => {
                    channelRef.current = event.target.value;
                    setChannel(event.target.value);
                  }}
                />
              </label>
              <EditorFontPicker
                value={channelFontId}
                onChange={(fontId) => updateEditorFont("channel", fontId)}
              />
            </div>
          </section>}
          {overlayPreviewEnabled && <section
            className={`editor-sidebar-tool-panel${!selectedTextOverlay && activeEditorSidebarTool === "comment" ? " is-active" : ""}`}
            aria-label="댓글 설정"
          >
            <header className="editor-tool-panel-header">
              <strong>댓글</strong>
            </header>
            <fieldset className="editor-comment-theme-setting">
              <legend>댓글 모드</legend>
              <div>
                <button
                  type="button"
                  aria-pressed={editorCommentTheme === "dark"}
                  onClick={() => setEditorCommentTheme("dark")}
                >
                  다크
                </button>
                <button
                  type="button"
                  aria-pressed={editorCommentTheme === "light"}
                  onClick={() => setEditorCommentTheme("light")}
                >
                  화이트
                </button>
              </div>
            </fieldset>
            <button
              type="button"
              className="editor-comment-regenerate-button"
              disabled={regeneratingComments || comments.length === 0}
              onClick={() => {
                commentRegenerationRequestIdRef.current = globalThis.crypto.randomUUID();
                setCommentRegenerationError(null);
                setCommentRegenerationConfirmationOpen(true);
              }}
            >
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="m12 3 1.25 4.2L17.5 8.5l-4.25 1.3L12 14l-1.25-4.2L6.5 8.5l4.25-1.3L12 3Z" fill="currentColor" />
                  <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" fill="currentColor" opacity=".7" />
                </svg>
              </span>
              {regeneratingComments ? "댓글 생성 중..." : "AI로 댓글 재생성"}
            </button>
            {comments.length === 0 && <p className="editor-comment-regenerate-hint">
              댓글을 먼저 추가해 주세요.
            </p>}
          </section>}
          <details
            className={`editor-accordion editor-sidebar-tool-panel${!selectedTextOverlay && activeEditorSidebarTool === "title" ? " is-active" : ""}`}
            open={overlayPreviewEnabled ? true : undefined}
          >
            <summary className="editor-accordion-summary">
              <span className="editor-accordion-summary-icon"><EditorSidebarSectionIcon section="title" /></span>
              <span>후킹 제목</span>
              <span className="editor-accordion-chevron" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>
            <div className="editor-accordion-panel">
              {overlayPreviewEnabled && <header className="editor-tool-panel-header">
                <strong>후킹 제목</strong>
              </header>}
              <label className="block">
                <span className="sr-only">후킹 제목</span>
                <textarea
                  ref={titleInputRef}
                  value={title}
                  onFocus={beginEditorCopyInteraction}
                  onBlur={finishEditorCopyInteraction}
                  onChange={(event) => updateEditorTitleInlineValue(event.target.value)}
                  onSelect={captureTitleSelection}
                  onDoubleClick={captureTitleSelection}
                  maxLength={80}
                  rows={2}
                  className="w-full rounded-lg border border-white/15 bg-black/30 p-3 text-sm"
                />
              </label>
              <p className={`mt-1 text-xs text-white ${validTitle ? "opacity-60" : "opacity-100"}`}>최대 2줄·80자 ({title.length}/80)</p>
            {overlayPreviewEnabled && <EditorFontPicker
              value={titleFontId}
              onChange={(fontId) => updateEditorFont("title", fontId)}
            />}
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs leading-5 text-white/70">글자를 선택하면 선택한 부분만, 선택하지 않으면 제목 전체의 색상이 바뀝니다.</p>
            <p className={`mt-2 truncate rounded-lg px-2.5 py-2 text-xs text-white ${titleSelection ? "bg-white/10" : "bg-white/[.04] opacity-50"}`}>
              {titleSelection ? `선택: ${Array.from(title).slice(titleSelection.start, titleSelection.end).join("")}` : "제목 전체에 적용"}
            </p>
            <div className="mt-3 grid grid-cols-2 items-start gap-5">
              <fieldset>
                <legend className="sr-only">글자색</legend>
                <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-white">글자색</span></div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(showAllTextColors ? titleTextColorOptions : titleTextColorOptions.slice(0, 3)).map((option) => <button key={option.color} type="button" aria-label={`글자색 ${option.name}`} title={option.name} aria-pressed={titleTextColor === option.color} onClick={() => { setTitleTextColor(option.color); updateSelectedTitleStyle({ color: option.color }); }} className={`h-8 w-8 rounded-full border border-white/20 transition disabled:cursor-not-allowed disabled:opacity-30 ${titleTextColor === option.color ? "outline outline-2 outline-offset-2 outline-white" : "hover:scale-105 hover:border-white/50"}`} style={{ background: option.color }} />)}
                  <button type="button" aria-label={showAllTextColors ? "글자색 접기" : "글자색 전체 보기"} title={showAllTextColors ? "접기" : "전체 보기"} aria-expanded={showAllTextColors} onClick={() => setShowAllTextColors((current) => !current)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#353438] text-base font-medium text-white transition hover:border-white/40 hover:bg-[#454449] disabled:cursor-not-allowed disabled:opacity-30">{showAllTextColors ? "−" : "+"}</button>
                </div>
              </fieldset>
              <fieldset>
                <legend className="sr-only">텍스트 배경색</legend>
                <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-white">텍스트 배경색</span></div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" aria-label="텍스트 배경색 없음" title="없음" onClick={() => updateSelectedTitleStyle({ backgroundColor: null })} className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-white/35 bg-white/[.03] text-[8px] font-bold text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-30">없음</button>
                  {(showAllBackgroundColors ? titleBackgroundColorOptions : titleBackgroundColorOptions.slice(0, 2)).map((option) => <button key={option.color} type="button" aria-label={`텍스트 배경색 ${option.name}`} title={option.name} aria-pressed={titleBackgroundColor === option.color} onClick={() => { setTitleBackgroundColor(option.color); updateSelectedTitleStyle({ backgroundColor: option.color }); }} className={`h-8 w-8 rounded-full border border-white/20 transition disabled:cursor-not-allowed disabled:opacity-30 ${titleBackgroundColor === option.color ? "outline outline-2 outline-offset-2 outline-white" : "hover:scale-105 hover:border-white/50"}`} style={{ background: option.color }} />)}
                  <button type="button" aria-label={showAllBackgroundColors ? "텍스트 배경색 접기" : "텍스트 배경색 전체 보기"} title={showAllBackgroundColors ? "접기" : "전체 보기"} aria-expanded={showAllBackgroundColors} onClick={() => setShowAllBackgroundColors((current) => !current)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#353438] text-base font-medium text-white transition hover:border-white/40 hover:bg-[#454449] disabled:cursor-not-allowed disabled:opacity-30">{showAllBackgroundColors ? "−" : "+"}</button>
                </div>
              </fieldset>
            </div>
            </div>
            <label className="mt-5 block font-semibold">
              <span className="flex items-center justify-between text-white"><span>제목 글자 크기</span><strong className="text-sm">{Math.round(titleFontScale * 100)}%</strong></span>
              <input
                aria-label="제목 글자 크기"
                type="range"
                min={EDITOR_TEXT_LAYER_MIN_SCALE}
                max={EDITOR_TEXT_LAYER_MAX_SCALE}
                step={0.05}
                value={titleFontScale}
                onPointerDown={beginEditorCopyInteraction}
                onPointerUp={finishEditorCopyInteraction}
                onPointerCancel={finishEditorCopyInteraction}
                onKeyDown={beginEditorCopyInteraction}
                onKeyUp={finishEditorCopyInteraction}
                onBlur={finishEditorCopyInteraction}
                onChange={(event) => updateEditorTitleFontScale(
                  Number(event.target.value),
                )}
                className="mt-3 w-full accent-white"
              />
            </label>
            </div>
          </details>
          {overlayPreviewEnabled && <details
            className={`editor-accordion editor-sidebar-tool-panel${!selectedTextOverlay && activeEditorSidebarTool === "background" ? " is-active" : ""}`}
            open
          >
            <summary className="editor-accordion-summary">
              <span className="editor-accordion-summary-icon"><EditorSidebarSectionIcon section="background" /></span>
              <span>배경</span>
              <span className="editor-accordion-summary-meta">
                {editorCanvasBackground?.kind === "image"
                  ? stockBackgrounds.find((item) => item.id === editorCanvasBackground.assetId)?.label
                  : editorCanvasBackground?.kind === "color"
                    ? templatePresetColorOptions.find((item) => item.color === editorCanvasBackground.color)?.name
                    : "템플릿 기본"}
              </span>
              <span className="editor-accordion-chevron" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>
            <div className="editor-accordion-panel editor-background-panel">
              <header className="editor-tool-panel-header">
                <strong>배경</strong>
              </header>
              <button
                type="button"
                className="editor-background-default"
                aria-pressed={editorCanvasBackground === null}
                onClick={() => setEditorCanvasBackground(null)}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M4.5 6.5h7a4 4 0 1 1-3.25 6.32" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
                  <path d="m4.5 6.5 2.2-2.2M4.5 6.5l2.2 2.2" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                템플릿 기본 배경
              </button>
              <fieldset className="editor-background-color-setting">
                <legend>색상 배경</legend>
                <div>
                  {templatePresetColorOptions.map((option) => <button
                    key={option.color}
                    type="button"
                    aria-label={`배경 색상 ${option.name}`}
                    title={option.name}
                    aria-pressed={editorCanvasBackground?.kind === "color"
                      && editorCanvasBackground.color === option.color}
                    onClick={() => setEditorCanvasBackground({
                      kind: "color",
                      color: option.color,
                    })}
                    style={{ backgroundColor: option.color }}
                  />)}
                </div>
              </fieldset>
              <fieldset className="editor-background-image-setting">
                <legend>이미지 배경</legend>
                <div>
                  {stockBackgrounds.map((asset) => <button
                    key={asset.id}
                    type="button"
                    aria-label={`이미지 배경 ${asset.label}`}
                    aria-pressed={editorCanvasBackground?.kind === "image"
                      && editorCanvasBackground.assetId === asset.id}
                    onClick={() => setEditorCanvasBackground({
                      kind: "image",
                      assetId: asset.id,
                    })}
                  >
                    <span
                      aria-hidden="true"
                      style={{ backgroundImage: `url(${asset.src})` }}
                    />
                    <strong>{asset.label}</strong>
                  </button>)}
                </div>
              </fieldset>
            </div>
          </details>}
          {templateId !== "comment-capture" && <label className="editor-section block text-sm font-semibold">채널명<input value={channel} onFocus={beginEditorCopyInteraction} onBlur={finishEditorCopyInteraction} onChange={(event) => { channelRef.current = event.target.value; setChannel(event.target.value); }} maxLength={50} className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3" /></label>}
          <label className="hidden"><input type="checkbox" checked={subtitlesEnabled} onChange={(event) => setSubtitlesEnabled(event.target.checked)} />자동 자막 표시</label>
          {subtitlesEnabled && <div className="hidden">{segments.map((segment, index) => <label key={`${segment.start}-${index}`}><span>{formatTimestamp(segment.start)}</span><input value={segment.text} onChange={(event) => updateSubtitleText(index, event.target.value)} /></label>)}</div>}
          <details
            className={`editor-accordion editor-sidebar-tool-panel${!selectedTextOverlay && activeEditorSidebarTool === "template" ? " is-active" : ""}`}
            open={overlayPreviewEnabled ? true : undefined}
          >
            <summary className="editor-accordion-summary">
              <span className="editor-accordion-summary-icon"><EditorSidebarSectionIcon section="template" /></span>
              <span>템플릿</span>
              <span className="editor-accordion-summary-meta">{activeCustomTemplate?.name || template.name}</span>
              <span className="editor-accordion-chevron" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </summary>
            <div className="editor-accordion-panel">
              {overlayPreviewEnabled && <header className="editor-tool-panel-header">
                <strong>템플릿</strong>
              </header>}
              <p className="mb-3 text-xs text-white/65">최종 영상의 제목·영상·하단 구성을 미리 확인하세요.</p>
              <div className="editor-template-grid">
                {availableCustomTemplate && <button
                  type="button"
                  aria-pressed={activeCustomTemplate?.id === availableCustomTemplate.id}
                  onClick={selectCurrentCustomTemplate}
                  className={`min-w-0 rounded-xl border-2 p-2 transition ${activeCustomTemplate?.id === availableCustomTemplate.id ? "border-white/75 bg-white/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}
                >
                  <CustomTemplateCanvasPreview
                    template={availableCustomTemplate}
                    firstLine={customTitleLines[0] || ""}
                    secondLine={customTitleLines[1] || ""}
                    channelLabel={channel}
                  />
                  <span className="mt-2 block truncate text-center text-xs font-semibold">{availableCustomTemplate.name}</span>
                  <span className="mt-1 block text-center text-[10px] font-bold text-white/80">적용 중인 내 템플릿</span>
                </button>}
                {templates.map((value) => {
                  const selected = !activeCustomTemplate && templateId === value.id;
                  return <button
                    key={value.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectTemplate(value.id)}
                    className={`min-w-0 rounded-xl border-2 p-2 transition ${selected ? "border-white/75 bg-white/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}
                  >
                    <TemplatePreview template={value} videoAspectRatio={item.videoAspectRatio || "1:1"} channelName={channel} channelThumbnailUrl={editorChannelThumbnailUrl} />
                    <span className="mt-2 block truncate text-center text-xs font-semibold">{value.name}</span>
                  </button>;
                })}
              </div>
            </div>
          </details>
          {error && <p className="mt-4 text-sm font-semibold text-white">{error}</p>}
          {!standalone && <div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={onClose} className="h-11 rounded-lg border border-white/15 px-4 text-sm font-semibold">변경 취소</button><button disabled={(overlayPreviewEnabled && !editorSaveEnabled) || !editorValid || saving} onClick={() => setApplyConfirmationOpen(true)} className="h-11 rounded-lg bg-white px-4 text-sm font-bold text-black disabled:opacity-40">{overlayPreviewEnabled && !editorSaveEnabled ? "저장 잠금" : saving ? "처리 중..." : "영상에 적용"}</button></div>}
          </div>
          </div>
        </section>
        {editTimeline && <section
          className="editor-range-panel editor-workspace-timeline"
          aria-label="영상 및 댓글 구간 선택"
          data-editor-guide={overlayPreviewEnabled ? "editor-timeline" : undefined}
        >
          {overlayPreviewEnabled && <EditorViewportZoomControl
            label="오버레이"
            value={editorTimelineZoom}
            min={EDITOR_TIMELINE_ZOOM_MIN}
            max={EDITOR_TIMELINE_ZOOM_MAX}
            step={EDITOR_TIMELINE_ZOOM_STEP}
            className="editor-timeline-zoom-control"
            onChange={updateEditorTimelineZoom}
          />}
          <div ref={editorTimelineScrollAreaRef} className="editor-timeline-scroll-area">
          <div className="editor-filmstrip-wrap" style={editorTimelineZoomStyle}>
            <div
              ref={filmstripRef}
              className="editor-filmstrip"
              data-editor-guide="range-handles"
              onPointerDown={startTimelineScrubbing}
              onPointerMove={moveTimelineScrubbing}
              onPointerUp={finishTimelineScrubbing}
              onPointerCancel={finishTimelineScrubbing}
            >
              {videoCuttingEnabled
                ? <>
                    <div className="editor-filmstrip-images" aria-hidden="true">
                      {Array.from({ length: TIMELINE_THUMBNAIL_COUNT }, (_, index) => (
                        timelineThumbnails[index]
                          ? <span key={index} className="has-image" style={{ backgroundImage: `url(${timelineThumbnails[index]})` }} />
                          : <span key={index} />
                      ))}
                    </div>
                    <div className="editor-filmstrip-shade editor-filmstrip-shade-left" style={{ width: `${sourceSelectionLeft}%` }} />
                    <div className="editor-filmstrip-shade editor-filmstrip-shade-right" style={{ left: `${sourceSelectionLeft + videoOutputWidthPercent}%` }} />
                    <div
                      key={`video-ripple-${videoRippleRevision}`}
                      className={`editor-video-clip-strip${videoRippleRevision > 0 ? " is-rippling" : ""}`}
                      aria-label="영상 조각 타임라인"
                      style={{
                        left: `${sourceSelectionLeft}%`,
                        width: `${videoOutputWidthPercent}%`,
                      }}
                    >
                    {renderVideoClips.map((clip, clipIndex) => {
                      const clipDuration = editorVideoClipDuration(clip);
                      const thumbnailCount = Math.max(
                        1,
                        Math.round(
                          clipDuration
                          / Math.max(videoSequenceDuration, 0.001)
                          * TIMELINE_THUMBNAIL_COUNT,
                        ),
                      );
                      return <button
                        key={clip.id}
                        type="button"
                        data-editor-video-clip-id={clip.id}
                        aria-label={`영상 조각 ${clipIndex + 1} 선택`}
                        aria-pressed={selectedVideoClipId === clip.id}
                        className={selectedVideoClipId === clip.id ? "is-selected" : ""}
                        style={{
                          flexBasis: `${clipDuration / Math.max(videoSequenceDuration, 0.001) * 100}%`,
                        }}
                        onClick={() => {
                          setSelectedVideoClipId(clip.id);
                          setSelectedOverlay(null);
                          setInlineEditingOverlay(null);
                        }}
                      >
                        <span className="editor-video-clip-thumbnails" aria-hidden="true">
                          {Array.from({ length: thumbnailCount }, (_, frameIndex) => {
                            const sourceSeconds = clip.sourceStartSeconds
                              + clipDuration * ((frameIndex + 0.5) / thumbnailCount);
                            const thumbnailIndex = Math.max(
                              0,
                              Math.min(
                                TIMELINE_THUMBNAIL_COUNT - 1,
                                Math.floor(sourceSeconds / timelineDuration * TIMELINE_THUMBNAIL_COUNT),
                              ),
                            );
                            const thumbnail = timelineThumbnails[thumbnailIndex];
                            return <span
                              key={`${clip.id}-${frameIndex}`}
                              className={thumbnail ? "has-image" : ""}
                              style={thumbnail ? { backgroundImage: `url(${thumbnail})` } : undefined}
                            />;
                          })}
                        </span>
                        {renderVideoClips.length > 1 && <span className="editor-video-clip-label">
                          조각 {clipIndex + 1}
                        </span>}
                      </button>;
                    })}
                    {renderVideoClips.slice(0, -1).map((clip, clipIndex) => {
                      const boundarySeconds = renderVideoClips
                        .slice(0, clipIndex + 1)
                        .reduce(
                          (duration, value) => duration + editorVideoClipDuration(value),
                          0,
                        );
                      return <span
                        key={`cut-${clip.id}`}
                        className="editor-video-cut-marker"
                        style={{
                          left: `${boundarySeconds / Math.max(videoSequenceDuration, 0.001) * 100}%`,
                        }}
                        aria-hidden="true"
                      />;
                    })}
                    {selectedVideoClip && <>
                      <button
                        type="button"
                        className="editor-video-clip-trim-handle is-start"
                        aria-label="선택한 영상 조각 앞부분 조절"
                        style={{
                          left: `${selectedVideoClipOutputStart / Math.max(videoSequenceDuration, 0.001) * 100}%`,
                        }}
                        onPointerDown={(event) => beginEditorVideoClipTrim(
                          selectedVideoClip.id,
                          "start",
                          event,
                        )}
                      />
                      <button
                        type="button"
                        className="editor-video-clip-trim-handle is-end"
                        aria-label="선택한 영상 조각 뒷부분 조절"
                        style={{
                          left: `${(
                            selectedVideoClipOutputStart
                            + editorVideoClipDuration(selectedVideoClip)
                          ) / Math.max(videoSequenceDuration, 0.001) * 100}%`,
                        }}
                        onPointerDown={(event) => beginEditorVideoClipTrim(
                          selectedVideoClip.id,
                          "end",
                          event,
                        )}
                      />
                    </>}
                    </div>
                  </>
                : <>
                    <div className="editor-filmstrip-images" aria-hidden="true">
                      {Array.from({ length: TIMELINE_THUMBNAIL_COUNT }, (_, index) => (
                        timelineThumbnails[index]
                          ? <span key={index} className="has-image" style={{ backgroundImage: `url(${timelineThumbnails[index]})` }} />
                          : <span key={index} />
                      ))}
                    </div>
                    <div className="editor-filmstrip-shade editor-filmstrip-shade-left" style={{ width: `${selectionLeft}%` }} />
                    <div className="editor-filmstrip-shade editor-filmstrip-shade-right" style={{ left: `${selectionLeft + selectionWidth}%` }} />
                    <div className="editor-filmstrip-selection" style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }} />
                    <span className="editor-range-marker editor-range-marker-start" style={{ left: `${selectionLeft}%` }} aria-hidden="true" onPointerDown={(event) => startRangeInteraction("start", event)}>
                      <span className="editor-range-marker-time">{formatPreciseTimestamp(0)}</span>
                      <span className="editor-range-marker-grip">•••</span>
                    </span>
                    <span className="editor-range-marker editor-range-marker-end" style={{ left: `${selectionLeft + selectionWidth}%` }} aria-hidden="true" onPointerDown={(event) => startRangeInteraction("end", event)}>
                      <span className="editor-range-marker-time">{formatPreciseTimestamp(selectionDuration)}</span>
                      <span className="editor-range-marker-grip">•••</span>
                    </span>
                    <input aria-label="최종 영상 시작 시간" type="range" min={editTimeline.timelineStartSeconds} max={editTimeline.timelineEndSeconds} step={0.001} value={selectionStart} onChange={(event) => updateSelectionStart(Number(event.target.value))} className="sr-only" />
                    <input aria-label="최종 영상 종료 시간" type="range" min={editTimeline.timelineStartSeconds} max={editTimeline.timelineEndSeconds} step={0.001} value={selectionEnd} onChange={(event) => updateSelectionEnd(Number(event.target.value))} className="sr-only" />
                  </>}
              <span className="editor-timeline-playhead" style={{ left: `${playheadLeft}%` }} aria-hidden="true" />
            </div>
            <div className="editor-filmstrip-bounds" aria-label="전체 편집 가능 범위">
              {videoCuttingEnabled
                ? <>
                    <span>{formatTimelineOffset(editTimeline.timelineStartSeconds - selectionStart)}</span>
                    <span>{formatTimelineOffset(editTimeline.timelineEndSeconds - selectionEnd)}</span>
                  </>
                : <>
                    <span>{formatTimelineOffset(editTimeline.timelineStartSeconds - selectionStart)}</span>
                    <span>{formatTimelineOffset(editTimeline.timelineEndSeconds - selectionStart)}</span>
                  </>}
            </div>
          </div>
          {(commentTimeline || textTimelines) && <div
            className="editor-overlay-timeline-lanes"
            style={editorTimelineZoomStyle}
          >
            {commentTimeline}
            {textTimelines}
          </div>}
          </div>
          {!overlayPreviewEnabled && <div className="editor-range-actions">
            <button type="button" data-editor-guide="reset-range" onClick={() => { setSelectionStart(editTimeline.initialStartSeconds); setSelectionEnd(editTimeline.initialEndSeconds); seekTimeline(editTimeline.initialStartSeconds); }}>↺ 원본으로 되돌리기</button>
            {templateId === "comment-capture" && <button type="button" data-editor-guide="add-comment" disabled={comments.length >= 20} onClick={addComment}>+ 댓글</button>}
          </div>}
          {previewDuration > 180 && <p className="editor-range-warning">3분을 넘는 영상은 YouTube에서 Shorts로 분류되지 않을 수 있지만 저장할 수 있습니다.</p>}
          {!validSelection && <p className="editor-range-error">최종 영상은 1초 이상이어야 합니다.</p>}
        </section>}
        {!editTimeline && (commentTimeline || textTimelines) && <section
          className="editor-range-panel editor-workspace-timeline editor-comment-only-panel"
          data-editor-guide={overlayPreviewEnabled ? "editor-timeline" : undefined}
        >
          {overlayPreviewEnabled && <EditorViewportZoomControl
            label="오버레이"
            value={editorTimelineZoom}
            min={EDITOR_TIMELINE_ZOOM_MIN}
            max={EDITOR_TIMELINE_ZOOM_MAX}
            step={EDITOR_TIMELINE_ZOOM_STEP}
            className="editor-timeline-zoom-control"
            onChange={updateEditorTimelineZoom}
          />}
          <div ref={editorTimelineScrollAreaRef} className="editor-timeline-scroll-area">
          <div
            className="editor-overlay-timeline-lanes"
            style={editorTimelineZoomStyle}
          >
            {commentTimeline}
            {textTimelines}
          </div>
          </div>
          {!overlayPreviewEnabled && <div className="editor-range-actions">
            {commentTimeline && <button type="button" data-editor-guide="add-comment" disabled={comments.length >= 20} onClick={addComment}>+ 댓글</button>}
          </div>}
        </section>}
      </div>
    </>
  );

  if (standalone) return <main
    className={`editor-page${overlayPreviewEnabled ? " editor-v2-root" : ""}`}
    data-editor-release-channel={
      overlayPreviewEnabled ? editorRelease.channel : undefined
    }
    aria-labelledby="editor-title"
  >{editorContent}</main>;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="editor-title">{editorContent}</div>;
}

function ProjectWorkspace({ job, access, onBack }: { job: VideoJob; access: ProjectActionAccess; onBack: () => void }) {
  const [playbackAssets, setPlaybackAssets] = useState<Record<string, {
    url: string;
    posterUrl: string | null;
  }>>({});
  const [iosDownloadDevice, setIosDownloadDevice] = useState(false);
  const [downloadNoticeOpen, setDownloadNoticeOpen] = useState(false);
  const [downloadPaywallOpen, setDownloadPaywallOpen] = useState(false);
  const [editorDraftsByShortId, setEditorDraftsByShortId] = useState<
    Record<string, EditorDraftRecord>
  >({});
  const [editorDraftEntry, setEditorDraftEntry] = useState<{
    draft: EditorDraftRecord;
    href: string;
  } | null>(null);
  const [editorDraftDiscardConfirmationOpen, setEditorDraftDiscardConfirmationOpen] = useState(false);
  const [revealDecision, setRevealDecision] = useState<{
    jobId: string;
    show: boolean;
  } | null>(null);
  const revealDecidedJobIds = useRef(new Set<string>());
  const requestedAccessVersions = useRef(new Set<string>());
  const playbackRefreshTimes = useRef(new Map<string, number>());
  const editorDraftLookupGeneration = useRef(0);
  const mounted = useRef(true);
  const selected = job.shorts[0];

  useEffect(() => {
    mounted.current = true;
    setIosDownloadDevice(isIosDownloadDevice(
      window.navigator.userAgent,
      window.navigator.maxTouchPoints,
    ));
    return () => { mounted.current = false; };
  }, []);

  const refreshEditorDrafts = useCallback(async () => {
    const generation = editorDraftLookupGeneration.current + 1;
    editorDraftLookupGeneration.current = generation;
    const entries = await Promise.all(job.shorts.map(async (item) => ({
      shortId: item.id,
      draft: await readEditorDraft(item.id, item.renderVersion)
        .catch(() => null),
    })));
    if (!mounted.current || editorDraftLookupGeneration.current !== generation) {
      return;
    }
    setEditorDraftsByShortId(Object.fromEntries(entries.flatMap((entry) => (
      entry.draft ? [[entry.shortId, entry.draft]] : []
    ))));
  }, [job.shorts]);

  useEffect(() => {
    void refreshEditorDrafts();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshEditorDrafts();
      }
    };
    const unsubscribe = subscribeEditorDraftChanges((change) => {
      if (job.shorts.some((item) => (
        item.id === change.shortId
        && item.renderVersion === change.baseRenderVersion
      ))) {
        void refreshEditorDrafts();
      }
    });
    window.addEventListener("focus", refreshEditorDrafts);
    window.addEventListener("pageshow", refreshEditorDrafts);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshEditorDrafts);
      window.removeEventListener("pageshow", refreshEditorDrafts);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [job.shorts, refreshEditorDrafts]);

  const openEditorFromDraftEntry = (choice: "continue" | "new") => {
    const entry = editorDraftEntry;
    if (!entry) return;
    const target = new URL(entry.href, window.location.origin);
    target.searchParams.set("draftChoice", choice);
    const anchor = document.createElement("a");
    anchor.href = target.toString();
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (choice === "new") {
      setEditorDraftsByShortId((current) => Object.fromEntries(
        Object.entries(current).filter(([shortId]) => (
          shortId !== entry.draft.shortId
        )),
      ));
    }
    setEditorDraftDiscardConfirmationOpen(false);
    setEditorDraftEntry(null);
  };

  useEffect(() => {
    if (job.status !== "completed" || revealDecidedJobIds.current.has(job.id)) return;
    revealDecidedJobIds.current.add(job.id);
    const storageKey = `${PROJECT_REVEAL_STORAGE_PREFIX}${job.id}`;
    let hasSeenReveal = false;
    try {
      hasSeenReveal = window.localStorage.getItem(storageKey) === "1";
      if (!hasSeenReveal) window.localStorage.setItem(storageKey, "1");
    } catch {
      // Local storage is optional; the ref still prevents duplicate effect runs.
    }
    setRevealDecision({ jobId: job.id, show: !hasSeenReveal });
  }, [job.id, job.status]);

  useEffect(() => {
    for (const item of job.shorts.filter(isPlaybackAvailable)) {
      const accessVersion = shortPlaybackVersionKey(item);
      if (requestedAccessVersions.current.has(accessVersion)) continue;
      requestedAccessVersions.current.add(accessVersion);
      void requestJson<{ url: string; posterUrl: string | null }>(`/api/shorts/${item.id}/access`)
        .then((value) => {
          if (!mounted.current) return;
          setPlaybackAssets((current) => current[accessVersion]
            ? current
            : { ...current, [accessVersion]: value });
        })
        .catch(() => requestedAccessVersions.current.delete(accessVersion));
    }
  }, [job.shorts]);

  const refreshPlaybackAccess = (item: GeneratedShort) => {
    const accessVersion = shortPlaybackVersionKey(item);
    const now = Date.now();
    const lastRefresh = playbackRefreshTimes.current.get(accessVersion) || 0;
    if (now - lastRefresh < 30_000) return;
    playbackRefreshTimes.current.set(accessVersion, now);
    void requestJson<{ url: string; posterUrl: string | null }>(`/api/shorts/${item.id}/access`)
      .then((value) => {
        if (!mounted.current) return;
        setPlaybackAssets((current) => ({ ...current, [accessVersion]: value }));
      })
      .catch(() => playbackRefreshTimes.current.delete(accessVersion));
  };

  const playbackAsset = (item: GeneratedShort) => isPlaybackAvailable(item)
    ? playbackAssets[shortPlaybackVersionKey(item)] || null
    : null;
  const dismissReveal = useCallback(() => {
    setRevealDecision({ jobId: job.id, show: false });
  }, [job.id]);
  const revealPlaybackAssets = Object.fromEntries(
    job.shorts.map((item) => {
      const asset = playbackAsset(item);
      return [item.id, {
        url: asset?.url || null,
        posterUrl: asset?.posterUrl || null,
      }];
    }),
  );

  const downloadableItems = job.shorts.filter((item) => item.status === "ready");
  const guideEditShortId = job.shorts.find((item) => (
    !job.isExample && item.status !== "rerendering"
  ))?.id;
  const guideDownloadShortId = job.shorts.find((item) => (
    !job.isExample && item.status === "ready"
  ))?.id;
  const downloadAll = () => {
    if (job.isExample || !downloadableItems.length) return;
    if (!access.canDownload) {
      setDownloadPaywallOpen(true);
      return;
    }
    if (iosDownloadDevice) {
      setDownloadNoticeOpen(true);
      return;
    }
    for (const item of downloadableItems) {
      const anchor = document.createElement("a");
      anchor.href = `/api/shorts/${encodeURIComponent(item.id)}/download`;
      anchor.download = shortDownloadFilename(item.hookTitle);
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
  };

  if (!selected) {
    const projectExpired = isProjectExpired(job);
    const message = job.status === "failed" && job.errorMessage
      ? job.errorMessage
      : !terminalStatuses.has(job.status)
        ? "쇼츠를 생성하고 있습니다. 완료되는 대로 이 화면에 표시됩니다."
        : projectExpired || job.status === "expired" || job.status === "deleted"
          ? "보관 기간이 끝나 이 프로젝트의 쇼츠를 볼 수 없습니다."
          : "아직 생성된 쇼츠가 없습니다.";
    return <div className="project-workspace"><button onClick={onBack}>← 프로젝트로 돌아가기</button><p className={`m-auto max-w-xl whitespace-pre-line px-6 text-center leading-7 ${job.status === "failed" ? "text-red-300" : "text-neutral-500"}`}>{message}</p></div>;
  }
  if (
    job.status === "completed"
    && (!revealDecision || revealDecision.jobId !== job.id)
  ) {
    return <div className="project-workspace" aria-label="프로젝트를 여는 중" />;
  }
  if (revealDecision?.jobId === job.id && revealDecision.show) {
    return (
      <div className="project-workspace">
        <ProjectReveal
          job={job}
          playbackAssets={revealPlaybackAssets}
          onComplete={dismissReveal}
        />
      </div>
    );
  }
  return (
    <div className="project-workspace">
      <header className="workspace-header">
        <div className="min-w-0"><button data-project-guide="back" onClick={onBack} className="text-xs font-semibold text-neutral-400 hover:text-white">← 프로젝트 /{job.projectNumber}</button><div className="mt-1 flex min-w-0 items-center gap-3"><h1 className="truncate text-base font-bold">{job.videoTitle}</h1>{job.isExample && <span className="shrink-0 rounded bg-red-500/15 px-2 py-1 text-[11px] font-extrabold text-red-300">예시 작업 · 읽기 전용</span>}<span className="shrink-0 text-xs text-neutral-500">쇼츠 {job.shorts.length}개</span></div></div>
        <button data-project-guide="bulk-download" disabled={job.isExample || !downloadableItems.length} title={job.isExample ? "예시 작업은 다운로드할 수 없습니다." : undefined} onClick={downloadAll} className="workspace-button workspace-button-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-40">{iosDownloadDevice ? "↓ 쇼츠별 다운로드 안내" : "↓ 모든 쇼츠 다운로드"}</button>
      </header>
      <ProjectActionGuide
        enabled={!job.isExample && job.status === "completed"}
        editAvailable={Boolean(guideEditShortId)}
        downloadAvailable={Boolean(guideDownloadShortId)}
        bulkDownloadAvailable={downloadableItems.length > 0}
      />
      <PaidProjectFeatureOverlay
        action="download"
        open={downloadPaywallOpen}
        onClose={() => setDownloadPaywallOpen(false)}
      />
      <NoticeDialog
        open={downloadNoticeOpen}
        dialogId="ios-download-notice"
        title="쇼츠별로 바로 저장해 주세요"
        description="iPhone과 iPad는 여러 파일의 자동 저장을 제한합니다. 아래 각 쇼츠의 다운로드 버튼을 누르면 파일 앱의 다운로드 폴더에 안전하게 저장됩니다."
        variant="info"
        onClose={() => setDownloadNoticeOpen(false)}
      />
      <EditorDraftEntryDialog
        draft={editorDraftDiscardConfirmationOpen
          ? null
          : editorDraftEntry?.draft || null}
        onContinue={() => openEditorFromDraftEntry("continue")}
        onStartNew={() => setEditorDraftDiscardConfirmationOpen(true)}
        onClose={() => {
          setEditorDraftDiscardConfirmationOpen(false);
          setEditorDraftEntry(null);
        }}
      />
      <EditorDraftDiscardConfirmDialog
        open={editorDraftDiscardConfirmationOpen && Boolean(editorDraftEntry)}
        onCancel={() => setEditorDraftDiscardConfirmationOpen(false)}
        onConfirm={() => openEditorFromDraftEntry("new")}
      />
      {job.status === "failed" && job.errorMessage && (
        <div role="alert" className="mx-4 mt-4 whitespace-pre-line rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200 sm:mx-6">
          {job.errorMessage}
        </div>
      )}
      <main className="short-results-workspace">
        <div className="short-results-list">
          {job.shorts.map((item, index) => {
            const itemAsset = playbackAsset(item);
            const itemUrl = itemAsset?.url || null;
            const itemIsRerendering = item.status === "rerendering";
            const script = item.subtitleSegments.map((segment) => segment.text).join(" ") || "추출된 스크립트가 없습니다.";
            return (
              <article key={item.id} className="short-result-card">
                <div className="short-result-heading">
                  <span>#{index + 1}</span>
                  <h2>{item.hookTitle}</h2>
                </div>
                <div className="short-result-layout">
                  <div className="short-video-column">
                    <div className="short-video-shell">
                      {itemUrl ? <video key={shortPlaybackVersionKey(item)} src={itemUrl} poster={itemAsset?.posterUrl || undefined} controls={!itemIsRerendering} controlsList={job.isExample ? "nodownload" : undefined} playsInline preload="metadata" onError={() => refreshPlaybackAccess(item)} className={itemIsRerendering ? "grayscale" : ""} /> : <div className="short-video-placeholder">영상 준비 중</div>}
                      <span className="short-duration-badge">{formatDuration(item.durationSeconds)}</span>
                      {itemIsRerendering && <EstimatedProcessingOverlay operationKey={`rerender:${item.id}:${item.renderVersion}`} durationSeconds={item.durationSeconds} rerender minimumProgress={item.rerenderProgress} />}
                    </div>
                    <div className="short-result-actions">
                      {job.isExample || itemIsRerendering || item.subtitleTemplateId
                        ? <button disabled title={job.isExample ? "예시 작업은 편집할 수 없습니다." : item.subtitleTemplateId ? "자막 템플릿 편집은 다음 단계에서 지원합니다." : undefined} className="tool-button short-edit-button cursor-not-allowed opacity-40">{item.subtitleTemplateId ? "✎ 편집 준비 중" : "✎ 편집하기"}</button>
                        : <Link
                            data-project-guide={item.id === guideEditShortId ? "edit" : undefined}
                            href={`/projects/${job.projectNumber}/edit/${item.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tool-button short-edit-button flex items-center justify-center"
                            aria-label={`${item.hookTitle} 새 탭에서 편집하기`}
                            onClick={(event) => {
                              const draft = editorDraftsByShortId[item.id];
                              if (!draft) return;
                              event.preventDefault();
                              setEditorDraftEntry({
                                draft,
                                href: `/projects/${job.projectNumber}/edit/${item.id}`,
                              });
                            }}
                          >✎ 편집하기</Link>}
                      {job.isExample || itemIsRerendering || item.status !== "ready"
                        ? <button disabled title={job.isExample ? "예시 작업은 다운로드할 수 없습니다." : undefined} className="tool-button short-download-button disabled:cursor-not-allowed disabled:opacity-40">↓ 다운로드</button>
                        : access.canDownload
                          ? <a data-project-guide={item.id === guideDownloadShortId ? "download" : undefined} href={`/api/shorts/${encodeURIComponent(item.id)}/download`} download={shortDownloadFilename(item.hookTitle)} className="tool-button short-download-button flex items-center justify-center" aria-label={`${item.hookTitle} 다운로드`}>↓ 다운로드</a>
                          : <button data-project-guide={item.id === guideDownloadShortId ? "download" : undefined} type="button" onClick={() => setDownloadPaywallOpen(true)} className="tool-button short-download-button">↓ 다운로드</button>}
                    </div>
                    {item.subtitleTemplateId && (
                      <p className="mt-2 text-center text-xs font-medium text-neutral-400">자막 편집은 다음 단계에서 지원해요.</p>
                    )}
                  </div>
                  <div className="short-detail-column">
                    <div className="short-highlight-note"><strong>✦ AI 하이라이트</strong><p>{item.highlightReason.trim()}</p></div>
                    <div className="short-source-range"><span>원본 영상 타임라인</span><strong>◷ {formatTimestamp(item.startSeconds)} ~ {formatTimestamp(item.endSeconds)}</strong></div>
                    <section className="short-script-panel">
                      <h3>스크립트</h3>
                      <p>{script}</p>
                    </section>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export function ShortEditorPage({ projectNumber, shortId, rangeEditingEnabled = false, overlayPreviewEnabled = false, editorSaveEnabled = false, editorRelease }: { projectNumber: number; shortId: string; rangeEditingEnabled?: boolean; overlayPreviewEnabled?: boolean; editorSaveEnabled?: boolean; editorRelease: EditorReleaseAssignment }) {
  const [project, setProject] = useState<VideoJob | null>(null);
  const [access, setAccess] = useState<ProjectActionAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadProject = useCallback(async () => {
    try {
      const value = await requestJson<{ project: VideoJob; access: ProjectActionAccess }>(`/api/projects/${projectNumber}`, undefined, 12_000);
      setProject(value.project);
      setAccess(value.access);
      setError(null);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "편집할 쇼츠를 불러오지 못했습니다."));
    }
  }, [projectNumber]);

  useEffect(() => { void loadProject(); }, [loadProject]);
  const item = project?.shorts.find((value) => value.id === shortId);
  const closeEditor = () => {
    window.close();
    window.setTimeout(() => { if (!window.closed) window.location.href = `/projects/${projectNumber}`; }, 100);
  };

  if (error) return <main className="editor-page grid place-items-center p-6 text-center"><div><h1 className="text-lg font-bold">편집기를 열 수 없습니다.</h1><p className="mt-3 text-sm text-red-300">{error}</p><Link href={`/projects/${projectNumber}`} className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-black">프로젝트로 돌아가기</Link></div></main>;
  if (!project) return <main className="editor-page grid place-items-center text-sm text-neutral-400">편집기를 준비하고 있습니다…</main>;
  if (!item || project.isExample) return <main className="editor-page grid place-items-center p-6 text-center"><div><h1 className="text-lg font-bold">편집할 수 없는 쇼츠입니다.</h1><Link href={`/projects/${projectNumber}`} className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-black">프로젝트로 돌아가기</Link></div></main>;

  return <Editor item={item} channelThumbnailUrl={project.channelThumbnailUrl} standalone projectLabel={item.hookTitle} projectNumber={project.projectNumber} onClose={closeEditor} onChanged={loadProject} rangeEditingEnabled={rangeEditingEnabled} overlayPreviewEnabled={overlayPreviewEnabled} editorSaveEnabled={editorSaveEnabled} editorRelease={editorRelease} paidAccessBlocked={!access?.canEdit} />;
}

export function ProjectPage({ projectNumber }: { projectNumber: number }) {
  const [project, setProject] = useState<VideoJob | null>(null);
  const [access, setAccess] = useState<ProjectActionAccess>({ canEdit: false, canDownload: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    try {
      const value = await requestJson<{ project: VideoJob; access: ProjectActionAccess }>(
        `/api/projects/${projectNumber}`,
        undefined,
        12_000,
      );
      setProject(value.project);
      setAccess(value.access);
      setLoadError(null);
    } catch (cause) {
      setLoadError(userFacingErrorMessage(cause, "프로젝트를 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [projectNumber]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    if (project?.status !== "completed" || project.isExample) return;
    markCompletedProjectViewedForFeedback(project.projectNumber);
  }, [project?.isExample, project?.projectNumber, project?.status]);

  useEffect(() => {
    const refreshAfterAppliedEdit = (event: StorageEvent) => {
      if (event.key !== PROJECT_EDIT_REFRESH_STORAGE_KEY) return;
      const signal = parseProjectEditRefreshSignal(event.newValue);
      if (signal?.projectNumber !== projectNumber) return;
      window.location.reload();
    };
    window.addEventListener("storage", refreshAfterAppliedEdit);
    return () => window.removeEventListener("storage", refreshAfterAppliedEdit);
  }, [projectNumber]);

  const projectHasBackgroundWork = Boolean(
    project
    && (
      !terminalStatuses.has(project.status)
      || project.shorts.some((item) => item.status === "rerendering")
    ),
  );

  useEffect(() => {
    if (!projectHasBackgroundWork) return;
    const timer = window.setInterval(() => {
      void loadProject();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [loadProject, projectHasBackgroundWork]);

  const returnToProjects = () => {
    window.location.assign("/#results");
  };

  if (!project) {
    return (
      <div className="project-workspace">
        <button onClick={returnToProjects}>← 프로젝트로 돌아가기</button>
        <div className="m-auto max-w-xl px-6 text-center">
          <p className={`leading-7 ${loadError ? "text-red-300" : "text-neutral-500"}`}>
            {loadError || (loading ? "프로젝트를 불러오는 중입니다." : "프로젝트를 찾을 수 없습니다.")}
          </p>
          {loadError && <button type="button" onClick={() => { setLoading(true); void loadProject(); }} className="mt-5 rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white">다시 시도</button>}
        </div>
      </div>
    );
  }

  return <ProjectWorkspace job={project} access={access} onBack={returnToProjects} />;
}

function initialActiveJob(state: MvpState | null) {
  if (!state) return null;
  const running = state.recentJobs.find((job) => !terminalStatuses.has(job.status));
  const rerendering = state.recentJobs.find((job) => (
    job.shorts.some((item) => item.status === "rerendering")
  ));
  return running || rerendering || state.recentJobs[0] || null;
}

function SourceRangeSelector({
  sourceDurationSeconds,
  startSeconds,
  endSeconds,
  usageSeconds,
  plannedShortCount,
  onStartChange,
  onEndChange,
  onReset,
}: {
  sourceDurationSeconds: number;
  startSeconds: number;
  endSeconds: number;
  usageSeconds: number;
  plannedShortCount: number;
  onStartChange: (seconds: number) => void;
  onEndChange: (seconds: number) => void;
  onReset: () => void;
}) {
  const safeDuration = Math.max(1, sourceDurationSeconds);
  const selectedDuration = Math.max(0, endSeconds - startSeconds);
  const selectedLeft = Math.max(0, Math.min(100, startSeconds / safeDuration * 100));
  const selectedRight = Math.max(0, Math.min(100, 100 - endSeconds / safeDuration * 100));
  const selectedEnd = 100 - selectedRight;
  const sliderThumbCenter = (percent: number) => (
    `calc(${percent}% + ${7 - percent * 0.14}px)`
  );
  return (
    <div className="rounded-2xl border border-[#ff8f7f]/30 bg-[#ff715e]/[.055] p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">사용할 영상 구간</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-400">
            양쪽 손잡이를 드래그해 전사·분석할 범위를 정하세요. 4분부터 60분까지 선택할 수 있습니다.
          </p>
        </div>
        <strong className="font-mono text-sm tabular-nums text-[#ffb4aa] sm:text-base">
          {formatTimestamp(startSeconds)} – {formatTimestamp(endSeconds)}
        </strong>
      </div>
      <div className="relative mt-6 h-10 select-none">
        <div className="absolute inset-x-0 top-4 h-2 rounded-full bg-white/10" />
        <div
          className="absolute top-4 h-2 rounded-full bg-gradient-to-r from-[#ff715e] to-[#ff9c8e]"
          style={{ left: `${selectedLeft}%`, right: `${selectedRight}%` }}
        />
        <span
          aria-hidden="true"
          data-source-range-guide="start-handle"
          className="pointer-events-none absolute top-[2px] z-30 h-[34px] w-[14px] -translate-x-1/2 rounded-[5px]"
          style={{ left: sliderThumbCenter(selectedLeft) }}
        />
        <span
          aria-hidden="true"
          data-source-range-guide="end-handle"
          className="pointer-events-none absolute top-[2px] z-30 h-[34px] w-[14px] -translate-x-1/2 rounded-[5px]"
          style={{ left: sliderThumbCenter(selectedEnd) }}
        />
        <input
          aria-label="사용할 영상 시작 지점"
          type="range"
          min={0}
          max={sourceDurationSeconds}
          step={1}
          value={startSeconds}
          onChange={(event) => onStartChange(Number(event.target.value))}
          className="range-editor-handle absolute inset-0 z-20 h-10 w-full"
        />
        <input
          aria-label="사용할 영상 끝 지점"
          type="range"
          min={0}
          max={sourceDurationSeconds}
          step={1}
          value={endSeconds}
          onChange={(event) => onEndChange(Number(event.target.value))}
          className="range-editor-handle absolute inset-0 z-10 h-10 w-full"
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs font-medium text-neutral-500">
        <span className="font-mono tabular-nums">0:00</span>
        <span className="text-center" data-source-range-guide="usage">
          선택 {formatDuration(selectedDuration)} · 차감 {formatDuration(usageSeconds)} · 예상 쇼츠 {plannedShortCount}개
        </span>
        <span className="font-mono tabular-nums">{formatTimestamp(sourceDurationSeconds)}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <SourceTimestampInput label="시작 시각" value={startSeconds} onChange={onStartChange} />
        <SourceTimestampInput label="종료 시각" value={endSeconds} onChange={onEndChange} />
      </div>
      <button type="button" onClick={onReset} className="mt-4 min-h-10 rounded-xl border border-white/10 px-4 text-xs font-bold text-neutral-300 transition hover:border-white/20 hover:bg-white/[.05] hover:text-white">
        선택 범위 초기화
      </button>
    </div>
  );
}

function SourceTimestampInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatTimestamp(value));
  useEffect(() => setDraft(formatTimestamp(value)), [value]);
  const commit = () => {
    const parsed = parseSourceTimestampInput(draft);
    if (parsed === null) {
      setDraft(formatTimestamp(value));
      return;
    }
    onChange(parsed);
  };
  return (
    <label className="grid gap-2 text-xs font-bold text-neutral-300">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDraft(formatTimestamp(value));
            event.currentTarget.blur();
          }
        }}
        aria-label={label}
        placeholder="0:00"
        className="h-11 rounded-xl border border-white/10 bg-black/25 px-4 font-mono text-sm tabular-nums text-white outline-none transition focus:border-[#ff8f7f]/70"
      />
    </label>
  );
}

export function ShortsApp({ initialState = null }: { initialState?: MvpState | null }) {
  const { locale, t } = useI18n();
  const [state, setState] = useState<MvpState | null>(initialState);
  const [stateLoadStatus, setStateLoadStatus] = useState<"loading" | "ready" | "error">(
    initialState ? "ready" : "loading",
  );
  const [stateLoadError, setStateLoadError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [analysis, setAnalysis] = useState<YoutubeAnalysis | null>(null);
  const [sourceRangeStartSeconds, setSourceRangeStartSeconds] = useState(0);
  const [sourceRangeEndSeconds, setSourceRangeEndSeconds] = useState(0);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const outputLanguage: OutputLanguage = "ko";
  const [templateId, setTemplateId] = useState<TemplateId>("comment-capture");
  const [subtitleTemplateId, setSubtitleTemplateId] = useState<SubtitleTemplateId | null>(null);
  const [customTemplateId, setCustomTemplateId] = useState<string | null>(null);
  const [personalTemplates, setPersonalTemplates] = useState<CustomTemplate[]>([]);
  const [favoriteTemplateKeys, setFavoriteTemplateKeys] = useState<TemplateFavoriteKey[]>([...DEFAULT_FAVORITE_TEMPLATE_KEYS]);
  const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>("16:9");
  const [activeJob, setActiveJob] = useState<VideoJob | null>(() => initialActiveJob(initialState));
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginNext, setLoginNext] = useState("/");
  const [loginPromptPending, setLoginPromptPending] = useState(false);
  const [creationRestrictionOpen, setCreationRestrictionOpen] = useState(false);
  const [creationRestrictionReason, setCreationRestrictionReason] = useState<string | null>(null);
  const [concurrentJobNoticeOpen, setConcurrentJobNoticeOpen] = useState(false);
  const [longSourceNoticeOpen, setLongSourceNoticeOpen] = useState(false);
  const [shortsEventRewardAvailable, setShortsEventRewardAvailable] = useState(false);
  const [shortsEventParticipationOpen, setShortsEventParticipationOpen] = useState(false);
  const [shortsEventGrantedSeconds, setShortsEventGrantedSeconds] = useState(0);
  const [scrollToAnalysis, setScrollToAnalysis] = useState(false);
  const [scrollToProjects, setScrollToProjects] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollStarted = useRef(0);
  const loginOpenTimer = useRef<number | null>(null);
  const stateLoadInFlight = useRef<Promise<void> | null>(null);
  const analysisSectionRef = useRef<HTMLElement>(null);
  const projectsSectionRef = useRef<HTMLElement>(null);
  const initializedSourceRangeAnalysisId = useRef<string | null>(null);
  const activeJobId = activeJob?.id;
  const activeJobStatus = activeJob?.status;
  const activeJobHasRerendering = Boolean(activeJob?.shorts.some((item) => item.status === "rerendering"));
  const hasBackgroundWork = Boolean(state?.recentJobs.some((job) => !terminalStatuses.has(job.status) || job.shorts.some((item) => item.status === "rerendering")));
  const analysisCreationBlocked = Boolean(analysis && analysis.creationAllowed !== true);
  const sourceRangeSelectionEnabled = analysis?.sourceRangeSelectionEnabled === true;
  const subtitleTemplateSelectionEnabled = analysis?.subtitleTemplateSelectionEnabled === true;
  const sourceVideoEmbedUrl = sourceRangeSelectionEnabled && analysis
    ? youtubePrivacyEnhancedEmbedUrl(analysis.videoId)
    : null;
  const selectedSourceDurationSeconds = sourceRangeSelectionEnabled
    ? Math.max(0, sourceRangeEndSeconds - sourceRangeStartSeconds)
    : analysis?.durationSeconds || 0;
  const selectedSourceUsageSeconds = selectedSourceDurationSeconds > 0
    ? billableSelectedSourceSeconds(selectedSourceDurationSeconds)
    : 0;
  const selectedSourceExceedsUsage = Boolean(
    sourceRangeSelectionEnabled
    && state?.usage.enforcementEnabled
    && selectedSourceUsageSeconds > state.usage.remainingSeconds,
  );
  const sourceRangeIsValid = !sourceRangeSelectionEnabled || Boolean(
    analysis
    && sourceRangeStartSeconds >= 0
    && sourceRangeEndSeconds <= analysis.durationSeconds
    && selectedSourceDurationSeconds >= MIN_SELECTED_SOURCE_SECONDS
    && selectedSourceDurationSeconds <= MAX_SELECTED_SOURCE_SECONDS
    && !selectedSourceExceedsUsage,
  );
  const selectedPlannedShortCount = sourceRangeSelectionEnabled
    ? expectedShortCount(selectedSourceDurationSeconds)
    : analysis?.expectedShortCount || 0;
  const activeJobCount = state?.recentJobs.filter((job) => !terminalStatuses.has(job.status)).length || 0;
  const planEnforcementEnabled = state?.usage.enforcementEnabled ?? true;
  const canUseCustomTemplates = Boolean(state && billingSupportsCustomTemplates(state.billing));
  const maxActiveJobs = planEnforcementEnabled ? (state?.billing.maxActiveJobs || 1) : 1;
  const activeJobBlocksCreation = Boolean(
    state?.user
    && activeJobCount >= maxActiveJobs,
  );
  const selectedPersonalTemplate = canUseCustomTemplates
    ? personalTemplates.find((template) => template.id === customTemplateId)
    : undefined;
  const effectiveVideoAspectRatio = selectedPersonalTemplate?.config.video.aspectRatio ?? videoAspectRatio;
  const closeCreationRestriction = useCallback(() => setCreationRestrictionOpen(false), []);
  const closeConcurrentJobNotice = useCallback(() => setConcurrentJobNoticeOpen(false), []);
  const closeLongSourceNotice = useCallback(() => {
    setLongSourceNoticeOpen(false);
    setScrollToAnalysis(true);
  }, []);
  const closeShortsEventParticipation = useCallback(() => {
    setShortsEventParticipationOpen(false);
  }, []);
  const openLoginAfterDelay = useCallback((next: string) => {
    if (loginOpenTimer.current !== null) return;
    setLoginNext(next);
    setLoginPromptPending(true);
    loginOpenTimer.current = window.setTimeout(() => {
      loginOpenTimer.current = null;
      setLoginPromptPending(false);
      setLoginOpen(true);
    }, LOGIN_OVERLAY_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (loginOpenTimer.current !== null) {
      window.clearTimeout(loginOpenTimer.current);
    }
  }, []);

  useEffect(() => {
    if (!subtitleTemplateSelectionEnabled) setSubtitleTemplateId(null);
  }, [subtitleTemplateSelectionEnabled]);

  useEffect(() => {
    if (!analysis) {
      initializedSourceRangeAnalysisId.current = null;
      setSourceRangeStartSeconds(0);
      setSourceRangeEndSeconds(0);
      return;
    }
    if (!analysis.sourceRangeSelectionEnabled) {
      initializedSourceRangeAnalysisId.current = analysis.analysisId;
      setSourceRangeStartSeconds(0);
      setSourceRangeEndSeconds(analysis.durationSeconds);
      return;
    }
    if (initializedSourceRangeAnalysisId.current === analysis.analysisId) return;
    initializedSourceRangeAnalysisId.current = analysis.analysisId;
    const availableSeconds = state?.usage.enforcementEnabled
      ? state.usage.remainingSeconds
      : MAX_SELECTED_SOURCE_SECONDS;
    setSourceRangeStartSeconds(0);
    setSourceRangeEndSeconds(Math.min(
      analysis.durationSeconds,
      availableSeconds,
      MAX_SELECTED_SOURCE_SECONDS,
    ));
  }, [analysis, state?.usage.enforcementEnabled, state?.usage.remainingSeconds]);

  const loadState = useCallback(async () => {
    if (stateLoadInFlight.current) return stateLoadInFlight.current;
    const task = (async () => {
      const value = await requestJson<MvpState>("/api/mvp/state", undefined, 12_000);
      setState(value);
      publishUsageSnapshot(value.usage);
      setStateLoadStatus("ready");
      setStateLoadError(null);
      setActiveJob(initialActiveJob(value));
    })();
    stateLoadInFlight.current = task;
    try {
      await task;
    } finally {
      if (stateLoadInFlight.current === task) stateLoadInFlight.current = null;
    }
  }, []);

  const retryStateLoad = () => {
    setStateLoadStatus("loading");
    setStateLoadError(null);
    void loadState().catch((cause) => {
      setStateLoadStatus("error");
      setStateLoadError(userFacingErrorMessage(cause, "프로젝트를 불러오지 못했습니다."));
    });
  };

  useEffect(() => {
    if (!state?.user) {
      setPersonalTemplates([]);
      setFavoriteTemplateKeys([...DEFAULT_FAVORITE_TEMPLATE_KEYS]);
      setCustomTemplateId(null);
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      requestJson<{ templates: CustomTemplate[] }>("/api/templates", { signal: controller.signal }, 12_000),
      requestJson<{ templateKeys: TemplateFavoriteKey[] }>("/api/template-favorites", { signal: controller.signal }, 12_000),
    ])
      .then(([templateResponse, favoriteResponse]) => {
        setPersonalTemplates(templateResponse.templates);
        setFavoriteTemplateKeys(favoriteResponse.templateKeys);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(userFacingErrorMessage(cause, "템플릿을 불러오지 못했습니다."));
      });
    return () => controller.abort();
  }, [state?.user]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let attempt = 0;
    const refresh = async () => {
      try {
        await loadState();
      } catch (cause) {
        if (stopped) return;
        setStateLoadStatus("error");
        setStateLoadError(userFacingErrorMessage(cause, "프로젝트를 불러오지 못했습니다."));
        timer = window.setTimeout(refresh, stateRetryDelayMs(attempt));
        attempt += 1;
      }
    };
    void refresh();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadState]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const authError = url.searchParams.get("auth_error");
    const loginRequested = url.searchParams.get("login") === "1";
    if (!authError && !loginRequested) return;
    if (authError) setError(localizeAuthError(authError, locale));
    if (loginRequested) {
      const requestedNext = url.searchParams.get("next");
      setLoginNext(
        requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
          ? requestedNext
          : "/",
      );
      setLoginOpen(true);
    }
    url.searchParams.delete("auth_error");
    url.searchParams.delete("login");
    url.searchParams.delete("next");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [locale]);

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const analysisId = currentUrl.searchParams.get("analysisId");
    if (!analysisId) return;
    if (currentUrl.hash === "#shorts-settings") {
      currentUrl.hash = "";
      window.history.replaceState(
        window.history.state,
        "",
        `${currentUrl.pathname}${currentUrl.search}`,
      );
    }
    setBusy(true);
    setError(null);
    requestJson<YoutubeAnalysis>(`/api/youtube/analyses/${encodeURIComponent(analysisId)}`)
      .then((value) => {
        setYoutubeUrl(value.normalizedUrl);
        setAnalysis(value);
        setRightsConfirmed(false);
        setCreationRestrictionReason(
          value.creationAllowed ? null : value.creationBlockReason || "이 영상은 이용 제한이 확인된 영상입니다.",
        );
        setCreationRestrictionOpen(value.creationAllowed !== true);
        if (shouldShowLongSourceNotice(
          value.durationSeconds,
          value.sourceRangeSelectionEnabled === true,
          value.creationAllowed === true,
        )) {
          setLongSourceNoticeOpen(true);
          setScrollToAnalysis(false);
        } else {
          setScrollToAnalysis(true);
        }
      })
      .catch((cause: unknown) => setError(userFacingErrorMessage(cause, "인기 영상 정보를 불러오지 못했습니다.")))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!scrollToAnalysis || !analysis) return;
    let scrollFrame = 0;
    const layoutFrame = window.requestAnimationFrame(() => {
      scrollFrame = window.requestAnimationFrame(() => {
        const section = analysisSectionRef.current;
        if (section) {
          const headerHeight = homeAnalysisHeaderOffset({
            isDesktop: window.matchMedia("(min-width: 768px)").matches,
            headerHeight: document.querySelector<HTMLElement>(".site-header")
              ?.getBoundingClientRect().height || 0,
          });
          window.scrollTo({
            top: Math.max(0, window.scrollY + section.getBoundingClientRect().top - headerHeight - 16),
            behavior: "smooth",
          });
        }
        setScrollToAnalysis(false);
      });
    });
    return () => {
      window.cancelAnimationFrame(layoutFrame);
      window.cancelAnimationFrame(scrollFrame);
    };
  }, [analysis, scrollToAnalysis]);

  useEffect(() => {
    if (!scrollToProjects || !state?.recentJobs.length) return;
    const frame = window.requestAnimationFrame(() => {
      projectsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollToProjects(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToProjects, state?.recentJobs.length]);

  useEffect(() => {
    if (!activeJobId || !activeJobStatus || (terminalStatuses.has(activeJobStatus) && !activeJobHasRerendering)) return;
    pollStarted.current ||= Date.now();
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const poll = async () => {
      try {
        controller = new AbortController();
        const value = await requestJson<{ job: VideoJob; usage: UsageSnapshot }>(
          `/api/jobs/${activeJobId}`,
          { signal: controller.signal },
          12_000,
        );
        if (stopped) return;
        setActiveJob(value.job);
        setState((current) => current ? { ...current, usage: value.usage, recentJobs: current.recentJobs.map((job) => job.id === value.job.id ? value.job : job) } : current);
        publishUsageSnapshot(value.usage);
        const hasRerendering = value.job.shorts.some((item) => item.status === "rerendering");
        if (terminalStatuses.has(value.job.status) && !hasRerendering) { pollStarted.current = 0; await loadState(); return; }
      } catch (cause) { if (!stopped) setError(userFacingErrorMessage(cause, "작업 상태를 확인하지 못했습니다.")); }
      const elapsed = Date.now() - pollStarted.current;
      if (!stopped) timer = window.setTimeout(poll, elapsed < 30_000 ? 3_000 : elapsed < 300_000 ? 6_000 : 10_000);
    };
    timer = window.setTimeout(poll, 3_000);
    return () => {
      stopped = true;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeJobHasRerendering, activeJobId, activeJobStatus, loadState]);

  useEffect(() => {
    if (!hasBackgroundWork) return;
    const timer = window.setInterval(() => {
      void loadState().catch((cause) => setError(userFacingErrorMessage(cause, "작업 상태를 확인하지 못했습니다.")));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [hasBackgroundWork, loadState]);

  const pasteYoutubeUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("클립보드에 붙여넣을 텍스트가 없습니다.");
      setYoutubeUrl(text.trim());
      setRightsConfirmed(false);
      setError(null);
    } catch (cause) {
      setError(userFacingErrorMessage(cause, "클립보드를 읽지 못했습니다."));
    }
  };

  const analyze = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setRightsConfirmed(false);
    setCreationRestrictionOpen(false);
    setCreationRestrictionReason(null);
    setLongSourceNoticeOpen(false);
    if (!state?.user) {
      setLoginNext("/");
      setLoginOpen(true);
      return;
    }
    setBusy(true);
    try {
      const value = await requestJson<YoutubeAnalysis>("/api/youtube/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ youtubeUrl }) });
      setAnalysis(value);
      setCreationRestrictionReason(
        value.creationAllowed ? null : value.creationBlockReason || "이 영상은 이용 제한이 확인된 영상입니다.",
      );
      setCreationRestrictionOpen(value.creationAllowed !== true);
      if (shouldShowLongSourceNotice(
        value.durationSeconds,
        value.sourceRangeSelectionEnabled === true,
        value.creationAllowed === true,
      )) {
        setLongSourceNoticeOpen(true);
        setScrollToAnalysis(false);
      } else {
        setScrollToAnalysis(true);
      }
    }
    catch (cause) {
      const message = userFacingErrorMessage(cause, "영상을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      if (cause instanceof HttpRequestError && cause.status === 400) {
        setAnalysis(null);
        setCreationRestrictionReason(message);
        setCreationRestrictionOpen(true);
      } else {
        setError(message);
      }
    }
    finally { setBusy(false); }
  };

  const createJob = async () => {
    if (!analysis) return;
    if (analysis.creationAllowed !== true) {
      if (!analysis.creationBlockReason) {
        setCreationRestrictionReason("이 영상은 이용 제한이 확인된 영상입니다.");
        setCreationRestrictionOpen(true);
        return;
      }
      setCreationRestrictionReason(
        analysis.creationBlockReason || "이 영상은 쇼츠로 만들 수 없습니다.",
      );
      setCreationRestrictionOpen(true);
      return;
    }
    if (!rightsConfirmed) {
      setError("쇼츠를 만들려면 원본 영상의 권리 보유 또는 적법한 이용 허가를 확인해 주세요.");
      return;
    }
    if (!sourceRangeIsValid) {
      setError(selectedSourceExceedsUsage
        ? "선택한 구간이 남은 원본 영상 처리시간을 초과합니다."
        : "사용할 영상 구간은 4분부터 60분까지 선택해 주세요.");
      return;
    }
    const next = `/?analysisId=${encodeURIComponent(analysis.analysisId)}`;
    if (!state?.user) {
      openLoginAfterDelay(next);
      return;
    }
    if (
      state.usage.enforcementEnabled
      && !state.billing.canCreateJobs
      && !shortsEventRewardAvailable
    ) {
      window.location.href = "/pricing";
      return;
    }
    if (activeJobBlocksCreation) {
      setConcurrentJobNoticeOpen(true);
      return;
    }
    setBusy(true); setError(null);
    try {
      const value = await requestJson<{
        jobId: string;
        projectNumber: number;
        usage: UsageSnapshot;
        shortsThankYouEventReward: {
          granted: boolean;
          grantedSeconds: number;
          validUntil: string | null;
        };
      }>("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId: analysis.analysisId, templateId, customTemplateId: canUseCustomTemplates ? customTemplateId : null, videoAspectRatio: effectiveVideoAspectRatio, outputLanguage, rightsConfirmed, requestId: crypto.randomUUID(), ...(sourceRangeSelectionEnabled ? { rangeStartSeconds: sourceRangeStartSeconds, rangeEndSeconds: sourceRangeEndSeconds } : {}), ...(subtitleTemplateSelectionEnabled && subtitleTemplateId ? { subtitleTemplateId } : {}) }) });
      setShortsEventRewardAvailable(false);
      if (value.shortsThankYouEventReward.granted) {
        setShortsEventGrantedSeconds(
          value.shortsThankYouEventReward.grantedSeconds,
        );
        setShortsEventParticipationOpen(true);
      }
      const pendingJob: VideoJob = { id: value.jobId, projectNumber: value.projectNumber, isExample: false, videoTitle: analysis.title, channelName: analysis.channelName, channelThumbnailUrl: analysis.channelThumbnailUrl, thumbnailUrl: analysis.thumbnailUrl, sourceDurationSeconds: analysis.durationSeconds, outputLanguage, expectedShortCount: selectedPlannedShortCount, plannedShortCount: selectedPlannedShortCount, readyShortCount: 0, failedShortCount: 0, renderSuccessPercent: null, status: "queued", stage: "queued", progress: SIMULATED_PROGRESS_START, stageCompletedCount: 0, stageTotalCount: 0, errorMessage: null, createdAt: new Date().toISOString(), expiresAt: null, shorts: [] };
      setState((current) => current ? { ...current, usage: value.usage, recentJobs: [pendingJob, ...current.recentJobs.filter((job) => job.id !== pendingJob.id)] } : current);
      publishUsageSnapshot(value.usage);
      setActiveJob(pendingJob);
      setScrollToProjects(true);
      pollStarted.current = Date.now();
      setYoutubeUrl("");
      setAnalysis(null);
      setSubtitleTemplateId(null);
      setRightsConfirmed(false);
      setCreationRestrictionOpen(false);
      setCreationRestrictionReason(null);
      setScrollToAnalysis(false);
      const currentUrl = new URL(window.location.href);
      if (currentUrl.searchParams.has("analysisId")) {
        currentUrl.searchParams.delete("analysisId");
        window.history.replaceState(
          window.history.state,
          "",
          `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
        );
      }
    } catch (cause) {
      if (cause instanceof HttpRequestError && cause.status === 401) {
        setLoginNext(next);
        setLoginOpen(true);
      } else if (
        cause instanceof HttpRequestError
        && cause.status === 402
        && state.usage.enforcementEnabled
      ) {
        window.location.href = "/pricing";
      } else if (cause instanceof HttpRequestError && cause.message.includes("현재 처리 중인 작업")) {
        setConcurrentJobNoticeOpen(true);
      } else {
        setError(userFacingErrorMessage(cause, "쇼츠 작업을 시작하지 못했습니다."));
      }
    }
    finally { setBusy(false); }
  };

  return (
    <div className="app-shell site-chrome desktop-sidebar-layout home-desktop-sidebar flex min-h-screen flex-col text-neutral-100">
      <div className="ambient ambient-coral" aria-hidden="true" />
      <div className="ambient ambient-violet" aria-hidden="true" />
      <SiteHeader desktopSidebar><AuthControls user={state?.user || null} next={loginNext} loginOpen={loginOpen} onLoginOpenChange={setLoginOpen} /></SiteHeader>
      <ShortsEventWelcomeController
        onRewardAvailabilityChange={setShortsEventRewardAvailable}
      />
      <ShortsEventParticipationCompleteOverlay
        open={shortsEventParticipationOpen}
        grantedSeconds={shortsEventGrantedSeconds}
        onClose={closeShortsEventParticipation}
      />
      <NoticeDialog
        open={creationRestrictionOpen && Boolean(creationRestrictionReason)}
        dialogId="creation-restriction"
        title={analysis?.creationAllowed === false ? "영상 이용 제한 안내" : "영상을 확인해 주세요"}
        description={creationRestrictionReason || "이 영상은 이용 제한이 확인된 영상입니다."}
        onClose={closeCreationRestriction}
      />
      <NoticeDialog
        open={concurrentJobNoticeOpen}
        dialogId="concurrent-job-notice"
        title="동시 작업 한도에 도달했어요"
        description={`동시에 ${maxActiveJobs}개까지 처리할 수 있습니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.`}
        variant="info"
        onClose={closeConcurrentJobNotice}
      />
      <NoticeDialog
        open={longSourceNoticeOpen}
        dialogId="long-source-notice"
        title={"길이가 긴 영상은 처리시간이\n조금 더 걸릴 수 있어요"}
        variant="info"
        confirmLabel="확인하고 계속"
        onClose={closeLongSourceNotice}
      />
      <SourceRangeGuide
        enabled={Boolean(
          sourceRangeSelectionEnabled
          && analysis?.creationAllowed === true
          && !longSourceNoticeOpen
          && !creationRestrictionOpen
        )}
      />
      <main id="top" className="relative mx-auto w-full max-w-6xl flex-1 space-y-10 px-5 pb-20 pt-7 sm:px-8 sm:pt-10">
      <div className="home-generated-shorts-count" aria-label={localizedValue(locale, { ko: "지금까지 생성된 쇼츠", en: "Shorts created so far", ja: "これまでに作成したショート動画" })}>
        <strong aria-busy={stateLoadStatus === "loading"}>
          <CountUpNumber value={state?.generatedShortCount ?? 14_259} initialValue={14_259} />
        </strong>
        <p>{localizedValue(locale, { ko: "지금까지 생성된 쇼츠", en: "Shorts created so far", ja: "これまでに作成したショート動画" })}</p>
      </div>
      <section className="hero mx-auto flex max-w-4xl flex-col items-center text-center">
        <h1 className="hero-title">{t("home.heroLine1")}<br /><span>{t("home.heroLine2")}</span></h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-[#d5aaa4] sm:text-base">{t("home.heroDescription")}</p>
        <form id="workspace" onSubmit={analyze} className="url-console mt-10 w-full max-w-3xl">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-4 flex items-center text-xl text-[#d7aaa4]" aria-hidden="true">↗</span>
            <input type="url" value={youtubeUrl} onChange={(event) => { setYoutubeUrl(event.target.value); setRightsConfirmed(false); }} placeholder={t("home.youtubePlaceholder")} className="url-input" aria-label={t("home.youtubeLabel")} />
            <button type="button" onClick={() => void pasteYoutubeUrl()} className="paste-button" aria-label={t("home.pasteLabel")} title={t("home.paste")}><svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="M9 5.5h6M9.5 3h5a1 1 0 0 1 1 1v3h-7V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 5H6.75A1.75 1.75 0 0 0 5 6.75v12.5C5 20.216 5.784 21 6.75 21h10.5A1.75 1.75 0 0 0 19 19.25V6.75A1.75 1.75 0 0 0 17.25 5H16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
          </div>
          <button disabled={busy} className="ai-button">{busy ? t("home.checking") : t("home.convert")}<span aria-hidden="true">✦</span></button>
        </form>
        <p className="mt-3 text-xs font-medium text-neutral-500">{t("home.sourceDurationHint")}</p>
        {state?.user && planEnforcementEnabled && <div className="mt-6 flex flex-wrap items-center justify-center gap-3 rounded-full border border-white/10 bg-white/[.035] px-5 py-3 text-xs text-neutral-400"><strong className="text-white">{state.billing.planCode.toUpperCase()}</strong><span>{t("home.baseMinutes", { minutes: Math.floor(state.usage.baseRemainingSeconds / 60) })}</span><span>{t("home.addonMinutes", { minutes: Math.floor(state.usage.addonRemainingSeconds / 60) })}</span><Link href="/pricing" className="font-bold text-[#ff9b8d]">{t("home.subscription")}</Link></div>}
      </section>
      {state?.user && state.recentJobs.length ? <section id="results" ref={projectsSectionRef} className="scroll-mt-24 sm:scroll-mt-28">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-2xl font-bold">{t("home.projects")}</h2>
            <span className="text-sm text-neutral-500">({state.recentJobs.length})</span>
          </div>
          <Link href="/projects" className="inline-flex min-h-10 shrink-0 items-center rounded-xl border border-white/10 px-4 text-sm font-bold text-neutral-200 transition hover:border-white/25 hover:bg-white/[.06] hover:text-white">
            {t("home.viewAll")} <span className="ml-2" aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{state.recentJobs.map((job) => <ProjectCard key={job.id} job={job} />)}</div>
      </section> : null}
      <TransformationShowcase />
      <BackgroundShowcase />
      {error && <div role="alert" className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">{error}</div>}
      {stateLoadStatus === "error" && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-100"><div><p>{t("home.serviceLoadError")}</p>{stateLoadError && <p className="mt-1 text-xs text-amber-300">{stateLoadError}</p>}</div><button type="button" onClick={retryStateLoad} className="rounded-lg border border-amber-300/30 px-3 py-2 font-semibold">{t("common.retry")}</button></div>}
      {analysis && (
        <section id="shorts-settings" ref={analysisSectionRef} className="scroll-mt-24 space-y-8 sm:scroll-mt-28">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#141416] sm:flex">
            {sourceVideoEmbedUrl ? (
              <div className="aspect-video w-full shrink-0 overflow-hidden bg-black sm:w-72">
                <iframe
                  src={sourceVideoEmbedUrl}
                  title={`${analysis.title} 원본 영상 플레이어`}
                  className="h-full w-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            ) : (
              <Image src={analysis.thumbnailUrl} alt="영상 썸네일" width={480} height={270} unoptimized className="aspect-video w-full object-cover sm:w-72" />
            )}
            <div className="p-5">
              <h2 className="text-lg font-bold">{analysis.title}</h2>
              <p className="mt-2 text-sm text-neutral-400">{analysis.channelName}</p>
              <p className="mt-4 text-sm">원본 영상 {formatDuration(analysis.durationSeconds)} · 예상 쇼츠 {selectedPlannedShortCount}개</p>
              <p className="mt-1 text-xs text-neutral-500">{sourceRangeSelectionEnabled
                ? planEnforcementEnabled
                  ? `선택한 ${formatDuration(selectedSourceDurationSeconds)}만 사용량으로 계산됩니다.`
                  : `선택한 ${formatDuration(selectedSourceDurationSeconds)}만 전사·분석됩니다.`
                : planEnforcementEnabled
                  ? `전체 영상 길이 ${formatDuration(analysis.durationSeconds)}가 사용량으로 계산됩니다.`
                  : "현재는 플랜 처리시간 차감 없이 생성됩니다."}</p>
            </div>
          </div>
          {sourceRangeSelectionEnabled && (
            <>
              <SourceRangeSelector
                sourceDurationSeconds={analysis.durationSeconds}
                startSeconds={sourceRangeStartSeconds}
                endSeconds={sourceRangeEndSeconds}
                usageSeconds={selectedSourceUsageSeconds}
                plannedShortCount={selectedPlannedShortCount}
                onStartChange={(seconds) => setSourceRangeStartSeconds(Math.max(
                  0,
                  sourceRangeEndSeconds - MAX_SELECTED_SOURCE_SECONDS,
                  Math.min(seconds, sourceRangeEndSeconds - MIN_SELECTED_SOURCE_SECONDS),
                ))}
                onEndChange={(seconds) => setSourceRangeEndSeconds(Math.min(
                  analysis.durationSeconds,
                  sourceRangeStartSeconds + MAX_SELECTED_SOURCE_SECONDS,
                  Math.max(seconds, sourceRangeStartSeconds + MIN_SELECTED_SOURCE_SECONDS),
                ))}
                onReset={() => {
                  const availableSeconds = state?.usage.enforcementEnabled
                    ? state.usage.remainingSeconds
                    : MAX_SELECTED_SOURCE_SECONDS;
                  setSourceRangeStartSeconds(0);
                  setSourceRangeEndSeconds(Math.min(
                    analysis.durationSeconds,
                    availableSeconds,
                    MAX_SELECTED_SOURCE_SECONDS,
                  ));
                }}
              />
              {!sourceRangeIsValid && (
                <div role="alert" className="rounded-xl border border-amber-400/25 bg-amber-400/[.07] px-4 py-3 text-sm font-medium text-amber-100">
                  {selectedSourceExceedsUsage
                    ? `선택 사용량 ${formatDuration(selectedSourceUsageSeconds)}가 남은 시간 ${formatDuration(state?.usage.remainingSeconds || 0)}을 초과합니다.`
                    : selectedSourceDurationSeconds < MIN_SELECTED_SOURCE_SECONDS
                      ? "최소 4분 이상 선택해야 쇼츠를 만들 수 있습니다."
                      : "한 작업에서 최대 60분까지 선택할 수 있습니다."}
                </div>
              )}
            </>
          )}
          <TemplatePicker
            value={templateId}
            onChange={(nextTemplateId) => {
              setSubtitleTemplateId(null);
              setTemplateId(nextTemplateId);
              if (nextTemplateId === "comment-capture") setVideoAspectRatio("16:9");
            }}
            videoAspectRatio={effectiveVideoAspectRatio}
            onVideoAspectRatioChange={setVideoAspectRatio}
            channelName={analysis.channelName}
            channelThumbnailUrl={analysis.channelThumbnailUrl}
            personalTemplates={personalTemplates}
            favoriteTemplateKeys={favoriteTemplateKeys}
            customTemplateId={canUseCustomTemplates ? customTemplateId : null}
            canUseCustomTemplates={canUseCustomTemplates}
            subtitleTemplateSelectionEnabled={subtitleTemplateSelectionEnabled}
            subtitleTemplateId={subtitleTemplateId}
            onSubtitleTemplateChange={(nextSubtitleTemplateId) => {
              setSubtitleTemplateId(nextSubtitleTemplateId);
              if (nextSubtitleTemplateId) {
                setCustomTemplateId(null);
                setTemplateId("dark-minimal");
              }
            }}
            onCustomTemplateChange={(template) => {
              setSubtitleTemplateId(null);
              setCustomTemplateId(template?.id || null);
              if (template) {
                setTemplateId(template.baseTemplateId);
                setVideoAspectRatio(template.config.video.aspectRatio);
              }
            }}
          />
          {analysisCreationBlocked && (
            <button type="button" onClick={() => { setCreationRestrictionReason(analysis.creationBlockReason || "영상 이용 제한을 확인했습니다."); setCreationRestrictionOpen(true); }} className="min-h-11 w-full rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100 transition hover:bg-red-500/15">
              생성 불가 사유 보기
            </button>
          )}
          <label className={`flex items-start gap-3 rounded-xl border p-4 transition ${rightsConfirmed ? "border-emerald-300/40 bg-emerald-400/[.08]" : "border-white/10 bg-white/[.025]"} ${analysisCreationBlocked || busy ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:border-white/20"}`}>
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
              disabled={analysisCreationBlocked || busy}
              aria-describedby="rights-confirmation-description"
              className="mt-1 h-5 w-5 shrink-0 accent-emerald-400"
            />
            <span>
              <strong className="block text-sm font-extrabold text-white">원본 영상 권리 확인</strong>
              <span id="rights-confirmation-description" className="mt-1 block text-xs font-medium leading-5 text-neutral-400">
                이 영상은 내가 소유하고 있거나, 권리자로부터 쇼츠 제작·편집 및 이용에 필요한 허가를 받은 영상임을 확인합니다.
              </span>
            </span>
          </label>
          <button disabled={analysisCreationBlocked || !sourceRangeIsValid || !rightsConfirmed || busy || stateLoadStatus !== "ready"} onClick={() => void createJob()} aria-busy={loginPromptPending} className={`h-[52px] w-full rounded-xl py-4 font-bold text-black transition duration-150 disabled:bg-neutral-800 disabled:text-neutral-500 ${loginPromptPending ? "scale-[.985] bg-neutral-200 shadow-[inset_0_2px_6px_rgba(0,0,0,.22)] motion-reduce:transform-none" : "bg-white hover:bg-neutral-100 active:scale-[.985]"}`}>
            <span className="inline-flex items-center justify-center gap-2">
              {loginPromptPending && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black motion-reduce:animate-none" />}
              {analysisCreationBlocked ? t("home.createUnavailable") : stateLoadStatus !== "ready" ? t("home.loginChecking") : !state?.user ? t("home.create") : !planEnforcementEnabled || state.billing.canCreateJobs || shortsEventRewardAvailable ? t("home.create") : t("home.choosePlan")}
            </span>
          </button>
        </section>
      )}
      <ThreeStepProcess />
      <CustomerReviews />
    </main>
    <SiteFooter />
    <SupportInquiryWidget
      user={state?.user || null}
      onLoginRequest={() => {
        setLoginNext("/");
        setLoginOpen(true);
      }}
    />
    </div>
  );
}
