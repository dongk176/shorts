"use client";

import { useEffect, useRef, useState } from "react";
import { inspectUploadVideo, uploadFileWhenReceiverReady } from "@/lib/file-upload-client";
import { MidformWorkspace } from "./midform-workspace";
import styles from "./midform-workspace.module.css";

type Project = { id: string; projectNumber: number; videoTitle: string; status: string;
  progress: number; errorMessage?: string; shortId?: string; outputStatus?: string; durationSeconds?: number };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000), ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.error || body.message || "요청을 처리하지 못했습니다.");
  return body as T;
}

export function MidformCloudWorkspace({ active, onBusyChange, initialUrl = "", initialFile, initialSourceMode = "youtube" }: {
  initialUrl?: string; initialFile?: File; initialSourceMode?: "youtube" | "upload"; active: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string>();
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("midform"); if (id && /^[0-9a-f-]{36}$/i.test(id)) setSelected(id); }, []);
  const [rights, setRights] = useState(false);
  const [sourceMode, setSourceMode] = useState<"youtube" | "upload">(initialSourceMode);
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState<File | undefined>(initialFile);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [projectError, setProjectError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef<string>("");
  const activeProject = projects.some(project => !["completed", "failed", "expired", "deleted"].includes(project.status));
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await json<{ projects: Project[] }>("/api/midform");
        if (alive) { setProjects(result.projects); setProjectError(""); }
      } catch (cause) { if (alive) setProjectError(cause instanceof Error ? cause.message : "프로젝트를 불러오지 못했습니다."); }
      if (alive) timer = setTimeout(load, 5000);
    }
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { if (!selected) onBusyChange(busy || activeProject); }, [busy, activeProject, onBusyChange, selected]);

  async function createFromLink() {
    if (!rights || busy || activeProject || !url.trim()) return;
    setBusy(true); setError(""); setMessage("영상 정보를 확인하고 있습니다…");
    try {
      const analysis = await json<{ analysisId: string; durationSeconds: number; sourceRangeSelectionEnabled: boolean }>("/api/youtube/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ youtubeUrl: url }),
      });
      if (analysis.durationSeconds < 600 || analysis.durationSeconds > 3600) throw new Error("10~60분 영상을 선택해 주세요.");
      await json("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        analysisId: analysis.analysisId, youtubeUrl: url, requestId: crypto.randomUUID(),
        templateId: "dark-minimal", videoAspectRatio: "16:9", outputLanguage: "ko", rightsConfirmed: true,
        midform: { version: 1, targetSeconds: 0 },
        ...(analysis.sourceRangeSelectionEnabled ? { rangeStartSeconds: 0, rangeEndSeconds: analysis.durationSeconds } : {}),
      }) });
      setMessage("중폼을 만들고 있어요. 아래에서 진행 상황을 확인하세요.");
      setProjects((await json<{ projects: Project[] }>("/api/midform")).projects);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "제작을 시작하지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file || !rights || busy || activeProject) return;
    setBusy(true); setError(""); setMessage("영상 정보를 확인하고 있습니다…");
    const abort = new AbortController(); controller.current = abort;
    try {
      if (file.size > 1024 ** 3) throw new Error("1GB 이하의 영상을 선택해 주세요.");
      const video = await inspectUploadVideo(file);
      if (video.durationSeconds < 600 || video.durationSeconds > 3600) throw new Error("10~60분 영상을 선택해 주세요.");
      requestId.current = crypto.randomUUID();
      const session = await json<{ uploadSessionId: string; uploadUrl: string; token: string;
        preparationExpiresAt: string; transport?: "lab_direct_https" }>("/api/file-upload/sessions", {
        method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId.current,
          file: { name: file.name, contentType: video.contentType, sizeBytes: file.size,
            durationSeconds: video.durationSeconds, width: video.width, height: video.height, hasAudio: true },
          rangeStartSeconds: 0, rangeEndSeconds: video.durationSeconds,
          templateId: "dark-minimal", videoAspectRatio: "16:9", outputLanguage: "ko", rightsConfirmed: true,
          midform: { version: 1, targetSeconds: 0 },
        }),
      });
      await uploadFileWhenReceiverReady({ file, uploadUrl: session.uploadUrl,
        bearerToken: session.token, preparationExpiresAt: session.preparationExpiresAt, signal: abort.signal,
        onAttemptStart: () => setMessage("영상을 올리고 있습니다…"),
        onWaiting: () => setMessage("편집 서버를 준비하고 있습니다…"),
        onProgress: progress => setMessage(`영상 업로드 ${Math.round(progress.percent)}%`),
        getSessionState: () => json(`/api/file-upload/sessions/${session.uploadSessionId}`, { signal: abort.signal }),
      });
      setMessage("업로드됐습니다. 아래 프로젝트에서 분석·제작 상태를 확인하세요.");
      setRights(false);
      setProjects((await json<{ projects: Project[] }>("/api/midform")).projects);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "영상을 올리지 못했습니다."); }
    finally { setBusy(false); controller.current = null; }
  }
  if (selected) return <MidformWorkspace key={selected} active={active} cloudShortId={selected}
    onBusyChange={onBusyChange} onClose={() => setSelected(undefined)} />;
  return <section className={styles.workspace} aria-label="긴 영상 편집">
    <section className="mx-auto w-full max-w-2xl py-8">
      <h1 className="text-3xl font-bold tracking-tight">중폼으로 한 편 뽑기</h1>
      <div className="mt-7 flex gap-2" role="group" aria-label="영상 입력 방식">
        <button type="button" className={styles.secondary} aria-pressed={sourceMode === "youtube"} disabled={busy || activeProject} onClick={() => setSourceMode("youtube")}>링크로 변환</button>
        <button type="button" className={styles.secondary} aria-pressed={sourceMode === "upload"} disabled={busy || activeProject} onClick={() => setSourceMode("upload")}>파일 업로드</button>
      </div>
      <div className="mt-5">
        {sourceMode === "youtube" ? <input type="url" aria-label="YouTube 영상 링크" className={styles.input} value={url} disabled={busy || activeProject} onChange={event => setUrl(event.target.value)} placeholder="YouTube 영상 링크" />
          : <label className="source-upload-dropzone"><strong>{file?.name || "영상 선택"}</strong><span>10~60분 · 최대 1GB</span><input type="file" accept=".mp4,.mov,.webm,.mkv" disabled={busy || activeProject} onChange={event => setFile(event.target.files?.[0])} /></label>}
        <label className="mt-4 flex items-start gap-3 text-xs leading-5 text-neutral-400"><input type="checkbox" checked={rights} disabled={busy || activeProject} onChange={event => setRights(event.target.checked)} />내가 소유하거나 편집 허가를 받은 영상입니다.</label>
        <button type="button" className="ai-button mt-5 w-full" disabled={!rights || busy || activeProject || (sourceMode === "youtube" ? !url.trim() : !file)} onClick={() => void (sourceMode === "youtube" ? createFromLink() : upload(file))}>중폼 한 편 만들기</button>
        <p className="mt-3 text-xs leading-5 text-neutral-500">장면을 원래 순서로 연결하고 무음은 자동으로 정리해요. 음성은 ElevenLabs, 대본은 OpenAI로 전달돼요.</p>
      </div>
    </section>
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {error || projectError ? <p role="alert" className={styles.error}>{error || projectError}</p> : null}
    <section className={styles.download} aria-label="긴 영상 프로젝트"><h2>내 편집 영상</h2>
      {projects.map(project => <div key={project.id}><strong>{project.videoTitle}</strong>{project.shortId && ["ready", "rerendering"].includes(project.outputStatus || "")
        ? <button className={styles.secondary} disabled={busy} onClick={() => setSelected(project.shortId)}>편집·다운로드</button>
        : <span>{project.status === "failed" ? project.errorMessage || "제작에 실패했습니다." : `제작 중 ${project.progress}%`}</span>}</div>)}
      {!projects.length ? <p>업로드한 영상이 여기에 표시됩니다.</p> : null}
    </section>
  </section>;
}
