"use client";
import { useUiText } from "@/lib/i18n/use-ui-text";

import { useMemo, useState } from "react";
import type { CaptionRenderSpec } from "@/lib/caption-render-spec";
import {
  type EditorCaptionTextDraft,
} from "@/lib/editor-caption-preview";
import { captionSearchRows, findCaptionMatches, planCaptionReplacement, type CaptionMatch, type CaptionReplaceRequest } from "@/lib/editor-caption-find-replace";
import type { EditorSubtitleCueEdit } from "@/lib/editor-render-spec";

function timestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

/** A view onto existing cue edits, rather than a second editable transcript. */
export function EditorSubtitleContent({ sourceSpec, previewSpec, cueEdits, draft, enabled, onSelect, onChange, onCommit, onCancel, searchBlocked, onSeek, onReplace }: {
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
}) {
  const ui = useUiText();
  const rows = useMemo(() => captionSearchRows(sourceSpec, previewSpec, cueEdits), [sourceSpec, previewSpec, cueEdits]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [selected, setSelected] = useState<CaptionMatch | null>(null);
  const [replacedCount, setReplacedCount] = useState<{ count: number; signature: string } | null>(null);
  const matches = useMemo(() => findCaptionMatches(rows, searchOpen ? query : "", matchCase), [rows, searchOpen, query, matchCase]);
  const selectedIndex = Math.max(0, matches.findIndex(match => match.cueIndex === selected?.cueIndex && match.start === selected.start));
  const active = matches[selectedIndex];
  const activeRow = rows.find(row => row.id === active?.cueIndex);
  const request = { query, replacement, matchCase };
  const allPlan = planCaptionReplacement(rows, cueEdits, request);
  const onePlan = active ? planCaptionReplacement(rows, cueEdits, { ...request, target: active }) : null;
  const visit = (match: CaptionMatch | undefined) => {
    if (!match || searchBlocked) return;
    setSelected(match);
    const row = rows.find(row => row.id === match.cueIndex);
    if (row) onSeek(row.seconds);
  };
  const replace = (all: boolean) => {
    if (searchBlocked || !active) return;
    const count = onReplace({ ...request, ...(all ? {} : { target: active }) });
    if (!count) return;
    setReplacedCount({ count, signature: JSON.stringify((all ? allPlan : onePlan)!.edits) });
    if (!all && onePlan) {
      const edits = new Map(onePlan.edits.map(edit => [edit.cueIndex, edit.text]));
      const remaining = findCaptionMatches(rows.map(row => ({ ...row, text: edits.get(row.id) ?? row.originalText })), query, matchCase);
      const rowIndex = rows.findIndex(row => row.id === active.cueIndex);
      const next = remaining.find(match => {
        const index = rows.findIndex(row => row.id === match.cueIndex);
        return index > rowIndex || (index === rowIndex && match.start >= active.start + replacement.length);
      }) || remaining[0];
      visit(next);
    }
  };
  const highlightedText = (id: number, text: string) => {
    const found = matches.filter(match => match.cueIndex === id);
    let cursor = 0;
    const parts = found.flatMap(match => {
      const prefix = text.slice(cursor, match.start);
      cursor = match.end;
      return [prefix, <mark key={match.start} className={active === match ? "is-current" : undefined}>{text.slice(match.start, match.end)}</mark>];
    });
    return [...parts, text.slice(cursor)];
  };
  const invalidDraft = Boolean(draft && !draft.text.trim());
  return <div className="editor-studio-subtitle-content">
    <button type="button" className="editor-caption-search-toggle" aria-expanded={searchOpen} aria-controls="editor-caption-search" onClick={() => { setSearchOpen(!searchOpen); setReplacedCount(null); }}>{ui("자막 찾기·바꾸기")}</button>
    {searchOpen && <section id="editor-caption-search" className="editor-caption-search" aria-label={ui("자막 찾기·바꾸기")}>
      <p className="editor-studio-help">{ui("현재 쇼츠의 자막만 검색합니다.")}</p>
      <label>{ui("찾을 말")}<input type="text" value={query} maxLength={200} placeholder={ui("찾을 단어 입력")} onChange={event => { setQuery(event.target.value); setSelected(null); setReplacedCount(null); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.key !== "Enter") return;
        event.preventDefault(); visit(matches[(selectedIndex + (event.shiftKey ? matches.length - 1 : 1)) % matches.length]);
      }} /></label>
      <div className="editor-caption-search-navigation">
        <span role="status" aria-live="polite">{matches.length ? `${selectedIndex + 1} / ${matches.length}` : ui(query.trim() ? "일치하는 자막이 없습니다." : "찾을 단어를 입력해 주세요.")}</span>
        <button type="button" aria-label={ui("이전 검색 결과")} disabled={!matches.length || searchBlocked} onClick={() => visit(matches[(selectedIndex + matches.length - 1) % matches.length])}>↑</button>
        <button type="button" aria-label={ui("다음 검색 결과")} disabled={!matches.length || searchBlocked} onClick={() => visit(matches[(selectedIndex + 1) % matches.length])}>↓</button>
      </div>
      {activeRow && <p className="editor-caption-search-preview"><time>{timestamp(activeRow.seconds)}</time> {highlightedText(activeRow.id, activeRow.text)}</p>}
      <label className="editor-caption-search-case"><input type="checkbox" checked={matchCase} onChange={event => { setMatchCase(event.target.checked); setSelected(null); setReplacedCount(null); }} />{ui("대소문자 구분")}</label>
      <label>{ui("바꿀 말")}<input type="text" value={replacement} maxLength={200} onChange={event => { setReplacement(event.target.value); setReplacedCount(null); }} /></label>
      <div className="editor-caption-search-actions">
        <button type="button" disabled={searchBlocked || !onePlan?.count || Boolean(onePlan.error)} onClick={() => replace(false)}>{ui("하나 바꾸기")}</button>
        <button type="button" disabled={searchBlocked || !allPlan.count || Boolean(allPlan.error)} onClick={() => replace(true)}>{ui("모두 바꾸기")}{allPlan.count > 0 ? ` (${allPlan.count})` : ""}</button>
      </div>
      {searchBlocked && <p className="editor-studio-help">{ui("수정 중인 자막을 완료하거나 취소한 뒤 바꿔 주세요.")}</p>}
      {allPlan.error && <p role="alert" className="editor-studio-field-error">{ui(allPlan.error === "empty" ? "자막 전체를 빈 내용으로 바꿀 수 없습니다." : "바꾼 자막이 200자를 넘습니다. 더 짧게 입력해 주세요.")}</p>}
      {replacedCount !== null && replacedCount.signature === JSON.stringify(cueEdits) && <p role="status" className="editor-studio-help">{ui("바꾼 항목")}: {replacedCount.count} · {ui("상단 되돌리기로 취소할 수 있습니다.")}</p>}
    </section>}
    <div className="editor-studio-subtitle-summary"><span>{ui("자막")} {rows.length}</span><span>{ui("선택하여 수정")}</span></div>
    {!enabled && <p className="editor-studio-help">{ui("영상에서 자막이 숨겨져 있습니다. 문구는 그대로 편집할 수 있어요.")}</p>}
    <div className="editor-studio-cue-list">
      {rows.map((row, index) => <div key={row.id} className={`editor-studio-cue${draft?.sourceCueIndex === row.id ? " is-editing" : ""}`}>
        <div className="editor-studio-cue-meta"><span>{String(index + 1).padStart(2, "0")}</span><time>{timestamp(row.seconds)}</time></div>
        {draft?.sourceCueIndex === row.id ? <>
          <textarea autoFocus aria-label={`${ui("자막")} ${index + 1}`} value={draft.text} maxLength={200} rows={3}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); onCancel(); }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !invalidDraft) { event.preventDefault(); onCommit(); }
            }} />
          {invalidDraft && <p role="alert" className="editor-studio-field-error">{ui("자막 내용을 입력해 주세요.")}</p>}
          <div className="editor-studio-cue-actions"><button type="button" onClick={onCancel}>{ui("취소")}</button><button type="button" disabled={invalidDraft} onClick={onCommit}>{ui("완료")}</button></div>
        </> : <button type="button" className="editor-studio-cue-text" disabled={invalidDraft} onClick={() => onSelect(row.id, row.seconds)}>{highlightedText(row.id, row.text)}</button>}
      </div>)}
    </div>
    {rows.length === 0 && <p className="editor-studio-help">{ui("현재 영상 구간에 표시할 자막이 없습니다.")}</p>}
  </div>;
}
