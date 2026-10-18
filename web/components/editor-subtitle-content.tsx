"use client";

import { useMemo, useRef, useState } from "react";
import { useUiText } from "@/lib/i18n/use-ui-text";
import type { CaptionRenderSpec } from "@/lib/caption-render-spec";
import type { EditorCaptionTextDraft } from "@/lib/editor-caption-preview";
import { captionSearchRows, findCaptionMatches, planCaptionReplacement, type CaptionReplaceRequest } from "@/lib/editor-caption-find-replace";
import type { EditorSubtitleCueEdit } from "@/lib/editor-render-spec";

function timestamp(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** Uses the existing caption draft, save contract and editor history. */
export function EditorSubtitleContent({ sourceSpec, previewSpec, cueEdits, draft, enabled, onSelect, onChange, onCommit, onCancel, searchBlocked, onSeek, onReplace, canUndoReplacement, onUndoReplacement }: {
  sourceSpec: CaptionRenderSpec;
  previewSpec: CaptionRenderSpec | null;
  cueEdits: EditorSubtitleCueEdit[];
  draft: EditorCaptionTextDraft | null;
  enabled: boolean;
  onSelect: (sourceCueIndex: number, seconds: number) => void;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  searchBlocked: boolean;
  onSeek: (seconds: number) => void;
  onReplace: (request: CaptionReplaceRequest) => number;
  canUndoReplacement: boolean;
  onUndoReplacement: () => void;
}) {
  const ui = useUiText();
  const searchInput = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => captionSearchRows(sourceSpec, previewSpec, cueEdits), [sourceSpec, previewSpec, cueEdits]);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [replaced, setReplaced] = useState<{ count: number; signature: string } | null>(null);
  const matches = useMemo(() => findCaptionMatches(rows, query, matchCase), [rows, query, matchCase]);
  const matchesByCue = useMemo(() => {
    const grouped = new Map<number, typeof matches>();
    for (const match of matches) grouped.set(match.cueIndex, [...(grouped.get(match.cueIndex) || []), match]);
    return grouped;
  }, [matches]);
  // Keep a draft visible even when its new wording no longer matches the filter.
  const visibleRows = query.trim() ? rows.filter(row => matchesByCue.has(row.id) || row.id === draft?.sourceCueIndex) : rows;
  const request = { query, replacement, matchCase };
  const plan = planCaptionReplacement(rows, cueEdits, request);
  const invalidDraft = Boolean(draft && !draft.text.trim());
  const replaceAll = () => {
    if (searchBlocked || plan.error || !plan.count) return;
    const count = onReplace(request);
    if (count) setReplaced({ count, signature: JSON.stringify(plan.edits) });
  };
  const clearSearch = () => { setQuery(""); searchInput.current?.focus(); };
  const highlightedText = (id: number, text: string) => {
    let cursor = 0;
    const parts = (matchesByCue.get(id) || []).flatMap(match => {
      const prefix = text.slice(cursor, match.start);
      cursor = match.end;
      return [prefix, <mark key={match.start}>{text.slice(match.start, match.end)}</mark>];
    });
    return [...parts, text.slice(cursor)];
  };
  const replacementVisible = replaced && replaced.signature === JSON.stringify(cueEdits);

  return <div className="editor-studio-subtitle-content">
    <section className="editor-caption-search" aria-label={ui("자막 찾기·바꾸기")}>
      <div className="editor-caption-search-bar">
        <div className="editor-caption-search-field">
          <input ref={searchInput} type="text" aria-label={ui("자막 검색")} placeholder={ui("자막 검색…")} value={query} maxLength={200}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clearSearch(); }
            }} />
          {query && <button type="button" className="editor-caption-clear" aria-label={ui("검색 지우기")} onClick={clearSearch}>×</button>}
        </div>
        <button type="button" className="editor-caption-replace-toggle" aria-expanded={replaceOpen} aria-controls="editor-caption-replace" onClick={() => setReplaceOpen(!replaceOpen)}>{ui("바꾸기")}</button>
        <button type="button" className="editor-caption-options-toggle" aria-label={ui("검색 옵션")} aria-expanded={optionsOpen} aria-controls="editor-caption-options" onClick={() => setOptionsOpen(!optionsOpen)}>⋯</button>
      </div>
      {replaceOpen && <div id="editor-caption-replace" className="editor-caption-replace-row">
        <input type="text" aria-label={ui("바꿀 말")} placeholder={ui("바꿀 말")} value={replacement} maxLength={200} onChange={event => setReplacement(event.target.value)} />
        <button type="button" disabled={searchBlocked || !plan.count || Boolean(plan.error)} onClick={replaceAll}>{ui("모두 수정")}</button>
      </div>}
      {optionsOpen && <label id="editor-caption-options" className="editor-caption-search-case"><input type="checkbox" checked={matchCase} onChange={event => setMatchCase(event.target.checked)} />{ui("대소문자 구분")}</label>}
      {query.trim() && <div className="editor-caption-match-count" role="status">{ui("{count}곳 일치").replace("{count}", String(matches.length))}{matchCase && !optionsOpen ? ` · ${ui("대소문자 구분")}` : ""}</div>}
      {replaceOpen && searchBlocked && <p className="editor-studio-help">{ui("수정 중인 자막을 완료하거나 취소한 뒤 바꿔 주세요.")}</p>}
      {replaceOpen && plan.error && <p role="alert" className="editor-studio-field-error">{ui(plan.error === "empty" ? "자막 전체를 빈 내용으로 바꿀 수 없습니다." : "바꾼 자막이 200자를 넘습니다. 더 짧게 입력해 주세요.")}</p>}
      {replacementVisible && <div className="editor-caption-replaced" role="status"><span>{ui("{count}곳 수정됨").replace("{count}", String(replaced.count))}</span>{canUndoReplacement && !searchBlocked && <button type="button" onClick={() => { onUndoReplacement(); setReplaced(null); }}>{ui("되돌리기")}</button>}</div>}
    </section>
    {!enabled && <p className="editor-studio-help">{ui("영상에서 자막이 숨겨져 있습니다. 문구는 그대로 편집할 수 있어요.")}</p>}
    <div className="editor-studio-cue-list">
      {visibleRows.map(row => <div key={row.id} className={`editor-studio-cue${draft?.sourceCueIndex === row.id ? " is-editing" : ""}`}>
        <div className="editor-studio-cue-meta"><button type="button" aria-label={`${ui("해당 장면으로 이동")} ${timestamp(row.seconds)}`} disabled={searchBlocked} onClick={() => onSeek(row.seconds)}><time>{timestamp(row.seconds)}</time></button></div>
        {draft?.sourceCueIndex === row.id ? <>
          <textarea autoFocus aria-label={`${ui("자막")} ${rows.findIndex(value => value.id === row.id) + 1}`} value={draft.text} maxLength={200} rows={3}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); onCancel(); }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !invalidDraft) { event.preventDefault(); onCommit(); }
            }} />
          {invalidDraft && <p role="alert" className="editor-studio-field-error">{ui("자막 내용을 입력해 주세요.")}</p>}
          <div className="editor-studio-cue-actions"><button type="button" onClick={onCancel}>{ui("취소")}</button><button type="button" disabled={invalidDraft} onClick={onCommit}>{ui("완료")}</button></div>
        </> : <button type="button" className="editor-studio-cue-text" disabled={invalidDraft} onClick={() => onSelect(row.id, row.seconds)}>{highlightedText(row.id, row.text)}</button>}
      </div>)}
    </div>
    {visibleRows.length === 0 && <p className="editor-studio-help">{ui(query.trim() ? "일치하는 자막이 없습니다." : "현재 영상 구간에 표시할 자막이 없습니다.")}</p>}
  </div>;
}
