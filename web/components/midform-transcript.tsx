"use client";
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MidformDraft, MidformRow } from "@/lib/midform-local";
import { speakerAppearance, speakerKeys, transcriptGroups } from "@/lib/midform-speakers";
import styles from "./midform-workspace.module.css";
import { EditorSelect } from "./editor-select";

const time = (n: number) => `${Math.floor(n / 60).toString().padStart(2, "0")}:${Math.floor(n % 60).toString().padStart(2, "0")}`;
const cueTime = (n: number) => `${time(n)}.${Math.floor(n * 10) % 10}`;
type Props = { studio?: boolean; draft: MidformDraft; busy: boolean; currentId?: string; onChange: (draft: MidformDraft) => void; onSeek: (seconds: number) => void; onReview: (seconds: number) => void };
export const MidformTranscript = memo(function MidformTranscript({ studio, draft, busy, currentId, onChange, onSeek, onReview }: Props) {
  const [query, setQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [follow, setFollow] = useState(true);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const container = useRef<HTMLDivElement>(null);
  const dialogueButtons = useRef(new Map<string, HTMLButtonElement>());
  const manualScrollUntil = useRef(0);
  const keys = useMemo(() => speakerKeys(draft), [draft]);
  const matches = (row: MidformRow) => (!speakerFilter || row.speaker === speakerFilter) && row.text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const groups = transcriptGroups(draft.rows).filter(group => group.rows.some(matches));
  const label = (key: string) => draft.names[key] || (key === "unknown" ? "미지정" : key === "overlap" ? "겹친 음성" : `화자 ${speakerAppearance(key, keys).badge}`);
  const change = (row: MidformRow, value: Partial<MidformRow>) => onChange({ ...draft, rows: draft.rows.map(item => item.id === row.id ? { ...item, ...value } : item) });
  useEffect(() => {
    const list = container.current;
    if (!list) return;
    const pause = () => { manualScrollUntil.current = performance.now() + 2500; };
    list.addEventListener("wheel", pause, { passive: true });
    list.addEventListener("touchstart", pause, { passive: true });
    list.addEventListener("pointerdown", pause);
    return () => {
      list.removeEventListener("wheel", pause);
      list.removeEventListener("touchstart", pause);
      list.removeEventListener("pointerdown", pause);
    };
  }, []);
  useEffect(() => {
    if (!follow || !currentId || editingSpeaker) return;
    const list = container.current;
    const active = list?.querySelector<HTMLElement>('[data-playing="true"]');
    const focused = document.activeElement;
    if (!list || !active || performance.now() < manualScrollUntil.current
      || (list.contains(focused) && focused?.matches("textarea,input,[contenteditable=true]"))) return;
    const itemRect = active.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (itemRect.top >= listRect.top + 8 && itemRect.bottom <= listRect.bottom - Math.min(32, list.clientHeight / 6)) return;
    const start = list.scrollTop;
    const inset = Math.max(0, Math.min(list.clientHeight * .28, list.clientHeight - itemRect.height - 8));
    const target = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, start + itemRect.top - listRect.top - inset));
    if (Math.abs(target - start) < 1) return;
    // A distant scene cut changes context directly; nearby dialogue follows gently.
    if (Math.abs(target - start) > list.clientHeight * 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { list.scrollTop = target; return; }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      if (performance.now() < manualScrollUntil.current) return;
      const progress = Math.min(1, (now - started) / 380);
      list.scrollTop = start + (target - start) * (1 - Math.pow(1 - progress, 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [currentId, follow, editingSpeaker, studio]);
  const finishEditing = (id: string) => {
    setEditingRow(null);
    requestAnimationFrame(() => dialogueButtons.current.get(id)?.focus({ preventScroll: true }));
  };
  const returnToCurrent = () => {
    setQuery(""); setSpeakerFilter(""); setFollow(true); manualScrollUntil.current = 0;
    const row = draft.rows.find(item => item.id === currentId);
    if (row) {
      const group = transcriptGroups(draft.rows).find(item => item.rows.some(item => item.id === row.id));
      if (group?.excluded) setExpanded(old => new Set([...old, group.id]));
      if (row.keep) onSeek(row.start); else onReview(row.start);
    }
    requestAnimationFrame(() => {
      const list = container.current, active = list?.querySelector<HTMLElement>('[data-playing="true"]');
      if (!list || !active) return;
      const inset = Math.max(0, Math.min(list.clientHeight * .28, list.clientHeight - active.getBoundingClientRect().height - 8));
      const top = list.scrollTop + active.getBoundingClientRect().top - list.getBoundingClientRect().top - inset;
      list.scrollTo({ top: Math.max(0, Math.min(list.scrollHeight - list.clientHeight, top)),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
  };
  const rowView = (row: MidformRow) => {
    const appearance = speakerAppearance(row.speaker, keys);
    const seek = () => row.keep ? onSeek(row.start) : onReview(row.start);
    return <div key={row.id} className={`${styles.dialogueRow} ${currentId === row.id ? styles.current : ""}`} style={{ "--dialogue-speaker": appearance.color } as CSSProperties} data-playing={currentId === row.id} onClick={event => { if (event.target === event.currentTarget) seek(); }}>
      <div className={styles.dialogueHeading}>
        <button className={styles.speakerBadge} style={{ color: appearance.color, borderColor: appearance.color }} aria-label={`${time(row.start)} 화자 변경: ${label(row.speaker)}`} aria-expanded={editingSpeaker === row.id} disabled={busy} onClick={() => setEditingSpeaker(editingSpeaker === row.id ? null : row.id)}>{appearance.badge}<span>{label(row.speaker)}</span><span aria-hidden="true">⌄</span></button>
        <button data-editor-seek className={styles.timestamp} onClick={seek} aria-label={`${time(row.start)} 대사 재생 위치로 이동`}><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 4.5V8l2.3 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg><time>{cueTime(row.start)}</time><span aria-hidden="true">–</span><time>{cueTime(row.end)}</time></button>
        <span className={styles.rowActions}><button className={styles.rowAction} disabled={busy} aria-label={`${time(row.start)} 자막 수정`} onClick={() => setEditingRow(row.id)}>수정</button><button className={styles.rowAction} disabled={busy} onClick={() => change(row, { keep: !row.keep })}>{row.keep ? "제외" : "복원"}</button></span>
      </div>
      {editingSpeaker === row.id ? <div className={styles.speakerMenu} role="group" aria-label="화자 지정" onKeyDown={e => { if (e.key === "Escape") setEditingSpeaker(null); }}>
        {[...new Set([...keys, "unknown", "overlap"])].map(key => <button key={key} disabled={busy} aria-pressed={row.speaker === key} onClick={() => { change(row, { speaker: key }); setEditingSpeaker(null); }}><span style={{ color: speakerAppearance(key, keys).color }}>{speakerAppearance(key, keys).badge}</span>{label(key)}{row.speaker === key ? " ✓" : ""}</button>)}
        <button disabled={busy || keys.length >= 64} onClick={() => { const key = `user_${crypto.randomUUID()}`; onChange({ ...draft, names: { ...draft.names, [key]: `새 화자 ${keys.filter(k => k.startsWith("user_")).length + 1}` }, framing: { ...draft.framing, [key]: "wide" }, rows: draft.rows.map(item => item.id === row.id ? { ...item, speaker: key } : item) }); setEditingSpeaker(null); }}>＋ 새 화자 만들어 지정</button>
        <button onClick={() => setEditingSpeaker(null)}>닫기</button>
      </div> : null}
      {editingRow === row.id ? <textarea autoFocus rows={studio ? Math.min(4, Math.max(1, Math.ceil([...row.text].length / 35))) : undefined} aria-label={`${time(row.start)} 자막`} value={row.text} maxLength={2000} disabled={busy} placeholder="대본이 없는 구간 · 자막 입력" onBlur={() => setEditingRow(null)} onKeyDown={event => { if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) { event.preventDefault(); finishEditing(row.id); } }} onChange={e => change(row, { text: e.target.value })} /> : <button ref={element => { if (element) dialogueButtons.current.set(row.id, element); else dialogueButtons.current.delete(row.id); }} type="button" data-editor-seek className={styles.dialogueText} aria-label={`${time(row.start)} 대사 재생: ${row.text || "대본이 없는 구간"}`} title="클릭하여 재생 위치로 이동 · 두 번 클릭하여 자막 수정" onClick={seek} onDoubleClick={() => { if (!busy) setEditingRow(row.id); }}>{row.text || <span className={styles.emptyDialogue}>대본이 없는 구간</span>}</button>}
    </div>;
  };
  return <section className={`${styles.transcript}${studio ? ` ${styles.studioTranscript}` : ""}`} aria-label="대본 편집">
    {!studio ? <div className={styles.previewHeading}><h2>대사 편집 <span>{draft.rows.filter(row => row.keep).length} / {draft.rows.length}개 포함</span></h2></div> : null}
    <div className={styles.searchBar}><input className={styles.input} aria-label="대본 검색" placeholder="대사를 검색하세요" value={query} onChange={e => setQuery(e.target.value)} /><button className={styles.replaceToggle} aria-expanded={showReplace} onClick={() => setShowReplace(!showReplace)}>찾아 바꾸기</button></div>
    <div className={styles.transcriptTools}><div className={styles.speakerFilter}><EditorSelect label="화자 필터" value={speakerFilter} onChange={setSpeakerFilter} options={[{ value: "", label: "모든 화자" }, ...keys.map(key => ({ value: key, label: label(key) }))]} /></div><label><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> 자동 스크롤</label><button className={styles.textButton} onClick={returnToCurrent}>재생 위치로</button></div>
    {showReplace ? <div className={styles.replace}><input className={styles.input} aria-label="찾을 말" placeholder="찾을 말" value={find} onChange={e => setFind(e.target.value)} /><input className={styles.input} aria-label="바꿀 말" placeholder="바꿀 말" value={replacement} onChange={e => setReplacement(e.target.value)} /><button disabled={!find || busy} onClick={() => onChange({ ...draft, rows: draft.rows.map(row => ({ ...row, text: row.text.split(find).join(replacement).slice(0, 2000) })) })}>전체 교정</button></div> : null}
    <div className={styles.rows} ref={container}>{groups.map(group => {
      if (!group.excluded) return rowView(group.rows[0]);
      const open = expanded.has(group.id) || Boolean(query || speakerFilter);
      const playing = group.rows.some(row => row.id === currentId);
      return <div key={`excluded-${group.id}`} className={styles.excludedGroup} data-playing={playing}>
        <div className={styles.excludedHeading}><button aria-expanded={open} onClick={() => setExpanded(old => { const next = new Set(old); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{open ? "⌄" : "›"} 제외한 대사 {group.rows.length}개 <span>{time(group.rows[0].start)}–{time(group.rows.at(-1)!.end)}</span></button><button disabled={busy} onClick={() => { const ids = new Set(group.rows.map(row => row.id)); onChange({ ...draft, rows: draft.rows.map(row => ids.has(row.id) ? { ...row, keep: true } : row) }); }}>모두 복원</button></div>
        {open ? group.rows.filter(matches).map(rowView) : <p>{group.rows.map(row => row.text || "(대사 없음)").join(" ")}</p>}
      </div>;
    })}{!groups.length ? <p className={styles.notice}>조건에 맞는 대사가 없습니다.</p> : null}</div>
    <p className={styles.notice}>화자 배지를 눌러 수정하세요. 제외한 대사는 펼쳐서 확인하고 복원할 수 있어요.</p>
  </section>;
});
