"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { SiteHeader } from "@/components/site-header";
import { TitleOverlayPreview } from "@/components/title-overlay-preview";
import type {
  GeneratedShort,
  MvpState,
  OutputLanguage,
  TemplateId,
  UsageSnapshot,
  VideoAspectRatio,
  VideoJob,
  YoutubeAnalysis,
} from "@/lib/contracts";
import { AI_CLIP_MIN_SECONDS, expectedShortCount, outputLanguageOptions, videoAspectRatioOptions } from "@/lib/contracts";
import { isPlaybackAvailable, shortPlaybackVersionKey } from "@/lib/project-playback";
import { stateRetryDelayMs } from "@/lib/state-loading";
import { titleLineBackground, titleLineColor } from "@/lib/title-preview";

const templates: Array<{ id: TemplateId; name: string; label: string; background: string; primary: string; accent: string; accentBackground: string | null; channel: string }> = [
  { id: "dark-red", name: "다크 레드", label: "지금 꼭 알아야 할\n핵심 한 가지", background: "#000000", primary: "#FFFFFF", accent: "#FFFFFF", accentBackground: "#E32626", channel: "#FFFFFF" },
  { id: "white-yellow", name: "화이트 옐로", label: "생각보다 쉬운\n핵심 한 가지", background: "#FFFFFF", primary: "#111111", accent: "#111111", accentBackground: "#FFD84D", channel: "#111111" },
  { id: "dark-minimal", name: "다크 미니멀", label: "놓치기 쉬운\n결정적 순간", background: "#000000", primary: "#FFFFFF", accent: "#F04444", accentBackground: null, channel: "#FFFFFF" },
  { id: "paper", name: "페이퍼", label: "오늘 바로 쓰는\n핵심 방법", background: "#F3F0E9", primary: "#111111", accent: "#D52B2B", accentBackground: null, channel: "#363636" },
];

function aspectLayout(value: VideoAspectRatio) {
  const option = videoAspectRatioOptions.find((item) => item.value === value)
    || videoAspectRatioOptions.find((item) => item.value === "1:1")!;
  const videoHeight = option.height / 19.2;
  const videoTop = (100 - videoHeight) / 2;
  const fullVertical = value === "9:16";
  const subtitleMargin = fullVertical
    ? 445
    : 1920 - (Math.round(videoTop * 19.2) + option.height - Math.max(64, Math.round(option.height * 0.08)));
  return { option, videoHeight, videoTop, fullVertical, subtitleBottom: subtitleMargin / 19.2 };
}

const terminalStatuses = new Set(["completed", "failed", "expired", "deleted"]);
const allowConcurrentJobs = process.env.NEXT_PUBLIC_ALLOW_CONCURRENT_JOBS === "true";
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

