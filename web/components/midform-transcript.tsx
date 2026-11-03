"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MidformDraft, MidformRow } from "@/lib/midform-local";
import { speakerAppearance, speakerKeys, transcriptGroups } from "@/lib/midform-speakers";
import styles from "./midform-workspace.module.css";

const time = (n: number) => `${Math.floor(n / 60).toString().padStart(2, "0")}:${Math.floor(n % 60).toString().padStart(2, "0")}`;
type Props = { draft: MidformDraft; busy: boolean; currentId?: string; onChange: (draft: MidformDraft) => void; onSeek: (seconds: number) => void; onReview: (seconds: number) => void };
export const MidformTranscript = memo(function MidformTranscript({ draft, busy, currentId, onChange, onSeek, onReview }: Props) {
  const [query, setQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [follow, setFollow] = useState(true);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const container = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => speakerKeys(draft), [draft]);
  const matches = (row: MidformRow) => (!speakerFilter || row.speaker === speakerFilter) && row.text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const groups = transcriptGroups(draft.rows).filter(group => group.rows.some(matches));
  const label = (key: string) => draft.names[key] || (key === "unknown" ? "미지정" : key === "overlap" ? "겹친 음성" : `화자 ${speakerAppearance(key, keys).badge}`);
  const change = (row: MidformRow, value: Partial<MidformRow>) => onChange({ ...draft, rows: draft.rows.map(item => item.id === row.id ? { ...item, ...value } : item) });
  useEffect(() => {
    if (!follow || !currentId || editingSpeaker) return;
    const list = container.current;
    const active = list?.querySelector<HTMLElement>('[data-playing="true"]');
    if (!list || !active || list.contains(document.activeElement)) return;
    const itemRect = active.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
      list.scrollTo({ top: list.scrollTop + itemRect.top - listRect.top - list.clientHeight / 3, behavior: "smooth" });
    }
  }, [currentId, follow, editingSpeaker]);
  const rowView = (row: MidformRow) => {
    const appearance = speakerAppearance(row.speaker, keys);
    return <div key={row.id} className={`${styles.dialogueRow} ${currentId === row.id ? styles.current : ""}`} data-playing={currentId === row.id}>
      <div className={styles.dialogueHeading}>
        <button className={styles.speakerBadge} style={{ color: appearance.color, borderColor: appearance.color }} aria-label={`${time(row.start)} 화자 변경: ${label(row.speaker)}`} aria-expanded={editingSpeaker === row.id} disabled={busy} onClick={() => setEditingSpeaker(editingSpeaker === row.id ? null : row.id)}>{appearance.badge}<span>{label(row.speaker)}</span><span aria-hidden="true">⌄</span></button>
        <button className={styles.timestamp} onClick={() => row.keep ? onSeek(row.start) : onReview(row.start)} aria-label={`${time(row.start)} 대사 재생 위치로 이동`}>{time(row.start)} → {time(row.end)}</button>
        <button className={styles.rowAction} disabled={busy} onClick={() => change(row, { keep: !row.keep })}>{row.keep ? "제외" : "복원"}</button>
      </div>
      {editingSpeaker === row.id ? <div className={styles.speakerMenu} role="group" aria-label="화자 지정" onKeyDown={e => { if (e.key === "Escape") setEditingSpeaker(null); }}>
        {[...new Set([...keys, "unknown", "overlap"])].map(key => <button key={key} disabled={busy} aria-pressed={row.speaker === key} onClick={() => { change(row, { speaker: key }); setEditingSpeaker(null); }}><span style={{ color: speakerAppearance(key, keys).color }}>{speakerAppearance(key, keys).badge}</span>{label(key)}{row.speaker === key ? " ✓" : ""}</button>)}
        <button disabled={busy || keys.length >= 64} onClick={() => { const key = `user_${crypto.randomUUID()}`; onChange({ ...draft, names: { ...draft.names, [key]: `새 화자 ${keys.filter(k => k.startsWith("user_")).length + 1}` }, framing: { ...draft.framing, [key]: "wide" }, rows: draft.rows.map(item => item.id === row.id ? { ...item, speaker: key } : item) }); setEditingSpeaker(null); }}>＋ 새 화자 만들어 지정</button>
        <button onClick={() => setEditingSpeaker(null)}>닫기</button>
      </div> : null}
      <textarea aria-label={`${time(row.start)} 자막`} value={row.text} maxLength={2000} disabled={busy} placeholder="대본이 없는 구간 · 자막 입력" onChange={e => change(row, { text: e.target.value })} />
    </div>;
  };
  return <section className={styles.transcript} aria-label="대본 편집">
    <div className={styles.previewHeading}><h2>대사 편집 <span>{draft.rows.filter(row => row.keep).length} / {draft.rows.length}개 포함</span></h2><button className={styles.textButton} aria-expanded={showReplace} onClick={() => setShowReplace(!showReplace)}>찾아 바꾸기</button></div>
    <input className={styles.input} aria-label="대본 검색" placeholder="대사를 검색하세요" value={query} onChange={e => setQuery(e.target.value)} />
    <div className={styles.transcriptTools}><select className={styles.input} aria-label="화자 필터" value={speakerFilter} onChange={e => setSpeakerFilter(e.target.value)}><option value="">모든 화자</option>{keys.map(key => <option key={key} value={key}>{label(key)}</option>)}</select><label><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> 자동 스크롤</label><button className={styles.textButton} onClick={() => { setQuery(""); setSpeakerFilter(""); setFollow(true); const row = draft.rows.find(r => r.id === currentId); if (row) { const group = transcriptGroups(draft.rows).find(g => g.rows.some(r => r.id === row.id)); if (group?.excluded) setExpanded(old => new Set([...old, group.id])); onSeek(row.start); } requestAnimationFrame(() => container.current?.querySelector<HTMLElement>('[data-playing="true"]')?.scrollIntoView({ block: "nearest" })); }}>재생 위치로</button></div>
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
