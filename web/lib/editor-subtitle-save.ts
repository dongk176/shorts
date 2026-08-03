export type EditorSubtitleForSave = {
  start: number;
  end: number;
  text: string;
};

/**
 * Treat an empty subtitle edit as removing that subtitle cue. The renderer
 * contract intentionally rejects empty cue text, so normalize it before the
 * shared document validation and before the request leaves the browser.
 */
export function editorSubtitlesForSave<T extends EditorSubtitleForSave>(
  segments: T[],
): T[] {
  return segments.flatMap((segment) => {
    const text = segment.text.trim();
    return text ? [{ ...segment, text }] : [];
  });
}
