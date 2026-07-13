"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type {
  GeneratedShort,
  MvpState,
  OutputLanguage,
  TemplateId,
  UsageSnapshot,
  VideoJob,
} from "@/lib/contracts";
import { AI_CLIP_MIN_SECONDS, expectedShortCount, outputLanguageOptions } from "@/lib/contracts";

type Analysis = {
  videoId: string;
  normalizedUrl: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  durationSeconds: number;
  expectedShortCount: number;
};

const templates: Array<{ id: TemplateId; name: string; label: string; background: string; primary: string; accent: string; accentBackground: string | null; channel: string }> = [
  { id: "dark-red", name: "다크 레드", label: "지금 꼭 알아야 할\n핵심 한 가지", background: "#000000", primary: "#FFFFFF", accent: "#FFFFFF", accentBackground: "#E32626", channel: "#FFFFFF" },
  { id: "white-yellow", name: "화이트 옐로", label: "생각보다 쉬운\n핵심 한 가지", background: "#FFFFFF", primary: "#111111", accent: "#111111", accentBackground: "#FFD84D", channel: "#111111" },
  { id: "dark-minimal", name: "다크 미니멀", label: "놓치기 쉬운\n결정적 순간", background: "#000000", primary: "#FFFFFF", accent: "#F04444", accentBackground: null, channel: "#FFFFFF" },
  { id: "paper", name: "페이퍼", label: "오늘 바로 쓰는\n핵심 방법", background: "#F3F0E9", primary: "#111111", accent: "#D52B2B", accentBackground: null, channel: "#363636" },
];

function previewTitleLines(value: string) {
  const manual = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (manual.length > 1) return manual.slice(0, 2);
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= 20) return [clean || "핵심 장면"];
  const candidates = [...clean].map((character, index) => character === " " ? index : -1).filter((index) => index > 0 && index <= 20);
  const split = candidates.length ? candidates.reduce((best, index) => Math.abs(index - clean.length / 2) < Math.abs(best - clean.length / 2) ? index : best) : 20;
  return [clean.slice(0, split).trim(), clean.slice(split).trim().slice(0, 20)];
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
    <div className="brand-progress" role="progressbar" aria-label={`진행률 ${value}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} style={{ background: `conic-gradient(from -90deg, #ff5540 0%, #a078ff ${value}%, rgba(255,255,255,.18) ${value}% 100%)` }}>
      <span>{value}%</span>
    </div>
  );
}

function TemplatePreview({ template }: { template: (typeof templates)[number] }) {
  const [firstLine, secondLine] = template.label.split("\n");
  const isLight = template.id === "white-yellow" || template.id === "paper";
  const background = template.id === "paper" ? "bg-[#F3F0E9]" : isLight ? "bg-white" : "bg-black";
  const foreground = isLight ? "text-black" : "text-white";
  return (
    <div className={`relative mx-auto aspect-[9/16] w-full max-w-[164px] overflow-hidden rounded-lg ${background} ${foreground}`}>
      <div className="flex h-[22%] flex-col items-center justify-end px-2 pb-1.5 text-center text-[10px] font-extrabold leading-[1.25] sm:pb-2 sm:text-[11px]">
        <span>{firstLine}</span>
        {template.id === "dark-red" && <span className="mt-1 bg-[#E32626] px-1.5 py-0.5 text-white">{secondLine}</span>}
        {template.id === "white-yellow" && <span className="mt-1 bg-[#FFD84D] px-1.5 py-0.5">{secondLine}</span>}
        {template.id === "dark-minimal" && <span className="mt-1 text-[#F04444]">{secondLine}</span>}
        {template.id === "paper" && <span className="mt-1 text-[#D52B2B]">{secondLine}</span>}
      </div>
      <div className={`relative flex h-[56%] items-center justify-center overflow-hidden ${isLight ? "bg-neutral-300" : "bg-neutral-700"}`}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
        <div className={`h-9 w-9 rounded-full border-2 ${isLight ? "border-neutral-500" : "border-neutral-400"}`} aria-hidden="true" />
      </div>
      <div className={`flex h-[22%] items-start justify-center px-2 pt-1.5 text-[8px] font-semibold sm:pt-2 sm:text-[9px] ${template.id === "paper" ? "text-neutral-700" : ""}`}>
        <div className="flex items-center justify-center gap-1">
          <span className={`h-2.5 w-2.5 rounded-full ${isLight ? "bg-neutral-800" : "bg-white"}`} aria-hidden="true" />
          예시 채널명
        </div>
      </div>
    </div>
  );
}

