import type { CaptionRenderSpec } from "./caption-render-spec";
import { editorCaptionCueSourceIndex, editorCaptionCueText, updateEditorCaptionCueEdits } from "./editor-caption-preview";
import type { EditorSubtitleCueEdit } from "./editor-render-spec";

export type CaptionSearchRow = { id: number; text: string; originalText: string; seconds: number };
export type CaptionMatch = { cueIndex: number; start: number; end: number };
export type CaptionReplaceRequest = {
  query: string;
  replacement: string;
  matchCase: boolean;
  target?: CaptionMatch;
};

/** Only unique, editable source cues present in the current cut are searchable. */
export function captionSearchRows(source: CaptionRenderSpec, preview: CaptionRenderSpec | null, edits: EditorSubtitleCueEdit[]): CaptionSearchRow[] {
  const originals = new Map<number, string | null>();
  source.cues.forEach((cue, index) => {
    const id = editorCaptionCueSourceIndex(cue, index);
    originals.set(id, originals.has(id) ? null : editorCaptionCueText(cue));
  });
  const current = new Map(edits.map(edit => [edit.cueIndex, edit.text]));
  const seen = new Set<number>();
  return (preview?.cues || []).flatMap((cue, index) => {
    const id = editorCaptionCueSourceIndex(cue, index);
    const originalText = originals.get(id);
    if (seen.has(id) || originalText == null || id < 0 || id >= 2000) return [];
    seen.add(id);
    return [{ id, originalText, text: current.get(id) ?? originalText, seconds: cue.startFrame / (preview?.fps || source.fps) }];
  });
}

export function findCaptionMatches(rows: CaptionSearchRow[], query: string, matchCase = false): CaptionMatch[] {
  if (!query.trim()) return [];
  // Search is literal: punctuation, brackets and dollar signs are not patterns.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
  return rows.flatMap(row => Array.from(row.text.matchAll(pattern), match => ({
    cueIndex: row.id, start: match.index, end: match.index + match[0].length,
  })));
}

export function planCaptionReplacement(rows: CaptionSearchRow[], edits: EditorSubtitleCueEdit[], request: CaptionReplaceRequest): {
  edits: EditorSubtitleCueEdit[]; count: number; error: "empty" | "too-long" | null;
} {
  const matches = findCaptionMatches(rows, request.query, request.matchCase).filter(match => !request.target || (
    match.cueIndex === request.target.cueIndex && match.start === request.target.start && match.end === request.target.end
  ));
  const byCue = new Map<number, CaptionMatch[]>();
  for (const match of matches) byCue.set(match.cueIndex, [...(byCue.get(match.cueIndex) || []), match]);
  let next = edits;
  let count = 0;
  for (const row of rows) {
    const rowMatches = byCue.get(row.id);
    if (!rowMatches) continue;
    let text = row.text;
    for (const match of [...rowMatches].reverse()) {
      text = text.slice(0, match.start) + request.replacement + text.slice(match.end);
    }
    text = text.trim();
    // Reject the whole operation rather than silently dropping invalid cues.
    if (!text) return { edits, count: 0, error: "empty" };
    if (text.length > 200) return { edits, count: 0, error: "too-long" };
    if (text === row.text) continue;
    next = updateEditorCaptionCueEdits(next, row.id, row.originalText, text);
    count += rowMatches.length;
  }
  return { edits: next, count, error: null };
}
