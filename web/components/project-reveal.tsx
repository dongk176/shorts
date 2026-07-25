"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { GeneratedShort, TemplateId, VideoJob } from "@/lib/contracts";

const SOURCE_END_MS = 600;
const DISCOVERY_END_MS = 2_400;
const CARDS_END_MS = 3_400;
const FINISH_HOLD_MS = 550;

type AssemblyStep = "title" | "reason" | "subtitle" | "comment" | "template" | "complete";

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

function assemblyStepLabel(step: AssemblyStep, usesCommentOverlay: boolean) {
  return step === "complete"
    ? "완성 영상을 확인했습니다"
    : usesCommentOverlay
      ? "제목·이유·자막·댓글을 함께 구성하고 있습니다"
      : "제목·이유·자막·스크립트를 함께 구성하고 있습니다";
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
  videoUrls,
}: {
  job: VideoJob;
  elapsed: number;
  videoUrls: Record<string, string | null>;
}) {
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
    <section className="project-reveal-timeline" aria-label="원본 영상 타임라인">
      <div className="project-reveal-timeline-labels">
        <span>00:00</span>
        <strong>원본 영상 타임라인</strong>
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
            aria-label={`쇼츠 ${index + 1}: ${formatTimestamp(item.startSeconds)}부터 ${formatTimestamp(item.endSeconds)}까지`}
          />
        ))}
      </div>
      <ShortCardRail job={job} visibleCount={visibleCount} videoUrls={videoUrls} />
      <div className="project-reveal-timeline-status">
        {elapsed < SOURCE_END_MS && "원본 영상 구조를 펼치고 있습니다"}
        {elapsed >= SOURCE_END_MS && elapsed < DISCOVERY_END_MS && (
          <><strong>{visibleCount}</strong> / {shorts.length} 구간을 확인하고 있습니다</>
        )}
        {elapsed >= DISCOVERY_END_MS && (
          "구간 확인을 완료했습니다"
        )}
      </div>
    </section>
  );
}

