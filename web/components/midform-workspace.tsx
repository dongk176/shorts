"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { midformRanges, type MidformDraft, type MidformRow, type SilencePreset } from "@/lib/midform-local";
import styles from "./midform-workspace.module.css";
import { MidformTranscript } from "./midform-transcript";
import { speakerAppearance, speakerKeys } from "@/lib/midform-speakers";
import { MidformCaptionPanel, MidformCaptionPreview } from "./midform-caption-panel";
import { emptyEntertainment, entertainmentSchema, visibleEntertainment, type EntertainmentCaptions } from "@/lib/midform-captions";
const renderFingerprint = (draft: Pick<MidformDraft, "rows" | "framing" | "removeSilence" | "silencePreset" | "entertainment">) => JSON.stringify([
  draft.rows.map(row => [row.id, row.start, row.end, row.text, row.speaker, row.keep]),
  Object.entries(draft.framing).sort(([a], [b]) => a.localeCompare(b)), draft.removeSilence, draft.removeSilence ? draft.silencePreset || "legacy" : null, draft.entertainment || emptyEntertainment,
]);
const sameRender = (a: MidformDraft, b?: Pick<MidformDraft, "rows" | "framing" | "removeSilence" | "silencePreset" | "entertainment">) => Boolean(b) && renderFingerprint(a) === renderFingerprint(b!);
function stableMediaUrl(previous?: string, next?: string) {
  if (!previous) return next;
  try { if (Number(new URL(previous).searchParams.get("Expires")) > Date.now() / 1000 + 60) return previous; } catch { /* Local URLs need no renewal. */ }
  return next;
}
const fixedDraft = (draft: MidformDraft): MidformDraft => ({ ...draft, removeSilence: true, silencePreset: "aggressive" });
const empty: MidformDraft = { rows: [], framing: {}, names: {}, removeSilence: false };
const time = (n: number) => `${Math.floor(n / 60).toString().padStart(2,"0")}:${Math.floor(n % 60).toString().padStart(2,"0")}`;
type Status = { entertainment?: EntertainmentCaptions; sourceUrl?: string; outputUrl?: string; subtitleUrl?: string; revision?: number; renderVersion?: number; framing?: Record<string, string>; names?: Record<string, string>; removeSilence?: boolean; silencePreset?: SilencePreset; silenceProfiles?: Partial<Record<SilencePreset, number[][]>>; exportDraft?: Pick<MidformDraft, "rows" | "framing" | "removeSilence" | "silencePreset" | "entertainment">; projectId?: string; title?: string; projects?: { id: string; title: string }[]; token: string; busy: boolean; status: string; duration?: number; rows?: MidformRow[]; silences?: number[][]; generation?: number; note?: string; target?: number; selectionMode?: string; exportReady?: boolean; error?: string; transcriptionAvailable?: boolean };

