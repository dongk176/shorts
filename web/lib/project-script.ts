import type { EditorDocumentSnapshot } from "./editor-document-snapshot";
import type { EditorSubtitleForSave } from "./editor-subtitle-save";

/** Read source sentences in playback order, without repeating a sentence split by cuts. */
export function projectScriptText(
  renderedSegments: EditorSubtitleForSave[],
  document?: EditorDocumentSnapshot | null,
): string {
  if (!document?.video.clips.length) {
    return renderedSegments.map((segment) => segment.text).join(" ");
  }
  const texts: string[] = [];
  let previousIndex: number | null = null;
  let previousEnd = -Infinity;
  for (const clip of document.video.clips) {
    // Replaying a source range is an intentional repetition, not a silence cut.
    if (clip.sourceStartSeconds < previousEnd - 0.001) previousIndex = null;
    document.subtitles.segments.forEach((segment, index) => {
      if (segment.end <= clip.sourceStartSeconds || segment.start >= clip.sourceEndSeconds) return;
      if (index !== previousIndex) texts.push(segment.text);
      previousIndex = index;
    });
    previousEnd = clip.sourceEndSeconds;
  }
  return texts.join(" ");
}
