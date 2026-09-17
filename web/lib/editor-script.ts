import type { CaptionRenderSpec } from "./caption-render-spec";
import { editorCaptionCueText } from "./editor-caption-preview";
import type { EditorVideoClip } from "./editor-video-cuts";
import type { EditorSubtitleForSave } from "./editor-subtitle-save";

/** Resolve the current script from the same edited caption preview used on screen. */
export function editorScriptForComments(
  segments: EditorSubtitleForSave[],
  clips: EditorVideoClip[],
  editedCaptions?: CaptionRenderSpec | null,
): EditorSubtitleForSave[] {
  let cursor = 0;
  const retimed = clips.flatMap((clip) => {
    const outputStart = cursor;
    cursor += clip.sourceEndSeconds - clip.sourceStartSeconds;
    return segments.flatMap((segment) => {
      const start = Math.max(segment.start, clip.sourceStartSeconds);
      const end = Math.min(segment.end, clip.sourceEndSeconds);
      return end > start ? [{
        start: outputStart + start - clip.sourceStartSeconds,
        end: outputStart + end - clip.sourceStartSeconds,
        text: segment.text,
      }] : [];
    });
  });
  if (!editedCaptions) return retimed;
  const edited = editedCaptions.cues.map((cue) => ({
    start: cue.startFrame / editedCaptions.fps,
    end: cue.endFrame / editedCaptions.fps,
    text: editorCaptionCueText(cue),
  }));
  // A failed margin caption layout must not discard its valid script.
  const uncovered = retimed.filter((segment) => !edited.some((caption) => (
    segment.start < caption.end && segment.end > caption.start
  )));
  return [...edited, ...uncovered].sort((a, b) => a.start - b.start);
}