function ProgressRing({ progress }: { progress: number }) {
  const target = Math.max(1, Math.min(99, Math.round(Number.isFinite(progress) ? progress : 1)));
  const [value, setValue] = useState(target);

  useEffect(() => {
    setValue((current) => target < current ? target : current);
    const timer = window.setInterval(() => {
      setValue((current) => {
        if (current >= target) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 45);
    return () => window.clearInterval(timer);
  }, [target]);

  return (
    <div className="brand-progress" role="progressbar" aria-label={`진행률 ${value}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className="brand-progress-spinner" aria-hidden="true" style={{ background: `conic-gradient(from -90deg, #ff5540 0%, #a078ff ${value}%, rgba(255,255,255,.18) ${value}% 100%)` }} />
      <span className="brand-progress-value">{value}%</span>
    </div>
  );
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

function TemplatePreview({ template, videoAspectRatio, channelName, channelThumbnailUrl }: { template: (typeof templates)[number]; videoAspectRatio: VideoAspectRatio; channelName: string; channelThumbnailUrl: string | null }) {
  const [firstLine, secondLine] = template.label.split("\n");
  const isLight = template.id === "white-yellow" || template.id === "paper";
  const foreground = isLight ? "text-black" : "text-white";
  const layout = aspectLayout(videoAspectRatio);
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
      <div data-template-title className={`absolute inset-x-0 z-10 flex flex-col items-center justify-end px-[4.9cqw] text-center text-[6.7cqw] font-extrabold leading-[1.25] ${videoAspectRatio === "4:5" ? "pb-[1.2cqw]" : "pb-[4.9cqw]"}`} style={layout.fullVertical ? { top: "5%", height: "18.75%" } : { top: 0, height: `${layout.videoTop}%` }}>
        {previewLine(firstLine, 0)}
        {previewLine(secondLine, 1)}
      </div>
      <div className={`absolute inset-x-0 flex items-center justify-center overflow-hidden ${isLight ? "bg-neutral-300" : "bg-neutral-700"}`} style={{ top: `${layout.videoTop}%`, height: `${layout.videoHeight}%` }}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
        <div className={`h-[22cqw] w-[22cqw] rounded-full border-2 ${isLight ? "border-neutral-500" : "border-neutral-400"}`} aria-hidden="true" />
      </div>
      <div className={`absolute inset-x-0 z-10 flex items-start justify-center px-[4.9cqw] pt-[4.9cqw] text-[5.5cqw] font-semibold ${template.id === "paper" ? "text-neutral-700" : ""}`} style={layout.fullVertical ? { bottom: "6.25%", height: "9.375%" } : { top: `${layout.videoTop + layout.videoHeight}%`, height: `${layout.videoTop}%` }}>
        <div className="flex items-center justify-center gap-[2.4cqw] whitespace-nowrap">
          <ChannelAvatar url={channelThumbnailUrl} className="h-[6.1cqw] w-[6.1cqw]" fallbackForeground={template.channel} fallbackBackground={template.background} sizes="10px" />
          <span className="max-w-[70cqw] truncate">{channelName}</span>
        </div>
      </div>
    </div>
  );
}

function TemplatePicker({ value, onChange, videoAspectRatio, onVideoAspectRatioChange, channelName, channelThumbnailUrl }: { value: TemplateId; onChange: (value: TemplateId) => void; videoAspectRatio: VideoAspectRatio; onVideoAspectRatioChange: (value: VideoAspectRatio) => void; channelName: string; channelThumbnailUrl: string | null }) {
  const selectedName = templates.find((template) => template.id === value)?.name;
  return (
    <div id="templates">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">템플릿</h2>
          <span className="text-xs font-semibold text-red-300">{selectedName}</span>
        </div>
        <fieldset className="min-w-0">
          <legend className="mb-2 text-xs font-semibold text-neutral-400">영상 비율</legend>
          <div className="flex flex-wrap gap-1.5">
            {videoAspectRatioOptions.map((option) => {
              const selected = videoAspectRatio === option.value;
              return <button key={option.value} type="button" aria-pressed={selected} onClick={() => onVideoAspectRatioChange(option.value)} className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${selected ? "border-red-500 bg-red-500/15 text-white" : "border-white/10 bg-[#141416] text-neutral-400 hover:border-white/30"}`}><span>{option.label}</span><span className="ml-1 text-[10px] text-neutral-500">{option.value}</span></button>;
            })}
          </div>
        </fieldset>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {templates.map((template) => {
          const selected = value === template.id;
          return (
            <button
              key={template.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(template.id)}
              className={`rounded-xl border-2 bg-[#141416] p-2.5 transition ${selected ? "border-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]" : "border-white/10 hover:border-white/30"}`}
            >
              <TemplatePreview template={template} videoAspectRatio={videoAspectRatio} channelName={channelName} channelThumbnailUrl={channelThumbnailUrl} />
              <span className="mt-2.5 block text-center text-sm font-semibold">{template.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

class HttpRequestError extends Error {
  constructor(public readonly status: number, message: string) {
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
      throw new Error("응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw error;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new HttpRequestError(response.status, body.detail || "요청을 처리하지 못했습니다.");
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

function Editor({ item, channelThumbnailUrl, onClose, onChanged }: { item: GeneratedShort; channelThumbnailUrl: string | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(item.hookTitle);
  const [channel, setChannel] = useState(item.channelDisplayName);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(item.subtitlesEnabled);
  const [segments, setSegments] = useState(item.subtitleSegments);
  const [templateId, setTemplateId] = useState(item.templateId);
  const [titleFontScale, setTitleFontScale] = useState(item.titleFontScale || 1);
  const [cleanVideoUrl, setCleanVideoUrl] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validTitle = title.trim().length > 0 && title.length <= 80 && title.split("\n").length <= 2;
  const template = templates.find((value) => value.id === templateId) || templates[0];
  const editorLayout = aspectLayout(item.videoAspectRatio || "1:1");
  const activeSubtitle = segments.find((segment) => segment.start <= previewTime && segment.end > previewTime)?.text;

  useEffect(() => {
    let cancelled = false;
    requestJson<{ url: string }>(`/api/shorts/${item.id}/edit-source`)
      .then((value) => { if (!cancelled) setCleanVideoUrl(value.url); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "편집용 영상을 준비하지 못했습니다."); });
    return () => { cancelled = true; };
  }, [item.id]);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await requestJson(`/api/shorts/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hookTitle: title, channelDisplayName: channel, subtitlesEnabled, subtitleSegments: segments, templateId, titleFontScale }),
      });
      await requestJson(`/api/shorts/${item.id}/rerender`, { method: "POST" });
      await onChanged();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="grid max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[#151517] sm:grid-cols-[320px_1fr] sm:rounded-2xl">
        <div className="sticky top-0 mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden" style={{ background: template.background }}>
          <TitleOverlayPreview title={title} fontScale={titleFontScale} videoAspectRatio={item.videoAspectRatio || "1:1"} primary={template.primary} accent={template.accent} accentBackground={template.accentBackground} background={template.background} />
          {cleanVideoUrl ? <video className="absolute inset-x-0 w-full object-cover" style={{ top: `${editorLayout.videoTop}%`, height: `${editorLayout.videoHeight}%` }} src={cleanVideoUrl} controls playsInline onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} /> : <div className="absolute inset-x-0 flex items-center justify-center bg-black/50 text-sm text-neutral-400" style={{ top: `${editorLayout.videoTop}%`, height: `${editorLayout.videoHeight}%` }}>클린 영상 준비 중</div>}
          {subtitlesEnabled && activeSubtitle && <div className="pointer-events-none absolute inset-x-5 z-20 rounded bg-black/75 px-2 py-1 text-center text-xs font-bold text-white" style={{ bottom: `${editorLayout.subtitleBottom}%` }}>{activeSubtitle}</div>}
          <div className={`absolute inset-x-0 z-10 flex items-start justify-center gap-2 text-sm font-bold ${editorLayout.fullVertical ? "pt-5" : "pt-[4.4%]"}`} style={{ top: editorLayout.fullVertical ? "84.375%" : `${editorLayout.videoTop + editorLayout.videoHeight}%`, height: editorLayout.fullVertical ? "9.375%" : `${editorLayout.videoTop}%`, background: editorLayout.fullVertical ? "transparent" : template.background, color: template.channel }}><ChannelAvatar url={channelThumbnailUrl} className="mt-0.5 h-5 w-5" fallbackForeground={template.channel} fallbackBackground={template.background} sizes="20px" /><span className="max-w-[72%] truncate">{channel}</span></div>
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><h2 id="editor-title" className="text-xl font-bold">쇼츠 편집</h2><p className="mt-1 text-xs text-neutral-500">왼쪽 미리보기에서 변경 내용을 실시간으로 확인하세요.</p></div><button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:bg-white/10">닫기</button></div>
          <label className="mt-5 block text-sm font-semibold">후킹 제목<textarea value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} rows={2} className="mt-2 w-full rounded-lg border border-white/15 bg-black/30 p-3" /></label>
          <p className={`mt-1 text-xs ${validTitle ? "text-neutral-500" : "text-red-400"}`}>최대 2줄·80자 ({title.length}/80)</p>
          <label className="mt-4 block text-sm font-semibold"><span className="flex items-center justify-between"><span>제목 글자 크기</span><strong className="text-red-300">{Math.round(titleFontScale * 100)}%</strong></span><input aria-label="제목 글자 크기" type="range" min={0.8} max={1.2} step={0.05} value={titleFontScale} onChange={(event) => setTitleFontScale(Number(event.target.value))} className="mt-3 w-full accent-red-500" /></label>
          <label className="mt-4 block text-sm font-semibold">채널명<input value={channel} onChange={(event) => setChannel(event.target.value)} maxLength={50} className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3" /></label>
          <label className="mt-4 flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={subtitlesEnabled} onChange={(event) => setSubtitlesEnabled(event.target.checked)} className="h-4 w-4 accent-red-500" />자동 자막 표시</label>
          {subtitlesEnabled && <div className="mt-3 max-h-44 space-y-2 overflow-y-auto rounded-lg border border-white/10 p-3">{segments.map((segment, index) => <label key={`${segment.start}-${index}`} className="grid grid-cols-[70px_1fr] items-center gap-2 text-xs text-neutral-500"><span>{formatTimestamp(segment.start)}</span><input value={segment.text} onChange={(event) => setSegments((current) => current.map((value, position) => position === index ? { ...value, text: event.target.value } : value))} className="h-9 rounded border border-white/10 bg-black/30 px-2 text-sm text-white" /></label>)}</div>}
          <div className="mt-5"><div className="mb-3 flex items-end justify-between"><div><h3 className="text-sm font-semibold">템플릿</h3><p className="mt-1 text-xs text-neutral-500">최종 영상의 제목·영상·채널 배치를 미리 확인하세요.</p></div><span className="text-xs font-semibold text-red-300">{template.name}</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{templates.map((value) => <button key={value.id} type="button" aria-pressed={templateId === value.id} onClick={() => setTemplateId(value.id)} className={`rounded-xl border-2 p-2 transition ${templateId === value.id ? "border-red-500 bg-red-500/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}><TemplatePreview template={value} videoAspectRatio={item.videoAspectRatio || "1:1"} channelName={channel} channelThumbnailUrl={channelThumbnailUrl} /><span className="mt-2 block text-center text-xs font-semibold">{value.name}</span></button>)}</div></div>
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={onClose} className="h-11 rounded-lg border border-white/15 px-4 text-sm font-semibold">변경 취소</button><button disabled={!validTitle || !channel.trim() || saving} onClick={() => void save()} className="h-11 rounded-lg bg-white px-4 text-sm font-bold text-black disabled:opacity-40">{saving ? "처리 중..." : "영상에 적용"}</button></div>
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ job, onOpen }: { job: VideoJob; onOpen: () => void }) {
  const readyCount = job.shorts.filter((item) => item.status === "ready").length;
  const rerenderingShort = job.shorts.find((item) => item.status === "rerendering");
  const isProcessing = !terminalStatuses.has(job.status) || Boolean(rerenderingShort);
  const daysUntilExpiration = job.expiresAt
    ? Math.max(0, Math.ceil((new Date(job.expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;
  const estimatedTotalSeconds = rerenderingShort
    ? Math.max(60, rerenderingShort.durationSeconds * 2)
    : Math.max(180, job.sourceDurationSeconds * 0.35 + job.expectedShortCount * 60);
  const remainingMinutes = rerenderingShort
    ? Math.max(1, Math.ceil(rerenderingShort.durationSeconds / 30))
    : Math.max(1, Math.ceil((estimatedTotalSeconds * (100 - Math.min(job.progress, 99))) / 100 / 60));
  const displayedProgress = rerenderingShort ? rerenderingShort.rerenderProgress : job.progress;
  return (
    <button type="button" onClick={onOpen} disabled={isProcessing && readyCount === 0} className={`project-card group text-left ${isProcessing ? "project-card-processing" : ""}`}>
      <div className="relative aspect-video overflow-hidden bg-neutral-900">
        {job.thumbnailUrl ? <Image src={job.thumbnailUrl} alt="" fill unoptimized className={`object-cover transition duration-300 group-hover:scale-[1.03] ${isProcessing ? "grayscale" : ""}`} /> : null}
        {daysUntilExpiration !== null && <span className="absolute left-2 top-2 z-10 rounded bg-black/75 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">{daysUntilExpiration > 0 ? `${daysUntilExpiration}일 뒤 만료` : "오늘 만료"}</span>}
        {!isProcessing && <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[11px] font-semibold">{formatDuration(job.sourceDurationSeconds)}</span>}
        <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
        {isProcessing && readyCount === 0 && <div className="project-processing-overlay"><ProgressRing progress={displayedProgress} /><strong>약 {remainingMinutes}분 남음</strong></div>}
      </div>
      <div className="p-4">
        <h3 className="line-clamp-1 text-sm font-bold text-white">{job.videoTitle}</h3>
        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
          <span className={rerenderingShort ? "text-violet-300" : job.status === "completed" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-neutral-400"}>{rerenderingShort ? "● 수정 반영 중" : job.status === "completed" ? "● 완료" : job.status === "failed" ? "● 생성 실패" : job.status === "retry_waiting" ? "● 원본 영상을 준비하고 있습니다" : readyCount > 0 ? `● ${readyCount}개 먼저 완료` : "● 생성 중"}</span>
          {(!isProcessing || rerenderingShort) && <span>{`쇼츠 ${readyCount || job.shorts.length}개`}</span>}
          <span>{new Date(job.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
        </div>
        {job.status === "failed" && job.errorMessage && <p className="mt-3 line-clamp-3 text-xs leading-5 text-red-300">{job.errorMessage}</p>}
      </div>
    </button>
  );
}

function ProjectWorkspace({ job, onBack, onChanged }: { job: VideoJob; onBack: () => void; onChanged: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(job.shorts[0]?.id || "");
  const [accessUrls, setAccessUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const requestedAccessVersions = useRef(new Set<string>());
  const mounted = useRef(true);
  const selected = job.shorts.find((item) => item.id === selectedId) || job.shorts[0];

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

  if (!selected) return <div className="project-workspace"><button onClick={onBack}>← 프로젝트로 돌아가기</button><p className={`m-auto max-w-xl px-6 text-center leading-7 ${job.status === "failed" ? "text-red-300" : "text-neutral-500"}`}>{job.status === "failed" && job.errorMessage ? job.errorMessage : "아직 생성된 쇼츠가 없습니다."}</p></div>;
  return (
    <div className="project-workspace">
      <header className="workspace-header">
        <div className="min-w-0"><button onClick={onBack} className="text-xs font-semibold text-neutral-400 hover:text-white">← 내 프로젝트</button><div className="mt-1 flex min-w-0 items-center gap-3"><h1 className="truncate text-lg font-bold">{job.videoTitle}</h1><span className="shrink-0 text-xs text-neutral-500">쇼츠 {job.shorts.length}개</span></div></div>
        <button onClick={() => void Promise.all(job.shorts.map(download))} className="workspace-button workspace-button-primary shrink-0">↓ 모든 쇼츠 다운로드</button>
      </header>
      <main className="short-results-workspace">
        <div className="short-results-list">
          {job.shorts.map((item, index) => {
            const itemUrl = playbackUrl(item);
            const itemIsRerendering = item.status === "rerendering";
            const itemRemainingMinutes = Math.max(1, Math.ceil(item.durationSeconds / 30));
            const script = item.subtitleSegments.map((segment) => segment.text).join(" ") || "추출된 스크립트가 없습니다.";
            return (
              <article key={item.id} className="short-result-card">
                <div className="short-result-heading"><span>#{index + 1}</span><h2>{item.hookTitle}</h2></div>
                <div className="short-result-layout">
                  <div className="short-video-column">
                    <div className="short-video-shell">
                      {itemUrl ? <video key={shortPlaybackVersionKey(item)} src={itemUrl} controls={!itemIsRerendering} playsInline preload="metadata" className={itemIsRerendering ? "grayscale" : ""} /> : <div className="short-video-placeholder">영상 준비 중</div>}
                      <span className="short-duration-badge">{formatDuration(item.durationSeconds)}</span>
                      {itemIsRerendering && <div className="project-processing-overlay"><ProgressRing progress={item.rerenderProgress} /><strong>약 {itemRemainingMinutes}분 남음</strong></div>}
                    </div>
                    <div className="short-result-actions">
                      <button disabled={itemIsRerendering} onClick={() => { setSelectedId(item.id); setEditing(true); }} className="tool-button short-edit-button disabled:opacity-40">✎ 편집하기</button>
                      <button disabled={!itemUrl || itemIsRerendering} onClick={() => void download(item)} className="tool-button short-download-button disabled:opacity-40">↓ 다운로드</button>
                    </div>
                  </div>
                  <div className="short-detail-column">
                    <div className="short-highlight-note"><strong>✦ AI 하이라이트</strong><p>{item.highlightReason.trim() || "이 쇼츠의 선정 이유가 저장되지 않았습니다."}</p></div>
                    <div className="short-source-range"><span>원본 영상 타임라인</span><strong>◷ {formatTimestamp(item.startSeconds)} ~ {formatTimestamp(item.endSeconds)}</strong></div>
                    <section className="short-script-panel"><h3>스크립트</h3><p>{script}</p></section>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>
      {editing && <Editor item={selected} channelThumbnailUrl={job.channelThumbnailUrl} onClose={() => setEditing(false)} onChanged={onChanged} />}
    </div>
  );
}

export function ShortsApp() {
  const [state, setState] = useState<MvpState | null>(null);
  const [stateLoadStatus, setStateLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [stateLoadError, setStateLoadError] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [analysis, setAnalysis] = useState<YoutubeAnalysis | null>(null);
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("ko");
  const [rangeStartSeconds, setRangeStartSeconds] = useState(0);
  const [rangeEndSeconds, setRangeEndSeconds] = useState(0);
  const [templateId, setTemplateId] = useState<TemplateId>("dark-red");
  const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>("5:4");
  const [activeJob, setActiveJob] = useState<VideoJob | null>(null);
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginNext, setLoginNext] = useState("/");
  const [creationRestrictionOpen, setCreationRestrictionOpen] = useState(false);
  const [creationRestrictionReason, setCreationRestrictionReason] = useState<string | null>(null);
  const [concurrentJobNoticeOpen, setConcurrentJobNoticeOpen] = useState(false);
  const [scrollToAnalysis, setScrollToAnalysis] = useState(false);
  const [scrollToProjects, setScrollToProjects] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollStarted = useRef(0);
  const stateLoadInFlight = useRef<Promise<void> | null>(null);
  const analysisSectionRef = useRef<HTMLElement>(null);
  const projectsSectionRef = useRef<HTMLElement>(null);
  const activeJobId = activeJob?.id;
  const activeJobStatus = activeJob?.status;
  const activeJobHasRerendering = Boolean(activeJob?.shorts.some((item) => item.status === "rerendering"));
  const hasBackgroundWork = Boolean(state?.recentJobs.some((job) => !terminalStatuses.has(job.status) || job.shorts.some((item) => item.status === "rerendering")));
  const analysisCreationBlocked = Boolean(analysis && analysis.creationAllowed !== true);
  const activeJobBlocksCreation = Boolean(!allowConcurrentJobs && activeJob && !terminalStatuses.has(activeJob.status));
  const closeCreationRestriction = useCallback(() => setCreationRestrictionOpen(false), []);
  const closeConcurrentJobNotice = useCallback(() => setConcurrentJobNoticeOpen(false), []);

  const loadState = useCallback(async () => {
    if (stateLoadInFlight.current) return stateLoadInFlight.current;
    const task = (async () => {
      const value = await requestJson<MvpState>("/api/mvp/state", undefined, 12_000);
      setState(value);
      setStateLoadStatus("ready");
      setStateLoadError(null);
      const running = value.recentJobs.find((job) => !terminalStatuses.has(job.status));
      const rerendering = value.recentJobs.find((job) => job.shorts.some((item) => item.status === "rerendering"));
      setActiveJob(running || rerendering || value.recentJobs[0] || null);
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
    setError(authError);
    url.searchParams.delete("auth_error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const analysisId = new URL(window.location.href).searchParams.get("analysisId");
    if (!analysisId) return;
    setBusy(true);
    setError(null);
    requestJson<YoutubeAnalysis>(`/api/youtube/analyses/${encodeURIComponent(analysisId)}`)
      .then((value) => {
        setYoutubeUrl(value.normalizedUrl);
        setAnalysis(value);
        setRangeStartSeconds(0);
        setRangeEndSeconds(value.durationSeconds);
        setCreationRestrictionReason(
          value.creationAllowed ? null : value.creationBlockReason || "영상 이용 제한을 확인했습니다.",
        );
        setCreationRestrictionOpen(value.creationAllowed !== true);
        setScrollToAnalysis(true);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "인기 영상 정보를 불러오지 못했습니다."))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!scrollToAnalysis || !analysis) return;
    const frame = window.requestAnimationFrame(() => {
      analysisSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollToAnalysis(false);
    });
    return () => window.cancelAnimationFrame(frame);
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
    if (!allowConcurrentJobs || !hasBackgroundWork) return;
    const timer = window.setInterval(() => {
      void loadState().catch((cause) => setError(cause instanceof Error ? cause.message : "작업 상태 확인 실패"));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [hasBackgroundWork, loadState]);

  const selectedDurationSeconds = Math.max(0, rangeEndSeconds - rangeStartSeconds);
  const rangeIsValid = Boolean(
    analysis
    && rangeStartSeconds >= 0
    && rangeEndSeconds <= analysis.durationSeconds
    && selectedDurationSeconds >= AI_CLIP_MIN_SECONDS
  );

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

  const openedProject = state?.recentJobs.find((job) => job.id === openedProjectId) || null;
  if (openedProject) return <ProjectWorkspace job={openedProject} onBack={() => setOpenedProjectId(null)} onChanged={loadState} />;

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
      setRangeStartSeconds(0);
      setRangeEndSeconds(value.durationSeconds);
      setCreationRestrictionReason(
        value.creationAllowed ? null : value.creationBlockReason || "영상 이용 제한을 확인했습니다.",
      );
      setCreationRestrictionOpen(value.creationAllowed !== true);
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
      setCreationRestrictionReason(
        analysis.creationBlockReason || "이 영상은 쇼츠로 만들 수 없습니다.",
      );
      setCreationRestrictionOpen(true);
      return;
    }
    const next = `/?analysisId=${encodeURIComponent(analysis.analysisId)}`;
    if (!state?.user) {
      setLoginNext(next);
      setLoginOpen(true);
      return;
    }
    if (activeJobBlocksCreation) {
      setConcurrentJobNoticeOpen(true);
      return;
    }
    setBusy(true); setError(null);
    try {
      const value = await requestJson<{ jobId: string; usage: UsageSnapshot }>("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId: analysis.analysisId, templateId, videoAspectRatio, outputLanguage, rangeStartSeconds, rangeEndSeconds, requestId: crypto.randomUUID() }) });
      const pendingJob: VideoJob = { id: value.jobId, videoTitle: analysis.title, channelName: analysis.channelName, channelThumbnailUrl: analysis.channelThumbnailUrl, thumbnailUrl: analysis.thumbnailUrl, sourceDurationSeconds: analysis.durationSeconds, rangeDownloadStatus: "pending", downloadedMediaDurationSeconds: null, downloadedMediaBytes: null, rangeDownloadVerifiedAt: null, outputLanguage, expectedShortCount: analysis.expectedShortCount, status: "queued", stage: "queued", progress: 5, errorMessage: null, createdAt: new Date().toISOString(), expiresAt: null, shorts: [] };
      setState((current) => current ? { ...current, usage: value.usage, recentJobs: [pendingJob, ...current.recentJobs.filter((job) => job.id !== pendingJob.id)] } : current);
      setActiveJob(pendingJob);
      setScrollToProjects(true);
      pollStarted.current = Date.now();
      setYoutubeUrl("");
      setAnalysis(null);
      setRangeStartSeconds(0);
      setRangeEndSeconds(0);
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
      } else if (cause instanceof HttpRequestError && cause.message.includes("현재 처리 중인 작업")) {
        setConcurrentJobNoticeOpen(true);
      } else {
        setError(cause instanceof Error ? cause.message : "작업 생성 실패");
      }
    }
    finally { setBusy(false); }
  };

  return (
    <div className="app-shell flex min-h-screen flex-col text-neutral-100">
      <div className="ambient ambient-coral" aria-hidden="true" />
      <div className="ambient ambient-violet" aria-hidden="true" />
      <SiteHeader><AuthControls user={state?.user || null} next={loginNext} loginOpen={loginOpen} onLoginOpenChange={setLoginOpen} /></SiteHeader>
      <NoticeDialog
        open={creationRestrictionOpen && Boolean(creationRestrictionReason)}
        dialogId="creation-restriction"
        title="이 영상은 쇼츠를 만들 수 없습니다."
        description={creationRestrictionReason || "영상 이용 제한을 확인했습니다."}
        onClose={closeCreationRestriction}
      />
      <NoticeDialog
        open={concurrentJobNoticeOpen}
        dialogId="concurrent-job-notice"
        title="다른 쇼츠를 만들고 있어요"
        description={activeJob ? `“${activeJob.videoTitle}” 작업이 진행 중입니다. 현재 작업이 끝난 뒤 다시 생성해 주세요.` : "현재 다른 쇼츠 작업이 진행 중입니다. 작업이 끝난 뒤 다시 생성해 주세요."}
        variant="info"
        onClose={closeConcurrentJobNotice}
      />
      <main id="top" className="relative mx-auto w-full max-w-6xl flex-1 space-y-10 px-5 pb-20 pt-7 sm:px-8 sm:pt-10">
      <section className="hero mx-auto flex max-w-4xl flex-col items-center text-center">
        <h1 className="hero-title">유튜브 링크 하나로<br /><span>바이럴 숏폼을</span> 만들어보세요</h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-[#d5aaa4] sm:text-base">아래에 긴 영상 URL을 입력하세요.<br className="hidden sm:block" /> AI가 가장 몰입도 높은 순간을 자동으로 분석하고 편집합니다.</p>
        <form id="workspace" onSubmit={analyze} className="url-console mt-10 w-full max-w-3xl">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-4 flex items-center text-xl text-[#d7aaa4]" aria-hidden="true">↗</span>
            <input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="YouTube 영상 URL을 붙여 넣으세요" className="url-input" aria-label="YouTube 영상 URL" />
            <button type="button" onClick={() => void pasteYoutubeUrl()} className="paste-button" aria-label="클립보드에서 YouTube 링크 붙여넣기" title="붙여넣기"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><path d="M9 5.5h6M9.5 3h5a1 1 0 0 1 1 1v3h-7V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 5H6.75A1.75 1.75 0 0 0 5 6.75v12.5C5 20.216 5.784 21 6.75 21h10.5A1.75 1.75 0 0 0 19 19.25V6.75A1.75 1.75 0 0 0 17.25 5H16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
          </div>
          <button disabled={busy} className="ai-button">{busy ? "확인 중..." : "지금 변환하기"}<span aria-hidden="true">✦</span></button>
        </form>
        <div className="mt-10 flex flex-col items-center gap-1">
          <strong aria-busy={!state} className="min-h-8 text-2xl font-extrabold tabular-nums text-white">{state ? <CountUpNumber value={state.generatedShortCount} /> : "—"}</strong>
          <p className="text-xs font-medium text-[#c99d97]">지금까지 생성된 쇼츠</p>
        </div>
      </section>
      {error && <div role="alert" className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">{error}</div>}
      {stateLoadStatus === "error" && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-100"><div><p>서비스 상태를 불러오지 못했습니다.</p>{stateLoadError && <p className="mt-1 text-xs text-amber-300">{stateLoadError}</p>}</div><button type="button" onClick={retryStateLoad} className="rounded-lg border border-amber-300/30 px-3 py-2 font-semibold">다시 시도</button></div>}
      {analysis && <section id="shorts-settings" ref={analysisSectionRef} className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#141416] p-5 sm:scroll-mt-28"><label htmlFor="output-language" className="text-xl font-bold">제목 언어</label><p className="mt-1 text-sm text-neutral-500">원본 영상 언어와 관계없이 선택한 언어로 후킹 제목을 만듭니다.</p><select id="output-language" value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value as OutputLanguage)} className="mt-3 h-12 w-full rounded-xl border border-white/10 bg-[#141416] px-4 text-sm text-neutral-100 outline-none focus:border-red-500 sm:max-w-xs">{outputLanguageOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></section>}
      {analysis && <section className="scroll-mt-24 space-y-8 sm:scroll-mt-28"><div className="overflow-hidden rounded-2xl border border-white/10 bg-[#141416] sm:flex"><Image src={analysis.thumbnailUrl} alt="영상 썸네일" width={480} height={270} unoptimized className="aspect-video w-full object-cover sm:w-72" /><div className="p-5"><h2 className="text-lg font-bold">{analysis.title}</h2><p className="mt-2 text-sm text-neutral-400">{analysis.channelName}</p><p className="mt-4 text-sm">원본 영상 {formatDuration(analysis.durationSeconds)} · 선택 구간 예상 쇼츠 {expectedShortCount(selectedDurationSeconds)}개</p><p className="mt-1 text-xs text-neutral-500">이번 작업은 선택한 구간 {formatDuration(selectedDurationSeconds)}만 사용량으로 계산됩니다.</p></div></div><div className="rounded-2xl border border-white/10 bg-[#141416] p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">사용할 영상 구간</h2><p className="mt-1 text-sm text-neutral-500">기본값은 영상 전체입니다. 양쪽 슬라이더로 시작과 끝을 정하세요.</p></div><strong className="text-red-300">{formatTimestamp(rangeStartSeconds)}–{formatTimestamp(rangeEndSeconds)}</strong></div><div className="relative mt-6 h-8"><div className="absolute inset-x-0 top-3 h-2 rounded-full bg-neutral-800" /><div className="absolute top-3 h-2 rounded-full bg-red-500" style={{ left: `${(rangeStartSeconds / analysis.durationSeconds) * 100}%`, right: `${100 - (rangeEndSeconds / analysis.durationSeconds) * 100}%` }} /><input aria-label="시작 지점" type="range" min={0} max={analysis.durationSeconds} step={1} value={rangeStartSeconds} onChange={(event) => setRangeStartSeconds(Math.min(Number(event.target.value), rangeEndSeconds - 1))} className="range-thumb absolute inset-x-0 top-0 w-full" /><input aria-label="끝 지점" type="range" min={0} max={analysis.durationSeconds} step={1} value={rangeEndSeconds} onChange={(event) => setRangeEndSeconds(Math.max(Number(event.target.value), rangeStartSeconds + 1))} className="range-thumb absolute inset-x-0 top-0 w-full" /></div><div className="mt-3 flex justify-between text-xs text-neutral-500"><span>0:00</span><span>선택 {formatDuration(selectedDurationSeconds)}</span><span>{formatTimestamp(analysis.durationSeconds)}</span></div>{!rangeIsValid && <p className="mt-3 text-sm text-red-400">AI 쇼츠 생성을 위해 최소 {AI_CLIP_MIN_SECONDS}초 구간이 필요합니다.</p>}<button type="button" onClick={() => { setRangeStartSeconds(0); setRangeEndSeconds(analysis.durationSeconds); }} className="mt-4 rounded-lg border border-white/15 px-3 py-2 text-sm">전체 구간으로 초기화</button></div><TemplatePicker value={templateId} onChange={setTemplateId} videoAspectRatio={videoAspectRatio} onVideoAspectRatioChange={setVideoAspectRatio} channelName={analysis.channelName} channelThumbnailUrl={analysis.channelThumbnailUrl} />{analysisCreationBlocked && <button type="button" onClick={() => { setCreationRestrictionReason(analysis.creationBlockReason || "영상 이용 제한을 확인했습니다."); setCreationRestrictionOpen(true); }} className="min-h-11 w-full rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-100 transition hover:bg-red-500/15">생성 불가 사유 보기</button>}<button disabled={analysisCreationBlocked || !rangeIsValid || busy || stateLoadStatus !== "ready"} onClick={() => void createJob()} className="h-[52px] w-full rounded-xl bg-white py-4 font-bold text-black disabled:bg-neutral-800 disabled:text-neutral-500">{analysisCreationBlocked ? "쇼츠 생성 불가" : stateLoadStatus !== "ready" ? "로그인 확인 중..." : state?.user ? "쇼츠 생성하기" : "로그인 후 쇼츠 생성하기"}</button></section>}
      {state?.user && state.recentJobs.length ? <section id="results" ref={projectsSectionRef} className="scroll-mt-24 sm:scroll-mt-28"><div className="mb-5 flex items-center gap-2"><h2 className="text-2xl font-bold">내 프로젝트</h2><span className="text-sm text-neutral-500">({state.recentJobs.length})</span></div><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{state.recentJobs.map((job) => <ProjectCard key={job.id} job={job} onOpen={() => setOpenedProjectId(job.id)} />)}</div></section> : null}
    </main>
    <footer className="site-footer"><div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8"><div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between"><div><span className="brand-type">Easy <em>Cut</em></span><p className="mt-2 text-xs text-neutral-500">© 2026 Easy Cut. 아카이브를 바이럴 콘텐츠로 변환하세요.</p></div><div className="flex flex-wrap gap-6 text-xs text-neutral-400"><Link href="/terms">이용약관</Link><Link href="/privacy">개인정보처리방침</Link><Link href="/support">고객 지원</Link><a href="#">제휴 프로그램</a></div></div><p className="border-t border-white/5 pt-5 text-[11px] leading-5 text-neutral-600">아티룸 · 대표 김동민 · 사업자등록번호 638-04-03590 · 통신판매업 신고번호 2025-서울마포-2971 · 서울특별시 마포구 성산로8길 40 · 고객센터 010-3603-2874 · artiroom176@gmail.com</p></div></footer>
    </div>
  );
}
