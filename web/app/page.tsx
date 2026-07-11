"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

type VideoMetadata = {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  duration_seconds: number;
};

type JobOutput = {
  id: string;
  title: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  video_url: string;
  download_url: string;
  transcript_text: string;
  title_color: string | null;
  title_font_size: number | null;
};

type JobState = {
  job_id: string;
  status: "queued" | "downloading" | "transcribing" | "selecting" | "rendering" | "completed" | "failed";
  progress: number;
  message: string;
  outputs: JobOutput[];
};

type Template = {
  id: "dark-red" | "white-yellow" | "dark-minimal" | "paper";
  name: string;
  label: string;
};

const templates: Template[] = [
  { id: "dark-red", name: "다크 레드", label: "지금 꼭 알아야 할\n핵심 한 가지" },
  { id: "white-yellow", name: "화이트 옐로", label: "생각보다 쉬운\n핵심 한 가지" },
  { id: "dark-minimal", name: "다크 미니멀", label: "놓치기 쉬운\n결정적 순간" },
  { id: "paper", name: "페이퍼", label: "오늘 바로 쓰는\n핵심 방법" },
];

const statusLabels: Record<JobState["status"], string> = {
  queued: "대기 중",
  downloading: "영상 준비",
  transcribing: "자막 분석",
  selecting: "핵심 구간 선정",
  rendering: "쇼츠 렌더링",
  completed: "완료",
  failed: "실패",
};

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remaining = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatTimestamp(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remaining = Math.floor(Math.max(0, seconds) % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function absoluteFileUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string | { msg?: string }[]; message?: string };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) return payload.detail.map((item) => item.msg || "입력값을 확인해 주세요.").join(" ");
    return payload.message || "요청을 처리하지 못했습니다.";
  } catch {
    return "서버에 연결하지 못했습니다. API가 실행 중인지 확인해 주세요.";
  }
}

function TemplatePreview({ template }: { template: Template }) {
  const lines = template.label.split("\n");
  const isLight = template.id === "white-yellow" || template.id === "paper";
  const background = template.id === "paper" ? "bg-[#F3F0E9]" : isLight ? "bg-white" : "bg-black";
  const foreground = isLight ? "text-black" : "text-white";

  return (
    <div className={`relative mx-auto aspect-[9/16] w-full max-w-[164px] overflow-hidden rounded-lg ${background} ${foreground}`}>
      <div className="flex h-[22%] flex-col items-center justify-center px-2 text-center text-[10px] font-extrabold leading-[1.25] sm:text-[11px]">
        <span>{lines[0]}</span>
        {template.id === "dark-red" && <span className="mt-1 bg-accent px-1.5 py-0.5 text-white">{lines[1]}</span>}
        {template.id === "white-yellow" && <span className="mt-1 bg-[#FFD84D] px-1.5 py-0.5">{lines[1]}</span>}
        {template.id === "dark-minimal" && <span className="mt-1 text-[#FF3838]">{lines[1]}</span>}
        {template.id === "paper" && <span className="mt-1 text-accent">{lines[1]}</span>}
      </div>
      <div className={`flex h-[56%] items-center justify-center ${isLight ? "bg-neutral-300" : "bg-neutral-700"}`}>
        <div className={`h-8 w-8 rounded-full border ${isLight ? "border-neutral-500" : "border-neutral-400"}`} aria-hidden="true" />
      </div>
      <div className={`flex h-[22%] items-center justify-center gap-1.5 px-2 text-[8px] font-semibold sm:text-[9px] ${template.id === "paper" ? "text-neutral-700" : ""}`}>
        <span className={`h-3 w-3 rounded-full ${isLight ? "bg-neutral-800" : "bg-white"}`} aria-hidden="true" />
        예시 채널명
      </div>
    </div>
  );
}