function TemplatePicker({ value, onChange }: { value: TemplateId; onChange: (value: TemplateId) => void }) {
  const selectedName = templates.find((template) => template.id === value)?.name;
  return (
    <div id="templates">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">템플릿</h2>
          <p className="mt-1 text-sm text-neutral-500">실제 영상의 제목·영상·채널 영역을 미리 확인하세요.</p>
        </div>
        <span className="text-xs font-semibold text-red-300">{selectedName}</span>
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
              <TemplatePreview template={template} />
              <span className="mt-2.5 block text-center text-sm font-semibold">{template.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail || "요청을 처리하지 못했습니다.");
  }
  return response.json() as Promise<T>;
}

function Editor({ item, onClose, onChanged }: { item: GeneratedShort; onClose: () => void; onChanged: () => Promise<void> }) {
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
  const titleLines = previewTitleLines(title);
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
          <div className="absolute inset-x-0 top-0 flex h-[21.875%] flex-col items-center justify-end gap-1.5 px-5 pb-[4.1%] text-center font-extrabold leading-[1.18]" style={{ background: template.background, fontSize: `${20 * titleFontScale}px` }}>
            {titleLines.map((line, index) => <span key={`${line}-${index}`} className="max-w-full px-1.5 py-0.5" style={{ color: index === 0 ? template.primary : template.accent, background: index === 1 && template.accentBackground ? template.accentBackground : "transparent", borderRadius: template.accentBackground ? 4 : 0 }}>{line}</span>)}
          </div>
          {cleanVideoUrl ? <video className="absolute inset-x-0 top-[21.875%] h-[56.25%] w-full object-cover" src={cleanVideoUrl} controls playsInline onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} /> : <div className="absolute inset-x-0 top-[21.875%] flex h-[56.25%] items-center justify-center bg-black/50 text-sm text-neutral-400">클린 영상 준비 중</div>}
          {subtitlesEnabled && activeSubtitle && <div className="pointer-events-none absolute inset-x-5 bottom-[23.2%] z-10 rounded bg-black/75 px-2 py-1 text-center text-xs font-bold text-white">{activeSubtitle}</div>}
          <div className="absolute inset-x-0 bottom-0 flex h-[21.875%] items-start justify-center gap-2 pt-[4.4%] text-sm font-bold" style={{ background: template.background, color: template.channel }}><span className="relative mt-0.5 h-5 w-5 rounded-full" style={{ background: template.channel }}><span className="absolute left-1/2 top-[4px] h-1.5 w-1.5 -translate-x-1/2 rounded-full" style={{ background: template.background }} /><span className="absolute bottom-[3px] left-1/2 h-1.5 w-3 -translate-x-1/2 rounded-t-full" style={{ background: template.background }} /></span><span className="max-w-[72%] truncate">{channel}</span></div>
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><h2 id="editor-title" className="text-xl font-bold">쇼츠 편집</h2><p className="mt-1 text-xs text-neutral-500">왼쪽 미리보기에서 변경 내용을 실시간으로 확인하세요.</p></div><button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:bg-white/10">닫기</button></div>
          <label className="mt-5 block text-sm font-semibold">후킹 제목<textarea value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} rows={2} className="mt-2 w-full rounded-lg border border-white/15 bg-black/30 p-3" /></label>
          <p className={`mt-1 text-xs ${validTitle ? "text-neutral-500" : "text-red-400"}`}>최대 2줄·80자 ({title.length}/80)</p>
          <label className="mt-4 block text-sm font-semibold"><span className="flex items-center justify-between"><span>제목 글자 크기</span><strong className="text-red-300">{Math.round(titleFontScale * 100)}%</strong></span><input aria-label="제목 글자 크기" type="range" min={0.8} max={1.2} step={0.05} value={titleFontScale} onChange={(event) => setTitleFontScale(Number(event.target.value))} className="mt-3 w-full accent-red-500" /></label>
          <label className="mt-4 block text-sm font-semibold">채널명<input value={channel} onChange={(event) => setChannel(event.target.value)} maxLength={50} className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3" /></label>
          <label className="mt-4 flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={subtitlesEnabled} onChange={(event) => setSubtitlesEnabled(event.target.checked)} className="h-4 w-4 accent-red-500" />자동 자막 표시</label>
          {subtitlesEnabled && <div className="mt-3 max-h-44 space-y-2 overflow-y-auto rounded-lg border border-white/10 p-3">{segments.map((segment, index) => <label key={`${segment.start}-${index}`} className="grid grid-cols-[70px_1fr] items-center gap-2 text-xs text-neutral-500"><span>{formatTimestamp(segment.start)}</span><input value={segment.text} onChange={(event) => setSegments((current) => current.map((value, position) => position === index ? { ...value, text: event.target.value } : value))} className="h-9 rounded border border-white/10 bg-black/30 px-2 text-sm text-white" /></label>)}</div>}
          <div className="mt-5"><div className="mb-3 flex items-end justify-between"><div><h3 className="text-sm font-semibold">템플릿</h3><p className="mt-1 text-xs text-neutral-500">최종 영상의 제목·영상·채널 배치를 미리 확인하세요.</p></div><span className="text-xs font-semibold text-red-300">{template.name}</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{templates.map((value) => <button key={value.id} type="button" aria-pressed={templateId === value.id} onClick={() => setTemplateId(value.id)} className={`rounded-xl border-2 p-2 transition ${templateId === value.id ? "border-red-500 bg-red-500/10" : "border-white/10 bg-black/20 hover:border-white/25"}`}><TemplatePreview template={value} /><span className="mt-2 block text-center text-xs font-semibold">{value.name}</span></button>)}</div></div>
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
  const estimatedTotalSeconds = rerenderingShort
    ? Math.max(60, rerenderingShort.durationSeconds * 2)
    : Math.max(180, job.sourceDurationSeconds * 0.35 + job.expectedShortCount * 60);
  const remainingMinutes = rerenderingShort
    ? Math.max(1, Math.ceil(rerenderingShort.durationSeconds / 30))
    : Math.max(1, Math.ceil((estimatedTotalSeconds * (100 - Math.min(job.progress, 99))) / 100 / 60));
  const displayedProgress = rerenderingShort ? rerenderingShort.rerenderProgress : job.progress;
  return (
    <button type="button" onClick={onOpen} disabled={isProcessing} className={`project-card group text-left ${isProcessing ? "project-card-processing" : ""}`}>
      <div className="relative aspect-video overflow-hidden bg-neutral-900">
        {job.thumbnailUrl ? <Image src={job.thumbnailUrl} alt="" fill unoptimized className={`object-cover transition duration-300 group-hover:scale-[1.03] ${isProcessing ? "grayscale" : ""}`} /> : null}
        {!isProcessing && <span className="absolute bottom-2 right-2 rounded bg-black/75 px-2 py-1 text-[11px] font-semibold">{formatDuration(job.sourceDurationSeconds)}</span>}
        <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
        {isProcessing && <div className="project-processing-overlay"><ProgressRing progress={displayedProgress} /><strong>약 {remainingMinutes}분 남음</strong></div>}
      </div>
      <div className="p-4">
        <h3 className="line-clamp-1 text-sm font-bold text-white">{job.videoTitle}</h3>
        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
          <span className={rerenderingShort ? "text-violet-300" : job.status === "completed" ? "text-emerald-400" : job.status === "failed" ? "text-red-400" : "text-neutral-400"}>{rerenderingShort ? "● 수정 반영 중" : job.status === "completed" ? "● 완료" : job.status === "failed" ? "● 생성 실패" : "● 생성 중"}</span>
          <span>{isProcessing && !rerenderingShort ? `최대 쇼츠 ${job.expectedShortCount}개` : `쇼츠 ${readyCount || job.shorts.length}개`}</span>
          <span>{new Date(job.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</span>
        </div>
      </div>
    </button>
  );
}

function ProjectWorkspace({ job, onBack, onChanged }: { job: VideoJob; onBack: () => void; onChanged: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState(job.shorts[0]?.id || "");
  const [accessUrls, setAccessUrls] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const selected = job.shorts.find((item) => item.id === selectedId) || job.shorts[0];

  useEffect(() => {
    let cancelled = false;
    Promise.all(job.shorts.filter((item) => item.status === "ready" || item.status === "rerendering").map(async (item) => {
      const value = await requestJson<{ url: string }>(`/api/shorts/${item.id}/access`);
      return [item.id, value.url] as const;
    })).then((entries) => { if (!cancelled) setAccessUrls(Object.fromEntries(entries)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [job.shorts]);

  const download = async (item: GeneratedShort) => {
    if (item.status !== "ready") return;
    const url = accessUrls[item.id];
    if (!url) return;
    const response = await fetch(url);
    const objectUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${item.hookTitle.replace(/[^0-9A-Za-z가-힣 _-]/g, "").trim() || "shorts"}.mp4`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  };

  if (!selected) return <div className="project-workspace"><button onClick={onBack}>← 프로젝트로 돌아가기</button><p className="m-auto text-neutral-500">아직 생성된 쇼츠가 없습니다.</p></div>;
  const selectedUrl = accessUrls[selected.id] || null;
  const selectedIsRerendering = selected.status === "rerendering";
  const selectedRemainingMinutes = Math.max(1, Math.ceil(selected.durationSeconds / 30));
  return (
    <div className="project-workspace">
      <header className="workspace-header">
        <div className="min-w-0"><button onClick={onBack} className="text-xs font-semibold text-neutral-400 hover:text-white">← 내 프로젝트</button><h1 className="mt-1 truncate text-lg font-bold">{job.videoTitle}</h1></div>
        <div className="flex shrink-0 gap-2"><button disabled={selectedIsRerendering} onClick={() => setEditing(true)} className="workspace-button disabled:opacity-40">✦ 템플릿 적용</button><button onClick={() => void Promise.all(job.shorts.map(download))} className="workspace-button workspace-button-primary">↓ 모든 쇼츠 다운로드</button></div>
      </header>
      <div className="workspace-body">
        <aside className="shorts-rail">
          <div className="flex items-center justify-between border-b border-white/10 p-4"><strong className="text-sm">생성된 쇼츠 ({job.shorts.length})</strong><span className="text-xs text-neutral-500">타임라인순</span></div>
          <div className="space-y-3 overflow-y-auto p-3">{job.shorts.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`rail-card ${selected.id === item.id ? "rail-card-active" : ""}`}><div className="flex aspect-[9/16] w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-black text-[10px] text-neutral-600">{accessUrls[item.id] ? <video src={accessUrls[item.id]} muted preload="metadata" className="h-full w-full object-cover" /> : "VIDEO"}</div><div className="min-w-0 flex-1 py-1"><span className="text-[10px] text-violet-300">✦ 하이라이트 훅</span><h3 className="mt-1 line-clamp-3 text-left text-xs font-semibold leading-5">{item.hookTitle}</h3><span className="mt-2 block text-left text-[10px] text-neutral-500">{formatDuration(item.durationSeconds)}</span></div></button>)}</div>
        </aside>
        <main className="preview-stage"><div className="relative overflow-hidden rounded-xl shadow-2xl">{selectedUrl ? <video key={`${selected.id}-${selected.renderVersion}`} src={selectedUrl} controls={!selectedIsRerendering} playsInline className={`max-h-full max-w-full ${selectedIsRerendering ? "grayscale" : ""}`} /> : <div className="flex aspect-[9/16] h-[70vh] items-center justify-center bg-black text-sm text-neutral-500">영상 준비 중</div>}{selectedIsRerendering && <div className="project-processing-overlay"><ProgressRing progress={selected.rerenderProgress} /><strong>약 {selectedRemainingMinutes}분 남음</strong></div>}</div></main>
        <aside className="tools-panel">
          <div className="rounded-xl border border-violet-400/20 bg-violet-400/10 p-4 text-xs leading-5 text-neutral-300"><strong className="block text-violet-200">✦ AI 하이라이트</strong>시청자의 관심을 끌 장면을 앞부분에 배치했어요. 편집에서 제목과 자막, 템플릿을 바꿀 수 있습니다.</div>
          <div><h2 className="tool-heading">빠른 작업</h2><div className="grid grid-cols-2 gap-2"><button disabled={selectedIsRerendering} onClick={() => setEditing(true)} className="tool-button bg-blue-600 disabled:opacity-40">✎ 편집하기</button><button disabled={!selectedUrl || selectedIsRerendering} onClick={() => void download(selected)} className="tool-button bg-emerald-700 disabled:opacity-40">↓ 다운로드</button></div></div>
          <div><h2 className="tool-heading">제목</h2><div className="tool-field">{selected.hookTitle}</div></div>
          <div><h2 className="tool-heading">원본 영상 타임라인</h2><div className="tool-field">◷ {formatTimestamp(selected.startSeconds)} ~ {formatTimestamp(selected.endSeconds)}</div></div>
          <div className="min-h-0 flex-1"><h2 className="tool-heading">스크립트</h2><div className="tool-field h-full overflow-y-auto leading-6">{selected.subtitleSegments.map((segment) => segment.text).join(" ") || "추출된 스크립트가 없습니다."}</div></div>
        </aside>
      </div>
      {editing && <Editor item={selected} onClose={() => setEditing(false)} onChanged={onChanged} />}
    </div>
  );
}

export function ShortsApp() {
  const [state, setState] = useState<MvpState | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("ko");
  const [rangeStartSeconds, setRangeStartSeconds] = useState(0);
  const [rangeEndSeconds, setRangeEndSeconds] = useState(0);
  const [templateId, setTemplateId] = useState<TemplateId>("dark-red");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [activeJob, setActiveJob] = useState<VideoJob | null>(null);
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);
  const [scrollToProjects, setScrollToProjects] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollStarted = useRef(0);
  const analysisSectionRef = useRef<HTMLElement>(null);
  const languageSectionRef = useRef<HTMLElement>(null);
  const projectsSectionRef = useRef<HTMLElement>(null);
  const activeJobId = activeJob?.id;
  const activeJobStatus = activeJob?.status;
  const activeJobHasRerendering = Boolean(activeJob?.shorts.some((item) => item.status === "rerendering"));
  const hasBackgroundWork = Boolean(state?.recentJobs.some((job) => !terminalStatuses.has(job.status) || job.shorts.some((item) => item.status === "rerendering")));

  const loadState = useCallback(async () => {
    const value = await requestJson<MvpState>("/api/mvp/state");
    setState(value);
    const running = value.recentJobs.find((job) => !terminalStatuses.has(job.status));
    const rerendering = value.recentJobs.find((job) => job.shorts.some((item) => item.status === "rerendering"));
    setActiveJob(running || rerendering || value.recentJobs[0] || null);
  }, []);

  useEffect(() => { void loadState().catch((cause) => setError(cause instanceof Error ? cause.message : "초기화 실패")); }, [loadState]);

  useEffect(() => {
    if (!analysis) return;
    const frame = window.requestAnimationFrame(() => {
      languageSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [analysis]);

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
    let timer: number;
    const poll = async () => {
      try {
        const value = await requestJson<{ job: VideoJob; usage: UsageSnapshot }>(`/api/jobs/${activeJobId}`);
        if (stopped) return;
        setActiveJob(value.job);
        setState((current) => current ? { ...current, usage: value.usage, recentJobs: current.recentJobs.map((job) => job.id === value.job.id ? value.job : job) } : current);
        const hasRerendering = value.job.shorts.some((item) => item.status === "rerendering");
        if (terminalStatuses.has(value.job.status) && !hasRerendering) { pollStarted.current = 0; await loadState(); return; }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "작업 상태 확인 실패"); }
      const elapsed = Date.now() - pollStarted.current;
      timer = window.setTimeout(poll, elapsed < 30_000 ? 3_000 : elapsed < 300_000 ? 6_000 : 10_000);
    };
    timer = window.setTimeout(poll, 3_000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [activeJobHasRerendering, activeJobId, activeJobStatus, loadState]);

  useEffect(() => {
    if (!allowConcurrentJobs || !hasBackgroundWork) return;
    const timer = window.setInterval(() => { void loadState(); }, 5_000);
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
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const value = await requestJson<Analysis>("/api/youtube/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ youtubeUrl }) });
      setAnalysis(value);
      setRangeStartSeconds(0);
      setRangeEndSeconds(value.durationSeconds);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "영상 확인 실패"); }
    finally { setBusy(false); }
  };

  const createJob = async () => {
    if (!analysis || !rightsConfirmed) return;
    setBusy(true); setError(null);
    try {
      const value = await requestJson<{ jobId: string; usage: UsageSnapshot }>("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ youtubeUrl: analysis.normalizedUrl, templateId, outputLanguage, rangeStartSeconds, rangeEndSeconds, rightsConfirmed: true, requestId: crypto.randomUUID() }) });
      const pendingJob: VideoJob = { id: value.jobId, videoTitle: analysis.title, channelName: analysis.channelName, thumbnailUrl: analysis.thumbnailUrl, sourceDurationSeconds: analysis.durationSeconds, outputLanguage, expectedShortCount: analysis.expectedShortCount, status: "queued", stage: "queued", progress: 5, errorMessage: null, createdAt: new Date().toISOString(), shorts: [] };
      setState((current) => current ? { ...current, usage: value.usage, recentJobs: [pendingJob, ...current.recentJobs.filter((job) => job.id !== pendingJob.id)] } : current);
      setActiveJob(pendingJob);
      setScrollToProjects(true);
      pollStarted.current = Date.now();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "작업 생성 실패"); }
    finally { setBusy(false); }
  };

  return (
    <div className="app-shell min-h-screen text-neutral-100">
      <div className="ambient ambient-coral" aria-hidden="true" />
      <div className="ambient ambient-violet" aria-hidden="true" />
      <header className="site-header">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-3" aria-label="Easy Cut 홈">
            <span className="brand-mark" aria-hidden="true"><Image src="/east-cut-logo.png" alt="" width={34} height={34} priority /></span>
            <span className="brand-type">Easy <em>Cut</em></span>
          </a>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-neutral-300 md:flex" aria-label="주요 메뉴">
            <a href="#templates" className="nav-link">템플릿</a>
            <Link href="/pricing" className="nav-link">가격</Link>
            <a href="#results" className="nav-link">대시보드</a>
          </nav>
          <a href="#workspace" className="header-cta">로그인 <span aria-hidden="true">→</span></a>
        </div>
      </header>
      <main id="top" className="relative mx-auto max-w-6xl space-y-10 px-5 pb-20 pt-12 sm:px-8 sm:pt-20">
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
          <strong className="text-2xl font-extrabold tabular-nums text-white">{(state?.generatedShortCount ?? 4321).toLocaleString("ko-KR")}</strong>
          <p className="text-xs font-medium text-[#c99d97]">지금까지 생성된 쇼츠</p>
        </div>
      </section>
      {error && <div role="alert" className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">{error}</div>}
      {analysis && <section ref={languageSectionRef} className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#141416] p-5 sm:scroll-mt-28"><label htmlFor="output-language" className="text-xl font-bold">제목 언어</label><p className="mt-1 text-sm text-neutral-500">원본 영상 언어와 관계없이 선택한 언어로 후킹 제목을 만듭니다.</p><select id="output-language" value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value as OutputLanguage)} className="mt-3 h-12 w-full rounded-xl border border-white/10 bg-[#141416] px-4 text-sm text-neutral-100 outline-none focus:border-red-500 sm:max-w-xs">{outputLanguageOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></section>}
      {analysis && <section ref={analysisSectionRef} className="scroll-mt-24 space-y-8 sm:scroll-mt-28"><div className="overflow-hidden rounded-2xl border border-white/10 bg-[#141416] sm:flex"><Image src={analysis.thumbnailUrl} alt="영상 썸네일" width={480} height={270} unoptimized className="aspect-video w-full object-cover sm:w-72" /><div className="p-5"><h2 className="text-lg font-bold">{analysis.title}</h2><p className="mt-2 text-sm text-neutral-400">{analysis.channelName}</p><p className="mt-4 text-sm">원본 영상 {formatDuration(analysis.durationSeconds)} · 선택 구간 예상 쇼츠 {expectedShortCount(selectedDurationSeconds)}개</p><p className="mt-1 text-xs text-neutral-500">이번 작업은 선택한 구간 {formatDuration(selectedDurationSeconds)}만 사용량으로 계산됩니다.</p></div></div><div className="rounded-2xl border border-white/10 bg-[#141416] p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">사용할 영상 구간</h2><p className="mt-1 text-sm text-neutral-500">기본값은 영상 전체입니다. 양쪽 슬라이더로 시작과 끝을 정하세요.</p></div><strong className="text-red-300">{formatTimestamp(rangeStartSeconds)}–{formatTimestamp(rangeEndSeconds)}</strong></div><div className="relative mt-6 h-8"><div className="absolute inset-x-0 top-3 h-2 rounded-full bg-neutral-800" /><div className="absolute top-3 h-2 rounded-full bg-red-500" style={{ left: `${(rangeStartSeconds / analysis.durationSeconds) * 100}%`, right: `${100 - (rangeEndSeconds / analysis.durationSeconds) * 100}%` }} /><input aria-label="시작 지점" type="range" min={0} max={analysis.durationSeconds} step={1} value={rangeStartSeconds} onChange={(event) => setRangeStartSeconds(Math.min(Number(event.target.value), rangeEndSeconds - 1))} className="range-thumb absolute inset-x-0 top-0 w-full" /><input aria-label="끝 지점" type="range" min={0} max={analysis.durationSeconds} step={1} value={rangeEndSeconds} onChange={(event) => setRangeEndSeconds(Math.max(Number(event.target.value), rangeStartSeconds + 1))} className="range-thumb absolute inset-x-0 top-0 w-full" /></div><div className="mt-3 flex justify-between text-xs text-neutral-500"><span>0:00</span><span>선택 {formatDuration(selectedDurationSeconds)}</span><span>{formatTimestamp(analysis.durationSeconds)}</span></div>{!rangeIsValid && <p className="mt-3 text-sm text-red-400">AI 쇼츠 생성을 위해 최소 {AI_CLIP_MIN_SECONDS}초 구간이 필요합니다.</p>}<button type="button" onClick={() => { setRangeStartSeconds(0); setRangeEndSeconds(analysis.durationSeconds); }} className="mt-4 rounded-lg border border-white/15 px-3 py-2 text-sm">전체 구간으로 초기화</button></div><TemplatePicker value={templateId} onChange={setTemplateId} /><label className="flex items-start gap-3 rounded-xl border border-white/10 p-4 text-sm"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-red-500" />내가 소유하거나 사용 허가를 받은 영상입니다.</label><button disabled={!rightsConfirmed || !rangeIsValid || busy || (!allowConcurrentJobs && Boolean(activeJob && !terminalStatuses.has(activeJob.status)))} onClick={() => void createJob()} className="h-[52px] w-full rounded-xl bg-white py-4 font-bold text-black disabled:bg-neutral-800 disabled:text-neutral-500">쇼츠 생성하기</button></section>}
      {state?.recentJobs.length ? <section id="results" ref={projectsSectionRef} className="scroll-mt-24 sm:scroll-mt-28"><div className="mb-5 flex items-center gap-2"><h2 className="text-2xl font-bold">내 프로젝트</h2><span className="text-sm text-neutral-500">({state.recentJobs.length})</span></div><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{state.recentJobs.map((job) => <ProjectCard key={job.id} job={job} onOpen={() => setOpenedProjectId(job.id)} />)}</div></section> : null}
    </main>
    <footer className="site-footer"><div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between"><div><span className="brand-type">Easy <em>Cut</em></span><p className="mt-2 text-xs text-neutral-500">© 2026 Easy Cut. 아카이브를 바이럴 콘텐츠로 변환하세요.</p></div><div className="flex flex-wrap gap-6 text-xs text-neutral-400"><a href="#">이용약관</a><a href="#">개인정보처리방침</a><a href="#">고객 지원</a><a href="#">제휴 프로그램</a></div></div></footer>
    </div>
  );
}