function ShortCardRail({
  job,
  visibleCount,
  videoUrls,
}: {
  job: VideoJob;
  visibleCount: number;
  videoUrls: Record<string, string | null>;
}) {
  return (
    <div className="project-reveal-card-rail" aria-label="발견된 쇼츠">
      {job.shorts.map((item, index) => {
        const visible = index < visibleCount;
        const latest = visible && index === visibleCount - 1;
        return (
          <article
            key={item.id}
            className={`project-reveal-mini-card ${visible ? "is-visible" : ""} ${latest ? "is-latest" : ""}`}
          >
            <div className="project-reveal-mini-image">
              {videoUrls[item.id]
                ? (
                  <video
                    src={videoUrls[item.id] || undefined}
                    muted
                    autoPlay
                    loop
                    playsInline
                    preload="metadata"
                    aria-label={`${item.hookTitle} 완성 영상`}
                  />
                )
                : <em>완성 영상 연결 중</em>}
              <span>{String(index + 1).padStart(2, "0")}</span>
            </div>
            <strong>{item.hookTitle.replace("\n", " ")}</strong>
            <small>{Math.round(item.durationSeconds)}초</small>
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
}: {
  item: GeneratedShort;
  step: AssemblyStep;
  videoUrl: string | null;
}) {
  const look = templateLooks[item.templateId];
  const usesCommentOverlay = item.templateId === "comment-capture";
  return (
    <div className="project-reveal-preview-column">
      <div className="project-reveal-preview-status" role="status">
        <i aria-hidden="true" />
        <strong>{assemblyStepLabel(step, usesCommentOverlay)}</strong>
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
            muted
            autoPlay
            loop
            playsInline
            preload="auto"
            className="project-reveal-final-video is-visible"
            aria-label={`${item.hookTitle} 실제 완성 영상`}
          />
          )
          : <div className="project-reveal-video-loading"><span />실제 완성 영상을 연결하고 있습니다</div>}
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
  const commentRowRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLParagraphElement>(null);
  const usesCommentOverlay = item.templateId === "comment-capture";
  const reasonText = item.highlightReason.trim()
    || "시청 흐름에서 핵심이 되는 장면을 쇼츠 구간으로 선정했습니다.";
  const subtitleText = item.subtitleSegments[0]?.text.trim()
    || "대사가 없는 장면의 영상 흐름을 유지했습니다.";
  const fullScriptText = item.subtitleSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    || "추출된 스크립트가 없습니다.";
  const storedComments = [...item.commentOverlays]
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .map((comment) => `@${comment.nickname} · ${comment.text}`);
  const commentEntries = storedComments.length
    ? storedComments
    : ["이 템플릿은 댓글 오버레이를 사용하지 않습니다."];
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
    { label: "후킹 제목", complete: titleProgress >= 1 },
    { label: "선정 이유", complete: reasonProgress >= 1 },
    { label: "자막 타이밍", complete: subtitleProgress >= 1 },
    usesCommentOverlay
      ? { label: "댓글 오버레이", complete: commentProgress >= 1 }
      : { label: "전체 스크립트", complete: fullScriptProgress >= 1 },
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
      <h2>{visibleTitle}<i className={titleProgress < 1 ? "is-visible" : ""} /></h2>
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
        <strong>✦ AI 하이라이트</strong>
        <p>
          {visibleReason}
          <i className={`project-reveal-typing-cursor ${reasonProgress < 1 ? "is-visible" : ""}`} />
        </p>
      </div>
      <div className="project-reveal-detail-card is-visible">
        <strong>자막 타이밍 구성</strong>
        <p>
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
            <strong>댓글 오버레이</strong>
            <p>
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
            <strong>전체 스크립트</strong>
            <p ref={scriptRef}>
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
  videoUrls,
  onComplete,
}: {
  job: VideoJob;
  videoUrls: Record<string, string | null>;
  onComplete: () => void;
}) {
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
    <div className={`project-reveal ${leaving ? "is-leaving" : ""}`} role="dialog" aria-modal="true" aria-label="쇼츠 제작 결과 공개">
      <header className="project-reveal-topbar">
        <div>
          <strong>EASY CUT</strong>
          <span>PROJECT /{job.projectNumber}</span>
        </div>
        <div className="project-reveal-overall">
          <span style={{ transform: `scaleX(${overallProgress})` }} />
        </div>
        <button type="button" onClick={skip}>바로 결과 보기</button>
      </header>

      {elapsed >= DISCOVERY_END_MS && elapsed < CARDS_END_MS && (
        <section className="project-reveal-discovery-announcement" role="status" aria-live="polite">
          <strong>{shorts.length}개의 쇼츠 구간을</strong>
          <span>발견했습니다</span>
        </section>
      )}

      {assembling && activeStep === "complete" && !allComplete && (
        <section className="project-reveal-short-ready" role="status" aria-live="polite">
          <span>✓</span>
          <strong>쇼츠 완성</strong>
        </section>
      )}

      <main className={`project-reveal-main ${assembling ? "is-editing" : ""}`}>
        {!assembling && !allComplete && (
          <>
            <section className="project-reveal-source">
              <div className="project-reveal-source-thumb">
                <Image
                  src={job.thumbnailUrl}
                  alt={`${job.videoTitle} 유튜브 썸네일`}
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
                  <strong>{job.channelName}</strong>
                </div>
                <h1>{job.videoTitle}</h1>
                <p>{formatTimestamp(job.sourceDurationSeconds)} 원본 영상</p>
              </div>
            </section>

            <Timeline job={job} elapsed={elapsed} videoUrls={videoUrls} />
          </>
        )}

        {assembling && activeItem && !allComplete && (
          <div className="project-reveal-assembly" key={activeItem.id}>
            <AssemblyPreview
              item={activeItem}
              step={activeStep}
              videoUrl={videoUrls[activeItem.id] || null}
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
            <h2>{shorts.length}개의 쇼츠가 완성됐습니다</h2>
          </section>
        )}
      </main>
    </div>
  );
}
