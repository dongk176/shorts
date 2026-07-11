"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type {
  ClipLengthOption,
  GeneratedShort,
  MvpState,
  PlanCode,
  TemplateId,
  UsageSnapshot,
  VideoJob,
} from "@/lib/contracts";
import { clipLengthRules, expectedShortCount } from "@/lib/contracts";

type Analysis = {
  videoId: string;
  normalizedUrl: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  durationSeconds: number;
  expectedShortCount: number;
};

const clipOptions: Array<{ code: ClipLengthOption; label: string; description: string }> = [
  { code: "sec_30", label: "30초", description: "20~30초" },
  { code: "sec_31_60", label: "31초~1분", description: "약 45~55초" },
  { code: "sec_61_180", label: "1분 이상", description: "최대 3분" },
];

const templates: Array<{ id: TemplateId; name: string; label: string }> = [
  { id: "dark-red", name: "다크 레드", label: "지금 꼭 알아야 할\n핵심 한 가지" },
  { id: "white-yellow", name: "화이트 옐로", label: "생각보다 쉬운\n핵심 한 가지" },
  { id: "dark-minimal", name: "다크 미니멀", label: "놓치기 쉬운\n결정적 순간" },
  { id: "paper", name: "페이퍼", label: "오늘 바로 쓰는\n핵심 방법" },
];

const terminalStatuses = new Set(["completed", "failed", "expired", "deleted"]);
const stageLabels: Record<string, string> = {
  validating: "영상 정보를 확인하고 있습니다.",
  queued: "영상 작업을 기다리고 있습니다.",
  starting: "영상 작업을 시작하고 있습니다.",
  downloading: "원본 영상을 준비하고 있습니다.",
  transcribing: "영상 내용을 분석하고 있습니다.",
  selecting: "쇼츠로 만들 장면을 찾고 있습니다.",
  extracting: "편집용 영상을 준비하고 있습니다.",
  rendering: "쇼츠 영상을 만들고 있습니다.",
  uploading: "영상을 업로드하고 있습니다.",
  completed: "완료되었습니다.",
  failed: "영상 생성에 실패했습니다.",
};

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

function TemplatePreview({ template }: { template: (typeof templates)[number] }) {
  const [firstLine, secondLine] = template.label.split("\n");
  const isLight = template.id === "white-yellow" || template.id === "paper";
  const background = template.id === "paper" ? "bg-[#F3F0E9]" : isLight ? "bg-white" : "bg-black";
  const foreground = isLight ? "text-black" : "text-white";
  return (
    <div className={`relative mx-auto aspect-[9/16] w-full max-w-[164px] overflow-hidden rounded-lg ${background} ${foreground}`}>
      <div className="flex h-[22%] flex-col items-center justify-center px-2 text-center text-[10px] font-extrabold leading-[1.25] sm:text-[11px]">
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
      <div className={`flex h-[22%] items-center justify-center gap-1.5 px-2 text-[8px] font-semibold sm:text-[9px] ${template.id === "paper" ? "text-neutral-700" : ""}`}>
        <span className={`h-3 w-3 rounded-full ${isLight ? "bg-neutral-800" : "bg-white"}`} aria-hidden="true" />
        예시 채널명
      </div>
    </div>
  );
}

