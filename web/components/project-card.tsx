"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { VideoJob } from "@/lib/contracts";
import {
  estimatedCreationMinutes,
  estimatedProgress,
  estimatedProgressWithFloor,
  estimatedRemainingLabel,
  estimatedRemainingMinutes,
  estimatedRerenderMinutes,
  SIMULATED_PROGRESS_START,
} from "@/lib/creation-progress";
import type { SiteLocale } from "@/lib/i18n/config";
import { formatSeoulDate } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/provider";

const terminalStatuses = new Set(["completed", "failed", "expired", "deleted"]);

function formatDuration(seconds: number, locale: SiteLocale) {
  const value = Math.max(0, Math.round(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (locale === "en") {
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${rest}s`;
    return `${rest}s`;
  }
  if (locale === "ja") {
    if (hours) return `${hours}時間 ${minutes}分`;
    if (minutes) return `${minutes}分 ${rest}秒`;
    return `${rest}秒`;
  }
  if (hours) return `${hours}시간 ${minutes}분`;
  if (minutes) return `${minutes}분 ${rest}초`;
  return `${rest}초`;
}

function isProjectExpired(job: VideoJob) {
  return Boolean(job.expiresAt && new Date(job.expiresAt).getTime() <= Date.now());
}

function ProgressRing({ progress }: { progress: number }) {
  const { locale } = useI18n();
  const value = Math.max(
    0,
    Math.min(99, Number.isFinite(progress) ? progress : SIMULATED_PROGRESS_START),
  );
  const displayedValue = Math.floor(value);

  return (
    <div className="brand-progress" role="progressbar" aria-label={locale === "ko" ? `진행률 ${displayedValue}%` : locale === "en" ? `Progress ${displayedValue}%` : `進捗 ${displayedValue}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayedValue}>
      <span className="brand-progress-spinner" aria-hidden="true" style={{ background: `conic-gradient(from -90deg, #ff5540 0%, #a078ff ${value}%, rgba(255,255,255,.18) ${value}% 100%)` }} />
      <span className="brand-progress-value">{displayedValue}%</span>
    </div>
  );
}

function processingLabel(job: VideoJob, locale: SiteLocale) {
  const copy = locale === "ko" ? {
    extract: "편집용 영상 준비", render: "렌더링", start: "작업을 시작하고 있습니다", download: "원본 영상을 다운로드하고 있습니다", transcribe: "영상 내용을 분석하고 있습니다", select: "쇼츠 장면을 찾고 있습니다", create: "쇼츠를 생성하고 있습니다",
  } : locale === "en" ? {
    extract: "Preparing editable clips", render: "Rendering", start: "Starting the job", download: "Downloading source video", transcribe: "Analyzing video", select: "Finding Shorts scenes", create: "Creating Shorts",
  } : {
    extract: "編集用動画を準備中", render: "レンダリング中", start: "処理を開始しています", download: "元動画をダウンロード中", transcribe: "動画を分析中", select: "ショート動画の場面を検索中", create: "ショート動画を作成中",
  };
  if (job.stage === "extracting" && job.stageTotalCount > 0) {
    return `${copy.extract} ${job.stageCompletedCount}/${job.stageTotalCount}`;
  }
  if (job.stage === "rendering" && job.stageTotalCount > 0) {
    return `${copy.render} ${job.stageCompletedCount}/${job.stageTotalCount}`;
  }
  if (job.stage === "queued" || job.stage === "starting") return copy.start;
  if (job.stage === "downloading") return copy.download;
  if (job.stage === "transcribing") return copy.transcribe;
  if (job.stage === "selecting") return copy.select;
  return copy.create;
}

export function EstimatedProcessingOverlay({
  operationKey,
  durationSeconds,
  createdAt,
  rerender = false,
  minimumProgress,
  job,
}: {
  operationKey: string;
  durationSeconds: number;
  createdAt?: string;
  rerender?: boolean;
  minimumProgress?: number;
  job?: VideoJob;
}) {
  const { locale } = useI18n();
  const estimatedMinutes = rerender
    ? estimatedRerenderMinutes(durationSeconds)
    : estimatedCreationMinutes(durationSeconds);
  const [clock, setClock] = useState<{ startedAtMs: number; nowMs: number } | null>(null);

  useEffect(() => {
    const storageKey = `estimated-progress:${operationKey}`;
    const parsedCreatedAt = createdAt ? Date.parse(createdAt) : Number.NaN;
    let sharedStartedAt = Number.NaN;
    let sessionStartedAt = Number.NaN;
    try {
      sharedStartedAt = Number(window.localStorage.getItem(storageKey));
    } catch {
      // Local storage is optional; the server progress still prevents a reset.
    }
    try {
      sessionStartedAt = Number(window.sessionStorage.getItem(storageKey));
    } catch {
      // Session storage is optional; timing still works for the current mount.
    }
    const storedStartedAt = [sharedStartedAt, sessionStartedAt]
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);
    const startedAtMs = Number.isFinite(parsedCreatedAt)
      ? parsedCreatedAt
      : Number.isFinite(storedStartedAt)
        ? storedStartedAt
        : Date.now();

    if (!Number.isFinite(parsedCreatedAt)) {
      try {
        window.localStorage.setItem(storageKey, String(startedAtMs));
      } catch {
        // Local storage is optional; the server progress still prevents a reset.
      }
      try {
        window.sessionStorage.setItem(storageKey, String(startedAtMs));
      } catch {
        // Session storage is optional; timing still works for the current mount.
      }
    }

    const update = () => setClock({ startedAtMs, nowMs: Date.now() });
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [createdAt, operationKey]);

  const progress = estimatedProgressWithFloor(
    clock
      ? estimatedProgress(clock.startedAtMs, clock.nowMs, estimatedMinutes)
      : SIMULATED_PROGRESS_START,
    minimumProgress,
  );
  const remainingMinutes = clock
    ? estimatedRemainingMinutes(clock.startedAtMs, clock.nowMs, estimatedMinutes)
    : estimatedMinutes;

  return (
    <div className="project-processing-overlay">
      <ProgressRing progress={progress} />
      <strong>{job ? processingLabel(job, locale) : locale === "ko" ? estimatedRemainingLabel(remainingMinutes) : locale === "en" ? `About ${remainingMinutes} min remaining` : `残り約${remainingMinutes}分`}</strong>
    </div>
  );
}

export function ProjectCard({ job }: { job: VideoJob }) {
  const { locale } = useI18n();
  const readyCount = job.shorts.filter((item) => item.status === "ready").length;
  const rerenderingShort = job.shorts.find((item) => item.status === "rerendering");
  const isProcessing = !terminalStatuses.has(job.status) || Boolean(rerenderingShort);
  const projectExpired = isProjectExpired(job);
  const daysUntilExpiration = job.expiresAt
    ? Math.ceil((new Date(job.expiresAt).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <Link
      href={`/projects/${job.projectNumber}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={locale === "ko" ? `프로젝트 /${job.projectNumber}: ${job.videoTitle} 새 탭에서 열기` : locale === "en" ? `Open project /${job.projectNumber}: ${job.videoTitle} in a new tab` : `プロジェクト /${job.projectNumber}: ${job.videoTitle} を新しいタブで開く`}
      className={`project-card group text-left ${isProcessing ? "project-card-processing" : ""}`}
    >
      <div className="relative aspect-video overflow-hidden bg-neutral-900">
        {job.thumbnailUrl ? <Image src={job.thumbnailUrl} alt="" fill unoptimized className={`object-cover transition duration-300 group-hover:scale-[1.03] ${isProcessing ? "grayscale" : ""}`} /> : null}
        {daysUntilExpiration !== null && <span className="absolute left-2 top-2 z-10 rounded bg-black/75 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">{projectExpired ? (locale === "ko" ? "만료됨" : locale === "en" ? "Expired" : "期限切れ") : daysUntilExpiration > 0 ? (locale === "ko" ? `${daysUntilExpiration}일 뒤 만료` : locale === "en" ? `Expires in ${daysUntilExpiration} days` : `あと${daysUntilExpiration}日で期限切れ`) : (locale === "ko" ? "오늘 만료" : locale === "en" ? "Expires today" : "本日期限切れ")}</span>}
        {job.isExample && <span className="absolute right-2 top-2 z-10 rounded bg-red-500 px-2 py-1 text-[11px] font-extrabold text-white shadow-lg">{locale === "ko" ? "예시 작업" : locale === "en" ? "Example" : "サンプル"}</span>}
        {!isProcessing && <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[11px] font-semibold">{formatDuration(job.sourceDurationSeconds, locale)}</span>}
        <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
        {isProcessing && readyCount === 0 && (rerenderingShort
          ? <EstimatedProcessingOverlay operationKey={`rerender:${rerenderingShort.id}:${rerenderingShort.renderVersion}`} durationSeconds={rerenderingShort.durationSeconds} rerender minimumProgress={rerenderingShort.rerenderProgress} />
          : <EstimatedProcessingOverlay operationKey={`create:${job.id}`} durationSeconds={job.sourceDurationSeconds} createdAt={job.createdAt} job={job} />)}
      </div>
      <div className="p-4">
        <h3 data-i18n-skip className="line-clamp-1 text-sm font-bold text-white">{job.videoTitle}</h3>
        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
          <span className={projectExpired ? "text-neutral-500" : rerenderingShort ? "text-violet-300" : job.status === "completed" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-neutral-400"}>{projectExpired ? `● ${locale === "ko" ? "만료됨" : locale === "en" ? "Expired" : "期限切れ"}` : rerenderingShort ? `● ${locale === "ko" ? "수정 반영 중" : locale === "en" ? "Applying edits" : "編集を反映中"}` : job.status === "completed" ? `● ${locale === "ko" ? "완료" : locale === "en" ? "Complete" : "完了"}` : job.status === "failed" ? `● ${locale === "ko" ? "생성 실패" : locale === "en" ? "Creation failed" : "作成に失敗"}` : job.status === "retry_waiting" ? `● ${locale === "ko" ? "원본 영상을 준비하고 있습니다" : locale === "en" ? "Preparing source video" : "元動画を準備中"}` : `● ${processingLabel(job, locale)}`}</span>
          {(!isProcessing || rerenderingShort) && <span>{locale === "ko" ? `쇼츠 ${readyCount || job.shorts.length}개` : locale === "en" ? `${readyCount || job.shorts.length} Shorts` : `ショート動画 ${readyCount || job.shorts.length}件`}</span>}
          <span>{formatSeoulDate(job.createdAt, locale)}</span>
        </div>
        {job.status === "failed" && job.errorMessage && <p className="mt-3 line-clamp-3 whitespace-pre-line text-xs leading-5 text-red-300">{job.errorMessage}</p>}
      </div>
    </Link>
  );
}
