"use client";
import { localizeUpdate, missingUpdateTexts, updateSourceTexts } from "@/lib/update-localization";
import type { SiteLocale } from "@/lib/i18n/config";
import { useEffect, useRef, useState } from "react";
import { UpdateArticleView } from "@/app/updates/article-view";
import { UpdateCover } from "@/app/updates/update-cover";
import { CapturedImage } from "@/app/updates/captured-image";
import { publicationIssues, type AdminUpdate, type UpdateContent, type UpdateBlock, type UpdateShot } from "@/lib/update-content";
import styles from "./admin-updates.module.css";
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const emptyPost = (): AdminUpdate => ({ id: crypto.randomUUID(), version: 0, visible: false, firstPublishedAt: null, updatedAt: new Date().toISOString(), hasChanges: true, draft: { slug: `update-${today()}-${crypto.randomUUID().slice(0, 6)}`, title: "", summary: "", date: today(), kind: "새 기능", topic: "", cover: "", image: "", commit: "", href: "/", changes: [], steps: [], readingMinutes: 2, blocks: [{ type: "text", eyebrow: "변경 내용", heading: "이렇게 달라졌어요", paragraphs: [""], strongFirst: true }] } });
async function request<T>(url: string, data?: unknown): Promise<T> {
 const response = await fetch(url, { method: data ? "POST" : "GET", cache: "no-store", headers: data ? { "Content-Type": "application/json" } : undefined, body: data ? JSON.stringify(data) : undefined });
 const body = await response.json(); if (!response.ok) throw new Error(body.detail || "요청을 처리하지 못했습니다."); return body as T;
}
function Field({ label, value, onChange, multiline = false, type = "text", disabled = false }: { label: string; value: string; onChange: (s: string) => void; multiline?: boolean; type?: string; disabled?: boolean }) {
 return <label className={styles.field}><span>{label}</span>{multiline ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} disabled={disabled}/> : <input type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}/>}</label>;
}
function PhotoEditor({ shot, onChange, onBusy }: { shot?: UpdateShot; onChange: (s: UpdateShot) => void; onBusy: (busy: boolean) => void }) {
 const [uploading, setUploading] = useState(false); const [error, setError] = useState("");
 const [start, setStart] = useState<{ x: number; y: number } | null>(null); const [end, setEnd] = useState<{ x: number; y: number } | null>(null);
 const startRef = useRef<{ x: number; y: number } | null>(null);
 const upload = async (file?: File) => {
  if (!file) return; setError("");
  if (file.size > 3 * 1024 * 1024) { setError("사진은 3MB 이하로 선택해 주세요."); return; }
  setUploading(true); onBusy(true);
  try {
   const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file); });
   const asset = await request<{ src: string; width: number; height: number }>("/api/admin/updates/assets", { image });
   onChange({ ...asset, sourceWidth: asset.width, sourceHeight: asset.height, cropX: 0, cropY: 0, capturedAt: today(), alt: shot?.alt ?? "", annotations: [] });
  } catch(e) { setError(e instanceof Error ? e.message : "사진 업로드에 실패했습니다."); }
  finally { setUploading(false); onBusy(false); }
 };
 const point = (e: React.PointerEvent<HTMLDivElement>) => { const rect = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100)) }; };
 const rectangle = start && end ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(start.x - end.x), h: Math.abs(start.y - end.y) } : null;
 return <div className={styles.photoEditor}>
  <label className={styles.upload}>{uploading ? "사진 올리는 중…" : shot ? "사진 바꾸기" : "사진 올리기"}<input aria-label={shot ? "사진 바꾸기" : "사진 올리기"} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }}/></label><small>JPG · PNG · WEBP, 최대 3MB</small>
  {error && <p role="alert">{error}</p>}
  {shot && <>
   <div className={styles.drawCanvas} aria-label="사진 위를 드래그해 표시 추가" onPointerDown={e => { if (e.button !== 0 || shot.annotations.length >= 20) return; e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); startRef.current = p; setStart(p); setEnd(p); }} onPointerMove={e => { if (startRef.current) setEnd(point(e)); }} onPointerCancel={() => { startRef.current = null; setStart(null); setEnd(null); }} onPointerUp={e => { const from = startRef.current; const to = point(e); if (from) { const a = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(from.x-to.x), h: Math.abs(from.y-to.y), label: "표시 설명" }; if (a.w >= 1 && a.h >= 1) onChange({ ...shot, annotations: [...shot.annotations, a] }); } startRef.current = null; setStart(null); setEnd(null); }}>
    <CapturedImage image="" shot={shot}/>{[...shot.annotations, ...(rectangle ? [rectangle] : [])].map((a, i) => <span key={i} className={styles.mark} style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }}><b>{i + 1}</b></span>)}
   </div>
   <p className={styles.hint}>사진에서 강조할 곳을 드래그하세요. 숫자와 설명이 함께 표시됩니다.</p>
   <div className={styles.twoColumns}><Field label="사진 설명" value={shot.alt} onChange={alt => onChange({ ...shot, alt })}/><Field label="캡처 날짜" type="date" value={shot.capturedAt} onChange={capturedAt => onChange({ ...shot, capturedAt })}/></div>
   {shot.annotations.map((a, i) => <div className={styles.annotation} key={i}><strong>{i + 1}</strong><input aria-label={`${i+1}번 표시 설명`} value={a.label} onChange={e => onChange({ ...shot, annotations: shot.annotations.map((item, j) => i === j ? { ...item, label: e.target.value } : item) })}/><button type="button" onClick={() => onChange({ ...shot, annotations: shot.annotations.filter((_, j) => i !== j) })}>표시 삭제</button></div>)}
   <button type="button" onClick={() => onChange({ ...shot, annotations: [...shot.annotations, { x: 10, y: 10, w: 30, h: 20, label: "표시 설명" }] })} disabled={shot.annotations.length >= 20}>번호 표시 추가</button>
   {shot.annotations.length > 0 && <details><summary>표시 위치 조절</summary>{shot.annotations.map((a, i) => <div className={styles.coordinates} key={i}><strong>{i+1}번</strong>{(["x", "y", "w", "h"] as const).map((key, j) => <label key={key}>{["가로 위치", "세로 위치", "너비", "높이"][j]} (%)<input type="number" min={key === "w" || key === "h" ? 1 : 0} max={100} value={Math.round(a[key] * 10)/10} onChange={e => { const next = { ...a, [key]: Math.max(0, Math.min(100, Number(e.target.value))) }; next.w = Math.max(0.1, Math.min(next.w, 100 - next.x)); next.h = Math.max(0.1, Math.min(next.h, 100-next.y)); onChange({ ...shot, annotations: shot.annotations.map((item, n) => n === i ? next : item) }); }}/></label>)}</div>)}</details>}
  </>}
 </div>;
}
export function AdminUpdates({ initialPosts }: { initialPosts: AdminUpdate[] }) {
 const [posts, setPosts] = useState(initialPosts); const [selected, setSelected] = useState<AdminUpdate | null>(null); const [saved, setSaved] = useState(""); const [preview, setPreview] = useState(false); const [query, setQuery] = useState(""); const [status, setStatus] = useState("전체"); const [busy, setBusy] = useState(false); const [uploads, setUploads] = useState(0); const [message, setMessage] = useState(""); const [error, setError] = useState("");
 const [previewLocale, setPreviewLocale] = useState<SiteLocale>("ko");
 const [editLocale, setEditLocale] = useState<"en" | "ja">("en");
 const dirty = selected !== null && JSON.stringify(selected.draft) !== saved;
 useEffect(() => { if (!dirty) return; const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [dirty]);
 const patch = (change: Partial<UpdateContent>) => setSelected(p => p ? { ...p, draft: { ...p.draft, ...change } } : p);
 const select = (post: AdminUpdate) => { setSelected(structuredClone(post)); setSaved(post.version ? JSON.stringify(post.draft) : ""); setPreview(false); setPreviewLocale("ko"); setMessage(""); setError(""); };
 const save = async (action: "save" | "publish" | "hide" | "translate") => {
  if (!selected || busy || uploads) return;
  if (action === "publish") { const issues = publicationIssues(selected.draft); if (issues.length) { setError(issues.join(" ")); return; } }
  if (action === "hide" && dirty) { setError("변경 내용을 먼저 초안으로 저장한 뒤 숨겨 주세요."); return; }
  if (action === "hide" && !window.confirm("이 글을 업데이트 페이지에서 숨길까요? 글과 사진은 보관됩니다.")) return;
  setBusy(true); setError(""); setMessage("");
  try { const result = await request<AdminUpdate>("/api/admin/updates", { id: selected.id, version: selected.version, action, draft: selected.draft }); setSelected(result); setSaved(JSON.stringify(result.draft)); setPosts(p => [result, ...p.filter(x => x.id !== result.id)].sort((a,b) => b.draft.date.localeCompare(a.draft.date))); setMessage(action === "publish" ? "한국어·영어·일본어로 게시했습니다. 업데이트 페이지에 반영됐어요." : action === "hide" ? "글을 숨겼습니다." : action === "translate" ? "번역을 준비하고 초안을 저장했습니다. 언어별 미리보기에서 확인해 주세요." : "초안을 저장했습니다. 게시 중인 내용은 그대로입니다."); }
  catch(e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); } finally { setBusy(false); }
 };
 const onUpload = (working: boolean) => setUploads(n => n + (working ? 1 : -1));
 const blocks = selected?.draft.blocks ?? [];
 const block = (i: number, next: UpdateBlock) => patch({ blocks: blocks.map((b,j) => i === j ? next : b) });
 const move = (i: number, dir: number) => { const next = [...blocks]; [next[i], next[i+dir]] = [next[i+dir], next[i]]; patch({ blocks: next }); };
 const addBlock = (type: "text" | "image" | "steps") => { if (type === "image" && !selected?.draft.shot) { setError("먼저 표지 사진을 올려 주세요. 본문 사진은 추가 후 바꿀 수 있습니다."); return; } patch({ blocks: [...blocks, type === "text" ? { type, heading: "", eyebrow: "", paragraphs: [""], strongFirst: false } : type === "steps" ? { type, heading: "이렇게 사용해 보세요", items: [""], href: "/" } : { type, heading: "화면으로 살펴보기", description: "실제 화면에서 사용할 위치를 확인해 보세요. 이미지를 누르면 더 크게 볼 수 있어요.", shot: structuredClone(selected!.draft.shot!) }] }); };
 if (!selected) return <section className={styles.manager}>
  <div className={styles.toolbar}><div><h2>사진과 글로 전하는 새로운 소식</h2><p>초안을 미리 보고, 준비되면 바로 게시하세요.</p></div><button className={styles.primary} onClick={() => select(emptyPost())}>+ 새 업데이트</button></div>
  <div className={styles.filters}><input aria-label="관리할 업데이트 검색" placeholder="제목이나 주제로 검색" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="게시 상태" value={status} onChange={e => setStatus(e.target.value)}>{["전체", "게시 중", "초안", "숨김"].map(s => <option key={s}>{s}</option>)}</select><span>{posts.length}개의 글</span></div>
  <div className={styles.postList}>{posts.filter(p => `${p.draft.title} ${p.draft.topic}`.includes(query) && (status === "전체" || (p.visible ? "게시 중" : p.firstPublishedAt ? "숨김" : "초안") === status)).map(p => <button className={styles.postRow} key={p.id} onClick={() => select(p)}><span className={styles.thumb}>{p.draft.shot ? <UpdateCover post={p.draft}/> : <span>사진 없음</span>}</span><span><span className={styles.state}>{p.visible ? "게시 중" : p.firstPublishedAt ? "숨김" : "초안"}{p.visible && p.hasChanges ? " · 수정 초안 있음" : ""}</span><strong>{p.draft.title || "제목 없는 업데이트"}</strong><small>{p.draft.date} · {p.draft.kind} · {p.draft.topic}</small></span><span>수정 →</span></button>)}</div>
 </section>;
 const post = selected.draft;
 const previewPost = localizeUpdate(post, previewLocale);
 return <section className={styles.manager}>
  <div className={styles.editorToolbar}><button disabled={busy || uploads > 0} onClick={() => { if (!dirty || window.confirm("저장하지 않은 변경 내용이 있습니다. 목록으로 돌아갈까요?")) setSelected(null); }}>← 목록</button><span className={styles.state}>{dirty ? "저장하지 않은 변경" : selected.visible ? selected.hasChanges ? "수정 초안 저장됨" : "게시 중" : "초안"}</span><div className={styles.actions}><button aria-pressed={preview} onClick={() => setPreview(p => !p)}>{preview ? "편집으로 돌아가기" : "미리보기"}</button><button disabled={busy || uploads > 0} onClick={() => void save("save")}>초안 저장</button><button className={styles.primary} disabled={busy || uploads > 0} onClick={() => void save("publish")}>{busy ? "처리 중…" : "게시하기"}</button></div></div>
  {error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.success}>{message}</p>}
  {preview ? <div className={styles.preview}><p className={styles.previewNote}>미리보기 · 아직 게시되지 않은 변경 내용도 표시됩니다.</p><label>미리보기 언어 <select value={previewLocale} onChange={e => setPreviewLocale(e.target.value as SiteLocale)}><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option></select></label>{post.shot ? previewPost ? <UpdateArticleView post={previewPost} locale={previewLocale}/> : <p>편집 화면에서 번역을 준비하면 이 언어로 미리 볼 수 있습니다.</p> : <p>표지 사진을 올리면 실제 화면으로 미리 볼 수 있습니다.</p>}</div> : <fieldset className={styles.editorFields} disabled={busy || uploads > 0}>
   <section className={styles.panel}><h2>영어·일본어 번역</h2><p>게시하면 한국어 원문과 영어·일본어 번역이 함께 공개됩니다. 원문을 수정하면 바뀐 문장을 다시 번역합니다.</p><button type="button" onClick={() => void save("translate")}>번역 준비 · 초안 저장</button><p>영어 {missingUpdateTexts(post, "en").length ? "번역 필요" : "준비됨"} · 일본어 {missingUpdateTexts(post, "ja").length ? "번역 필요" : "준비됨"}</p><details><summary>번역 확인·수정</summary><label>수정할 언어 <select value={editLocale} onChange={e => setEditLocale(e.target.value as "en" | "ja")}><option value="en">English</option><option value="ja">日本語</option></select></label>{updateSourceTexts(post).map(source => <Field key={`${editLocale}:${source}`} label={source} multiline value={post.translations?.[editLocale]?.[source] ?? ""} onChange={value => patch({ translations: { en: { ...post.translations?.en }, ja: { ...post.translations?.ja }, [editLocale]: { ...post.translations?.[editLocale], [source]: value } } })}/>)}</details></section>
   <div className={styles.editorGrid}><div>
    <section className={styles.panel}><h2>기본 정보</h2><Field label="제목" value={post.title} onChange={title => patch({ title })}/><Field label="짧은 소개" multiline value={post.summary} onChange={summary => patch({ summary })}/><div className={styles.twoColumns}><Field label="게시 날짜" type="date" value={post.date} onChange={date => patch({ date })}/><label className={styles.field}><span>분류</span><select value={post.kind} onChange={e => patch({ kind: e.target.value as UpdateContent["kind"] })}>{["새 기능", "개선", "오류 수정"].map(k => <option key={k}>{k}</option>)}</select></label></div><Field label="주제 (예: 커뮤니티 템플릿)" value={post.topic} onChange={topic => patch({ topic })}/><details><summary>글 주소 · 읽기 시간</summary><Field label="글 주소 /updates/" disabled={Boolean(selected.firstPublishedAt)} value={post.slug} onChange={slug => patch({ slug })}/><Field label="읽기 시간 (분)" type="number" value={String(post.readingMinutes)} onChange={n => patch({ readingMinutes: Math.max(1, Math.min(60, Number(n))) })}/></details></section>
    <section className={styles.panel}><h2>표지</h2><Field label="표지 문구 (줄바꿈 가능)" multiline value={post.cover} onChange={cover => patch({ cover })}/><PhotoEditor shot={post.shot} onChange={shot => patch({ shot })} onBusy={onUpload}/></section>
   </div><aside className={styles.cardPreview}><h3>목록에서 보이는 모습</h3>{post.shot ? <UpdateCover post={post}/> : <div className={styles.placeholder}>표지 사진을 올려 주세요</div>}<h2>{post.title || "업데이트 제목"}</h2><p>{post.summary || "짧은 소개가 여기에 표시됩니다."}</p><small>{post.date} · {post.kind}</small></aside></div>
   <section className={styles.bodyEditor}><div className={styles.toolbar}><div><h2>본문</h2><p>글, 사진, 사용 방법을 원하는 순서로 넣으세요.</p></div></div>
    {blocks.map((b,i) => <section className={styles.panel} key={i}><div className={styles.blockBar}><h3>{i+1}. {b.type === "text" ? "글" : b.type === "image" ? "사진" : b.type === "steps" ? "사용 방법" : "YouTube 연결 안내"}</h3><div><button aria-label={`${i+1}번 블록 위로`} disabled={i === 0} onClick={() => move(i,-1)}>↑</button><button aria-label={`${i+1}번 블록 아래로`} disabled={i === blocks.length-1} onClick={() => move(i,1)}>↓</button><button onClick={() => { if (window.confirm("이 블록을 삭제할까요?")) patch({ blocks: blocks.filter((_,j) => i !== j) }); }}>삭제</button></div></div>
     {b.type === "text" && <><Field label="소제목" value={b.heading} onChange={heading => block(i,{...b,heading})}/><Field label="본문 (빈 줄로 문단 구분)" multiline value={b.paragraphs.join("\n\n")} onChange={s => block(i,{...b,paragraphs:s.split("\n\n")})}/><label className={styles.check}><input type="checkbox" checked={b.strongFirst} onChange={e => block(i,{...b,strongFirst:e.target.checked})}/>첫 문단 강조</label><details><summary>작은 머리말</summary><Field label="머리말" value={b.eyebrow} onChange={eyebrow => block(i,{...b,eyebrow})}/></details></>}
     {b.type === "image" && <><Field label="소제목" value={b.heading} onChange={heading => block(i,{...b,heading})}/><Field label="사진 위 안내" value={b.description} onChange={description => block(i,{...b,description})}/><PhotoEditor shot={b.shot} onChange={shot => block(i,{...b,shot})} onBusy={onUpload}/></>}
     {b.type === "steps" && <><Field label="소제목" value={b.heading} onChange={heading => block(i,{...b,heading})}/><Field label="사용 방법 (한 줄에 한 단계)" multiline value={b.items.join("\n")} onChange={s => block(i,{...b,items:s.split("\n")})}/><Field label="기능 연결 주소 (예: /popular)" value={b.href} onChange={href => block(i,{...b,href})}/></>}
     {b.type === "youtube-guide" && <p>YouTube 채널 연결 안내가 표시됩니다.</p>}
    </section>)}
    <div className={styles.addBlocks}><button onClick={() => addBlock("text")} disabled={blocks.length >= 40}>+ 글 추가</button><button onClick={() => addBlock("image")} disabled={blocks.length >= 40}>+ 사진 추가</button><button onClick={() => addBlock("steps")} disabled={blocks.length >= 40}>+ 사용 방법 추가</button></div>
   </section>
   {selected.visible && <div className={styles.publishLinks}><a href={`/updates/${post.slug}`} target="_blank" rel="noreferrer">게시한 글 열기 ↗</a><button onClick={() => void save("hide")}>게시 중인 글 숨기기</button></div>}
  </fieldset>}
 </section>;
}