function TemplatePicker({ value, onChange }: { value: TemplateId; onChange: (value: TemplateId) => void }) {
  const selectedName = templates.find((template) => template.id === value)?.name;
  return (
    <div>
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

function UsageCard({ planName, usage }: { planName: string; usage: UsageSnapshot }) {
  const total = usage.usedSeconds + usage.reservedSeconds;
  const percentage = usage.limitSeconds ? (total / usage.limitSeconds) * 100 : 0;
  return (
    <section className="rounded-2xl border border-white/10 bg-[#141416] p-5" aria-labelledby="usage-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-red-400">이번 달 사용량</p>
          <h2 id="usage-heading" className="mt-1 text-xl font-bold">{planName}</h2>
        </div>
        <p className="text-sm font-semibold">{formatDuration(usage.usedSeconds)} / {formatDuration(usage.limitSeconds)}</p>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full bg-red-500" style={{ width: `${Math.min(100, percentage)}%` }} />
      </div>
      <div className="mt-3 grid gap-1 text-sm text-neutral-400 sm:grid-cols-3">
        <span>처리 중 {formatDuration(usage.reservedSeconds)}</span>
        <span>남음 {formatDuration(usage.remainingSeconds)}</span>
        <span className="sm:text-right">다음 초기화 {new Date(usage.nextResetAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" })}</span>
      </div>
      {percentage > 100 && !usage.enforcementEnabled && <p className="mt-3 text-xs text-amber-300">MVP에서는 한도를 초과해도 생성할 수 있습니다.</p>}
    </section>
  );
}

function Editor({ item, videoUrl, onClose, onChanged }: { item: GeneratedShort; videoUrl: string | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState(item.hookTitle);
  const [channel, setChannel] = useState(item.channelDisplayName);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(item.subtitlesEnabled);
  const [segments, setSegments] = useState(item.subtitleSegments);
  const [templateId, setTemplateId] = useState(item.templateId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validTitle = title.trim().length > 0 && title.length <= 40 && title.split("\n").length <= 2;

  const save = async (rerender: boolean) => {
    setSaving(true); setError(null);
    try {
      await requestJson(`/api/shorts/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hookTitle: title, channelDisplayName: channel, subtitlesEnabled, subtitleSegments: segments, templateId }),
      });
      if (rerender) await requestJson(`/api/shorts/${item.id}/rerender`, { method: "POST" });
      await onChanged();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="grid max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[#151517] sm:grid-cols-[280px_1fr] sm:rounded-2xl">
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden bg-black">
          {videoUrl ? <video className="h-full w-full object-cover" src={videoUrl} controls playsInline /> : <div className="flex h-full items-center justify-center text-sm text-neutral-500">영상 준비 중</div>}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[22%] items-center justify-center bg-black/90 px-5 text-center text-xl font-extrabold whitespace-pre-line">{title}</div>
          {subtitlesEnabled && segments[0]?.text && <div className="pointer-events-none absolute inset-x-5 bottom-[23%] rounded bg-black/75 px-2 py-1 text-center text-xs">{segments[0].text}</div>}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[22%] items-center justify-center bg-black/90 px-4 text-center font-bold">{channel}</div>
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><h2 id="editor-title" className="text-xl font-bold">텍스트 편집</h2><button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:bg-white/10">닫기</button></div>
          <label className="mt-5 block text-sm font-semibold">후킹 제목<textarea value={title} onChange={(event) => setTitle(event.target.value)} maxLength={40} rows={2} className="mt-2 w-full rounded-lg border border-white/15 bg-black/30 p-3" /></label>
          <p className={`mt-1 text-xs ${validTitle ? "text-neutral-500" : "text-red-400"}`}>최대 2줄·40자 ({title.length}/40)</p>
          <label className="mt-4 block text-sm font-semibold">채널명<input value={channel} onChange={(event) => setChannel(event.target.value)} maxLength={50} className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3" /></label>
          <label className="mt-4 flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={subtitlesEnabled} onChange={(event) => setSubtitlesEnabled(event.target.checked)} className="h-4 w-4 accent-red-500" />자동 자막 표시</label>
          {subtitlesEnabled && <div className="mt-3 max-h-44 space-y-2 overflow-y-auto rounded-lg border border-white/10 p-3">{segments.map((segment, index) => <label key={`${segment.start}-${index}`} className="grid grid-cols-[70px_1fr] items-center gap-2 text-xs text-neutral-500"><span>{formatTimestamp(segment.start)}</span><input value={segment.text} onChange={(event) => setSegments((current) => current.map((value, position) => position === index ? { ...value, text: event.target.value } : value))} className="h-9 rounded border border-white/10 bg-black/30 px-2 text-sm text-white" /></label>)}</div>}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{templates.map((template) => <button key={template.id} onClick={() => setTemplateId(template.id)} className={`rounded-lg border px-3 py-2 text-sm ${templateId === template.id ? "border-red-500 bg-red-500/10" : "border-white/10"}`}>{template.name}</button>)}</div>
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={onClose} className="h-11 rounded-lg border border-white/15 px-4 text-sm font-semibold">변경 취소</button><button disabled={!validTitle || !channel.trim() || saving} onClick={() => void save(false)} className="h-11 rounded-lg border border-white/15 px-4 text-sm font-semibold disabled:opacity-40">저장</button><button disabled={!validTitle || !channel.trim() || saving} onClick={() => void save(true)} className="h-11 rounded-lg bg-white px-4 text-sm font-bold text-black disabled:opacity-40">{saving ? "처리 중..." : "영상에 적용"}</button></div>
        </div>
      </div>
    </div>
  );
}

function ShortCard({ item, onChanged }: { item: GeneratedShort; onChanged: () => Promise<void> }) {
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (item.status !== "ready") return;
    let cancelled = false;
    requestJson<{ url: string }>(`/api/shorts/${item.id}/access`).then((value) => { if (!cancelled) setAccessUrl(value.url); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [item.id, item.renderVersion, item.status]);

  useEffect(() => {
    if (item.status !== "rerendering") return;
    const timer = window.setInterval(() => { void onChanged(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [item.status, onChanged]);

  const share = async () => {
    if (!accessUrl) return;
    if (navigator.share) await navigator.share({ title: item.hookTitle, url: accessUrl });
    else await navigator.clipboard.writeText(accessUrl);
  };
  const download = async () => {
    if (!accessUrl) return;
    try {
      const response = await fetch(accessUrl);
      if (!response.ok) throw new Error("영상을 다운로드하지 못했습니다.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${item.hookTitle.replace(/[^0-9A-Za-z가-힣 _-]/g, "").trim() || "shorts"}.mp4`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    } catch {
      alert("영상을 다운로드하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };
  const remove = async () => { if (confirm("이 쇼츠와 편집용 파일을 지금 삭제할까요?")) { await requestJson(`/api/shorts/${item.id}`, { method: "DELETE" }); await onChanged(); } };

  return (
    <article className="rounded-2xl border border-white/10 bg-[#141416] p-4 sm:p-5">
      <h3 className="mb-4 text-xl font-bold">{item.hookTitle}</h3>
      <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
        {accessUrl ? <video key={`${item.id}-${item.renderVersion}`} className="aspect-[9/16] w-full rounded-xl bg-black" src={accessUrl} controls playsInline /> : <div className="flex aspect-[9/16] items-center justify-center rounded-xl bg-black text-sm text-neutral-500">{item.status === "rerendering" ? "새 영상 렌더링 중" : "접근 URL 준비 중"}</div>}
        <div className="flex flex-col"><p className="text-sm text-neutral-400">원본 구간 {formatTimestamp(item.startSeconds)}–{formatTimestamp(item.endSeconds)} · {formatDuration(item.durationSeconds)}</p><div className="mt-4 flex-1 rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs font-bold text-neutral-500">해당 구간의 텍스트</p><p className="mt-2 text-sm leading-6 text-neutral-300">{item.subtitleSegments.map((segment) => segment.text).join(" ") || "추출된 텍스트가 없습니다."}</p></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={!accessUrl} onClick={() => void share()} className="h-10 rounded-lg border border-white/15 px-4 text-sm font-semibold disabled:opacity-40">공유</button><button disabled={!accessUrl} onClick={() => void download()} className="h-10 rounded-lg border border-white/15 px-4 text-sm font-semibold disabled:opacity-40">다운로드</button><button onClick={() => setEditing(true)} className="h-10 rounded-lg bg-white px-4 text-sm font-bold text-black">편집</button><button onClick={() => void remove()} className="h-10 rounded-lg border border-red-900 px-4 text-sm text-red-300">삭제</button></div></div>
      </div>
      {editing && <Editor item={item} videoUrl={accessUrl} onClose={() => setEditing(false)} onChanged={onChanged} />}
    </article>
  );
}

export function ShortsApp() {
  const [state, setState] = useState<MvpState | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [clipLengthOption, setClipLengthOption] = useState<ClipLengthOption>("sec_31_60");
  const [rangeStartSeconds, setRangeStartSeconds] = useState(0);
  const [rangeEndSeconds, setRangeEndSeconds] = useState(0);
  const [templateId, setTemplateId] = useState<TemplateId>("dark-red");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [activeJob, setActiveJob] = useState<VideoJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollStarted = useRef(0);
  const activeJobId = activeJob?.id;
  const activeJobStatus = activeJob?.status;

  const loadState = useCallback(async () => {
    const value = await requestJson<MvpState>("/api/mvp/state");
    setState(value);
    const running = value.recentJobs.find((job) => !terminalStatuses.has(job.status));
    setActiveJob(running || null);
  }, []);

  useEffect(() => { void loadState().catch((cause) => setError(cause instanceof Error ? cause.message : "초기화 실패")); }, [loadState]);

  useEffect(() => {
    if (!activeJobId || !activeJobStatus || terminalStatuses.has(activeJobStatus)) return;
    pollStarted.current ||= Date.now();
    let stopped = false;
    let timer: number;
    const poll = async () => {
      try {
        const value = await requestJson<{ job: VideoJob; usage: UsageSnapshot }>(`/api/jobs/${activeJobId}`);
        if (stopped) return;
        setActiveJob(value.job);
        setState((current) => current ? { ...current, usage: value.usage, recentJobs: current.recentJobs.map((job) => job.id === value.job.id ? value.job : job) } : current);
        if (terminalStatuses.has(value.job.status)) { pollStarted.current = 0; await loadState(); return; }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "작업 상태 확인 실패"); }
      const elapsed = Date.now() - pollStarted.current;
      timer = window.setTimeout(poll, elapsed < 30_000 ? 3_000 : elapsed < 300_000 ? 6_000 : 10_000);
    };
    timer = window.setTimeout(poll, 3_000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [activeJobId, activeJobStatus, loadState]);

  const selectedPlan = useMemo(() => state?.plans.find((plan) => plan.code === state.selectedPlanCode), [state]);
  const selectedDurationSeconds = Math.max(0, rangeEndSeconds - rangeStartSeconds);
  const minimumRangeSeconds = clipLengthRules[clipLengthOption].min;
  const rangeIsValid = Boolean(
    analysis
    && rangeStartSeconds >= 0
    && rangeEndSeconds <= analysis.durationSeconds
    && selectedDurationSeconds >= minimumRangeSeconds
  );

  const selectPlan = async (planCode: PlanCode) => {
    const value = await requestJson<{ selectedPlanCode: PlanCode; usage: UsageSnapshot }>("/api/mvp/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planCode }) });
    setState((current) => current ? { ...current, selectedPlanCode: value.selectedPlanCode, usage: value.usage } : current);
  };

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
      const value = await requestJson<{ jobId: string; usage: UsageSnapshot }>("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ youtubeUrl: analysis.normalizedUrl, templateId, clipLengthOption, rangeStartSeconds, rangeEndSeconds, rightsConfirmed: true, requestId: crypto.randomUUID() }) });
      setState((current) => current ? { ...current, usage: value.usage } : current);
      setActiveJob({ id: value.jobId, videoTitle: analysis.title, channelName: analysis.channelName, thumbnailUrl: analysis.thumbnailUrl, sourceDurationSeconds: analysis.durationSeconds, clipLengthOption, expectedShortCount: analysis.expectedShortCount, status: "queued", stage: "queued", progress: 5, errorMessage: null, createdAt: new Date().toISOString(), shorts: [] });
      pollStarted.current = Date.now();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "작업 생성 실패"); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-neutral-100"><header className="border-b border-white/10 bg-[#0D0D0F]"><div className="mx-auto flex h-14 max-w-5xl items-center px-5 font-bold">Shorts Maker</div></header><main className="mx-auto max-w-5xl space-y-10 px-5 py-10 sm:px-6">
      <section><p className="text-sm font-semibold text-red-400">AI 쇼츠 자동 생성</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">유튜브 링크 하나로 쇼츠 만들기</h1><p className="mt-3 text-neutral-400">선택한 영상 구간만 사용량으로 계산하고, 완성 영상은 최대 30일 보관합니다.</p></section>
      {error && <div role="alert" className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">{error}</div>}
      {state && selectedPlan && <><UsageCard planName={selectedPlan.displayName} usage={state.usage} /><section><div className="mb-4"><h2 className="text-xl font-bold">요금제 선택</h2><p className="mt-1 text-sm text-neutral-500">MVP에서는 결제 없이 플랜을 선택할 수 있습니다.</p></div><div className="grid gap-3 sm:grid-cols-3">{state.plans.map((plan) => <button key={plan.code} onClick={() => void selectPlan(plan.code)} className={`rounded-xl border p-5 text-left ${state.selectedPlanCode === plan.code ? "border-red-500 bg-red-500/10" : "border-white/10 bg-[#141416]"}`}><strong className="text-lg">{plan.displayName}</strong><span className="mt-2 block text-sm text-neutral-400">월 원본 영상 {Math.round(plan.monthlySourceSeconds / 60)}분</span><span className="mt-4 block text-xs font-bold text-red-300">{state.selectedPlanCode === plan.code ? "선택됨" : "선택"}</span></button>)}</div></section></>}
      <section><h2 className="text-xl font-bold">YouTube 영상</h2><form onSubmit={analyze} className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." className="h-12 flex-1 rounded-xl border border-white/15 bg-[#18181B] px-4" /><button disabled={busy} className="h-12 rounded-xl bg-white px-6 font-bold text-black disabled:opacity-50">{busy ? "확인 중..." : "영상 확인"}</button></form></section>
      {analysis && <section className="space-y-8"><div className="overflow-hidden rounded-2xl border border-white/10 bg-[#141416] sm:flex"><Image src={analysis.thumbnailUrl} alt="영상 썸네일" width={480} height={270} unoptimized className="aspect-video w-full object-cover sm:w-72" /><div className="p-5"><h2 className="text-lg font-bold">{analysis.title}</h2><p className="mt-2 text-sm text-neutral-400">{analysis.channelName}</p><p className="mt-4 text-sm">원본 영상 {formatDuration(analysis.durationSeconds)} · 선택 구간 예상 쇼츠 {expectedShortCount(selectedDurationSeconds)}개</p><p className="mt-1 text-xs text-neutral-500">이번 작업은 선택한 구간 {formatDuration(selectedDurationSeconds)}만 사용량으로 계산됩니다.</p></div></div><div className="rounded-2xl border border-white/10 bg-[#141416] p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">사용할 영상 구간</h2><p className="mt-1 text-sm text-neutral-500">기본값은 영상 전체입니다. 양쪽 슬라이더로 시작과 끝을 정하세요.</p></div><strong className="text-red-300">{formatTimestamp(rangeStartSeconds)}–{formatTimestamp(rangeEndSeconds)}</strong></div><div className="relative mt-6 h-8"><div className="absolute inset-x-0 top-3 h-2 rounded-full bg-neutral-800" /><div className="absolute top-3 h-2 rounded-full bg-red-500" style={{ left: `${(rangeStartSeconds / analysis.durationSeconds) * 100}%`, right: `${100 - (rangeEndSeconds / analysis.durationSeconds) * 100}%` }} /><input aria-label="시작 지점" type="range" min={0} max={analysis.durationSeconds} step={1} value={rangeStartSeconds} onChange={(event) => setRangeStartSeconds(Math.min(Number(event.target.value), rangeEndSeconds - 1))} className="range-thumb absolute inset-x-0 top-0 w-full" /><input aria-label="끝 지점" type="range" min={0} max={analysis.durationSeconds} step={1} value={rangeEndSeconds} onChange={(event) => setRangeEndSeconds(Math.max(Number(event.target.value), rangeStartSeconds + 1))} className="range-thumb absolute inset-x-0 top-0 w-full" /></div><div className="mt-3 flex justify-between text-xs text-neutral-500"><span>0:00</span><span>선택 {formatDuration(selectedDurationSeconds)}</span><span>{formatTimestamp(analysis.durationSeconds)}</span></div>{!rangeIsValid && <p className="mt-3 text-sm text-red-400">선택한 쇼츠 길이 기준으로 최소 {minimumRangeSeconds}초 구간이 필요합니다.</p>}<button type="button" onClick={() => { setRangeStartSeconds(0); setRangeEndSeconds(analysis.durationSeconds); }} className="mt-4 rounded-lg border border-white/15 px-3 py-2 text-sm">전체 구간으로 초기화</button></div><div><h2 className="text-xl font-bold">쇼츠 길이</h2><div className="mt-3 grid gap-2 sm:grid-cols-3">{clipOptions.map((option) => <button key={option.code} onClick={() => setClipLengthOption(option.code)} className={`rounded-xl border p-4 text-left ${clipLengthOption === option.code ? "border-red-500 bg-red-500/10" : "border-white/10"}`}><strong>{option.label}</strong><span className="mt-1 block text-xs text-neutral-500">{option.description}</span></button>)}</div></div><TemplatePicker value={templateId} onChange={setTemplateId} /><label className="flex items-start gap-3 rounded-xl border border-white/10 p-4 text-sm"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-red-500" />내가 소유하거나 사용 허가를 받은 영상입니다.</label><button disabled={!rightsConfirmed || !rangeIsValid || busy || Boolean(activeJob && !terminalStatuses.has(activeJob.status))} onClick={() => void createJob()} className="h-[52px] w-full rounded-xl bg-white py-4 font-bold text-black disabled:bg-neutral-800 disabled:text-neutral-500">쇼츠 생성하기</button></section>}
      {activeJob && <section className="rounded-2xl border border-white/10 bg-[#141416] p-5"><div className="flex justify-between gap-4"><div><p className="font-bold">{stageLabels[activeJob.stage] || "실제 작업 상태를 확인하고 있습니다."}</p><p className="mt-1 text-sm text-neutral-400">{activeJob.errorMessage || (activeJob.stage === "rendering" ? `완성 ${activeJob.shorts.length}/${activeJob.expectedShortCount}` : terminalStatuses.has(activeJob.status) ? "작업이 종료되었습니다." : "완성된 쇼츠는 바로 아래에 표시됩니다.")}</p></div><strong>{activeJob.progress}%</strong></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-800"><div className="h-full bg-red-500 transition-all" style={{ width: `${activeJob.progress}%` }} /></div></section>}
      {(activeJob?.shorts.length || state?.recentJobs.some((job) => job.shorts.length)) && <section><h2 className="mb-5 text-2xl font-bold">완성된 쇼츠</h2><div className="space-y-5">{(activeJob?.shorts.length ? activeJob.shorts : state?.recentJobs.flatMap((job) => job.shorts) || []).map((item) => <ShortCard key={item.id} item={item} onChanged={loadState} />)}</div></section>}
    </main></div>
  );
}
