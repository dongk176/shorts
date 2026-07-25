"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { BackgroundShowcase } from "@/components/background-showcase";
import { CustomTemplateCanvasPreview } from "@/components/custom-template-canvas-preview";
import { EstimatedProcessingOverlay, ProjectCard } from "@/components/project-card";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
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
import { outputLanguageOptions, videoAspectRatioOptions } from "@/lib/contracts";
import { SHOW_MONETIZATION_CONTENT } from "@/lib/content-visibility";
import { SIMULATED_PROGRESS_START } from "@/lib/creation-progress";
import { isPlaybackAvailable, shortPlaybackVersionKey } from "@/lib/project-playback";
import { stateRetryDelayMs } from "@/lib/state-loading";
import { applyTitleTextStyle, codePointOffset, defaultTemplateTitleTextStyles } from "@/lib/title-text-style";
import { titleLineBackground, titleLineColor } from "@/lib/title-preview";
import { COMMENT_BACKGROUND_COLOR, type CustomTemplate } from "@/lib/template-config";
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
import { billingSupportsCustomTemplates } from "@/lib/template-entitlements";
import { currentClientLocale, localizeApiError, localizeAuthError } from "@/lib/i18n/errors";
import { messagesByLocale } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/provider";
import { localizedValue } from "@/lib/i18n/config";
import { outputLanguageName } from "@/lib/i18n/product";
import { publishUsageSnapshot } from "@/lib/usage-client";

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

function randomComment(startSeconds: number, endSeconds: number): CommentOverlay {
  const nickname = `${randomItem(commentNicknamePrefixes)}${randomItem(commentNicknameSuffixes)}${Math.floor(Math.random() * 90) + 10}`;
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    startSeconds: Math.round(startSeconds * 1000) / 1000,
    endSeconds: Math.round(endSeconds * 1000) / 1000,
    text: "아 진짜 ㅋㅋㅋㅋㅋㅋㅋㅋ",
    initial: nickname.slice(0, 1),
    avatarColor: randomItem(commentAvatarColors),
    nickname,
    likeCount: randomCommentLikeCount(),
    ageLabel: `${Math.floor(Math.random() * 11) + 1}개월 전`,
  };
}

