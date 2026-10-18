"use client";
import { useUiText } from "@/lib/i18n/use-ui-text";

import { useMemo } from "react";
import type { CaptionRenderSpec } from "@/lib/caption-render-spec";
import {
  editorCaptionCueSourceIndex,
  editorCaptionCueText,
  type EditorCaptionTextDraft,
} from "@/lib/editor-caption-preview";
import type { EditorSubtitleCueEdit } from "@/lib/editor-render-spec";

function timestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

/** A view onto existing cue edits, rather than a second editable transcript. */
export function EditorSubtitleContent({ sourceSpec, previewSpec, cueEdits, draft, enabled, onSelect, onChange, onCommit, onCancel }: {
  sourceSpec: CaptionRenderSpec;
  previewSpec: CaptionRenderSpec | null;
  cueEdits: EditorSubtitleCueEdit[];
  draft: EditorCaptionTextDraft | null;
  enabled: boolean;
  onSelect: (sourceCueIndex: number, seconds: number) => void;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ui = useUiText();
  const rows = useMemo(() => {
    const sourceText = new Map<number, string | null>();
    sourceSpec.cues.forEach((cue, index) => {
      const id = editorCaptionCueSourceIndex(cue, index);
      sourceText.set(id, sourceText.has(id) ? null : editorCaptionCueText(cue));
    });
    const edits = new Map(cueEdits.map((edit) => [edit.cueIndex, edit.text]));
    const seen = new Set<number>();
    return (previewSpec?.cues || []).flatMap((cue, index) => {
      const id = editorCaptionCueSourceIndex(cue, index);
      if (seen.has(id)) return [];
      seen.add(id);
      const originalText = sourceText.get(id);
      return originalText == null ? [] : [{
        id,
        text: edits.get(id) || originalText,
        seconds: cue.startFrame / sourceSpec.fps,
      }];
    });
  }, [sourceSpec, previewSpec, cueEdits]);
  const invalidDraft = Boolean(draft && !draft.text.trim());
  return <div className="editor-studio-subtitle-content">
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
        </> : <button type="button" className="editor-studio-cue-text" disabled={invalidDraft} onClick={() => onSelect(row.id, row.seconds)}>{row.text}</button>}
      </div>)}
    </div>
    {rows.length === 0 && <p className="editor-studio-help">{ui("현재 영상 구간에 표시할 자막이 없습니다.")}</p>}
  </div>;
}
