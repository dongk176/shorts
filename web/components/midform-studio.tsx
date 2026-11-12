"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { EditorStudioBackButton, EditorStudioTopbar, EditorViewportZoomControl } from "./editor-studio-chrome";
import { MidformStoryTimeline } from "./midform-story-timeline";
import { EditorTimelineResizer } from "./editor-timeline-resizer";
import { EditorSelect } from "./editor-select";
import { MidformTranscript } from "./midform-transcript";
import { MidformCaptionPanel, MidformCaptionPreview } from "./midform-caption-panel";
import { midformRanges, type MidformDraft, type MidformRow, type MidformSourceScene } from "@/lib/midform-local";
import { speakerAppearance, speakerKeys } from "@/lib/midform-speakers";
import { visibleEntertainment } from "@/lib/midform-captions";
import { useTimelineThumbnails } from "@/lib/use-timeline-thumbnails";
import styles from "./midform-studio.module.css";

const clock = (n: number) => `${Math.floor(n / 60).toString().padStart(2, "0")}:${Math.floor(n % 60).toString().padStart(2, "0")}`;
const tools = [{ id: "dialogue", label: "대사" }, { id: "captions", label: "자막" }, { id: "speakers", label: "화자" }, { id: "layout", label: "레이아웃" }] as const;
type Tool = typeof tools[number]["id"];
type Props = {
  projectNumber?: number; title: string; draft: MidformDraft; sourceRows: MidformRow[]; sourceScenes?: MidformSourceScene[]; sourceDuration: number; sourceUrl?: string;
  outputUrl?: string; subtitleUrl?: string; duration: number; position: number; silences: number[][];
  busy: boolean; saved: boolean; outputReady: boolean; error?: string; canUndo: boolean; canRedo: boolean;
  videoRef: RefObject<HTMLVideoElement | null>; editPreview: boolean;
  onChange: (draft: MidformDraft) => void; onSeek: (seconds: number) => void; onPosition: (seconds: number) => void;
  onReview: (seconds: number) => void; onEditPreview: (value: boolean) => void;
  onUndo: () => void; onRedo: () => void; onReset: () => void; onClose: () => void;
  onApply: () => void; onGenerateCaptions: () => void;
};

function ToolIcon({ tool }: { tool: Tool }) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    {tool === "dialogue" ? <><path d="M4 4.5h12v9H9l-4 3v-3H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M7 8h6M7 10.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
      : tool === "captions" ? <><rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M5.75 9h3.5M10.75 9h3.5M5.75 12h5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
        : tool === "speakers" ? <><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" /><path d="M4.5 16c.55-3 2.35-4.5 5.5-4.5s4.95 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.5" /></>
          : <><rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M3.8 8h12.4M9 8v8.2" stroke="currentColor" strokeWidth="1.5" /></>}
  </svg>;
}

