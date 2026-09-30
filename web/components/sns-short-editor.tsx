"use client";

import Link from "next/link";
import { validateSnsTextWidths } from "@/lib/sns-editor-fonts";
import { useEffect, useRef, useState } from "react";
import type { GeneratedShort } from "@/lib/contracts";
import type { EditorReleaseAssignment } from "@/lib/editor-rendering-release";
import { createEditorDocumentSnapshotV3 } from "@/lib/editor-document-snapshot";
import { createInitialEditorOverlayLayout } from "@/lib/editor-overlay-preview";
import { createSnsEditorRenderSpec } from "@/lib/sns-editor-render-spec";
import { snsCopyLimits, snsEditedSnapshotSchema, type SnsLanguage } from "@/lib/sns-editor-contract";
import { SnsTemplatePreview } from "./sns-template-preview";

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
  const original = item.templateSnapshot!;
  const community = original.communityTemplateVersion === 1;
  const name = community ? "커뮤니티" : "SNS";
  const language = (original.snsLanguage || "ko") as SnsLanguage;
  const ratio = item.videoAspectRatio;
  const limits = snsCopyLimits(community ? "4:5" : ratio, language);
  const content = original.snsContent as { title: string; body: string[]; hashtags: string[] };
  const [title, setTitle] = useState(content.title);
  const [body, setBody] = useState(content.body);
  const [tags, setTags] = useState(content.hashtags);
  const [brandColor, setBrandColor] = useState(String(original.brandColor || "#000000"));
  const [channel, setChannel] = useState(item.channelDisplayName);
  const [avatar, setAvatar] = useState(item.editorDocument?.channel.thumbnailAssetKey ? `/api/shorts/${item.id}/editor-channel-asset` : item.editorDocument?.channel.thumbnailUrl || channelThumbnailUrl);
  const [assetKey, setAssetKey] = useState(item.editorDocument?.channel.thumbnailAssetKey || null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [start, setStart] = useState(item.startSeconds);
  const [end, setEnd] = useState(item.endSeconds);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState(false);
  const [dirty, setDirty] = useState(false);
  const requestId = useRef<string | null>(null);
  const busy = saving || item.status === "rerendering";
  useEffect(() => {
    let disposed = false;
    request<Timeline>(`/api/shorts/${item.id}/edit-timeline`).then(data => {
      if (!disposed) setTimeline(data);
    }).catch(cause => { if (!disposed) setError(String(cause.message)); });
    return () => { disposed = true; };
  }, [item.id]);
  useEffect(() => {
    if (item.status !== "rerendering") return;
    const timer = setInterval(() => { void onChanged(); }, 3000);
    return () => clearInterval(timer);
  }, [item.status, onChanged]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const changed = () => { setDirty(true); setApplied(false); requestId.current = null; };
  async function save() {
    if (!timeline || !canEdit || busy) return;
    setError(""); setSaving(true);
    try {
      const snapshot = snsEditedSnapshotSchema(ratio, language, community).parse({ presetVersion: 4, snsTemplateVersion: 1,
        snsLanguage: language, brandColor, ...(community ? { communityTemplateVersion: 1 } : {}), snsContent: { title, body, hashtags: tags, source: "edited" } });
      await validateSnsTextWidths(snapshot.snsContent, community ? "4:5" : ratio, language);
      const { communityTemplateVersion, ...baseSnapshot } = snapshot;
      if (!channel.trim()) throw new Error("채널명을 입력해 주세요.");
      if (start < timeline.timelineStartSeconds || end > timeline.timelineEndSeconds || end - start < 3) {
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
      setDirty(false); setApplied(true);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? (cause.name === "ZodError" ? "제목·본문의 글자 수와 해시태그 형식을 확인해 주세요." : cause.message) : "수정 반영에 실패했습니다.");
    } finally { setSaving(false); }
  }
  const inputClass = "mt-2 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-cyan-300 focus:outline-none";
  return <main className="min-h-screen bg-[#121212] p-4 text-white sm:p-8">
    <header className="mx-auto mb-6 flex max-w-6xl items-center justify-between gap-3">
      <div><Link href={`/projects/${projectNumber}`} className="text-sm text-neutral-400">← 프로젝트</Link>
        <h1 className="mt-2 text-xl font-bold">{name} 템플릿 편집 <span className="text-xs" style={{ color: brandColor }}>베타</span></h1></div>
      <button type="button" onClick={() => void save()} disabled={busy || !timeline || !canEdit}
        className="rounded-xl bg-cyan-300 px-5 py-3 font-bold text-black disabled:opacity-40">{busy ? "영상에 반영 중…" : "수정 반영"}</button>
    </header>
    <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[minmax(260px,420px)_1fr]">
      <div className="mx-auto w-full max-w-[360px]">
        <SnsTemplatePreview community={community} language={language} ratio={ratio} brandColor={brandColor} channelName={channel} channelThumbnailUrl={avatar}
          thumbnailUrl="" content={{ title, body, hashtags: tags }} videoUrl={timeline?.url}
          videoStart={timeline ? start - timeline.timelineStartSeconds : 0} videoEnd={timeline ? end - timeline.timelineStartSeconds : undefined} />
        <p className="mt-3 text-center text-xs text-neutral-400">영상 {ratio} · 출력 1080 × 1920</p>
      </div>
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-60" onChange={changed}>
        <label className="block text-sm">제목 · 한 줄, {limits.title}자 이내<input aria-label="SNS 제목" className={inputClass} value={title} onChange={e => setTitle(e.target.value)} /></label>
        {body.map((line, index) => <label key={index} className="block text-sm">본문 {index + 1} · {limits.body}자 이내
          <input aria-label={`SNS 본문 ${index + 1}`} className={inputClass} value={line} onChange={e => setBody(body.map((v, i) => i === index ? e.target.value : v))} /></label>)}
        {limits.tags > 0 && <div><p className="text-sm">해시태그 · 각 {limits.tag}자 이내</p><div className="grid grid-cols-3 gap-2">
          {tags.map((tag, index) => <input key={index} aria-label={`SNS 해시태그 ${index + 1}`} className={inputClass} value={tag} onChange={e => setTags(tags.map((v, i) => i === index ? e.target.value : v))} />)}</div></div>}
        <label className="flex items-center gap-4 text-sm">브랜드 컬러<input aria-label="SNS 브랜드 컬러" type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)} className="h-10 w-16 cursor-pointer rounded" /><span className="text-neutral-400">{community ? "최상단 네모 배경에 적용됩니다." : "제목 색은 자동으로 맞춰집니다."}</span></label>
        <label className="block text-sm">채널명<input aria-label="SNS 채널명" maxLength={50} className={inputClass} value={channel} onChange={e => setChannel(e.target.value)} /></label>
        <label className="block text-sm">채널 사진<input aria-label="SNS 채널 사진" type="file" accept="image/png,image/jpeg,image/webp" className={inputClass} onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return;
          if (file.size > 2 * 1024 * 1024) { setError("2MB 이하의 이미지를 선택해 주세요."); return; }
          try {
            const bitmap = await createImageBitmap(file);
            try {
              const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
              const context = canvas.getContext("2d");
              if (!context) throw new Error("이미지를 처리하지 못했습니다.");
              const size = Math.min(bitmap.width, bitmap.height);
              context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
              setAvatar(canvas.toDataURL("image/webp", 0.84)); setAssetKey(null); changed();
            } finally { bitmap.close(); }
          } catch { setError("사진을 불러오지 못했습니다. JPG·PNG·WebP 파일을 선택해 주세요."); }
        }} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">시작(초)<input aria-label="SNS 영상 시작" className={inputClass} type="number" step="0.1" value={start} onChange={e => setStart(Number(e.target.value))} /></label>
          <label className="text-sm">끝(초)<input aria-label="SNS 영상 끝" className={inputClass} type="number" step="0.1" value={end} onChange={e => setEnd(Number(e.target.value))} /></label>
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        {!canEdit && <p className="text-sm text-amber-200">이 계정의 편집 이용 권한을 확인해 주세요.</p>}
        {(applied || busy) && <p role="status" className="rounded-xl bg-cyan-500/10 p-3 text-sm text-cyan-200">{busy ? `수정한 내용으로 영상을 만들고 있습니다. ${item.rerenderProgress || 5}%` : item.editorApplyFailed ? "반영에 실패했습니다. 내용을 확인하고 다시 시도해 주세요." : "영상 반영이 완료되었습니다."} <Link href={`/projects/${projectNumber}`} className="underline">프로젝트에서 보기</Link></p>}
      </fieldset>
    </div>
  </main>;
}
