"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ProjectDeleteOverlay } from "@/components/project-delete-overlay";
import { YoutubeThumbnail } from "@/components/youtube-thumbnail";
import { copyTextToClipboard } from "@/lib/browser-clipboard";
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
import { localizeApiError } from "@/lib/i18n/errors";
import { translateLegacyText } from "@/lib/i18n/legacy-phrases";
import { useI18n } from "@/lib/i18n/provider";
import { projectCanBeDeleted } from "@/lib/project-deletion";

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

function localizedProjectErrorMessage(value: string, locale: SiteLocale) {
  if (locale === "ko") return value;
  const translated = translateLegacyText(value, locale);
  if (!/[가-힣]/.test(translated)) return translated;
  return locale === "en"
    ? "This project could not be completed. Please try again."
    : "プロジェクトを完了できませんでした。もう一度お試しください。";
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
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const deleteScrollPositionRef = useRef({ x: 0, y: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSucceeded, setDeleteSucceeded] = useState(false);
  const [locallyDeleted, setLocallyDeleted] = useState(false);
  const readyCount = job.shorts.filter((item) => item.status === "ready").length;
  const rerenderingShort = job.shorts.find((item) => item.status === "rerendering");
  const isProcessing = !terminalStatuses.has(job.status) || Boolean(rerenderingShort);
  const canDelete = projectCanBeDeleted(job);
  const projectExpired = isProjectExpired(job);
  const daysUntilExpiration = job.expiresAt
    ? Math.ceil((new Date(job.expiresAt).getTime() - Date.now()) / 86_400_000)
    : null;
  const projectHref = `/projects/${job.projectNumber}`;

  const rememberScrollPosition = () => {
    deleteScrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
  };
  const restoreScrollPosition = () => {
    const { x, y } = deleteScrollPositionRef.current;
    window.requestAnimationFrame(() => window.scrollTo(x, y));
  };

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const copyProjectLink = async () => {
    try {
      await copyTextToClipboard(new URL(projectHref, window.location.origin).toString());
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  const deleteProject = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/projects/${job.projectNumber}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => ({})) as {
        detail?: string;
        code?: string;
      };
      if (!response.ok) {
        throw new Error(localizeApiError(body, response.status, locale));
      }
      setDeleteDialogOpen(false);
      setDeleteSucceeded(true);
      setLocallyDeleted(true);
      restoreScrollPosition();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : (
        locale === "ko"
          ? "프로젝트를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요."
          : locale === "en"
            ? "Could not delete the project. Please try again shortly."
            : "プロジェクトを削除できませんでした。しばらくしてからもう一度お試しください。"
      ));
    } finally {
      setDeleting(false);
    }
  };

  if (locallyDeleted) {
    return (
      <ProjectDeleteOverlay
        open={deleteSucceeded}
        state="success"
        statusLabel={locale === "ko" ? "완료" : locale === "en" ? "Complete" : "完了"}
        title={locale === "ko" ? "프로젝트를 삭제했어요" : locale === "en" ? "Project deleted" : "プロジェクトを削除しました"}
        closeLabel={locale === "ko" ? "확인" : locale === "en" ? "OK" : "確認"}
        onClose={() => {
          setDeleteSucceeded(false);
          restoreScrollPosition();
        }}
      />
    );
  }

  const copyLabel = copyStatus === "copied"
    ? (locale === "ko" ? "링크 복사됨" : locale === "en" ? "Link copied" : "リンクをコピーしました")
    : copyStatus === "error"
      ? (locale === "ko" ? "복사하지 못했어요" : locale === "en" ? "Copy failed" : "コピーできませんでした")
      : (locale === "ko" ? "프로젝트 링크 복사" : locale === "en" ? "Copy project link" : "プロジェクトリンクをコピー");

  return (
    <>
      <article className={`project-card group relative w-full min-w-0 max-w-full !overflow-visible text-left ${menuOpen ? "z-40" : ""} ${isProcessing ? "project-card-processing" : ""}`}>
        <Link
          href={projectHref}
          prefetch={false}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={locale === "ko" ? `프로젝트 /${job.projectNumber}: ${job.videoTitle} 새 탭에서 열기` : locale === "en" ? `Open project /${job.projectNumber}: ${job.videoTitle} in a new tab` : `プロジェクト /${job.projectNumber}: ${job.videoTitle} を新しいタブで開く`}
          className="block w-full min-w-0 overflow-hidden rounded-[13px]"
        >
          <div className="relative aspect-video overflow-hidden bg-neutral-900">
            {job.thumbnailUrl ? <YoutubeThumbnail key={`${job.thumbnailUrl}:${job.stage}:${job.status}`} src={job.thumbnailUrl} alt="" fill unoptimized className={`object-cover transition duration-300 group-hover:scale-[1.03] ${isProcessing ? "grayscale" : ""}`} /> : null}
            <div className="absolute left-2 top-2 z-10 flex flex-col items-start gap-1.5">
              {job.isExample && <span className="rounded bg-[#ff5540] px-2.5 py-1 text-[11px] font-extrabold text-white shadow-lg">{locale === "ko" ? "예시 작업" : locale === "en" ? "Example" : "サンプル"}</span>}
              {daysUntilExpiration !== null && <span className="rounded bg-black/75 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">{projectExpired ? (locale === "ko" ? "만료됨" : locale === "en" ? "Expired" : "期限切れ") : daysUntilExpiration > 0 ? (locale === "ko" ? `${daysUntilExpiration}일 뒤 만료` : locale === "en" ? `Expires in ${daysUntilExpiration} days` : `あと${daysUntilExpiration}日で期限切れ`) : (locale === "ko" ? "오늘 만료" : locale === "en" ? "Expires today" : "本日期限切れ")}</span>}
            </div>
            {!isProcessing && <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[11px] font-semibold">{formatDuration(job.sourceDurationSeconds, locale)}</span>}
            <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
            {isProcessing && readyCount === 0 && (rerenderingShort
              ? <EstimatedProcessingOverlay operationKey={`rerender:${rerenderingShort.id}:${rerenderingShort.renderVersion}`} durationSeconds={rerenderingShort.durationSeconds} rerender minimumProgress={rerenderingShort.rerenderProgress} />
              : <EstimatedProcessingOverlay operationKey={`create:${job.id}`} durationSeconds={job.sourceDurationSeconds} createdAt={job.createdAt} job={job} />)}
          </div>
          <div className="p-4">
            <h3 data-i18n-skip className="line-clamp-1 text-sm font-bold text-white">{job.videoTitle}</h3>
            <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-neutral-500">
              <span className={`min-w-0 break-words ${projectExpired ? "text-neutral-500" : rerenderingShort ? "text-violet-300" : job.status === "completed" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-neutral-400"}`}>{projectExpired ? `● ${locale === "ko" ? "만료됨" : locale === "en" ? "Expired" : "期限切れ"}` : rerenderingShort ? `● ${locale === "ko" ? "수정 반영 중" : locale === "en" ? "Applying edits" : "編集を反映中"}` : job.status === "completed" ? `● ${locale === "ko" ? "완료" : locale === "en" ? "Complete" : "完了"}` : job.status === "failed" ? `● ${locale === "ko" ? "생성 실패" : locale === "en" ? "Creation failed" : "作成に失敗"}` : job.status === "retry_waiting" ? `● ${locale === "ko" ? "원본 영상을 준비하고 있습니다" : locale === "en" ? "Preparing source video" : "元動画を準備中"}` : `● ${processingLabel(job, locale)}`}</span>
              {(!isProcessing || rerenderingShort) && <span className="shrink-0">{locale === "ko" ? `쇼츠 ${readyCount || job.shorts.length}개` : locale === "en" ? `${readyCount || job.shorts.length} Shorts` : `ショート動画 ${readyCount || job.shorts.length}件`}</span>}
              <span className="shrink-0">{formatSeoulDate(job.createdAt, locale)}</span>
            </div>
            {job.status === "failed" && job.errorMessage && <p className="mt-3 line-clamp-3 whitespace-pre-line text-xs leading-5 text-red-300">{localizedProjectErrorMessage(job.errorMessage, locale)}</p>}
          </div>
        </Link>

        <div ref={menuRef} className="absolute right-2 top-2 z-30 h-10 w-10">
          <button
            type="button"
            aria-label={locale === "ko" ? `${job.videoTitle} 프로젝트 메뉴` : locale === "en" ? `${job.videoTitle} project menu` : `${job.videoTitle} プロジェクトメニュー`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => {
              if (!menuOpen) rememberScrollPosition();
              setMenuOpen((open) => !open);
            }}
            className="grid h-10 w-10 place-items-center rounded-xl border border-white/30 bg-black/85 text-white shadow-[0_8px_24px_rgba(0,0,0,.48)] backdrop-blur-md transition hover:border-[#ff8f7f]/80 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff715e]"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.9" />
              <circle cx="12" cy="12" r="1.9" />
              <circle cx="19" cy="12" r="1.9" />
            </svg>
          </button>
          {menuOpen ? (
            <div id={menuId} role="menu" className="absolute right-0 top-12 w-52 overflow-hidden rounded-2xl border border-white/15 bg-[#242729]/[.98] p-1.5 text-sm text-white shadow-[0_22px_55px_rgba(0,0,0,.68)] backdrop-blur-xl">
              <Link href={projectHref} prefetch={false} target="_blank" rel="noopener noreferrer" role="menuitem" onClick={() => setMenuOpen(false)} className="flex min-h-10 items-center gap-3 rounded-xl px-3 font-bold transition hover:bg-white/[.08] focus-visible:bg-white/[.08] focus-visible:outline-none">
                <span aria-hidden="true">↗</span>
                {locale === "ko" ? "프로젝트 열기" : locale === "en" ? "Open project" : "プロジェクトを開く"}
              </Link>
              <button type="button" role="menuitem" onClick={() => void copyProjectLink()} className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left font-bold transition hover:bg-white/[.08] focus-visible:bg-white/[.08] focus-visible:outline-none ${copyStatus === "error" ? "text-red-300" : copyStatus === "copied" ? "text-emerald-300" : ""}`}>
                <span aria-hidden="true">⧉</span>
                {copyLabel}
              </button>
              {!job.isExample ? (
                <>
                  <div className="my-1 border-t border-white/10" />
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canDelete}
                    title={!canDelete ? (locale === "ko" ? "진행 중인 작업은 완료된 뒤 삭제할 수 있습니다." : locale === "en" ? "A running project can be deleted after it finishes." : "処理中のプロジェクトは完了後に削除できます。") : undefined}
                    onClick={() => {
                      rememberScrollPosition();
                      setMenuOpen(false);
                      setDeleteError(null);
                      setDeleteDialogOpen(true);
                    }}
                    className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left font-bold text-red-300 transition enabled:hover:bg-red-400/10 enabled:focus-visible:bg-red-400/10 enabled:focus-visible:outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
                  >
                    <span aria-hidden="true">⌫</span>
                    {canDelete
                      ? (locale === "ko" ? "프로젝트 삭제" : locale === "en" ? "Delete project" : "プロジェクトを削除")
                      : (locale === "ko" ? "작업 완료 후 삭제 가능" : locale === "en" ? "Delete after completion" : "完了後に削除可能")}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>

      <ProjectDeleteOverlay
        open={deleteDialogOpen}
        state={deleteError ? "error" : "confirm"}
        statusLabel={locale === "ko" ? "확인 필요" : locale === "en" ? "Confirmation" : "確認が必要"}
        title={deleteError
          ? (locale === "ko" ? "프로젝트를 삭제하지 못했어요" : locale === "en" ? "Could not delete the project" : "プロジェクトを削除できませんでした")
          : (locale === "ko" ? "이 프로젝트를 삭제할까요?" : locale === "en" ? "Delete this project?" : "このプロジェクトを削除しますか？")}
        message={deleteError || undefined}
        actionLabel={deleteError ? undefined : (locale === "ko" ? "프로젝트 삭제" : locale === "en" ? "Delete project" : "プロジェクトを削除")}
        closeLabel={deleteError ? (locale === "ko" ? "확인" : locale === "en" ? "OK" : "確認") : (locale === "ko" ? "취소" : locale === "en" ? "Cancel" : "キャンセル")}
        actionPending={deleting}
        onAction={deleteError ? undefined : () => void deleteProject()}
        onClose={() => {
          if (deleting) return;
          setDeleteDialogOpen(false);
          setDeleteError(null);
          restoreScrollPosition();
        }}
      />
    </>
  );
}