function defaultComments(durationSeconds: number) {
  const duration = Math.max(0.3, durationSeconds);
  return [0, 1, 2].map((index) => randomComment(
    duration * index / 3,
    duration * (index + 1) / 3,
  ));
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

function aspectLayout(value: VideoAspectRatio, reserveCommentSpace = false) {
  const layoutValue = reserveCommentSpace && value === "9:16" ? "4:5" : value;
  const option = videoAspectRatioOptions.find((item) => item.value === layoutValue)
    || videoAspectRatioOptions.find((item) => item.value === "1:1")!;
  const videoHeight = option.height / 19.2;
  const videoTop = (100 - videoHeight) / 2;
  const fullVertical = layoutValue === "9:16";
  const subtitleMargin = fullVertical
    ? 445
    : 1920 - (Math.round(videoTop * 19.2) + option.height - Math.max(64, Math.round(option.height * 0.08)));
  return { option, videoHeight, videoTop, fullVertical, subtitleBottom: subtitleMargin / 19.2 };
}

const terminalStatuses = new Set(["completed", "failed", "expired", "deleted"]);
const LOGIN_OVERLAY_DELAY_MS = 1_000;

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

function isProjectExpired(job: VideoJob) {
  return Boolean(job.expiresAt && new Date(job.expiresAt).getTime() <= Date.now());
}

function CountUpNumber({ value }: { value: number }) {
  const target = Math.max(0, Math.floor(value));
  const initialValue = target > 0 ? 1 : 0;
  const [displayedValue, setDisplayedValue] = useState(initialValue);
  const displayedValueRef = useRef(initialValue);

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
  { name: "Chris_Lee", rating: 5, role: "전업 크리에이터", review: "템플릿만봐도 대중이 뭐를 좋아하는지 딱 아시는 것 같아서 연간결제 박았습니다~ 숏폼 서비스 다 써봤는데, 알파컷, 피카클립이랑은 비교 불가." },
  { name: "강태영", rating: 5, role: "전업 크리에이터", review: "솔직히 안 유명해졌음 좋겠다… 실시간 인기 영상에서 바로 따오는 건 반칙이잖아 ㅋㅋ" },
  { name: "user_8821", rating: 5, role: "영상 편집자", review: "알파컷 썼을 땐 하이라이트 포인트를 너무 못 잡아서 답답했는데, 이건 진짜 사람 편집자가 엑기스만 쏙쏙 뽑은 느낌임." },
  { name: "윤서준", rating: 5, role: "직장인 (부업)", review: "댓글 진짜 존나 웃기게 다네 ㅋㅋㅋㅋㅋ 수정이 좀 필요하긴 한데 좋아요." },
  { name: "edit_master", rating: 5, role: "영상 편집자", review: "영상 편집자 해고했습니다. 죄송합니다 ㅎ" },
  { name: "송지아", rating: 4, role: "마케터 / 대행사", review: "와 미쳤다 진짜 ㅋㅋㅋ 근데 자막 폰트 종류 좀 늘려주세요!" },
  { name: "Kevin_Park", rating: 5, role: "전업 크리에이터", review: "댓글 때문에 저작권이 안 걸려서 진짜 개미친 것 같아요… 저만 쓸래요.." },
  { name: "조민재", rating: 4, role: "영상 편집자", review: "피카클립 쓸 바엔 무조건 이거 쓰셈. 근데 AI 댓글 중에 가끔 선 넘는 드립 치는 애들 있어서 업로드 전에 한 번씩 확인은 필수임 ㅋㅋㅋ 다른 템플릿 더 많이 만들어주세요!!! 댓글 템플릿은 좋음." },
  { name: "Jason12", rating: 5, role: "직장인 (부업)", review: "쇼츠 외주 주다가 이거 쓰고 돈 굳음요; 진짜 개꿀통." },
  { name: "한동훈", rating: 5, role: "전업 크리에이터", review: "조회수 복사기임 ㄹㅇ 안 쓸 이유가 없음." },
  { name: "임지수", rating: 5, role: "전업 크리에이터", review: "이거 쓰고 첫 쇼츠 50만 찍음 ㅋㅋ 연간 결제 박습니다." },
  { name: "Ryan_Kim", rating: 5, role: "직장인 (부업)", review: "부업으로 쇼츠 채널 2개 돌리는데 달에 150씩 꼬박꼬박 꽂힘. 구독료 뽕 뽑고도 남으니까 돈 안 아까워요." },
  { name: "백승호", rating: 5, role: "직장인 (부업)", review: "알파컷 쓰다 답답해서 갈아탔는데 알고리즘 제대로 타네요. 이번 달 조회수 수익 보고 바로 직장 퇴사 마렵습니다 ㅋㅋㅋ" },
  { name: "user_9902", rating: 5, role: "마케터 / 대행사", review: "처음엔 반신반의하면서 한 달만 끊었는데, 영상 하나 터진 걸로 1년 치 구독료 한방에 회수함요. 감사해요 사장님." },
  { name: "오지훈", rating: 5, role: "전업 크리에이터", review: "편집자 동생한테 미안하지만... 걔 월급 줄 돈으로 이거 돌리니까 효율 10배는 나옴요;; 미안하다 고맙다!!!" },
  { name: "Sarah_J", rating: 5, role: "마케터 / 대행사", review: "솔직히 요즘 실시간 트렌드 바로 반영해서 템플릿 짜주는 건 반칙 아닙니까? 다른 숏폼 서비스들 긴장 좀 해야 할 듯." },
  { name: "신영우", rating: 5, role: "전업 크리에이터", review: "와 댓글 창 보고 소름 돋았네;; 이거 AI가 쓴 거 맞음? 릴스에 올렸더니 애들 진짜 사람인 줄 알고 키보드 배틀 뜨고 있음 개웃김 ㅋㅋㅋㅋ" },
  { name: "Mike_Shin", rating: 5, role: "영상 편집자", review: "실시간 인기 영상에서 하이라이트 바로 따오는 건 걍 조회수 복사하겠다는 거 아님? 개꿀통 진짜." },
  { name: "권민석", rating: 5, role: "직장인 (부업)", review: "인기 영상 베껴 만드는 거 귀찮았는데, 이건 링크 복붙하면 알아서 엑기스 다 따줌 ㄷㄷ 개이득." },
  { name: "vvd_edit", rating: 4, role: "영상 편집자", review: "실시간 인기 영상 링크 넣고 딸깍 돌리면 10분 만에 떡상용 쇼츠 나옴. 다만 트렌드 영상이라 그런지 사람 몰릴 땐 서버가 쫌 벅차하는 게 눈에 보임 ㅠ 그것만 고쳐주셈." },
  { name: "장도연", rating: 4, role: "마케터 / 대행사", review: "인기 동영상 소스로 쇼츠 양산하기 개편함. 근데 가끔 AI 댓글이 트렌드 밈을 너무 과하게 써서 뇌절할 때가 있음 ㅋㅋㅋ 그거 한두 개만 지우고 올리면 피드백 완벽함." },
  { name: "Daniel_Oh", rating: 5, role: "전업 크리에이터", review: "솔직히 이 기능은 안 유명해졌으면 좋겠음... 남들 유행 탑승하려고 대본 짜고 있을 때 난 인기 영상 주소 넣고 쇼츠 5개 뽑아서 올림 ㅋㅋㅋ 댓글 드립이 가끔 매워서 검수하긴 해야 하는데 시간 단축은 압도적." },
  { name: "황준호", rating: 5, role: "영상 편집자", review: "알파컷 피카클립 바로 유기함. 하이라이트 잡는 눈치가 다름." },
  { name: "user_3114", rating: 5, role: "직장인 (부업)", review: "유튜브 인기 영상 링크 복붙하면 1분 만에 쇼츠 뚝딱임. 트렌드 날먹 치트키 ㅋㅋㅋ" },
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

function CustomerReviews({ generatedShortCount }: { generatedShortCount: number | null }) {
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
          <div className="customer-review-count">
            <strong aria-busy={generatedShortCount === null}>{generatedShortCount === null ? "—" : <CountUpNumber value={generatedShortCount} />}</strong>
            <p>{localizedValue(locale, { ko: "지금까지 생성된 쇼츠", en: "Shorts created so far", ja: "これまでに作成したショート動画" })}</p>
          </div>
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
          <a href="#workspace">{localizedValue(locale, { ko: "지금 시작하기", en: "Get started", ja: "今すぐ始める" })}</a>
          <p><span aria-hidden="true">✓</span> {localizedValue(locale, { ko: "월 7,920원부터 시작 · 언제든 해지 가능", en: "From ₩7,920/month · Cancel anytime", ja: "月額₩7,920から・いつでも解約可能" })}</p>
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

function CommentCaptureCard({ comment }: { comment: CommentOverlay | null }) {
  return (
    <div className="h-full w-full bg-[#040404] pb-[0.6cqw] pl-[4.4cqw] pr-[2.8cqw] pt-[4.5cqw] text-left text-white">
      {comment ? <div className="flex items-start gap-[2.7cqw]">
        <div className="grid h-[8.6cqw] w-[8.6cqw] shrink-0 place-items-center rounded-full text-[3.7cqw] font-bold text-white blur-[0.65cqw]" style={{ background: comment.avatarColor }}>{comment.initial}</div>
        <div className="min-w-0 flex-1">
          <div className="w-fit max-w-[74cqw] truncate text-[3.45cqw] font-bold leading-tight text-neutral-100 blur-[0.52cqw]">@{comment.nickname} <span className="font-normal text-neutral-400">{comment.ageLabel}</span></div>
          <p className="mt-[1.5cqw] line-clamp-2 whitespace-pre-wrap font-normal leading-[1.28] text-white/95 blur-[0.05cqw]" style={{ fontSize: `${COMMENT_CAPTURE_BODY_FONT_CQW}cqw` }}>{comment.text}</p>
          <div className="mt-[2.1cqw] flex items-center gap-[1.25cqw] text-[3.4cqw] text-neutral-300/80 blur-[0.035cqw]">
            <ReactionIcon /><span>{formatCompactKoreanCount(comment.likeCount)}</span>
            <span className="ml-[2.2cqw]"><ReactionIcon down /></span>
            <span className="ml-[3cqw] text-[3.25cqw] text-neutral-200">답글</span>
          </div>
        </div>
      </div> : null}
    </div>
  );
}

function TemplatePreview({ template, videoAspectRatio, channelName, channelThumbnailUrl }: { template: (typeof templates)[number]; videoAspectRatio: VideoAspectRatio; channelName: string; channelThumbnailUrl: string | null }) {
  const [firstLine, secondLine] = template.label.split("\n");
  const isLight = template.id === "white-yellow" || template.id === "paper";
  const foreground = isLight ? "text-black" : "text-white";
  const layout = aspectLayout(videoAspectRatio, template.id === "comment-capture");
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
      <div className={`absolute inset-x-0 z-10 overflow-hidden text-[5.5cqw] font-semibold ${template.id === "paper" ? "text-neutral-700" : ""}`} style={layout.fullVertical ? { bottom: "6.25%", height: "9.375%" } : { top: `${layout.videoTop + layout.videoHeight}%`, height: `${layout.videoTop}%` }}>
        {template.id === "comment-capture"
          ? <CommentCaptureCard comment={templateCommentSample} />
          : <div className="flex items-start justify-center px-[4.9cqw] pt-[4.9cqw]"><div className="flex items-center justify-center gap-[2.4cqw] whitespace-nowrap"><ChannelAvatar url={channelThumbnailUrl} className="h-[6.1cqw] w-[6.1cqw]" fallbackForeground={template.channel} fallbackBackground={template.background} sizes="10px" /><span className="max-w-[70cqw] truncate">{channelName}</span></div></div>}
      </div>
    </div>
  );
}

function CustomHomeTemplatePreview({ template }: { template: CustomTemplate }) {
  return <CustomTemplateCanvasPreview template={template} firstLine="AI가 만든 제목" secondLine="핵심 포인트" channelLabel="채널 이름" />;
}

function TemplatePicker({ value, onChange, videoAspectRatio, onVideoAspectRatioChange, channelName, channelThumbnailUrl, personalTemplates, favoriteTemplateKeys, customTemplateId, onCustomTemplateChange, canUseCustomTemplates }: { value: TemplateId; onChange: (value: TemplateId) => void; videoAspectRatio: VideoAspectRatio; onVideoAspectRatioChange: (value: VideoAspectRatio) => void; channelName: string; channelThumbnailUrl: string | null; personalTemplates: CustomTemplate[]; favoriteTemplateKeys: TemplateFavoriteKey[]; customTemplateId: string | null; onCustomTemplateChange: (template: CustomTemplate | null) => void; canUseCustomTemplates: boolean }) {
  const usablePersonalTemplates = canUseCustomTemplates ? personalTemplates : [];
  const selectedCustom = usablePersonalTemplates.find((template) => template.id === customTemplateId);
  const selectedTemplate = templates.find((template) => template.id === value) || templates[0];
  const effectiveAspectRatio = selectedCustom?.config.video.aspectRatio ?? videoAspectRatio;
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
          <span className="text-xs font-semibold text-red-300">{selectedCustom?.name || selectedTemplate.name}</span>
        </div>
        <VideoAspectRatioPicker value={effectiveAspectRatio} lockedValue={selectedCustom?.config.video.aspectRatio} onChange={onVideoAspectRatioChange} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {favoriteCards.map((card) => {
          if (card.kind === "custom") {
            const selected = customTemplateId === card.template.id;
            return <button key={`favorite-custom-${card.template.id}`} type="button" aria-pressed={selected} onClick={() => onCustomTemplateChange(card.template)} className={`rounded-xl border-2 bg-[rgba(26,26,30,.72)] p-2.5 backdrop-blur-xl transition ${selected ? "border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]" : "border-white/10 hover:border-white/30"}`}><CustomHomeTemplatePreview template={card.template} /><span className="mt-2.5 block truncate text-center text-sm font-semibold">{card.template.name}</span><span className="mt-1 block text-center text-[10px] font-bold text-[#ff9b8d]">자주 쓰는 내 템플릿</span></button>;
          }
          const selected = !customTemplateId && value === card.template.id;
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
          const selected = customTemplateId === template.id;
          return <button key={template.id} type="button" aria-pressed={selected} onClick={() => onCustomTemplateChange(template)} className={`rounded-xl border-2 bg-[rgba(26,26,30,.72)] p-2.5 backdrop-blur-xl transition ${selected ? "border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]" : "border-white/10 hover:border-white/30"}`}><CustomHomeTemplatePreview template={template} /><span className="mt-2.5 block truncate text-center text-sm font-semibold">{template.name}</span><span className="mt-1 block text-center text-[10px] font-bold text-[#ff9b8d]">내 템플릿</span></button>;
        })}
      </div>
      {!customTemplateId && value === "comment-capture" && (
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
    if (controller.signal.aborted && !externalSignal?.aborted) {
      const locale = currentClientLocale();
      throw new Error(locale === "ko"
        ? "응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
        : messagesByLocale[locale]["error.HTTP_503"]);
    }
    throw error;
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
  onClose,
}: {
  open: boolean;
  dialogId: string;
  title: string;
  description: string;
  variant?: "danger" | "info";
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
        aria-describedby={`${dialogId}-description`}
        className={`relative w-full max-w-[480px] overflow-hidden rounded-[24px] border px-7 pb-8 pt-10 text-center shadow-[0_28px_90px_rgba(0,0,0,.68)] sm:px-9 sm:pb-9 ${info ? "border-violet-400/20 bg-[#24222b]" : "border-red-400/20 bg-[#272123]"}`}
      >
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-16 -top-24 h-40 rounded-full blur-3xl ${info ? "bg-violet-500/15" : "bg-red-500/15"}`} />
        <div aria-hidden="true" className={`relative mx-auto grid h-12 w-12 place-items-center rounded-full border text-2xl ${info ? "border-violet-300/20 bg-violet-500/10 text-violet-200" : "border-red-300/20 bg-red-500/10 text-red-200"}`}>{info ? "i" : "!"}</div>
        <h2 id={`${dialogId}-title`} className="relative mt-5 text-2xl font-extrabold tracking-[-0.025em] text-white">
          {title}
        </h2>
        <p id={`${dialogId}-description`} className={`relative mt-4 text-sm leading-6 ${info ? "text-violet-100/80" : "text-red-100/80"}`}>
          {description}
        </p>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="relative mt-8 min-h-12 w-full rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-black transition hover:bg-neutral-100 active:scale-[.99]"
        >
          확인
        </button>
      </section>
    </div>,
    document.body,
  );
}

function Editor({ item, channelThumbnailUrl, onClose, onChanged, standalone = false, projectLabel }: { item: GeneratedShort; channelThumbnailUrl: string | null; onClose: () => void; onChanged: () => Promise<void>; standalone?: boolean; projectLabel?: string }) {
  const initialTemplate = templates.find((value) => value.id === item.templateId) || templates[0];
  const initialTitleAspectRatio = item.templateId === "comment-capture" && item.videoAspectRatio === "9:16"
    ? "4:5"
    : item.videoAspectRatio || "1:1";
  const initialTitleTextStyles = item.titleTextStylesInitialized
    ? item.titleTextStyles
    : defaultTemplateTitleTextStyles(
      item.hookTitle,
      initialTitleAspectRatio,
      initialTemplate.background,
      initialTemplate.accentBackground,
    );
  const [title, setTitle] = useState(item.hookTitle);
  const [titleTextStyles, setTitleTextStyles] = useState<TitleTextStyle[]>(initialTitleTextStyles);
  const [titleSelection, setTitleSelection] = useState<{ start: number; end: number } | null>(null);
  const [titleTextColor, setTitleTextColor] = useState(initialTitleTextStyles.find((style) => style.color)?.color || "#FFFFFF");
  const [titleBackgroundColor, setTitleBackgroundColor] = useState(initialTitleTextStyles.find((style) => style.backgroundColor)?.backgroundColor || "#E32626");
  const [showAllTextColors, setShowAllTextColors] = useState(false);
  const [showAllBackgroundColors, setShowAllBackgroundColors] = useState(false);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const [channel, setChannel] = useState(item.channelDisplayName);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(item.subtitlesEnabled);
  const [segments, setSegments] = useState(item.subtitleSegments);
  const [templateId, setTemplateId] = useState(item.templateId);
  const [comments, setComments] = useState<CommentOverlay[]>(() => {
    if (item.commentOverlays?.length) return item.commentOverlays.map((comment) => ({
      ...comment,
      likeCount: Math.max(COMMENT_LIKE_COUNT_MIN, comment.likeCount),
    }));
    return item.templateId === "comment-capture" ? defaultComments(item.durationSeconds) : [];
  });
  const [titleFontScale, setTitleFontScale] = useState(item.titleFontScale || 1);
  const [cleanVideoUrl, setCleanVideoUrl] = useState<string | null>(null);
  const [videoLoadError, setVideoLoadError] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validTitle = title.trim().length > 0 && title.length <= 80 && title.split("\n").length <= 2;
  const template = templates.find((value) => value.id === templateId) || templates[0];
  const originalAspectRatio = item.videoAspectRatio || "1:1";
  const commentNeedsVerticalFit = templateId === "comment-capture" && originalAspectRatio === "9:16";
  const editorLayout = aspectLayout(originalAspectRatio, templateId === "comment-capture");
  const activeSubtitle = segments.find((segment) => segment.start <= previewTime && segment.end > previewTime)?.text;
  const orderedCommentsForPreview = [...comments].sort(
    (left, right) => left.startSeconds - right.startSeconds,
  );
  const activeComment = orderedCommentsForPreview.reduce<CommentOverlay | null>(
    (active, comment) => comment.startSeconds <= previewTime ? comment : active,
    orderedCommentsForPreview[0] || null,
  );
  const orderedComments = [...comments].sort((left, right) => left.startSeconds - right.startSeconds);
  const validComments = comments.length > 0
    && comments.every((comment) => Number.isFinite(comment.startSeconds) && Number.isFinite(comment.endSeconds) && comment.startSeconds >= 0 && comment.endSeconds > comment.startSeconds && comment.endSeconds <= item.durationSeconds + 0.001 && comment.text.trim().length > 0)
    && orderedComments.every((comment, index) => index === 0 || comment.startSeconds >= orderedComments[index - 1].endSeconds - 0.001);
  const editorValid = validTitle && (templateId === "comment-capture" ? validComments : channel.trim().length > 0);

  useEffect(() => {
    let cancelled = false;
    requestJson<{ url: string }>(`/api/shorts/${item.id}/edit-source`)
      .then((value) => { if (!cancelled) setCleanVideoUrl(value.url); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "편집용 영상을 준비하지 못했습니다."); });
    return () => { cancelled = true; };
  }, [item.id]);

  const selectTemplate = (value: TemplateId) => {
    setTemplateId(value);
    const selectedTemplate = templates.find((template) => template.id === value) || templates[0];
    const selectedTitleAspectRatio = value === "comment-capture" && originalAspectRatio === "9:16"
      ? "4:5"
      : originalAspectRatio;
    const defaultStyles = defaultTemplateTitleTextStyles(
      title,
      selectedTitleAspectRatio,
      selectedTemplate.background,
      selectedTemplate.accentBackground,
    );
    setTitleTextStyles(defaultStyles);
    const defaultBackground = defaultStyles.find((style) => style.backgroundColor)?.backgroundColor;
    if (defaultBackground) setTitleBackgroundColor(defaultBackground);
    if (value === "comment-capture" && comments.length === 0) {
      setComments(defaultComments(item.durationSeconds));
    }
  };

  const updateComment = (id: string, values: Partial<CommentOverlay>) => {
    setComments((current) => current.map((comment) => comment.id === id ? { ...comment, ...values } : comment));
  };

  const addComment = () => {
    setComments((current) => {
      if (current.length >= 20) return current;
      if (current.length === 0) return [randomComment(0, item.durationSeconds)];
      const longest = current.reduce((selected, comment) => (
        comment.endSeconds - comment.startSeconds > selected.endSeconds - selected.startSeconds ? comment : selected
      ));
      const midpoint = Math.round(((longest.startSeconds + longest.endSeconds) / 2) * 1000) / 1000;
      if (midpoint <= longest.startSeconds || midpoint >= longest.endSeconds) return current;
      return [
        ...current.map((comment) => comment.id === longest.id ? { ...comment, endSeconds: midpoint } : comment),
        randomComment(midpoint, longest.endSeconds),
      ];
    });
  };

  const captureTitleSelection = () => {
    const input = titleInputRef.current;
    if (!input || input.selectionStart === input.selectionEnd) return;
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
    if (!titleSelection) return;
    setTitleTextStyles((current) => applyTitleTextStyle(
      current,
      Array.from(title).length,
      titleSelection.start,
      titleSelection.end,
      patch,
    ));
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await requestJson(`/api/shorts/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hookTitle: title, channelDisplayName: channel, subtitlesEnabled, subtitleSegments: segments, commentOverlays: orderedComments, templateId, titleFontScale, titleTextStyles }),
      });
      await requestJson(`/api/shorts/${item.id}/rerender`, { method: "POST" });
      try {
        window.sessionStorage.setItem(
          `estimated-progress:rerender:${item.id}:${item.renderVersion}`,
          String(Date.now()),
        );
      } catch {
        // Storage can be disabled; the overlay will start when rerendering is first observed.
      }
      await onChanged();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  const editorContent = (
    <>
      {standalone && <header className="editor-topbar">
        <div className="editor-topbar-inner">
          <div className="min-w-0"><span className="editor-eyebrow">EASY CUT EDITOR</span><h1 className="truncate">{projectLabel || "쇼츠 편집"}</h1></div>
          <button type="button" onClick={onClose} className="editor-close-button" aria-label="편집기 닫기">✕ 닫기</button>
        </div>
      </header>}
      <div className={standalone ? "editor-page-body" : "grid max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[#151517] sm:grid-cols-[320px_1fr] sm:rounded-2xl"}>
        <section className={standalone ? "editor-preview-pane" : ""}>
        <div className={standalone ? "editor-video-frame" : "sticky top-0 mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden"} style={{ background: template.background, containerType: "inline-size" }}>
          <TitleOverlayPreview title={title} fontScale={titleFontScale} videoAspectRatio={commentNeedsVerticalFit ? "4:5" : originalAspectRatio} primary={template.primary} accent={template.accent} background={template.background} keepPrimaryFirstLine={template.id === "paper"} textStyles={titleTextStyles} />
          {cleanVideoUrl ? <video className={`absolute inset-x-0 w-full bg-black ${commentNeedsVerticalFit ? "object-contain" : "object-cover"}`} style={{ top: `${editorLayout.videoTop}%`, height: `${editorLayout.videoHeight}%` }} src={cleanVideoUrl} controls playsInline preload="metadata" onLoadedMetadata={() => setVideoLoadError(false)} onError={() => setVideoLoadError(true)} onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} /> : <div className="absolute inset-x-0 flex items-center justify-center bg-black/50 text-sm text-neutral-400" style={{ top: `${editorLayout.videoTop}%`, height: `${editorLayout.videoHeight}%` }}>클린 영상 준비 중</div>}
          {videoLoadError && <div className="pointer-events-none absolute inset-x-3 z-30 rounded bg-red-950/90 px-3 py-2 text-center text-xs font-semibold text-red-100" style={{ top: `${editorLayout.videoTop + 2}%` }}>편집용 영상을 재생하지 못했습니다. 잠시 후 다시 열어 주세요.</div>}
          {subtitlesEnabled && activeSubtitle && <div className="pointer-events-none absolute inset-x-5 z-20 rounded bg-black/75 px-2 py-1 text-center text-xs font-bold text-white" style={{ bottom: `${editorLayout.subtitleBottom}%` }}>{activeSubtitle}</div>}
          <div className={`absolute inset-x-0 z-10 overflow-hidden text-sm font-bold ${templateId === "comment-capture" ? "" : editorLayout.fullVertical ? "pt-5" : "pt-[4.4%]"}`} style={{ top: editorLayout.fullVertical ? "84.375%" : `${editorLayout.videoTop + editorLayout.videoHeight}%`, height: editorLayout.fullVertical ? "9.375%" : `${editorLayout.videoTop}%`, background: editorLayout.fullVertical && templateId !== "comment-capture" ? "transparent" : template.background, color: template.channel }}>
            {templateId === "comment-capture"
              ? <CommentCaptureCard comment={activeComment} />
              : <div className="flex items-start justify-center gap-2"><ChannelAvatar url={channelThumbnailUrl} className="mt-0.5 h-5 w-5" fallbackForeground={template.channel} fallbackBackground={template.background} sizes="20px" /><span className="max-w-[72%] truncate">{channel}</span></div>}
          </div>
        </div>
        </section>
        <section className={standalone ? "editor-controls-pane" : "p-5 sm:p-6"}>
          <div className="flex items-center justify-between"><div><h2 id="editor-title" className="text-xl font-bold">쇼츠 편집</h2><p className="mt-1 text-xs text-neutral-500">왼쪽 미리보기에서 변경 내용을 실시간으로 확인하세요.</p></div>{!standalone && <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:bg-white/10">닫기</button>}</div>
          <label className="editor-section editor-section-heading block font-semibold">후킹 제목<textarea ref={titleInputRef} value={title} onChange={(event) => { setTitle(event.target.value); setTitleTextStyles([]); setTitleSelection(null); }} onSelect={captureTitleSelection} onDoubleClick={captureTitleSelection} maxLength={80} rows={2} className="mt-2 w-full rounded-lg border border-white/15 bg-black/30 p-3 text-sm" /></label>
          <p className={`mt-1 text-xs ${validTitle ? "text-neutral-500" : "text-red-400"}`}>최대 2줄·80자 ({title.length}/80)</p>
          <div className="editor-section">
            <h3 className="text-sm font-semibold">제목 스타일</h3>
            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs leading-5 text-neutral-400">제목에서 원하는 글자를 더블클릭하거나 드래그해 선택한 뒤 색상을 변경하세요.</p>
            <p className={`mt-2 truncate rounded-lg px-2.5 py-2 text-xs ${titleSelection ? "bg-white/10 text-white" : "bg-white/[.04] text-neutral-500"}`}>
              {titleSelection ? `선택: ${Array.from(title).slice(titleSelection.start, titleSelection.end).join("")}` : "선택된 글자가 없습니다."}
            </p>
            <div className="mt-3 grid grid-cols-2 items-start gap-5">
              <fieldset disabled={!titleSelection}>
                <legend className="sr-only">글자색</legend>
                <div className="flex items-center justify-between gap-3"><span className={`text-xs font-semibold ${titleSelection ? "text-neutral-200" : "text-neutral-600"}`}>글자색</span></div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(showAllTextColors ? titleTextColorOptions : titleTextColorOptions.slice(0, 3)).map((option) => <button key={option.color} type="button" aria-label={`글자색 ${option.name}`} title={option.name} aria-pressed={titleTextColor === option.color} onClick={() => { setTitleTextColor(option.color); updateSelectedTitleStyle({ color: option.color }); }} className={`h-8 w-8 rounded-full border border-white/20 transition disabled:cursor-not-allowed disabled:opacity-30 ${titleTextColor === option.color ? "ring-2 ring-[#ff715e] ring-offset-2 ring-offset-[#111113]" : "hover:scale-105 hover:border-white/50"}`} style={{ background: option.color }} />)}
                  <button type="button" aria-label={showAllTextColors ? "글자색 접기" : "글자색 전체 보기"} title={showAllTextColors ? "접기" : "전체 보기"} aria-expanded={showAllTextColors} onClick={() => setShowAllTextColors((current) => !current)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#353438] text-base font-medium text-neutral-200 transition hover:border-white/40 hover:bg-[#454449] disabled:cursor-not-allowed disabled:opacity-30">{showAllTextColors ? "−" : "+"}</button>
                </div>
              </fieldset>
              <fieldset disabled={!titleSelection}>
                <legend className="sr-only">텍스트 배경색</legend>
                <div className="flex items-center justify-between gap-3"><span className={`text-xs font-semibold ${titleSelection ? "text-neutral-200" : "text-neutral-600"}`}>텍스트 배경색</span></div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" aria-label="텍스트 배경색 없음" title="없음" onClick={() => updateSelectedTitleStyle({ backgroundColor: null })} className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-white/35 bg-white/[.03] text-[8px] font-bold text-neutral-400 transition hover:border-white/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">없음</button>
                  {(showAllBackgroundColors ? titleBackgroundColorOptions : titleBackgroundColorOptions.slice(0, 2)).map((option) => <button key={option.color} type="button" aria-label={`텍스트 배경색 ${option.name}`} title={option.name} aria-pressed={titleBackgroundColor === option.color} onClick={() => { setTitleBackgroundColor(option.color); updateSelectedTitleStyle({ backgroundColor: option.color }); }} className={`h-8 w-8 rounded-full border border-white/20 transition disabled:cursor-not-allowed disabled:opacity-30 ${titleBackgroundColor === option.color ? "ring-2 ring-[#ff715e] ring-offset-2 ring-offset-[#111113]" : "hover:scale-105 hover:border-white/50"}`} style={{ background: option.color }} />)}
                  <button type="button" aria-label={showAllBackgroundColors ? "텍스트 배경색 접기" : "텍스트 배경색 전체 보기"} title={showAllBackgroundColors ? "접기" : "전체 보기"} aria-expanded={showAllBackgroundColors} onClick={() => setShowAllBackgroundColors((current) => !current)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#353438] text-base font-medium text-neutral-200 transition hover:border-white/40 hover:bg-[#454449] disabled:cursor-not-allowed disabled:opacity-30">{showAllBackgroundColors ? "−" : "+"}</button>
                </div>
              </fieldset>
            </div>
            </div>
          </div>
          <label className="editor-section editor-section-heading block font-semibold"><span className="flex items-center justify-between"><span>제목 글자 크기</span><strong className="text-sm text-red-300">{Math.round(titleFontScale * 100)}%</strong></span><input aria-label="제목 글자 크기" type="range" min={0.8} max={1.2} step={0.05} value={titleFontScale} onChange={(event) => setTitleFontScale(Number(event.target.value))} className="mt-3 w-full accent-red-500" /></label>
          {templateId !== "comment-capture" && <label className="editor-section block text-sm font-semibold">채널명<input value={channel} onChange={(event) => setChannel(event.target.value)} maxLength={50} className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3" /></label>}
          <label className="hidden"><input type="checkbox" checked={subtitlesEnabled} onChange={(event) => setSubtitlesEnabled(event.target.checked)} />자동 자막 표시</label>
          {subtitlesEnabled && <div className="hidden">{segments.map((segment, index) => <label key={`${segment.start}-${index}`}><span>{formatTimestamp(segment.start)}</span><input value={segment.text} onChange={(event) => setSegments((current) => current.map((value, position) => position === index ? { ...value, text: event.target.value } : value))} /></label>)}</div>}
          <div className="editor-section"><div className="mb-3 flex items-end justify-between"><div><h3 className="text-sm font-semibold">템플릿</h3><p className="mt-1 text-xs text-neutral-500">최종 영상의 제목·영상·하단 구성을 미리 확인하세요.</p></div><span className="text-xs font-semibold text-red-300">{template.name}</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{templates.map((value) => <button key={value.id} type="button" aria-pressed={templateId === value.id} onClick={() => selectTemplate(value.id)} className={`rounded-xl border-2 p-2 transition ${templateId === value.id ? "border-red-500 bg-red-500/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}><TemplatePreview template={value} videoAspectRatio={item.videoAspectRatio || "1:1"} channelName={channel} channelThumbnailUrl={channelThumbnailUrl} /><span className="mt-2 block text-center text-xs font-semibold">{value.name}</span></button>)}</div></div>
          {templateId === "comment-capture" && <section className="editor-section">
            <div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-bold">시간별 댓글</h3><p className="mt-1 text-xs leading-5 text-neutral-500">각 구간에는 댓글 하나만 표시됩니다. 새 댓글의 랜덤 정보는 저장 후에도 유지됩니다.</p></div><button type="button" disabled={comments.length >= 20} onClick={addComment} className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold disabled:opacity-40">+ 댓글 추가</button></div>
            <div className="mt-4 space-y-3">
              {orderedComments.map((comment, index) => <article key={comment.id} className="rounded-lg border border-white/10 bg-[#101012] p-3">
                <div className="flex items-center justify-between gap-3"><strong className="text-xs text-neutral-300">댓글 {index + 1}</strong><button type="button" onClick={() => setComments((current) => current.filter((value) => value.id !== comment.id))} className="text-xs font-semibold text-red-300 hover:text-red-200">삭제</button></div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-xs text-neutral-400">시작(초)<input aria-label={`댓글 ${index + 1} 시작 시간`} type="number" min={0} max={item.durationSeconds} step={0.1} value={comment.startSeconds} onChange={(event) => updateComment(comment.id, { startSeconds: Number(event.target.value) })} className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30 px-2 text-sm text-white" /></label>
                  <label className="text-xs text-neutral-400">종료(초)<input aria-label={`댓글 ${index + 1} 종료 시간`} type="number" min={0} max={item.durationSeconds} step={0.1} value={comment.endSeconds} onChange={(event) => updateComment(comment.id, { endSeconds: Number(event.target.value) })} className="mt-1 h-9 w-full rounded border border-white/10 bg-black/30 px-2 text-sm text-white" /></label>
                </div>
                <label className="mt-3 block text-xs text-neutral-400">댓글 내용<textarea aria-label={`댓글 ${index + 1} 내용`} value={comment.text} maxLength={200} rows={2} onChange={(event) => updateComment(comment.id, { text: event.target.value })} className="mt-1 w-full rounded border border-white/10 bg-black/30 p-2 text-sm text-white" /></label>
                <div className="mt-3 aspect-[5/1] overflow-hidden border border-white/5" style={{ containerType: "inline-size" }}><CommentCaptureCard comment={comment} /></div>
              </article>)}
            </div>
            {!validComments && <p className="mt-3 text-xs leading-5 text-red-400">댓글을 하나 이상 두고, 텍스트와 시간이 비어 있거나 서로 겹치지 않도록 조정해 주세요. 최대 길이는 {item.durationSeconds.toFixed(1)}초입니다.</p>}
          </section>}
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={onClose} className="h-11 rounded-lg border border-white/15 px-4 text-sm font-semibold">변경 취소</button><button disabled={!editorValid || saving} onClick={() => void save()} className="h-11 rounded-lg bg-white px-4 text-sm font-bold text-black disabled:opacity-40">{saving ? "처리 중..." : "영상에 적용"}</button></div>
        </section>
      </div>
    </>
  );

  if (standalone) return <main className="editor-page" aria-labelledby="editor-title">{editorContent}</main>;
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="editor-title">{editorContent}</div>;
}

function ProjectWorkspace({ job, onBack }: { job: VideoJob; onBack: () => void }) {
  const [accessUrls, setAccessUrls] = useState<Record<string, string>>({});
  const requestedAccessVersions = useRef(new Set<string>());
  const mounted = useRef(true);
  const selected = job.shorts[0];

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    for (const item of job.shorts.filter(isPlaybackAvailable)) {
      const accessVersion = shortPlaybackVersionKey(item);
      if (requestedAccessVersions.current.has(accessVersion)) continue;
      requestedAccessVersions.current.add(accessVersion);
      void requestJson<{ url: string }>(`/api/shorts/${item.id}/access`)
        .then((value) => {
          if (!mounted.current) return;
          setAccessUrls((current) => current[accessVersion]
            ? current
            : { ...current, [accessVersion]: value.url });
        })
        .catch(() => requestedAccessVersions.current.delete(accessVersion));
    }
  }, [job.shorts]);

  const playbackUrl = (item: GeneratedShort) => isPlaybackAvailable(item)
    ? accessUrls[shortPlaybackVersionKey(item)] || null
    : null;

  const download = async (item: GeneratedShort) => {
    if (item.status !== "ready") return;
    const url = playbackUrl(item);
    if (!url) return;
    const response = await fetch(url);
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${item.hookTitle.replace(/[^0-9A-Za-z가-힣 _-]/g, "").trim() || "shorts"}.mp4`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
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
  return (
    <div className="project-workspace">
      <header className="workspace-header">
        <div className="min-w-0"><button onClick={onBack} className="text-xs font-semibold text-neutral-400 hover:text-white">← 프로젝트 /{job.projectNumber}</button><div className="mt-1 flex min-w-0 items-center gap-3"><h1 className="truncate text-base font-bold">{job.videoTitle}</h1>{job.isExample && <span className="shrink-0 rounded bg-red-500/15 px-2 py-1 text-[11px] font-extrabold text-red-300">예시 작업 · 읽기 전용</span>}<span className="shrink-0 text-xs text-neutral-500">쇼츠 {job.shorts.length}개</span></div></div>
        <button onClick={() => void Promise.all(job.shorts.map(download))} className="workspace-button workspace-button-primary shrink-0">↓ 모든 쇼츠 다운로드</button>
      </header>
      {job.status === "failed" && job.errorMessage && (
        <div role="alert" className="mx-4 mt-4 whitespace-pre-line rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-200 sm:mx-6">
          {job.errorMessage}
        </div>
      )}
      <main className="short-results-workspace">
        <div className="short-results-list">
          {job.shorts.map((item, index) => {
            const itemUrl = playbackUrl(item);
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
                      {itemUrl ? <video key={shortPlaybackVersionKey(item)} src={itemUrl} controls={!itemIsRerendering} playsInline preload="metadata" className={itemIsRerendering ? "grayscale" : ""} /> : <div className="short-video-placeholder">영상 준비 중</div>}
                      <span className="short-duration-badge">{formatDuration(item.durationSeconds)}</span>
                      {itemIsRerendering && <EstimatedProcessingOverlay operationKey={`rerender:${item.id}:${item.renderVersion}`} durationSeconds={item.durationSeconds} rerender />}
                    </div>
                    <div className="short-result-actions">
                      {job.isExample || itemIsRerendering
                        ? <button disabled title={job.isExample ? "예시 작업은 편집할 수 없습니다." : undefined} className="tool-button short-edit-button cursor-not-allowed opacity-40">✎ 편집하기</button>
                        : <Link href={`/${job.projectNumber}/edit/${item.id}`} target="_blank" rel="noopener noreferrer" className="tool-button short-edit-button flex items-center justify-center" aria-label={`${item.hookTitle} 새 탭에서 편집하기`}>✎ 편집하기</Link>}
                      <button disabled={!itemUrl || itemIsRerendering} onClick={() => void download(item)} className="tool-button short-download-button disabled:opacity-40">↓ 다운로드</button>
                    </div>
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

export function ShortEditorPage({ projectNumber, shortId }: { projectNumber: number; shortId: string }) {
  const [project, setProject] = useState<VideoJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadProject = useCallback(async () => {
    try {
      const value = await requestJson<{ project: VideoJob }>(`/api/projects/${projectNumber}`, undefined, 12_000);
      setProject(value.project);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "편집할 쇼츠를 불러오지 못했습니다.");
    }
  }, [projectNumber]);

  useEffect(() => { void loadProject(); }, [loadProject]);
  const item = project?.shorts.find((value) => value.id === shortId);
  const closeEditor = () => {
    window.close();
    window.setTimeout(() => { if (!window.closed) window.location.href = `/${projectNumber}`; }, 100);
  };

  if (error) return <main className="editor-page grid place-items-center p-6 text-center"><div><h1 className="text-lg font-bold">편집기를 열 수 없습니다.</h1><p className="mt-3 text-sm text-red-300">{error}</p><Link href={`/${projectNumber}`} className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-black">프로젝트로 돌아가기</Link></div></main>;
  if (!project) return <main className="editor-page grid place-items-center text-sm text-neutral-400">편집기를 준비하고 있습니다…</main>;
  if (!item || project.isExample) return <main className="editor-page grid place-items-center p-6 text-center"><div><h1 className="text-lg font-bold">편집할 수 없는 쇼츠입니다.</h1><Link href={`/${projectNumber}`} className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-black">프로젝트로 돌아가기</Link></div></main>;

  return <Editor item={item} channelThumbnailUrl={project.channelThumbnailUrl} standalone projectLabel={`프로젝트 /${project.projectNumber} · ${item.hookTitle}`} onClose={closeEditor} onChanged={loadProject} />;
}

export function ProjectPage({ projectNumber }: { projectNumber: number }) {
  const [project, setProject] = useState<VideoJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    try {
      const value = await requestJson<{ project: VideoJob }>(
        `/api/projects/${projectNumber}`,
        undefined,
        12_000,
      );
      setProject(value.project);
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "프로젝트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [projectNumber]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

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

  return <ProjectWorkspace job={project} onBack={returnToProjects} />;
}

function initialActiveJob(state: MvpState | null) {
  if (!state) return null;
  const running = state.recentJobs.find((job) => !terminalStatuses.has(job.status));
  const rerendering = state.recentJobs.find((job) => (
    job.shorts.some((item) => item.status === "rerendering")
  ));
  return running || rerendering || state.recentJobs[0] || null;
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
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("ko");
  const [templateId, setTemplateId] = useState<TemplateId>("comment-capture");
  const [customTemplateId, setCustomTemplateId] = useState<string | null>(null);
  const [personalTemplates, setPersonalTemplates] = useState<CustomTemplate[]>([]);
  const [favoriteTemplateKeys, setFavoriteTemplateKeys] = useState<TemplateFavoriteKey[]>([...DEFAULT_FAVORITE_TEMPLATE_KEYS]);
  const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>("5:4");
  const [activeJob, setActiveJob] = useState<VideoJob | null>(() => initialActiveJob(initialState));
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginNext, setLoginNext] = useState("/");
  const [loginPromptPending, setLoginPromptPending] = useState(false);
  const [creationRestrictionOpen, setCreationRestrictionOpen] = useState(false);
  const [creationRestrictionReason, setCreationRestrictionReason] = useState<string | null>(null);
  const [concurrentJobNoticeOpen, setConcurrentJobNoticeOpen] = useState(false);
  const [scrollToAnalysis, setScrollToAnalysis] = useState(false);
  const [scrollToProjects, setScrollToProjects] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollStarted = useRef(0);
  const loginOpenTimer = useRef<number | null>(null);
  const stateLoadInFlight = useRef<Promise<void> | null>(null);
  const analysisSectionRef = useRef<HTMLElement>(null);
  const projectsSectionRef = useRef<HTMLElement>(null);
  const activeJobId = activeJob?.id;
  const activeJobStatus = activeJob?.status;
  const activeJobHasRerendering = Boolean(activeJob?.shorts.some((item) => item.status === "rerendering"));
  const hasBackgroundWork = Boolean(state?.recentJobs.some((job) => !terminalStatuses.has(job.status) || job.shorts.some((item) => item.status === "rerendering")));
  const analysisCreationBlocked = Boolean(analysis && analysis.creationAllowed !== true);
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
      setStateLoadError(cause instanceof Error ? cause.message : "프로젝트를 불러오지 못했습니다.");
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
        setError(cause instanceof Error ? cause.message : "템플릿을 불러오지 못했습니다.");
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
        setStateLoadError(cause instanceof Error ? cause.message : "프로젝트를 불러오지 못했습니다.");
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
    if (!authError) return;
    setError(localizeAuthError(authError, locale));
    url.searchParams.delete("auth_error");
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
        setCreationRestrictionReason(
          value.creationAllowed ? null : value.creationBlockReason || "이 영상은 이용 제한이 확인된 영상입니다.",
        );
        setCreationRestrictionOpen(value.creationAllowed !== true);
        setScrollToAnalysis(true);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "인기 영상 정보를 불러오지 못했습니다."))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!scrollToAnalysis || !analysis) return;
    let scrollFrame = 0;
    const layoutFrame = window.requestAnimationFrame(() => {
      scrollFrame = window.requestAnimationFrame(() => {
        const section = analysisSectionRef.current;
        if (section) {
          const headerHeight = document.querySelector<HTMLElement>(".site-header")?.getBoundingClientRect().height || 0;
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
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "작업 상태 확인 실패"); }
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
      void loadState().catch((cause) => setError(cause instanceof Error ? cause.message : "작업 상태 확인 실패"));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [hasBackgroundWork, loadState]);

  const pasteYoutubeUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("클립보드에 붙여넣을 텍스트가 없습니다.");
      setYoutubeUrl(text.trim());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "클립보드를 읽지 못했습니다.");
    }
  };

  const analyze = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setCreationRestrictionOpen(false);
    setCreationRestrictionReason(null);
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
      setScrollToAnalysis(true);
    }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "영상 확인 실패";
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
    const next = `/?analysisId=${encodeURIComponent(analysis.analysisId)}`;
    if (!state?.user) {
      openLoginAfterDelay(next);
      return;
    }
    if (state.usage.enforcementEnabled && !state.billing.canCreateJobs) {
      window.location.href = "/pricing";
      return;
    }
    if (activeJobBlocksCreation) {
      setConcurrentJobNoticeOpen(true);
      return;
    }
    setBusy(true); setError(null);
    try {
      const value = await requestJson<{ jobId: string; projectNumber: number; usage: UsageSnapshot }>("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId: analysis.analysisId, templateId, customTemplateId: canUseCustomTemplates ? customTemplateId : null, videoAspectRatio: effectiveVideoAspectRatio, outputLanguage, requestId: crypto.randomUUID() }) });
      const pendingJob: VideoJob = { id: value.jobId, projectNumber: value.projectNumber, isExample: false, videoTitle: analysis.title, channelName: analysis.channelName, channelThumbnailUrl: analysis.channelThumbnailUrl, thumbnailUrl: analysis.thumbnailUrl, sourceDurationSeconds: analysis.durationSeconds, outputLanguage, expectedShortCount: analysis.expectedShortCount, plannedShortCount: analysis.expectedShortCount, readyShortCount: 0, failedShortCount: 0, renderSuccessPercent: null, status: "queued", stage: "queued", progress: SIMULATED_PROGRESS_START, stageCompletedCount: 0, stageTotalCount: 0, errorMessage: null, createdAt: new Date().toISOString(), expiresAt: null, shorts: [] };
      setState((current) => current ? { ...current, usage: value.usage, recentJobs: [pendingJob, ...current.recentJobs.filter((job) => job.id !== pendingJob.id)] } : current);
      publishUsageSnapshot(value.usage);
      setActiveJob(pendingJob);
      setScrollToProjects(true);
      pollStarted.current = Date.now();
      setYoutubeUrl("");
      setAnalysis(null);
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
        setError(cause instanceof Error ? cause.message : "작업 생성 실패");
      }
    }
    finally { setBusy(false); }
  };

  return (
    <div className="app-shell site-chrome flex min-h-screen flex-col text-neutral-100">
      <div className="ambient ambient-coral" aria-hidden="true" />
      <div className="ambient ambient-violet" aria-hidden="true" />
      <SiteHeader><AuthControls user={state?.user || null} next={loginNext} loginOpen={loginOpen} onLoginOpenChange={setLoginOpen} /></SiteHeader>
      <NoticeDialog
        open={creationRestrictionOpen && Boolean(creationRestrictionReason)}
        dialogId="creation-restriction"
        title="영상 이용 제한 안내"
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
      <main id="top" className="relative mx-auto w-full max-w-6xl flex-1 space-y-10 px-5 pb-20 pt-7 sm:px-8 sm:pt-10">
      <section className="hero mx-auto flex max-w-4xl flex-col items-center text-center">
        <h1 className="hero-title">{t("home.heroLine1")}<br /><span>{t("home.heroLine2")}</span></h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-[#d5aaa4] sm:text-base">{t("home.heroDescription")}</p>
        <form id="workspace" onSubmit={analyze} className="url-console mt-10 w-full max-w-3xl">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-4 flex items-center text-xl text-[#d7aaa4]" aria-hidden="true">↗</span>
            <input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder={t("home.youtubePlaceholder")} className="url-input" aria-label={t("home.youtubeLabel")} />
            <button type="button" onClick={() => void pasteYoutubeUrl()} className="paste-button" aria-label={t("home.pasteLabel")} title={t("home.paste")}><svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="M9 5.5h6M9.5 3h5a1 1 0 0 1 1 1v3h-7V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 5H6.75A1.75 1.75 0 0 0 5 6.75v12.5C5 20.216 5.784 21 6.75 21h10.5A1.75 1.75 0 0 0 19 19.25V6.75A1.75 1.75 0 0 0 17.25 5H16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
          </div>
          <button disabled={busy} className="ai-button">{busy ? t("home.checking") : t("home.convert")}<span aria-hidden="true">✦</span></button>
        </form>
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
      {analysis && <section id="shorts-settings" ref={analysisSectionRef} className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#141416] p-5 sm:scroll-mt-28"><label htmlFor="output-language" className="text-xl font-bold">{t("home.outputLanguage")}</label><p className="mt-1 text-sm text-neutral-500">{t("home.outputLanguageDescription")}</p><select id="output-language" value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value as OutputLanguage)} className="mt-3 h-12 w-full rounded-xl border border-white/10 bg-[#141416] px-4 text-sm text-neutral-100 outline-none focus:border-red-500 sm:max-w-xs">{outputLanguageOptions.map((option) => <option key={option.code} value={option.code}>{outputLanguageName(option.code, locale)}</option>)}</select></section>}
      {analysis && <section className="scroll-mt-24 space-y-8 sm:scroll-mt-28"><div className="overflow-hidden rounded-2xl border border-white/10 bg-[#141416] sm:flex"><Image src={analysis.thumbnailUrl} alt="영상 썸네일" width={480} height={270} unoptimized className="aspect-video w-full object-cover sm:w-72" /><div className="p-5"><h2 className="text-lg font-bold">{analysis.title}</h2><p className="mt-2 text-sm text-neutral-400">{analysis.channelName}</p><p className="mt-4 text-sm">원본 영상 {formatDuration(analysis.durationSeconds)} · 예상 쇼츠 {analysis.expectedShortCount}개</p><p className="mt-1 text-xs text-neutral-500">{planEnforcementEnabled ? `전체 영상 길이 ${formatDuration(analysis.durationSeconds)}가 사용량으로 계산됩니다.` : "현재는 플랜 처리시간 차감 없이 생성됩니다."}</p></div></div><TemplatePicker value={templateId} onChange={setTemplateId} videoAspectRatio={effectiveVideoAspectRatio} onVideoAspectRatioChange={setVideoAspectRatio} channelName={analysis.channelName} channelThumbnailUrl={analysis.channelThumbnailUrl} personalTemplates={personalTemplates} favoriteTemplateKeys={favoriteTemplateKeys} customTemplateId={canUseCustomTemplates ? customTemplateId : null} canUseCustomTemplates={canUseCustomTemplates} onCustomTemplateChange={(template) => { setCustomTemplateId(template?.id || null); if (template) { setTemplateId(template.baseTemplateId); setVideoAspectRatio(template.config.video.aspectRatio); } }} />{analysisCreationBlocked && <button type="button" onClick={() => { setCreationRestrictionReason(analysis.creationBlockReason || "영상 이용 제한을 확인했습니다."); setCreationRestrictionOpen(true); }} className="min-h-11 w-full rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100 transition hover:bg-red-500/15">생성 불가 사유 보기</button>}<button disabled={analysisCreationBlocked || busy || stateLoadStatus !== "ready"} onClick={() => void createJob()} aria-busy={loginPromptPending} className={`h-[52px] w-full rounded-xl py-4 font-bold text-black transition duration-150 disabled:bg-neutral-800 disabled:text-neutral-500 ${loginPromptPending ? "scale-[.985] bg-neutral-200 shadow-[inset_0_2px_6px_rgba(0,0,0,.22)] motion-reduce:transform-none" : "bg-white hover:bg-neutral-100 active:scale-[.985]"}`}><span className="inline-flex items-center justify-center gap-2">{loginPromptPending && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-black/25 border-t-black motion-reduce:animate-none" />}{analysisCreationBlocked ? t("home.createUnavailable") : stateLoadStatus !== "ready" ? t("home.loginChecking") : !state?.user ? t("home.create") : !planEnforcementEnabled || state.billing.canCreateJobs ? t("home.create") : t("home.choosePlan")}</span></button></section>}
      <ThreeStepProcess />
      <CustomerReviews generatedShortCount={state?.generatedShortCount ?? null} />
    </main>
    <SiteFooter />
    </div>
  );
}