export default function Home() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [analyzedUrl, setAnalyzedUrl] = useState("");
  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template["id"]>("dark-red");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingOutput, setEditingOutput] = useState<JobOutput | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editColor, setEditColor] = useState("#FFFFFF");
  const [editFontSize, setEditFontSize] = useState(72);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const jobIsActive = Boolean(job && !["completed", "failed"].includes(job.status));
  const canGenerate = Boolean(video && rightsConfirmed && !jobIsActive && !isStarting);

  const chosenTemplateName = useMemo(
    () => templates.find((template) => template.id === selectedTemplate)?.name || "다크 레드",
    [selectedTemplate],
  );

  const activeJobId = job?.job_id;
  const activeJobStatus = job?.status;

  useEffect(() => {
    if (!activeJobId || !activeJobStatus || ["completed", "failed"].includes(activeJobStatus)) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/jobs/${activeJobId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await readError(response));
        const nextJob = (await response.json()) as JobState;
        if (!cancelled) {
          setJob(nextJob);
          if (nextJob.status === "failed") setError(nextJob.message || "쇼츠 생성에 실패했습니다.");
          else setError(null);
        }
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "작업 상태를 확인하지 못했습니다.");
      }
    };

    const timer = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJobId, activeJobStatus]);

  const analyzeVideo = async (event?: FormEvent) => {
    event?.preventDefault();
    const trimmedUrl = youtubeUrl.trim();
    if (!trimmedUrl) {
      setError("유튜브 링크를 입력해 주세요.");
      return;
    }
    setError(null);
    setVideo(null);
    setAnalyzedUrl("");
    setRightsConfirmed(false);
    setJob(null);
    setIsAnalyzing(true);
    try {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youtube_url: trimmedUrl }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const metadata = (await response.json()) as VideoMetadata;
      setVideo(metadata);
      setRangeStart(0);
      setRangeEnd(Math.floor(metadata.duration_seconds));
      setAnalyzedUrl(trimmedUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "영상을 확인하지 못했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startJob = async () => {
    if (!video || !rightsConfirmed || !analyzedUrl) return;
    setError(null);
    setJob(null);
    setIsStarting(true);
    try {
      const response = await fetch(`${API_BASE}/api/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtube_url: analyzedUrl,
          template_id: selectedTemplate,
          rights_confirmed: true,
          range_start_seconds: rangeStart,
          range_end_seconds: rangeEnd,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const created = (await response.json()) as Pick<JobState, "job_id" | "status">;
      setJob({
        job_id: created.job_id,
        status: created.status,
        progress: 0,
        message: "작업을 준비하고 있습니다.",
        outputs: [],
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "작업을 시작하지 못했습니다.");
    } finally {
      setIsStarting(false);
    }
  };

  const retry = () => {
    setError(null);
    if (jobIsActive) return;
    if (video && rightsConfirmed) void startJob();
    else void analyzeVideo();
  };

  const changeYoutubeUrl = (nextUrl: string) => {
    setYoutubeUrl(nextUrl);
    if (video && nextUrl.trim() !== analyzedUrl) {
      setVideo(null);
      setAnalyzedUrl("");
      setRightsConfirmed(false);
      setRangeStart(0);
      setRangeEnd(0);
      setJob(null);
      setError(null);
    }
  };

  const openEditor = (output: JobOutput) => {
    setEditingOutput(output);
    setEditTitle(output.title);
    setEditColor(output.title_color || "#FFFFFF");
    setEditFontSize(output.title_font_size || 72);
  };

  const saveEdit = async () => {
    if (!job || !editingOutput) return;
    setIsSavingEdit(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/jobs/${job.job_id}/outputs/${editingOutput.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, title_color: editColor, title_font_size: editFontSize }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const updated = (await response.json()) as JobOutput;
      setJob({ ...job, outputs: job.outputs.map((output) => output.id === updated.id ? updated : output) });
      setEditingOutput(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "쇼츠를 편집하지 못했습니다.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const shareOutput = async (output: JobOutput) => {
    const url = absoluteFileUrl(output.video_url);
    if (navigator.share) await navigator.share({ title: output.title, url });
    else await navigator.clipboard.writeText(url);
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="h-14 border-b border-white/10 bg-[#0D0D0F]">
        <div className="mx-auto flex h-full max-w-[960px] items-center px-5 sm:px-6">
          <span className="text-[17px] font-bold tracking-[-0.02em]">Shorts Maker</span>
        </div>
      </header>

      <main className="mx-auto max-w-[960px] px-5 pb-20 pt-12 sm:px-6">
        <section aria-labelledby="page-title">
          <p className="mb-2 text-sm font-semibold text-accent">AI 쇼츠 자동 생성</p>
          <h1 id="page-title" className="text-[30px] font-bold leading-tight tracking-[-0.035em] sm:text-4xl">
            유튜브 링크 하나로 쇼츠 만들기
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-6 text-neutral-400 sm:text-base">
            영상을 분석해 핵심 구간을 찾고, 세로 쇼츠를 자동으로 생성합니다.
          </p>

          <form className="mt-8 flex flex-col gap-2.5 sm:flex-row" onSubmit={analyzeVideo}>
            <label className="sr-only" htmlFor="youtube-url">유튜브 링크</label>
            <input
              id="youtube-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={youtubeUrl}
              onChange={(event) => changeYoutubeUrl(event.target.value)}
              disabled={isAnalyzing || isStarting || jobIsActive}
              className="h-12 min-w-0 flex-1 rounded-[10px] border border-white/15 bg-[#18181B] px-4 text-base text-white placeholder:text-neutral-500 disabled:bg-neutral-900 sm:text-[15px]"
            />
            <button
              type="submit"
              disabled={isAnalyzing || isStarting || jobIsActive}
              className="h-12 shrink-0 rounded-[10px] bg-white px-6 text-[15px] font-semibold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
            >
              {isAnalyzing ? "확인 중..." : "영상 확인"}
            </button>
          </form>
        </section>

        {error && (
          <div role="alert" className="mt-6 rounded-[10px] border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <p>{error}</p>
              <button type="button" onClick={retry} className="shrink-0 rounded-lg border border-red-800 bg-red-950 px-3 py-1.5 font-semibold hover:bg-red-900">
                다시 시도
              </button>
            </div>
          </div>
        )}

        {video && (
          <section className="mt-10" aria-labelledby="video-heading">
            <h2 id="video-heading" className="mb-3 text-lg font-bold tracking-[-0.02em]">확인한 영상</h2>
            <div className="overflow-hidden rounded-[10px] border border-white/10 bg-[#141416]">
              <div className="flex flex-col sm:flex-row">
                {/* yt-dlp can return multiple YouTube image hosts, so a native image avoids an unsafe wildcard config. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={video.thumbnail_url} alt={`${video.title} 썸네일`} className="aspect-video w-full object-cover sm:w-[260px]" />
                <div className="flex min-w-0 flex-1 flex-col justify-center px-5 py-4">
                  <h3 className="line-clamp-2 text-base font-bold leading-6">{video.title}</h3>
                  <p className="mt-2 truncate text-sm text-neutral-400">{video.channel_name}</p>
                  <p className="mt-1 text-sm text-neutral-500">{formatDuration(video.duration_seconds)}</p>
                </div>
              </div>
              <div className="border-t border-white/10 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold">사용할 영상 구간</h3>
                    <p className="mt-1 text-xs leading-5 text-neutral-500">
                      이 범위 안에서 AI가 쇼츠 장면을 찾습니다.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold tabular-nums text-neutral-200">
                    {formatTimestamp(rangeStart)}–{formatTimestamp(rangeEnd)}
                  </span>
                </div>
                <div className="relative mt-5 h-8" aria-label="사용할 영상 범위">
                  <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-neutral-700" />
                  <div
                    className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
                    style={{
                      left: `${(rangeStart / video.duration_seconds) * 100}%`,
                      right: `${100 - (rangeEnd / video.duration_seconds) * 100}%`,
                    }}
                  />
                  <label className="sr-only" htmlFor="range-start">사용 시작 지점</label>
                  <input
                    id="range-start"
                    type="range"
                    min={0}
                    max={Math.max(1, Math.floor(video.duration_seconds))}
                    step={1}
                    value={rangeStart}
                    onChange={(event) => setRangeStart(Math.min(Number(event.target.value), rangeEnd - 1))}
                    disabled={isStarting || jobIsActive}
                    className="range-handle absolute inset-0 z-20 w-full"
                  />
                  <label className="sr-only" htmlFor="range-end">사용 종료 지점</label>
                  <input
                    id="range-end"
                    type="range"
                    min={0}
                    max={Math.max(1, Math.floor(video.duration_seconds))}
                    step={1}
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(Math.max(Number(event.target.value), rangeStart + 1))}
                    disabled={isStarting || jobIsActive}
                    className="range-handle absolute inset-0 z-10 w-full"
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs font-medium tabular-nums text-neutral-500">
                  <span>시작 {formatTimestamp(rangeStart)}</span>
                  <span>끝 {formatTimestamp(rangeEnd)}</span>
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-3 border-t border-white/10 px-5 py-4 text-sm leading-5">
                <input
                  type="checkbox"
                  checked={rightsConfirmed}
                  onChange={(event) => setRightsConfirmed(event.target.checked)}
                  disabled={isStarting || jobIsActive}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span>내가 소유하거나 사용 허가를 받은 영상입니다</span>
              </label>
            </div>
          </section>
        )}

        {video && (
          <section className="mt-10" aria-labelledby="template-heading">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 id="template-heading" className="text-lg font-bold tracking-[-0.02em]">템플릿 선택</h2>
                <p className="mt-1 text-sm text-neutral-500">영상에 적용할 스타일 하나를 고르세요.</p>
              </div>
              <span className="text-xs font-semibold text-neutral-500">{chosenTemplateName}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {templates.map((template) => {
                const selected = template.id === selectedTemplate;
                return (
                  <button
                    key={template.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedTemplate(template.id)}
                    disabled={isStarting || jobIsActive}
                    className={`rounded-[10px] border-2 bg-[#18181B] p-2.5 text-left transition-colors disabled:cursor-not-allowed ${selected ? "border-accent" : "border-white/5 hover:border-neutral-600"}`}
                  >
                    <TemplatePreview template={template} />
                    <span className="mt-2.5 block text-center text-sm font-semibold">{template.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {video && (
          <section className="mt-8" aria-label="쇼츠 생성">
            <button
              type="button"
              disabled={!canGenerate}
              onClick={startJob}
              className="h-[52px] w-full rounded-[10px] bg-white px-6 text-[15px] font-bold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
            >
              {isStarting ? "작업 시작 중..." : "쇼츠 생성하기"}
            </button>
            {!rightsConfirmed && <p className="mt-2 text-center text-xs text-neutral-500">권리 확인에 동의하면 생성할 수 있습니다.</p>}
          </section>
        )}

        {job && job.status !== "completed" && (
          <section className="mt-10 rounded-[10px] border border-white/10 bg-[#141416] p-5" aria-labelledby="progress-heading" aria-live="polite">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 id="progress-heading" className="font-bold">{statusLabels[job.status]}</h2>
                <p className="mt-1 text-sm text-neutral-400">{job.message}</p>
              </div>
              <span className="text-sm font-bold tabular-nums">{job.progress}%</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress}>
              <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
            </div>
          </section>
        )}

        {job?.status === "completed" && (
          <section className="mt-12" aria-labelledby="results-heading">
            <div className="mb-5">
              <p className="text-sm font-semibold text-accent">생성 완료</p>
              <h2 id="results-heading" className="mt-1 text-2xl font-bold tracking-[-0.03em]">완성된 쇼츠 {job.outputs.length}개</h2>
            </div>
            <div className="space-y-5">
              {job.outputs.map((output) => (
                <article key={output.id} className="rounded-[14px] border border-white/10 bg-[#141416] p-4 sm:p-5">
                  <h3 className="mb-4 text-lg font-bold leading-7 sm:text-xl">{output.title}</h3>
                  <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
                    <video
                      key={`${output.id}-${output.title}-${output.title_color}-${output.title_font_size}`}
                      className="aspect-[9/16] w-full rounded-[10px] bg-black"
                      src={`${absoluteFileUrl(output.video_url)}?v=${encodeURIComponent(`${output.title}-${output.title_font_size}`)}`}
                      aria-label={`${output.title} 미리보기`}
                      controls
                      playsInline
                      preload="metadata"
                    >
                      브라우저가 MP4 재생을 지원하지 않습니다.
                    </video>
                    <div className="flex min-w-0 flex-col">
                      <dl className="grid grid-cols-2 gap-3 text-xs text-neutral-400">
                      <div>
                        <dt className="text-neutral-500">영상 길이</dt>
                        <dd className="mt-0.5 font-semibold text-neutral-300">{formatDuration(output.duration_seconds)}</dd>
                      </div>
                      <div>
                        <dt className="text-neutral-500">원본 구간</dt>
                        <dd className="mt-0.5 font-semibold text-neutral-300">{formatTimestamp(output.start_seconds)}–{formatTimestamp(output.end_seconds)}</dd>
                      </div>
                      </dl>
                      <div className="mt-4 flex-1 rounded-[10px] border border-white/10 bg-black/25 p-4">
                        <p className="text-xs font-bold text-neutral-500">해당 구간의 텍스트</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-300">
                          {output.transcript_text || "이 구간에서 추출된 텍스트가 없습니다."}
                        </p>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void shareOutput(output)} className="h-10 rounded-lg border border-white/15 px-4 text-sm font-semibold hover:bg-white/10">공유</button>
                        <a href={absoluteFileUrl(output.download_url)} download className="flex h-10 items-center rounded-lg border border-white/15 px-4 text-sm font-semibold hover:bg-white/10">다운로드</a>
                        <button type="button" onClick={() => openEditor(output)} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black hover:bg-neutral-200">편집</button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        {editingOutput && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="edit-title-heading">
            <div className="w-full max-w-lg rounded-t-2xl border border-white/10 bg-[#18181B] p-5 shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 id="edit-title-heading" className="text-xl font-bold">영상 제목 편집</h2>
                <button type="button" onClick={() => setEditingOutput(null)} className="rounded-lg px-3 py-2 text-neutral-400 hover:bg-white/10 hover:text-white">닫기</button>
              </div>
              <label className="mt-5 block text-sm font-semibold" htmlFor="edit-title-text">제목 텍스트</label>
              <input id="edit-title-text" value={editTitle} maxLength={24} onChange={(event) => setEditTitle(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-white" />
              <p className="mt-1 text-right text-xs text-neutral-500">{editTitle.length}/24</p>
              <div className="mt-4 grid grid-cols-[1fr_110px] gap-4">
                <label className="text-sm font-semibold" htmlFor="edit-font-size">
                  글자 크기 <span className="text-neutral-400">{editFontSize}px</span>
                  <input id="edit-font-size" type="range" min={44} max={96} value={editFontSize} onChange={(event) => setEditFontSize(Number(event.target.value))} className="mt-3 w-full accent-accent" />
                </label>
                <label className="text-sm font-semibold" htmlFor="edit-color">
                  글자 색
                  <input id="edit-color" type="color" value={editColor} onChange={(event) => setEditColor(event.target.value)} className="mt-2 h-10 w-full cursor-pointer rounded-lg border border-white/15 bg-transparent p-1" />
                </label>
              </div>
              <button type="button" disabled={!editTitle.trim() || isSavingEdit} onClick={() => void saveEdit()} className="mt-6 h-12 w-full rounded-lg bg-white font-bold text-black disabled:bg-neutral-700 disabled:text-neutral-500">
                {isSavingEdit ? "영상 다시 만드는 중..." : "수정하고 다시 렌더링"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