export function MidformWorkspace({ onBusyChange, active, cloudShortId, onClose }: { onBusyChange: (busy: boolean) => void; active: boolean; cloudShortId?: string; onClose?: () => void }) {
  const base = cloudShortId ? `/api/midform/${cloudShortId}` : "/api/midform-local";
  const [cloudSaved, setCloudSaved] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState(empty);
  const target = 0;
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const visibleError = error || connectionError;
  const [past, setPast] = useState<MidformDraft[]>([]);
  const [future, setFuture] = useState<MidformDraft[]>([]);
  const [editPreview, setEditPreview] = useState(true);
  const [captionPreview, setCaptionPreview] = useState(false);
  const [position, setPosition] = useState(0);
  const [download, setDownload] = useState(false);
  const [rights, setRights] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [name, setName] = useState("긴 영상 편집");
  const video = useRef<HTMLVideoElement>(null);
  const renderedVideo = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const sync = useRef(true);
  const generation = useRef<number | undefined>(undefined);
  const exporting = useRef(false);
  const mutationEpoch = useRef(0);
  const requestInFlight = useRef(false);
  const generatingCaptions = useRef<number | null>(null);
  const exportRequested = useRef<MidformDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = pending || Boolean(status?.busy);
  const measuredSilences = useMemo(() => draft.silencePreset ? status?.silenceProfiles?.[draft.silencePreset] || [] : status?.silences || [], [draft.silencePreset, status?.silenceProfiles, status?.silences]);
  const ranges = useMemo(() => midformRanges(draft.rows, measuredSilences, draft.removeSilence), [draft.rows, draft.removeSilence, measuredSilences]);
  const beforeSilence = midformRanges(draft.rows, [], false);
  const removedSeconds = Math.max(0, beforeSilence.reduce((n, r) => n + r.end - r.start, 0) - ranges.reduce((n, r) => n + r.end - r.start, 0));
  const detectedCount = measuredSilences.filter(([a, b]) => beforeSilence.some(r => a < r.end && b > r.start)).length;
  const duration = ranges.reduce((n, r) => n + r.end - r.start, 0);
  const current = draft.rows.find(r => r.start <= position && r.end > position);
  const crop = editPreview && current && !["unknown", "overlap"].includes(current.speaker) ? draft.framing[current.speaker] || "wide" : "wide";
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const startedEpoch = mutationEpoch.current;
        const response = await fetch(cloudShortId ? base : `${base}/api/state`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error("편집 연결을 확인해 주세요.");
        const value: Status = await response.json();
        if (!active) return;
        if (requestInFlight.current || startedEpoch !== mutationEpoch.current) { timer = setTimeout(poll, 1000); return; }
        setConnectionError("");
        setStatus(old => old && old.generation === value.generation ? { ...value, revision: Math.max(old.revision || 0, value.revision || 0), sourceUrl: stableMediaUrl(old.sourceUrl, value.sourceUrl), outputUrl: stableMediaUrl(old.outputUrl, value.outputUrl) } : value);
        if (value.status === "empty" && !value.busy) {
          setDraft(empty); setDownload(false); generation.current = undefined; sync.current = true;
        }
        if (!value.busy && value.rows && (sync.current || generation.current !== value.generation)) {
          let restored: { draft: MidformDraft; name: string; target: number } | null = null;
          if (generation.current === undefined && !cloudShortId) {
            try { restored = JSON.parse(localStorage.getItem(`easycut-midform:v2:${value.projectId || `${value.token}:${value.generation}`}`) || "null"); } catch { /* Storage may be unavailable. */ }
          }
          if (restored?.draft?.rows?.length === value.rows.length) {
            setDraft(fixedDraft(restored.draft)); setName(restored.name);
          } else setDraft(old => fixedDraft({ ...empty, removeSilence: value.removeSilence ?? false, silencePreset: value.silencePreset || (Object.keys(value.silenceProfiles || {}).length ? "medium" : undefined), entertainment: value.entertainment, rows: value.rows!, framing: value.framing || {}, names: { ...value.names, ...Object.fromEntries([...new Set(value.rows!.map(r => r.speaker))].map((key, i) => [key, value.names?.[key] || old.names[key] || (key === "unknown" ? "미확인" : key === "overlap" ? "겹친 음성" : `화자 ${i + 1}`)])) } }));
          if (!restored) { setName((value.title || "중폼 편집").replace(/ · 무음 빡세게$/, " 하이라이트")); }
          setDownload(Boolean(value.exportReady) && (cloudShortId ? sameRender({ ...empty, rows: value.rows!, framing: value.framing || {}, removeSilence: value.removeSilence ?? false, silencePreset: value.silencePreset || (Object.keys(value.silenceProfiles || {}).length ? "medium" : undefined), entertainment: value.entertainment }, value.exportDraft) : sameRender(fixedDraft(restored?.draft || { ...empty, rows: value.rows!, framing: value.framing || {} }), value.exportDraft))); setPast([]); setFuture([]);
          generation.current = value.generation; sync.current = false;
        }
        if (exporting.current && !value.busy) { const complete = Boolean(value.exportReady && (generatingCaptions.current !== null ? (value.renderVersion || 0) > generatingCaptions.current : exportRequested.current && sameRender(exportRequested.current, value.exportDraft))); generatingCaptions.current = null; setDownload(complete); if (!complete) setError(value.error || "내보내기를 완료하지 못했습니다. 저장된 편집은 유지됩니다."); exporting.current = false; }
        if (active) timer = setTimeout(poll, value.busy || sync.current ? 1000 : 3000);
      } catch (cause) {
        if (active) { setConnectionError(cause instanceof Error ? cause.message : "연결에 실패했습니다."); timer = setTimeout(poll, 5000); }
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [base, cloudShortId]);
  useEffect(() => {
    if (!status?.token || !draft.rows.length || sync.current || generation.current !== status.generation) return;
    setSaved(false);
    const timer = setTimeout(() => {
      try {
        const key = `easycut-midform:v2:${status.projectId || `${status.token}:${status.generation}`}`;
        for (const oldKey of Object.keys(localStorage)) if (oldKey.startsWith("easycut-midform:") && !oldKey.startsWith("easycut-midform:v2:review-") && oldKey !== key) localStorage.removeItem(oldKey);
        localStorage.setItem(key, JSON.stringify({ draft, target, name })); setSaved(true);
      } catch { setSaved(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, target, name, status?.token, status?.generation, status?.projectId]);
  useEffect(() => {
    if (!draft.rows.length && !busy) return;
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [draft.rows.length, busy]);
  useEffect(() => {
    if (!active) { video.current?.pause(); renderedVideo.current?.pause(); return; }
    let frame: number;
    let lastPaint = 0;
    const tick = () => {
      const player = video.current;
      if (player && !player.paused) {
        if (editPreview) {
          const next = ranges.find(r => r.end > player.currentTime + .025);
          if (!next) player.pause(); else if (player.currentTime < next.start) player.currentTime = next.start;
        }
        if (Math.abs(player.currentTime - lastPaint) >= .1) {
          lastPaint = player.currentTime; setPosition(player.currentTime);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [editPreview, ranges, active]);
  const update = useCallback((next: MidformDraft) => { setCloudSaved(false); setPast(items => [...items.slice(-39), draft]); setFuture([]); setDraft(fixedDraft(next)); setDownload(false); }, [draft]);
  function undo() { setCloudSaved(false); const prev = past.at(-1); if (prev) { setFuture(items => [...items, draft]); setPast(items => items.slice(0,-1)); setDraft(prev); setDownload(false); } }
  function redo() { setCloudSaved(false); const next = future.at(-1); if (next) { setPast(items => [...items,draft]); setFuture(items => items.slice(0,-1)); setDraft(next); setDownload(false); } }
  async function request(action: string, payload: object | File = {}) {
    if (!status?.token || busy) return;
    if (cloudShortId && action === "reset") { onClose?.(); return; }
    setPending(true); setError(""); setDownload(false);
    if (["export", "captions", "save"].includes(action) && draft.entertainment) {
      const checked = entertainmentSchema.safeParse(draft.entertainment);
      if (!checked.success) { setPending(false); setError(checked.error.issues[0]?.message || "예능 자막 설정을 확인해 주세요."); return; }
    }
    if (["export", "captions"].includes(action)) exportRequested.current = draft;
    generatingCaptions.current = action === "captions" ? status.renderVersion || 0 : null;
    requestInFlight.current = true; mutationEpoch.current += 1;
    try {
      const response = cloudShortId
        ? await fetch(base, { signal: AbortSignal.timeout(30_000), method: action === "save" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: payload, revision: status.revision, renderVersion: status.renderVersion, ...(["export", "captions"].includes(action) ? { requestId: crypto.randomUUID(), ...(action === "captions" ? { generateCaptions: true } : {}) } : {}) }) })
        : await fetch(`${base}/api/${action}`, { method: "POST", headers: { "X-Midform-Token": status.token, "Content-Type": payload instanceof File ? "application/octet-stream" : "application/json", "X-Midform-Target": String(target) }, body: payload instanceof File ? payload : JSON.stringify(payload) });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "요청을 처리하지 못했습니다."); }
      if (cloudShortId) { const result = await response.json(); setStatus(old => old ? { ...old, revision: result.revision } : old); if (action === "save") { setCloudSaved(true); setDownload(sameRender(draft, status.exportDraft)); return; } }
      if (["sample", "upload", "select", "open"].includes(action)) sync.current = true;
      if (action === "reset") { setDraft(empty); setPast([]); setFuture([]); generation.current = undefined; setName("긴 영상 편집"); }
      else { exporting.current = ["export", "captions"].includes(action); setStatus(old => old ? { ...old, busy: true, exportReady: false, status: ["export", "captions"].includes(action) ? "rendering" : action === "open" ? "loading" : "analysing", error: undefined } : old); }
    } catch (cause) { setError(cause instanceof Error && cause.name === "TimeoutError"
      ? "서버 응답이 늦어지고 있습니다. 편집 내용은 이 화면에 남아 있습니다. 잠시 후 저장 상태를 확인해 주세요."
      : cause instanceof Error ? cause.message : "다시 시도해 주세요."); }
    finally { requestInFlight.current = false; mutationEpoch.current += 1; setPending(false); }
  }
  function upload(file?: File) { if (!file || !rights || busy) return; if (file.size > 1024 ** 3) { setError("1GB 이하의 영상을 선택해 주세요."); return; } setName(file.name); void request("upload", file); }
  const seek = useCallback((n: number) => { if (video.current) video.current.currentTime = n; setPosition(n); }, []);
  const reviewExcluded = useCallback((seconds: number) => { video.current?.pause(); setEditPreview(false); seek(seconds); }, [seek]);
  const speakers = speakerKeys(draft);
  const examples = status?.projects?.filter(project => project.id.endsWith("-silence-aggressive")) || [];

  return <section className={styles.workspace} aria-label="긴 영상 편집" aria-busy={busy}>
    {cloudShortId && !draft.rows.length ? <p role="status">{visibleError || "저장된 편집 영상을 불러오고 있습니다…"}</p> : !draft.rows.length ? <section className="hero mx-auto flex w-full max-w-4xl flex-col items-center text-center">
      <p className={styles.kicker}>LONG TO MID</p>
      <h1 className="hero-title">볼 만한 장면을 모아<br /><span>한 편으로 완성하세요</span></h1>
      <p className={styles.intro}>쇼츠로 만들 만한 장면을 원본 순서로 이어 붙이고,<br className="hidden sm:block" /> 불필요한 쉼은 자동으로 줄여드려요.</p>
      <div className={styles.uploadCard}>
        <input ref={input} type="file" accept=".mp4,.mov,.webm,.mkv" className="sr-only" aria-label="중폼으로 만들 영상 파일" onChange={e => { setSelectedFile(e.target.files?.[0] || null); e.target.value = ""; }} />
        <button type="button" className={styles.dropzone} disabled={busy || !status} onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setSelectedFile(e.dataTransfer.files[0] || null); }}>
          <span className={styles.uploadIcon} aria-hidden="true">↥</span>
          <strong>{selectedFile ? selectedFile.name : "영상을 여기에 놓거나 선택해 주세요"}</strong>
          <span>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB · 클릭해서 다른 영상 선택` : "10~60분 영상 · 최대 1GB · MP4, MOV, WebM, MKV"}</span>
        </button>
        <label className={styles.rights}><input type="checkbox" checked={rights} disabled={busy} onChange={e => setRights(e.target.checked)} />내가 소유하거나 편집 허가를 받은 영상입니다.</label>
        <button type="button" className={`ai-button ${styles.createButton}`} disabled={!selectedFile || !rights || busy || !status} onClick={() => upload(selectedFile || undefined)}>중폼 한 편 만들기 <span aria-hidden="true">↗</span></button>
        <p className={styles.privacy}>영상의 음성과 대본을 분석해 장면을 선택합니다.<br />음성은 ElevenLabs, 대본은 OpenAI에서 처리돼요.</p>
      </div>
      <div className={styles.autoBenefits}><span>✓ 장면 자동 선택</span><span>✓ 무음 자동 정리</span><span>✓ 화자별 대사 편집</span></div>
      {examples.length > 0 && <details className={styles.examples}><summary>완성 예시 먼저 보기 <span aria-hidden="true">＋</span></summary><div>{examples.map(project => <button key={project.id} type="button" disabled={busy} onClick={() => { generation.current = undefined; void request("open", { id: project.id }); }}><span aria-hidden="true">▶</span><strong>{project.title.startsWith("자동차") ? "첫 운전 하이라이트" : "팟캐스트 하이라이트"}</strong><span>열어보기 ↗</span></button>)}</div></details>}
    </section> : <>
      <header className={styles.toolbar}><div><p className="text-xs text-neutral-500">중폼 편집</p><h1 className="mt-1 max-w-sm truncate text-lg font-bold">{name}</h1></div><div className={styles.actions}>
        <button className={styles.secondary} disabled={busy || !past.length} onClick={undo}>실행 취소</button><button className={styles.secondary} disabled={busy || !future.length} onClick={redo}>다시 실행</button><button className={styles.secondary} disabled={busy} onClick={() => setResetConfirm(true)}>새 영상</button>{cloudShortId ? <button className={styles.secondary} disabled={busy} onClick={() => void request("save", draft)}>{cloudSaved ? "계정에 저장됨" : "편집 저장"}</button> : null}<button className="ai-button" disabled={busy || duration <= 0 || duration > 1200.1} onClick={() => void request("export", draft)}>내보내기 · {time(duration)}</button>
      </div></header>
      {resetConfirm ? <div className={styles.download} role="alert"><span>편집 내용을 지우고 새 영상을 열까요?</span><button className={styles.secondary} disabled={busy} onClick={() => { setResetConfirm(false); void request("reset"); }}>새 영상 열기</button><button className={styles.secondary} onClick={() => setResetConfirm(false)}>취소</button></div> : null}
      <p className={styles.editSummary}><span>원본 {time(status?.duration || 0)} <span aria-hidden="true">→</span> 중폼 {time(duration)}</span><span>{status?.selectionMode?.startsWith("수동") ? "자동 장면 선택을 완료하지 못했어요. 대사를 확인해 주세요." : "장면 연결 · 무음 정리 적용"}</span><span>{saved ? "편집 저장됨" : "편집 저장 중"}</span></p>
      <div className={styles.editor}>
        <MidformTranscript key={status?.generation} draft={draft} busy={busy} currentId={current?.id} onChange={update} onSeek={seek} onReview={reviewExcluded} />
        <section className={styles.preview} aria-label="영상 미리보기"><div className={styles.previewHeading}><h2>미리보기</h2><label><input type="checkbox" checked={captionPreview} onChange={e => setCaptionPreview(e.target.checked)} /> 화자별 자막 미리보기</label><label><input type="checkbox" checked={editPreview} onChange={e => setEditPreview(e.target.checked)} /> 편집 결과</label></div>
          <div className={styles.videoFrame}><video ref={video} onPlay={() => renderedVideo.current?.pause()} key={status?.generation} src={cloudShortId ? status?.sourceUrl : `${base}/source.mp4?v=${status?.generation}`} playsInline preload="metadata" style={{ transform: crop === "wide" ? "none" : "scale(1.4)", transformOrigin: `${crop === "left" ? "left" : crop === "right" ? "right" : "center"} center` }} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} />{captionPreview ? <p className={styles.caption} style={{ color: current ? speakerAppearance(current.speaker, speakers).color : undefined }}><span>{current ? draft.names[current.speaker] || "미지정" : ""}</span>{current?.text}</p> : null}{cloudShortId ? <MidformCaptionPreview cue={visibleEntertainment(draft.entertainment, ranges, position)} /> : null}</div>
          <div className={styles.playerControls}><button className={styles.secondary} onClick={() => { const p = video.current; if (!p) return; if (p.paused) { if (editPreview && !ranges.some(r => r.end > p.currentTime)) seek(ranges[0]?.start || 0); void p.play().catch(() => setError("영상을 재생하지 못했습니다.")); } else p.pause(); }}>재생 / 일시정지</button><span>{time(position)} / {time(status?.duration || 0)} · 원본 위치</span></div><p className={styles.notice}>선택 구간의 빠른 미리보기입니다. 내보낸 영상은 아래 완성본에서 확인하세요. 확대 구도는 직접 지정합니다. 화자 색상은 미리보기용이며 SRT에는 포함되지 않습니다.</p>
        </section>
        <aside className={styles.settings}><div className={styles.autoSummary}><div><h2>불필요한 쉼은 자동으로 정리했어요</h2><p className={styles.notice}>{detectedCount ? `${detectedCount}곳 · 약 ${removedSeconds.toFixed(1)}초 단축` : "현재 선택한 장면에 줄일 무음이 없어요."} · 길이는 내용에 맞춰 결정됩니다.</p></div>{!cloudShortId && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void request("select", { ...draft, target: 0 })}>장면 다시 고르기</button>}</div><details className={styles.speakerDetails}><summary>화자 이름·화면 조정</summary>
          {Object.entries(draft.names).map(([key, label]) => <div className={styles.speaker} key={key}><input className={styles.input} style={{ borderLeft: `3px solid ${speakerAppearance(key, speakers).color}` }} aria-label={`${key} 화자 이름`} value={label} maxLength={30} disabled={busy} onChange={e => update({ ...draft, names: { ...draft.names, [key]: e.target.value } })} /><select className={styles.input} aria-label={`${label} 화면 구도`} disabled={busy || ["unknown","overlap"].includes(key)} value={draft.framing[key] || "wide"} onChange={e => update({ ...draft, framing: { ...draft.framing, [key]: e.target.value } })}><option value="wide">전체 화면</option><option value="left">왼쪽 확대</option><option value="center">중앙 확대</option><option value="right">오른쪽 확대</option></select></div>)}</details>
        </aside>
      </div>
      {cloudShortId ? <MidformCaptionPanel value={draft.entertainment} disabled={busy} position={position} duration={status?.duration || 0}
        onChange={entertainment => update({ ...draft, entertainment })} onSeek={seek}
        onGenerate={() => void request("captions", draft)} /> : null}
      <section className={styles.timelineSection} aria-label="편집 타임라인"><div className={styles.previewHeading}><h2>선택한 구간</h2><span>원본 {time(status?.duration || 0)} → 결과 {time(duration)}</span></div><div className={styles.timeline}>{ranges.map(r => <button key={`${r.start}-${r.end}`} aria-label={`${time(r.start)}로 이동`} className={styles.kept} style={{ left: `${r.start / (status?.duration || 1) * 100}%`, width: `${(r.end-r.start) / (status?.duration || 1) * 100}%` }} onClick={() => seek(r.start)} />)}<i style={{ left: `${position / (status?.duration || 1) * 100}%` }} /></div></section>
      {duration > 1200.1 ? <p role="alert" className={styles.notice}>20분을 초과했습니다. 구간을 더 제외해 주세요.</p> : null}
      {download ? <div className={styles.download} role="status"><strong>내보내기 완료</strong><video ref={renderedVideo} onPlay={() => video.current?.pause()} controls playsInline preload="metadata" src={status?.outputUrl || `${base}/output.mp4?v=${status?.generation}`} aria-label="완성된 영상" style={{ width: "100%", maxHeight: 540 }} /><a href={cloudShortId ? `/api/shorts/${cloudShortId}/download` : `${base}/output.mp4`} download="easycut.mp4">영상 다운로드</a><a href={status?.subtitleUrl || `${base}/output.srt`} download="easycut.srt">자막 다운로드</a><span>원본 해상도 유지 (최대 1080p) · 대사 자막 파일 별도 제공</span></div> : null}
    </>}
    {busy ? <div className={styles.progress} role="status">{status?.status === "loading" ? "저장된 편집을 불러오고 무음 구간을 측정하고 있습니다…" : status?.status === "rendering" ? generatingCaptions.current !== null ? "예능 자막을 고르고 영상에 적용하고 있습니다…" : "원본 화질로 영상을 내보내고 있습니다…" : status?.status === "reviewing" ? "선택한 이야기의 앞뒤 연결과 마무리를 검수하고 있습니다…" : status?.status === "selecting" ? "볼 만한 장면을 골라 한 편으로 연결하고 있습니다…" : "음성과 화자를 분석하고 있습니다…"} {cloudShortId ? "화면을 닫아도 제작은 계속됩니다." : "이 화면을 열어 두세요."}</div> : null}
    {visibleError || status?.error ? <p role="alert" className={styles.error}>{visibleError || status?.error}</p> : null}
  </section>;
}
