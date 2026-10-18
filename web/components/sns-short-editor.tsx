"use client";

import { useRouter } from "@/lib/i18n/navigation";
import { useUiText } from "@/lib/i18n/use-ui-text";
import { communityBoardLimits, communityLegacyHeading } from "@/lib/community-template-contract";
import { validateSnsTextWidths } from "@/lib/sns-editor-fonts";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import type { GeneratedShort } from "@/lib/contracts";
import type { EditorReleaseAssignment } from "@/lib/editor-rendering-release";
import { createEditorDocumentSnapshotV3 } from "@/lib/editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "@/lib/editor-overlay-preview";
import { createSnsEditorRenderSpec } from "@/lib/sns-editor-render-spec";
import { snsCopyLimits, snsEditedSnapshotSchema, type SnsLanguage } from "@/lib/sns-editor-contract";
import { SnsTemplatePreview } from "./sns-template-preview";

import { EditorStudioBackButton, EditorStudioTopbar } from "./editor-studio-chrome";
import { EditorTemplateTimeline, templateEditorTime } from "./editor-template-timeline";
import { createTemplateEditorHistory, templateEditorDirty, templateEditorHistory, type TemplateEditorDraft } from "@/lib/template-editor-history";
import { resolveEditorHistoryShortcut } from "@/lib/editor-history-shortcuts";
type Tool = "title" | "content" | "channel" | "video";
type Timeline = { url: string; timelineStartSeconds: number; timelineEndSeconds: number; version: number };
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail || value.error?.message || value.error || value.message || "요청을 처리하지 못했습니다.");
  return value;
}
export function SnsShortEditor({ item, projectNumber, channelThumbnailUrl, release, canEdit, onChanged }: {
  item: GeneratedShort; projectNumber: number; channelThumbnailUrl: string | null;
  release: EditorReleaseAssignment; canEdit: boolean; onChanged: () => Promise<void>;
}) {
  const ui = useUiText();
  const original = item.templateSnapshot!;
  const community = original.communityTemplateVersion === 1;
  const name = community ? "커뮤니티" : "SNS";
  const language = (original.snsLanguage || "ko") as SnsLanguage;
  const ratio = item.videoAspectRatio;
  const limits = snsCopyLimits(community ? "4:5" : ratio, language);
  const content = original.snsContent as { boardName?: string; title: string; body: string[]; hashtags: string[] };
  const router = useRouter();
  const [history, dispatch] = useReducer(templateEditorHistory, {
    boardName: content.boardName ?? communityLegacyHeading[language], title: content.title, body: content.body, tags: content.hashtags,
    brandColor: String(original.brandColor || "#000000"), channel: item.channelDisplayName,
    avatar: item.editorDocument?.channel.thumbnailAssetKey ? `/api/shorts/${item.id}/editor-channel-asset` : item.editorDocument?.channel.thumbnailUrl || channelThumbnailUrl,
    assetKey: item.editorDocument?.channel.thumbnailAssetKey || null, start: item.startSeconds, end: item.endSeconds,
  }, createTemplateEditorHistory);
  const { boardName, title, body, tags, brandColor, channel, avatar, assetKey, start, end } = history.present;
  const dirty = templateEditorDirty(history);
  const [tool, setTool] = useState<Tool>("title");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(item.startSeconds);
  const [preparingImage, setPreparingImage] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const timelineId = useId();
  const mounted = useRef(true);
  const savingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState(false);
  const requestId = useRef<string | null>(null);
  const busy = saving || item.status === "rerendering";
  const blocked = busy || preparingImage || !canEdit;
  useEffect(() => {
    let disposed = false;
    request<Timeline>(`/api/shorts/${item.id}/edit-timeline`).then(data => {
      if (!disposed) setTimeline(data);
    }).catch(cause => { if (!disposed) setError(String(cause.message)); });
    return () => { disposed = true; };
  }, [item.id]);
  useEffect(() => {
    if (item.status !== "rerendering") return;
    const timer = setInterval(() => { void onChanged().catch(() => setError("진행 상황을 확인하지 못했습니다. 잠시 후 다시 시도합니다.")); }, 3000);
    return () => clearInterval(timer);
  }, [item.status, onChanged]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const edit = (patch: Partial<TemplateEditorDraft>, group?: string) => {
    dispatch({ type: "edit", patch, group }); setApplied(false); requestId.current = null;
  };
  const historyAction = (type: "undo" | "redo") => { dispatch({ type }); setApplied(false); requestId.current = null; };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const action = resolveEditorHistoryShortcut(event);
      if (!action || blocked) return;
      event.preventDefault(); dispatch({ type: action }); setApplied(false); requestId.current = null;
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [blocked]);
  async function save() {
    if (!timeline || blocked || savingRef.current) return;
    savingRef.current = true;
    setError(""); setSaving(true);
    try {
      const snapshot = snsEditedSnapshotSchema(ratio, language, community).parse({ presetVersion: 4, snsTemplateVersion: 1,
        snsLanguage: language, brandColor, ...(community ? { communityTemplateVersion: 1 } : {}), snsContent: { ...(community ? { boardName } : {}), title, body, hashtags: tags, source: "edited" } });
      await validateSnsTextWidths(snapshot.snsContent, community ? "4:5" : ratio, language);
      const { communityTemplateVersion, ...baseSnapshot } = snapshot;
      if (!channel.trim()) throw new Error("채널명을 입력해 주세요.");
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < timeline.timelineStartSeconds || end > timeline.timelineEndSeconds || end - start < 3) {
        throw new Error("편집 범위 안에서 3초 이상의 구간을 선택해 주세요.");
      }
      const document = createEditorDocumentSnapshotV3({ sourceShortId: item.id, baseRenderVersion: item.renderVersion,
        template: { id: "white-yellow", customTemplateId: null, presetVersion: 4,
          snapshot: communityTemplateVersion === 1 ? { ...baseSnapshot, communityTemplateVersion } : baseSnapshot },
        title: { text: snapshot.snsContent.title, textStyles: [], fontScale: 1 },
        channel: { displayName: channel.trim(), thumbnailUrl: assetKey ? null : avatar, thumbnailAssetKey: assetKey },
        comments: [], subtitles: { enabled: false, segments: [] }, overlays: createInitialEditorOverlayLayout(),
        video: { aspectRatio: ratio, timelineStartSeconds: timeline.timelineStartSeconds, timelineEndSeconds: timeline.timelineEndSeconds,
          selectionStartSeconds: start, selectionEndSeconds: end,
          clips: [{ id: "sns-video-1", sourceStartSeconds: start - timeline.timelineStartSeconds, sourceEndSeconds: end - timeline.timelineStartSeconds }] } });
      document.renderSpec = await createSnsEditorRenderSpec(document);
      requestId.current ||= crypto.randomUUID();
      await request(`/api/shorts/${item.id}/apply-edit`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId.current, timelineVersion: timeline.version, templateSelectionTouched: false,
          release: { releaseId: release.releaseId, channel: release.channel, uiVersion: release.uiVersion, documentVersion: release.documentVersion }, document }) });
      dispatch({ type: "saved" }); setApplied(true);
      await onChanged().catch(() => setError("편집 요청은 접수되었지만 진행 상황을 확인하지 못했습니다. 프로젝트에서 확인해 주세요."));
    } catch (cause) {
      setError(cause instanceof Error ? (cause.name === "ZodError" ? "게시판 이름·제목·본문의 글자 수와 해시태그 형식을 확인해 주세요." : cause.message) : "수정 반영에 실패했습니다.");
    } finally { savingRef.current = false; setSaving(false); }
  }
  const inputClass = "template-editor-input";
  const toolItems = [{ id: "title", label: "후킹 제목", icon: "T" }, { id: "content", label: "본문", icon: "☷" }, { id: "channel", label: "채널", icon: "◎" }, { id: "video", label: "영상", icon: "▷" }] as const;
  const selectTool = (tool: Tool) => { dispatch({ type: "checkpoint" }); setTool(tool); setMobileOpen(true); };
  const seek = (absoluteTime: number) => { if (videoRef.current && timeline) { videoRef.current.currentTime = Math.max(start, Math.min(end, absoluteTime)) - timeline.timelineStartSeconds; setCurrentTime(Math.max(start, Math.min(end, absoluteTime))); } };
  const leave = () => { if (!dirty || window.confirm(ui("반영하지 않은 변경사항이 있습니다. 편집기를 나가시겠습니까?"))) router.push(`/projects/${projectNumber}`); };
  return <main className="editor-page editor-v2-root editor-studio editor-template-studio">
    <EditorStudioTopbar>
      <EditorStudioBackButton onClick={leave} />
      <div className="editor-history-controls">
        <button type="button" aria-label={ui("되돌리기")} title={ui("되돌리기")} disabled={blocked || !history.past.length} onClick={() => historyAction("undo")}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12" stroke="currentColor" strokeWidth="2" /></svg></button>
        <button type="button" aria-label={ui("다시 실행")} title={ui("다시 실행")} disabled={blocked || !history.future.length} onClick={() => historyAction("redo")}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12" stroke="currentColor" strokeWidth="2" /></svg></button>
      </div>
      <div className="editor-header-project"><strong>{ui(`${name} 템플릿 편집`)}</strong><span className="editor-draft-status">{ui(dirty ? "변경사항 적용 필요" : applied ? "적용 요청됨" : "현재 영상과 같음")}</span></div>
      <div className="editor-header-actions"><button type="button" className="editor-apply-button" disabled={blocked || !timeline || (!dirty && !item.editorApplyFailed)} onClick={() => void save()}>{ui(busy ? "영상에 반영 중…" : "영상에 적용")}</button></div>
    </EditorStudioTopbar>
    {error && <div role="alert" className="template-editor-notice">{ui(error)} <button type="button" aria-label={ui("닫기")} onClick={() => setError("")}>×</button></div>}
    {!canEdit && <div className="template-editor-notice">{ui("이 계정의 편집 이용 권한을 확인해 주세요.")}</div>}
    {(applied || busy || item.editorApplyFailed) && <div role="status" className="template-editor-status">{ui(saving ? "편집 내용을 전달하고 있습니다." : busy ? `수정한 내용으로 영상을 만들고 있습니다. ${item.rerenderProgress ?? 0}%` : item.editorApplyFailed ? "반영에 실패했습니다. 내용을 확인하고 다시 시도해 주세요." : "편집 요청이 접수되었습니다. 프로젝트에서 결과를 확인해 주세요.")}{applied && !busy && !item.editorApplyFailed && <button type="button" aria-label={ui("닫기")} onClick={() => setApplied(false)}>×</button>}</div>}
    <div ref={workspaceRef} className={`editor-page-body has-editor-tool-sidebar${mobileOpen ? " has-mobile-controls-open" : ""}`}>
      <section className="editor-preview-pane has-range-editor">
        <div className="editor-studio-canvas-heading"><span>{ui("미리보기")}</span><span>{ratio} · 1080 × 1920</span></div>
        <div className="editor-preview-canvas-wrap template-preview-wrap">
          <SnsTemplatePreview community={community} language={language} ratio={ratio} brandColor={brandColor} channelName={channel} channelThumbnailUrl={avatar}
            thumbnailUrl="" content={{ ...(community ? { boardName } : {}), title, body, hashtags: tags }} videoUrl={timeline?.url}
            videoStart={timeline ? start - timeline.timelineStartSeconds : 0} videoEnd={timeline ? end - timeline.timelineStartSeconds : undefined}
            videoRef={videoRef} videoControls={false} onTimeChange={time => setCurrentTime(time + (timeline?.timelineStartSeconds ?? 0))} onPlayingChange={setPlaying}
            onVideoError={() => setError("영상을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.")} />
        </div>
        <div className="template-preview-transport"><button type="button" className="editor-preview-play-control" aria-label={ui(playing ? "일시정지" : "재생")} disabled={!timeline}
          onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play().catch(() => setError("영상을 재생하지 못했습니다. 다시 시도해 주세요.")); else video.pause(); }}>{playing ? "Ⅱ" : "▶"}</button>
          <output>{templateEditorTime(Math.max(0, currentTime - start))} / {templateEditorTime(end - start)}</output></div>
      </section>
      <section className={`editor-controls-pane has-editor-tool-rail${mobileOpen ? " is-mobile-open" : ""}`} aria-label={ui("편집 도구")}>
        <div className="editor-studio-inspector-heading"><h2>{ui("편집 도구")}</h2></div>
        <nav className="editor-tool-rail" aria-label={ui("편집 도구")}><div className="editor-tool-rail-buttons">{toolItems.map(entry => <button type="button" key={entry.id} aria-pressed={tool === entry.id} onClick={() => selectTool(entry.id)}><span aria-hidden="true">{entry.icon}</span>{ui(entry.label)}</button>)}</div></nav>
        <div className="editor-controls-detail">
          <div className="template-sheet-heading"><strong>{ui(toolItems.find(entry => entry.id === tool)!.label)}</strong><button type="button" onClick={() => setMobileOpen(false)}>{ui("완료")}</button></div>
          <fieldset className="editor-controls-scroll template-editor-fields" disabled={blocked} onBlur={() => dispatch({ type: "checkpoint" })}>
            {tool === "title" && <>
              <label>{ui(`제목 · 한 줄, ${limits.title}자 이내`)}<input aria-label={ui("SNS 제목")} className={inputClass} value={title} onChange={e => edit({ title: e.target.value }, "title")} /></label>
              <label>{ui("브랜드 컬러")}<input aria-label={ui("SNS 브랜드 컬러")} type="color" value={brandColor} onChange={e => edit({ brandColor: e.target.value }, "color")} /><span className="template-editor-hint">{ui(community ? "최상단 네모 배경에 적용됩니다." : "제목 색은 자동으로 맞춰집니다.")}</span></label>
            </>}
            {tool === "content" && <>
              {community && <label>{ui(`게시판 이름 · ${communityBoardLimits[language][0]}~${communityBoardLimits[language][1]}자`)}<input aria-label={ui("커뮤니티 게시판 이름")} className={inputClass} value={boardName} onChange={e => edit({ boardName: e.target.value }, "board")} /></label>}
              {body.map((line, index) => <label key={index}>{ui(`본문 ${index + 1} · ${limits.body}자 이내`)}<input aria-label={ui(`SNS 본문 ${index + 1}`)} className={inputClass} value={line} onChange={e => edit({ body: body.map((v, i) => i === index ? e.target.value : v) }, `body-${index}`)} /></label>)}
              {limits.tags > 0 && <div><p>{ui(`해시태그 · 각 ${limits.tag}자 이내`)}</p>{tags.map((tag, index) => <input key={index} aria-label={ui(`SNS 해시태그 ${index + 1}`)} className={inputClass} value={tag} onChange={e => edit({ tags: tags.map((v, i) => i === index ? e.target.value : v) }, `tag-${index}`)} />)}</div>}
            </>}
            {tool === "channel" && <>
              <label>{ui("채널명")}<input aria-label={ui("SNS 채널명")} maxLength={50} className={inputClass} value={channel} onChange={e => edit({ channel: e.target.value }, "channel")} /></label>
              <label>{ui("채널 사진")}<input aria-label={ui("SNS 채널 사진")} type="file" accept="image/png,image/jpeg,image/webp" className={inputClass} onChange={async e => {
                const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
                if (file.size > 2 * 1024 * 1024) { setError("2MB 이하의 이미지를 선택해 주세요."); return; }
                setPreparingImage(true);
                try {
                  const bitmap = await createImageBitmap(file);
                  try {
                    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
                    const context = canvas.getContext("2d"); if (!context) throw new Error();
                    const size = Math.min(bitmap.width, bitmap.height);
                    context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
                    if (mounted.current) edit({ avatar: canvas.toDataURL("image/webp", 0.84), assetKey: null });
                  } finally { bitmap.close(); }
                } catch { if (mounted.current) setError("사진을 불러오지 못했습니다. JPG·PNG·WebP 파일을 선택해 주세요."); }
                finally { if (mounted.current) setPreparingImage(false); }
              }} /></label>
            </>}
            {tool === "video" && <>
              <p className="template-editor-hint">{ui("이 템플릿은 배치가 고정되어 있습니다. 아래 타임라인에서 영상 구간을 조절할 수 있습니다.")}</p>
              <label>{ui("시작(초)")}<input aria-label={ui("SNS 영상 시작")} className={inputClass} type="number" step="0.1" min={timeline?.timelineStartSeconds} max={end - 3} value={start} onChange={e => edit({ start: Math.max(timeline?.timelineStartSeconds ?? 0, Math.min(end - 3, Number(e.target.value))) }, "start")} /></label>
              <label>{ui("끝(초)")}<input aria-label={ui("SNS 영상 끝")} className={inputClass} type="number" step="0.1" min={start + 3} max={timeline?.timelineEndSeconds} value={end} onChange={e => edit({ end: Math.min(timeline?.timelineEndSeconds ?? end, Math.max(start + 3, Number(e.target.value))) }, "end")} /></label>
            </>}
          </fieldset>
        </div>
      </section>
      {timeline ? <EditorTemplateTimeline workspaceRef={workspaceRef} id={timelineId} min={timeline.timelineStartSeconds} max={timeline.timelineEndSeconds} start={start} end={end} time={currentTime} disabled={blocked}
        onSeek={seek} onRangeChange={(edge, value) => edit({ [edge]: value }, `range-${edge}`)} onCheckpoint={() => dispatch({ type: "checkpoint" })}
        layers={[{ label: title || ui("후킹 제목"), selected: tool === "title", onSelect: () => selectTool("title") }, { label: body.join(" · ") || ui("본문"), selected: tool === "content", onSelect: () => selectTool("content") }, { label: channel || ui("채널명"), selected: tool === "channel", onSelect: () => selectTool("channel") }]} />
        : <section className="editor-workspace-timeline template-timeline-loading" role="status">{ui(error ? "타임라인을 불러오지 못했습니다." : "타임라인 불러오는 중…")}</section>}
    </div>
  </main>;
}