/** Uses the existing editor chrome, controls, ruler and resizer; only the landscape canvas and dialogue tools differ. */
export function MidformStudio(props: Props) {
  const { draft, busy, position, videoRef, onUndo, onRedo, onSeek, editPreview } = props;
  const [tool, setTool] = useState<Tool>("dialogue");
  const [playing, setPlaying] = useState(false);
  const [showCaptions, setShowCaptions] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [applyOpen, setApplyOpen] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLElement>(null);
  const applyDialog = useRef<HTMLDialogElement>(null);
  const thumbnails = useTimelineThumbnails(props.sourceUrl || "");
  const ranges = useMemo(() => midformRanges(draft.rows, props.silences, true), [draft.rows, props.silences]);
  const timeline = useMemo(() => {
    let cursor = 0;
    return ranges.map(range => { const start = cursor; cursor += range.end - range.start; return { ...range, outputStart: start, outputEnd: cursor }; });
  }, [ranges]);
  const keys = useMemo(() => speakerKeys(draft), [draft]);
  const current = draft.rows.find(row => row.start <= position && row.end > position);
  const activeRange = timeline.find(range => position >= range.start && position < range.end);
  const elapsed = activeRange ? activeRange.outputStart + position - activeRange.start : timeline.find(range => range.start > position)?.outputStart ?? props.duration;
  const crop = current ? draft.framing[current.speaker] || "wide" : "wide";
  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (editPreview) {
        const next = timeline.find(range => range.end > video.currentTime + .025) || timeline[0];
        if (next && (video.currentTime < next.start || video.currentTime >= next.end)) onSeek(next.start);
      } else if (video.ended) onSeek(0);
      void video.play().catch(() => setPlaying(false));
    } else video.pause();
  }, [videoRef, timeline, onSeek, editPreview]);
  const seekOutput = (seconds: number) => {
    const piece = timeline.find(range => seconds < range.outputEnd) || timeline.at(-1);
    if (piece) props.onSeek(Math.min(piece.end - .01, piece.start + Math.max(0, seconds - piece.outputStart)));
  };
  useEffect(() => {
    if (applyOpen && !applyDialog.current?.open) applyDialog.current?.showModal();
  }, [applyOpen]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.defaultPrevented || event.isComposing || applyOpen || target && (target.isContentEditable || target.matches('textarea,select,input:not([data-editor-seek])')
        || target.closest('[role="listbox"],[role="menu"],[role="dialog"]'))) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !busy) {
        event.preventDefault(); if (event.shiftKey) onRedo(); else onUndo();
      }
      if (event.code === "Space" && !event.metaKey && !event.ctrlKey && !event.altKey
        && (!target?.closest('button,a,[role="combobox"]') || target.closest('[data-editor-seek]'))) {
        event.preventDefault();
        if (!event.repeat) togglePlayback();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyOpen, busy, onUndo, onRedo, togglePlayback]);

  return <main className={`editor-page editor-v2-root editor-studio ${styles.studio}`} aria-label="미들폼 편집기">
    <div className={styles.shell} inert={applyOpen || undefined}>
      <EditorStudioTopbar>
        <EditorStudioBackButton onClick={props.onClose} />
        <div className="editor-header-project"><span className="editor-header-project-number">{props.projectNumber ? `프로젝트 #${props.projectNumber} · 미들폼` : "미들폼 편집"}</span><div className="editor-header-title-row"><h1>{props.title}</h1></div></div>
        <div className="editor-history-controls" aria-label="편집 기록"><button type="button" disabled={busy || !props.canUndo} onClick={props.onUndo}><span aria-hidden="true">↶</span>되돌리기</button><button type="button" disabled={busy || !props.canRedo} onClick={props.onRedo}><span aria-hidden="true">↷</span>앞으로 가기</button></div>
        <div className="editor-header-actions">
          <span className={`editor-draft-status is-${props.saved ? "saved" : "saving"}`} role="status"><span aria-hidden="true" />{props.saved ? "이 기기에 임시 저장됨" : "임시 저장 중…"}</span>
          {props.outputReady && props.outputUrl ? <a className={`editor-close-button ${styles.download}`} href={props.outputUrl} download="easycut-midform.mp4">다운로드 <span aria-hidden="true">↓</span></a> : null}
          <button type="button" className="editor-apply-button" disabled={busy || !draft.rows.length || props.duration <= 0 || props.duration > 1200.1} onClick={() => setApplyOpen(true)}>{busy ? "적용 중…" : "영상에 적용"}</button>
        </div>
      </EditorStudioTopbar>
      <div ref={workspace} className="editor-page-body has-editor-tool-sidebar">
        <section ref={preview} className="editor-preview-pane has-range-editor" aria-label="영상 미리보기">
          <div className="editor-studio-canvas-heading"><span>미리보기 <span className="editor-studio-live-dot" /><button type="button" className={styles.previewMode} aria-pressed={props.editPreview} onClick={() => { props.onEditPreview(!props.editPreview); if (!props.editPreview) seekOutput(elapsed); }}>{props.editPreview ? "편집 결과" : "원본 확인 중"}</button></span><span>16:9 <i /> 1920 × 1080</span></div>
          <div className={styles.canvas}>
            <div className={`editor-preview-canvas-viewport ${styles.frame}`} style={{ transform: `scale(${previewZoom})` }}>
              <video ref={videoRef} src={props.sourceUrl} playsInline preload="metadata" aria-label="미들폼 영상 미리보기" onLoadedMetadata={event => { if (editPreview && position === 0 && event.currentTarget.currentTime === 0 && timeline[0]) onSeek(timeline[0].start); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={event => props.onPosition(event.currentTarget.currentTime)} style={{ transform: crop === "wide" ? "none" : "scale(1.4)", transformOrigin: `${crop === "left" ? "left" : crop === "right" ? "right" : "center"} center` }} />
              {showCaptions && current ? <p className={styles.caption} style={{ color: speakerAppearance(current.speaker, keys).color }}><span>{draft.names[current.speaker]}</span>{current.text}</p> : null}
              <MidformCaptionPreview cue={visibleEntertainment(draft.entertainment, ranges, position)} />
            </div>
          </div>
          <div className={`editor-preview-transport ${styles.transport}`}>
            <div className="editor-preview-time-group"><time>{clock(elapsed)}</time><span aria-hidden="true">/</span><time>{clock(props.duration)}</time></div>
            <button className="editor-preview-play-control" type="button" aria-label={playing ? "일시정지" : "재생"} aria-keyshortcuts="Space" title="재생 / 일시정지 (Space)" onClick={togglePlayback}>{playing ? "Ⅱ" : "▶"}</button>
            <button type="button" className={styles.fullscreen} aria-label="전체 화면" onClick={() => void preview.current?.requestFullscreen()}>⛶</button>
          </div>
          <EditorViewportZoomControl label="미리보기" value={previewZoom} min={.5} max={1.5} step={.25} className={styles.previewZoom} onChange={setPreviewZoom} />
        </section>
        <section className="editor-controls-pane has-editor-tool-rail" aria-label="영상 편집 도구">
          <div className="editor-studio-inspector-heading"><h2>{tool === "dialogue" ? "대본 편집" : "영상 편집"}</h2><span className={styles.cueCount}>{draft.rows.filter(row => row.keep).length}개 대사</span></div>
          <nav className="editor-tool-rail" aria-label="편집 도구"><div className="editor-tool-rail-buttons">{tools.map(item => <button type="button" key={item.id} aria-pressed={tool === item.id} onClick={() => setTool(item.id)}><span><ToolIcon tool={item.id} /></span>{item.label}</button>)}</div></nav>
          <div className="editor-controls-detail"><div className={`editor-controls-scroll${tool === "dialogue" ? ` ${styles.dialogueScroll}` : ""}`}>
            {props.error ? <p className="editor-studio-error" role="alert">{props.error}</p> : null}
            {!draft.rows.length ? <p role="status">편집 영상을 불러오는 중입니다…</p> : tool === "dialogue" ? <MidformTranscript studio draft={draft} busy={busy} currentId={current?.id} onChange={props.onChange} onSeek={props.onSeek} onReview={props.onReview} />
              : tool === "captions" ? <><header className="editor-tool-panel-header"><strong>자막</strong></header><label className={styles.checkbox}><input type="checkbox" checked={showCaptions} onChange={event => setShowCaptions(event.target.checked)} />화자별 대사 미리보기</label><MidformCaptionPanel value={draft.entertainment} disabled={busy} position={position} duration={props.sourceDuration} onChange={entertainment => props.onChange({ ...draft, entertainment })} onSeek={props.onSeek} onGenerate={props.onGenerateCaptions} />{props.subtitleUrl && props.outputReady ? <a className={styles.subtitleDownload} href={props.subtitleUrl} download="easycut.srt">자막 파일 다운로드 ↓</a> : null}</>
                : tool === "speakers" ? <><header className="editor-tool-panel-header"><strong>화자</strong><span className="editor-studio-small-label">{keys.filter(key => !["unknown", "overlap"].includes(key)).length}명</span></header><p className="editor-studio-help">화자 이름을 정하고 대사에서 배지를 눌러 바꿀 수 있어요.</p>{keys.map(key => <label className={styles.speaker} key={key}><span style={{ color: speakerAppearance(key, keys).color }}>{speakerAppearance(key, keys).badge}</span><input aria-label={`${key} 화자 이름`} value={draft.names[key] || ""} disabled={busy} maxLength={30} onChange={event => props.onChange({ ...draft, names: { ...draft.names, [key]: event.target.value } })} /></label>)}</>
                  : <><header className="editor-tool-panel-header"><strong>레이아웃</strong></header><div className="editor-studio-info-row"><span>영상 비율</span><strong>16:9</strong></div><p className="editor-studio-help">화자별로 보여줄 화면 구도를 선택하세요.</p>{keys.filter(key => !["unknown", "overlap"].includes(key)).map(key => <label className={styles.layout} key={key}><span>{draft.names[key] || key}</span><EditorSelect label={`${draft.names[key] || key} 화면 구도`} value={draft.framing[key] || "wide"} disabled={busy} onChange={value => props.onChange({ ...draft, framing: { ...draft.framing, [key]: value } })} options={[{value:"wide",label:"전체 화면"},{value:"left",label:"왼쪽 확대"},{value:"center",label:"중앙 확대"},{value:"right",label:"오른쪽 확대"}]} /></label>)}<div className={styles.summary}>무음은 자동으로 정리돼요.<br />대사에서 제외한 구간은 영상에서도 빠집니다.</div></>}
          </div></div>
        </section>
        <section id="midform-studio-timeline" className="editor-range-panel editor-workspace-timeline" aria-label="미들폼 타임라인">
          <EditorTimelineResizer compact workspaceRef={workspace} timelineId="midform-studio-timeline" />
          <div className="editor-studio-timeline-toolbar"><div className="editor-studio-timeline-tools"><strong>타임라인</strong><span className="editor-studio-divider" /><button type="button" disabled={busy} onClick={props.onReset}>구간 초기화</button></div><span className="editor-studio-duration">미들폼 길이 <strong>{clock(props.duration)}</strong></span></div>
          <EditorViewportZoomControl label="타임라인" value={timelineZoom} min={1} max={8} step={.5} className="editor-timeline-zoom-control" onChange={setTimelineZoom} />
          <MidformStoryTimeline draft={draft} sourceRows={props.sourceRows} sourceScenes={props.sourceScenes} silences={props.silences}
            sourceDuration={props.sourceDuration} position={position} thumbnails={thumbnails}
            zoom={timelineZoom} onZoomChange={setTimelineZoom} busy={busy} onChange={props.onChange}
            onSeek={seconds => { props.onEditPreview(true); props.onSeek(seconds); }} onReview={props.onReview} onCaptionSelect={() => setTool("dialogue")} />
        </section>
      </div>
    </div>
    {applyOpen ? <dialog ref={applyDialog} className={styles.modal} onCancel={() => setApplyOpen(false)} aria-labelledby="midform-apply-title"><h2 id="midform-apply-title">편집한 내용을 영상에 적용할까요?</h2><p>대사와 선택한 구간을 반영해 영상을 다시 만들어요.</p><div><button type="button" autoFocus onClick={() => setApplyOpen(false)}>취소</button><button type="button" onClick={() => { setApplyOpen(false); props.onApply(); }}>영상에 적용</button></div></dialog> : null}
  </main>;
}
