"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { GeneratedShort, TemplateId, VideoJob } from "@/lib/contracts";
import type { SiteLocale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

const SOURCE_END_MS = 600;
const DISCOVERY_END_MS = 2_400;
const CARDS_END_MS = 3_400;
const FINISH_HOLD_MS = 550;

type AssemblyStep = "title" | "reason" | "subtitle" | "comment" | "template" | "complete";
type PlaybackAsset = { url: string | null; posterUrl: string | null };

const projectRevealCopy: Record<SiteLocale, {
  assemblyComplete: string;
  assemblyWithComment: string;
  assemblyWithScript: string;
  timeline: string;
  shortRange: (index: number, start: string, end: string) => string;
  sourceExpanding: string;
  checkingRanges: (visible: number, total: number) => string;
  rangesComplete: string;
  discoveredShorts: string;
  completedVideo: (title: string) => string;
  connectingVideo: string;
  seconds: (seconds: number) => string;
  actualVideo: (title: string) => string;
  connectingActualVideo: string;
  defaultReason: string;
  silentScene: string;
  noScript: string;
  noComments: string;
  hookTitle: string;
  selectionReason: string;
  subtitleTiming: string;
  commentOverlay: string;
  fullScript: string;
  aiHighlight: string;
  subtitleTimingSetup: string;
  dialog: string;
  viewResults: string;
  discoveredCount: (count: number) => string;
  discovered: string;
  shortComplete: string;
  thumbnail: (title: string) => string;
  sourceVideo: string;
  completedCount: (count: number) => string;
}> = {
  ko: {
    assemblyComplete: "완성 영상을 확인했습니다", assemblyWithComment: "제목·이유·자막·댓글을 함께 구성하고 있습니다", assemblyWithScript: "제목·이유·자막·스크립트를 함께 구성하고 있습니다",
    timeline: "원본 영상 타임라인", shortRange: (index, start, end) => `쇼츠 ${index}: ${start}부터 ${end}까지`,
    sourceExpanding: "원본 영상 구조를 펼치고 있습니다", checkingRanges: (visible, total) => `${visible} / ${total} 구간을 확인하고 있습니다`, rangesComplete: "구간 확인을 완료했습니다",
    discoveredShorts: "발견된 쇼츠", completedVideo: (title) => `${title} 완성 영상`, connectingVideo: "완성 영상 연결 중", seconds: (seconds) => `${seconds}초`,
    actualVideo: (title) => `${title} 실제 완성 영상`, connectingActualVideo: "실제 완성 영상을 연결하고 있습니다",
    defaultReason: "시청 흐름에서 핵심이 되는 장면을 쇼츠 구간으로 선정했습니다.", silentScene: "대사가 없는 장면의 영상 흐름을 유지했습니다.", noScript: "추출된 스크립트가 없습니다.", noComments: "이 템플릿은 댓글 오버레이를 사용하지 않습니다.",
    hookTitle: "후킹 제목", selectionReason: "선정 이유", subtitleTiming: "자막 타이밍", commentOverlay: "댓글 오버레이", fullScript: "전체 스크립트", aiHighlight: "✦ AI 하이라이트", subtitleTimingSetup: "자막 타이밍 구성",
    dialog: "쇼츠 제작 결과 공개", viewResults: "바로 결과 보기", discoveredCount: (count) => `${count}개의 쇼츠 구간을`, discovered: "발견했습니다", shortComplete: "쇼츠 완성",
    thumbnail: (title) => `${title} 유튜브 썸네일`, sourceVideo: "원본 영상", completedCount: (count) => `${count}개의 쇼츠가 완성됐습니다`,
  },
  en: {
    assemblyComplete: "Finished video checked", assemblyWithComment: "Assembling the title, reason, captions, and comments", assemblyWithScript: "Assembling the title, reason, captions, and script",
    timeline: "Source video timeline", shortRange: (index, start, end) => `Short ${index}: ${start} to ${end}`,
    sourceExpanding: "Mapping the source video", checkingRanges: (visible, total) => `Checking segment ${visible} of ${total}`, rangesComplete: "Segment check complete",
    discoveredShorts: "Discovered Shorts", completedVideo: (title) => `Completed video: ${title}`, connectingVideo: "Connecting completed video", seconds: (seconds) => `${seconds} sec`,
    actualVideo: (title) => `Finished video: ${title}`, connectingActualVideo: "Connecting the finished video",
    defaultReason: "This key moment was selected as a Shorts segment based on the viewing flow.", silentScene: "The visual flow of this scene was preserved because it has no dialogue.", noScript: "No script was extracted.", noComments: "This template does not use a comment overlay.",
    hookTitle: "Hook title", selectionReason: "Selection reason", subtitleTiming: "Caption timing", commentOverlay: "Comment overlay", fullScript: "Full script", aiHighlight: "✦ AI highlight", subtitleTimingSetup: "Caption timing",
    dialog: "Shorts creation results", viewResults: "View results now", discoveredCount: (count) => `${count} Shorts segments`, discovered: "discovered", shortComplete: "Short complete",
    thumbnail: (title) => `YouTube thumbnail for ${title}`, sourceVideo: "source video", completedCount: (count) => `${count} Shorts are ready`,
  },
  ja: {
    assemblyComplete: "完成動画を確認しました", assemblyWithComment: "タイトル・理由・字幕・コメントを構成しています", assemblyWithScript: "タイトル・理由・字幕・スクリプトを構成しています",
    timeline: "元動画のタイムライン", shortRange: (index, start, end) => `ショート${index}: ${start}から${end}まで`,
    sourceExpanding: "元動画の構成を展開しています", checkingRanges: (visible, total) => `${total}件中${visible}件の区間を確認しています`, rangesComplete: "区間の確認が完了しました",
    discoveredShorts: "見つかったショート動画", completedVideo: (title) => `${title}の完成動画`, connectingVideo: "完成動画に接続中", seconds: (seconds) => `${seconds}秒`,
    actualVideo: (title) => `${title}の実際の完成動画`, connectingActualVideo: "実際の完成動画に接続しています",
    defaultReason: "視聴の流れで重要となる場面をショート動画区間として選びました。", silentScene: "セリフのない場面の映像の流れを維持しました。", noScript: "抽出されたスクリプトはありません。", noComments: "このテンプレートはコメントオーバーレイを使用しません。",
    hookTitle: "フックタイトル", selectionReason: "選定理由", subtitleTiming: "字幕タイミング", commentOverlay: "コメントオーバーレイ", fullScript: "全スクリプト", aiHighlight: "✦ AIハイライト", subtitleTimingSetup: "字幕タイミングの構成",
    dialog: "ショート動画作成結果", viewResults: "結果をすぐ見る", discoveredCount: (count) => `${count}件のショート区間を`, discovered: "見つけました", shortComplete: "ショート完成",
    thumbnail: (title) => `${title}のYouTubeサムネイル`, sourceVideo: "元動画", completedCount: (count) => `${count}件のショート動画が完成しました`,
  },
};

const templateLooks: Record<TemplateId, {
  name: string;
  background: string;
  foreground: string;
  accent: string;
}> = {
  "comment-capture": {
    name: "댓글 캡처",
    background: "#040404",
    foreground: "#ffffff",
    accent: "#35e6e3",
  },
  "dark-red": {
    name: "다크 레드",
    background: "#050505",
    foreground: "#ffffff",
    accent: "#e32626",
  },
  "white-yellow": {
    name: "화이트 옐로",
    background: "#f8f8f4",
    foreground: "#111111",
    accent: "#ffd84d",
  },
  "dark-minimal": {
    name: "다크 미니멀",
    background: "#050505",
    foreground: "#ffffff",
    accent: "#f04444",
  },
  paper: {
    name: "페이퍼",
    background: "#f3f0e9",
    foreground: "#171717",
    accent: "#d52b2b",
  },
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatTimestamp(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  const rest = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function perShortDuration(count: number) {
  return Math.max(3_400, Math.min(4_000, 28_000 / Math.max(1, count)));
}

function assemblyStep(progress: number): AssemblyStep {
  if (progress >= 0.92) return "complete";
  if (progress >= 0.78) return "template";
  if (progress >= 0.62) return "comment";
  if (progress >= 0.46) return "subtitle";
  if (progress >= 0.28) return "reason";
  return "title";
}

function assemblyStepLabel(step: AssemblyStep, usesCommentOverlay: boolean, locale: SiteLocale) {
  const copy = projectRevealCopy[locale];
  return step === "complete"
    ? copy.assemblyComplete
    : usesCommentOverlay
      ? copy.assemblyWithComment
      : copy.assemblyWithScript;
}

function absoluteSubtitleTime(item: GeneratedShort) {
  const segment = item.subtitleSegments[0];
  return segment ? item.startSeconds + segment.start : item.startSeconds;
}

function typingProgress(progress: number, start: number, end: number) {
  return clamp((progress - start) / Math.max(0.01, end - start));
}

function typedText(text: string, progress: number) {
  const characters = Array.from(text);
  return characters.slice(0, Math.ceil(characters.length * clamp(progress))).join("");
}

function Timeline({
  job,
  elapsed,
  playbackAssets,
}: {
  job: VideoJob;
  elapsed: number;
  playbackAssets: Record<string, PlaybackAsset>;
}) {
  const { locale } = useI18n();
  const copy = projectRevealCopy[locale];
  const duration = Math.max(1, job.sourceDurationSeconds);
  const shorts = job.shorts;
  const discoveryProgress = clamp((elapsed - SOURCE_END_MS) / (DISCOVERY_END_MS - SOURCE_END_MS));
  const revealProgress = clamp((discoveryProgress - 0.08) / 0.92);
  const visibleCount = Math.min(shorts.length, Math.ceil(revealProgress * shorts.length));

  const rangeStyle = (start: number, end: number) => ({
    left: `${clamp(start / duration) * 100}%`,
    width: `${Math.max(0.7, clamp((end - start) / duration) * 100)}%`,
  });

  return (
    <section className="project-reveal-timeline" aria-label={copy.timeline}>
      <div className="project-reveal-timeline-labels">
        <span>00:00</span>
        <strong>{copy.timeline}</strong>
        <span>{formatTimestamp(duration)}</span>
      </div>
      <div className="project-reveal-track">
        <div
          className="project-reveal-track-fill"
          style={{ width: `${clamp(elapsed / SOURCE_END_MS) * 100}%` }}
        />
        {shorts.slice(0, visibleCount).map((item, index) => (
          <div
            key={item.id}
            className={`project-reveal-range project-reveal-range-final ${index === visibleCount - 1 ? "is-latest" : ""}`}
            style={rangeStyle(item.startSeconds, item.endSeconds)}
            aria-label={copy.shortRange(index + 1, formatTimestamp(item.startSeconds), formatTimestamp(item.endSeconds))}
          />
        ))}
      </div>
      <ShortCardRail job={job} visibleCount={visibleCount} playbackAssets={playbackAssets} />
      <div className="project-reveal-timeline-status">
        {elapsed < SOURCE_END_MS && copy.sourceExpanding}
        {elapsed >= SOURCE_END_MS && elapsed < DISCOVERY_END_MS && (
          copy.checkingRanges(visibleCount, shorts.length)
        )}
        {elapsed >= DISCOVERY_END_MS && (
          copy.rangesComplete
        )}
      </div>
    </section>
  );
}

function ShortCardRail({
  job,
  visibleCount,
  playbackAssets,
}: {
  job: VideoJob;
  visibleCount: number;
  playbackAssets: Record<string, PlaybackAsset>;
}) {
  const { locale } = useI18n();
  const copy = projectRevealCopy[locale];
  return (
    <div className="project-reveal-card-rail" aria-label={copy.discoveredShorts}>
      {job.shorts.map((item, index) => {
        const visible = index < visibleCount;
        const latest = visible && index === visibleCount - 1;
        return (
          <article
            key={item.id}
            className={`project-reveal-mini-card ${visible ? "is-visible" : ""} ${latest ? "is-latest" : ""}`}
          >
            <div className="project-reveal-mini-image">
              {playbackAssets[item.id]?.url
                ? (
                  <video
                    src={playbackAssets[item.id].url || undefined}
                    poster={playbackAssets[item.id].posterUrl || undefined}
                    muted
                    autoPlay
                    loop
                    playsInline
                    preload="metadata"
                    aria-label={copy.completedVideo(item.hookTitle)}
                  />
                )
                : <em>{copy.connectingVideo}</em>}
              <span>{String(index + 1).padStart(2, "0")}</span>
            </div>
            <strong data-i18n-skip>{item.hookTitle.replace("\n", " ")}</strong>
            <small>{copy.seconds(Math.round(item.durationSeconds))}</small>
          </article>
        );
      })}
    </div>
  );
}

function AssemblyPreview({
  item,
  step,
  videoUrl,
  posterUrl,
}: {
  item: GeneratedShort;
  step: AssemblyStep;
  videoUrl: string | null;
  posterUrl: string | null;
}) {
  const { locale } = useI18n();
  const copy = projectRevealCopy[locale];
  const look = templateLooks[item.templateId];
  const usesCommentOverlay = item.templateId === "comment-capture";
  return (
    <div className="project-reveal-preview-column">
      <div className="project-reveal-preview-status" role="status">
        <i aria-hidden="true" />
        <strong>{assemblyStepLabel(step, usesCommentOverlay, locale)}</strong>
      </div>
      <div
        className="project-reveal-preview"
        style={{ background: look.background, color: look.foreground }}
      >
        {videoUrl
          ? (
          <video
            key={`${item.id}:${videoUrl}`}
            src={videoUrl}
            poster={posterUrl || undefined}
            muted
            autoPlay
            loop
            playsInline
            preload="auto"
            className="project-reveal-final-video is-visible"
            aria-label={copy.actualVideo(item.hookTitle)}
          />
          )
          : <div className="project-reveal-video-loading"><span />{copy.connectingActualVideo}</div>}
        <div className={`project-reveal-edit-overlay is-${step}`}>
          <i className="project-reveal-edit-scan" />
          <span className="project-reveal-edit-corner project-reveal-edit-corner-one" />
          <span className="project-reveal-edit-corner project-reveal-edit-corner-two" />
          <span className="project-reveal-edit-corner project-reveal-edit-corner-three" />
          <span className="project-reveal-edit-corner project-reveal-edit-corner-four" />
        </div>
      </div>
    </div>
  );
}

function AssemblyDetails({
  item,
  index,
  count,
  progress,
}: {
  item: GeneratedShort;
  index: number;
  count: number;
  progress: number;
}) {
  const { locale } = useI18n();
  const copy = projectRevealCopy[locale];
  const commentRowRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLParagraphElement>(null);
  const usesCommentOverlay = item.templateId === "comment-capture";
  const reasonText = item.highlightReason.trim()
    || copy.defaultReason;
  const subtitleText = item.subtitleSegments[0]?.text.trim()
    || copy.silentScene;
  const fullScriptText = item.subtitleSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    || copy.noScript;
  const storedComments = [...item.commentOverlays]
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .map((comment) => `@${comment.nickname} · ${comment.text}`);
  const commentEntries = storedComments.length
    ? storedComments
    : [copy.noComments];
  const titleProgress = typingProgress(progress, 0, 0.65);
  const reasonProgress = typingProgress(progress, 0, 0.78);
  const subtitleProgress = typingProgress(progress, 0, 0.72);
  const commentProgress = typingProgress(progress, 0, 0.85);
  const fullScriptProgress = typingProgress(progress, 0, 0.88);
  const visibleTitle = typedText(item.hookTitle, titleProgress);
  const visibleReason = typedText(reasonText, reasonProgress);
  const visibleSubtitle = typedText(subtitleText, subtitleProgress);
  const visibleFullScript = typedText(fullScriptText, fullScriptProgress);
  const totalCommentCharacters = commentEntries.reduce(
    (total, comment) => total + Array.from(comment).length,
    0,
  );
  let remainingCommentCharacters = Math.ceil(totalCommentCharacters * commentProgress);
  const visibleComments = commentEntries.map((comment) => {
    const characters = Array.from(comment);
    const visible = characters.slice(0, Math.max(0, remainingCommentCharacters)).join("");
    remainingCommentCharacters -= characters.length;
    return visible;
  });
  const visibleCommentLength = visibleComments.reduce((total, comment) => total + comment.length, 0);
  const checkpoints: Array<{ label: string; complete: boolean }> = [
    { label: copy.hookTitle, complete: titleProgress >= 1 },
    { label: copy.selectionReason, complete: reasonProgress >= 1 },
    { label: copy.subtitleTiming, complete: subtitleProgress >= 1 },
    usesCommentOverlay
      ? { label: copy.commentOverlay, complete: commentProgress >= 1 }
      : { label: copy.fullScript, complete: fullScriptProgress >= 1 },
  ];

  useEffect(() => {
    const row = commentRowRef.current;
    if (!row) return;
    row.scrollLeft = row.scrollWidth;
  }, [visibleCommentLength]);

  useEffect(() => {
    const script = scriptRef.current;
    if (!script || usesCommentOverlay) return;
    script.scrollTop = script.scrollHeight;
  }, [usesCommentOverlay, visibleFullScript.length]);

  return (
    <section className="project-reveal-details">
      <div className="project-reveal-details-heading">
        <span>SHORT {String(index + 1).padStart(2, "0")}</span>
        <small>{index + 1} / {count}</small>
      </div>
      <h2 data-i18n-skip>{visibleTitle}<i className={titleProgress < 1 ? "is-visible" : ""} /></h2>
      <div className="project-reveal-checkpoints">
        {checkpoints.map((checkpoint) => {
          return (
            <div key={checkpoint.label} className={checkpoint.complete ? "is-reached" : ""}>
              <span>{checkpoint.complete ? "✓" : ""}</span>
              <p>{checkpoint.label}</p>
            </div>
          );
        })}
      </div>
      <div className="project-reveal-detail-card is-reason is-visible">
        <strong>{copy.aiHighlight}</strong>
        <p data-i18n-skip>
          {visibleReason}
          <i className={`project-reveal-typing-cursor ${reasonProgress < 1 ? "is-visible" : ""}`} />
        </p>
      </div>
      <div className="project-reveal-detail-card is-visible">
        <strong>{copy.subtitleTimingSetup}</strong>
        <p data-i18n-skip>
          <time>[{formatTimestamp(absoluteSubtitleTime(item))}]</time>{" "}
          {visibleSubtitle}
          <i className={`project-reveal-typing-cursor ${subtitleProgress < 1 ? "is-visible" : ""}`} />
        </p>
      </div>
      {usesCommentOverlay
        ? (
          <div
            ref={commentRowRef}
            className="project-reveal-detail-card is-comments is-visible"
          >
            <strong>{copy.commentOverlay}</strong>
            <p data-i18n-skip>
              {visibleComments.map((comment, commentIndex) => (
                comment
                  ? <span className="project-reveal-comment-entry" key={`${commentIndex}:${commentEntries[commentIndex]}`}>{comment}</span>
                  : null
              ))}
              <i className={`project-reveal-typing-cursor ${commentProgress < 1 ? "is-visible" : ""}`} />
            </p>
          </div>
        )
        : (
          <div className="project-reveal-detail-card is-script is-visible">
            <strong>{copy.fullScript}</strong>
            <p ref={scriptRef} data-i18n-skip>
              {visibleFullScript}
              <i className={`project-reveal-typing-cursor ${fullScriptProgress < 1 ? "is-visible" : ""}`} />
            </p>
          </div>
        )}
    </section>
  );
}

export function ProjectReveal({
  job,
  playbackAssets,
  onComplete,
}: {
  job: VideoJob;
  playbackAssets: Record<string, PlaybackAsset>;
  onComplete: () => void;
}) {
  const { locale } = useI18n();
  const copy = projectRevealCopy[locale];
  const shorts = job.shorts;
  const shortDuration = perShortDuration(shorts.length);
  const totalDuration = CARDS_END_MS + shortDuration * shorts.length + FINISH_HOLD_MS;
  const [elapsed, setElapsed] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const completedRef = useRef(false);

  useEffect(() => {
    let animationFrame = 0;
    let finishTimer = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = Date.now();

    const tick = () => {
      const nextElapsed = Date.now() - startedAt;
      setElapsed(Math.min(totalDuration, nextElapsed));
      if (nextElapsed < totalDuration) {
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }
      setLeaving(true);
      finishTimer = window.setTimeout(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        onComplete();
      }, reducedMotion ? 80 : 360);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(finishTimer);
    };
  }, [onComplete, totalDuration]);

  const skip = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  };

  const assemblyElapsed = Math.max(0, elapsed - CARDS_END_MS);
  const activeIndex = shorts.length
    ? Math.min(shorts.length - 1, Math.floor(assemblyElapsed / shortDuration))
    : 0;
  const activeProgress = shorts.length
    ? clamp((assemblyElapsed - activeIndex * shortDuration) / shortDuration)
    : 1;
  const activeStep = assemblyStep(activeProgress);
  const assembling = elapsed >= CARDS_END_MS && shorts.length > 0;
  const activeItem = shorts[activeIndex];
  const allComplete = elapsed >= CARDS_END_MS + shortDuration * shorts.length;
  const overallProgress = clamp(elapsed / Math.max(1, totalDuration - FINISH_HOLD_MS));

  return (
    <div className={`project-reveal ${leaving ? "is-leaving" : ""}`} role="dialog" aria-modal="true" aria-label={copy.dialog}>
      <header className="project-reveal-topbar">
        <div>
          <strong>EASY CUT</strong>
          <span>PROJECT /{job.projectNumber}</span>
        </div>
        <div className="project-reveal-overall">
          <span style={{ transform: `scaleX(${overallProgress})` }} />
        </div>
        <button type="button" onClick={skip}>{copy.viewResults}</button>
      </header>

      {elapsed >= DISCOVERY_END_MS && elapsed < CARDS_END_MS && (
        <section className="project-reveal-discovery-announcement" role="status" aria-live="polite">
          <strong>{copy.discoveredCount(shorts.length)}</strong>
          <span>{copy.discovered}</span>
        </section>
      )}

      {assembling && activeStep === "complete" && !allComplete && (
        <section className="project-reveal-short-ready" role="status" aria-live="polite">
          <span>✓</span>
          <strong>{copy.shortComplete}</strong>
        </section>
      )}

      <main className={`project-reveal-main ${assembling ? "is-editing" : ""}`}>
        {!assembling && !allComplete && (
          <>
            <section className="project-reveal-source">
              <div className="project-reveal-source-thumb">
                <Image
                  src={job.thumbnailUrl}
                  alt={copy.thumbnail(job.videoTitle)}
                  fill
                  sizes="(max-width: 760px) 350px, 420px"
                  unoptimized
                  className="object-cover"
                />
                <span>YOUTUBE ORIGINAL</span>
              </div>
              <div className="project-reveal-source-copy">
                <div className="project-reveal-channel-line">
                  {job.channelThumbnailUrl && (
                    <Image src={job.channelThumbnailUrl} alt="" width={32} height={32} unoptimized />
                  )}
                  <strong data-i18n-skip>{job.channelName}</strong>
                </div>
                <h1 data-i18n-skip>{job.videoTitle}</h1>
                <p>{formatTimestamp(job.sourceDurationSeconds)} {copy.sourceVideo}</p>
              </div>
            </section>

            <Timeline job={job} elapsed={elapsed} playbackAssets={playbackAssets} />
          </>
        )}

        {assembling && activeItem && !allComplete && (
          <div className="project-reveal-assembly" key={activeItem.id}>
            <AssemblyPreview
              item={activeItem}
              step={activeStep}
              videoUrl={playbackAssets[activeItem.id]?.url || null}
              posterUrl={playbackAssets[activeItem.id]?.posterUrl || null}
            />
            <AssemblyDetails
              item={activeItem}
              index={activeIndex}
              count={shorts.length}
              progress={activeProgress}
            />
          </div>
        )}

        {allComplete && (
          <section className="project-reveal-complete">
            <span>✓</span>
            <h2>{copy.completedCount(shorts.length)}</h2>
          </section>
        )}
      </main>
    </div>
  );
}
