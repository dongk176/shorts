import {
  cloneEditorDocumentSnapshot,
  type EditorDocumentSnapshot,
} from "@/lib/editor-document-snapshot";
import { RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS } from "@/lib/range-editing";

// Container timestamps may differ by a few frames from the editor metadata.
// Keep this aligned with the worker's editor timeline tolerance.
export const EDITOR_TIMELINE_METADATA_TOLERANCE_SECONDS = 0.5;

export type EditorTimelineIdentity = {
  timelineStartSeconds: number;
  timelineEndSeconds: number;
  version: number;
  subtitleSegments?: { start: number; end: number; text: string }[];
};

function sameTimelineSecond(left: number, right: number) {
  return Math.abs(left - right) <= EDITOR_TIMELINE_METADATA_TOLERANCE_SECONDS;
}

function roundedTimelineSecond(value: number) {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function editorDocumentMatchesTimeline(
  document: EditorDocumentSnapshot,
  timeline: EditorTimelineIdentity,
) {
  return sameTimelineSecond(
    document.video.timelineStartSeconds,
    timeline.timelineStartSeconds,
  ) && sameTimelineSecond(
    document.video.timelineEndSeconds,
    timeline.timelineEndSeconds,
  );
}

export function synchronizeEditorDocumentTimeline(
  document: EditorDocumentSnapshot,
  timeline: EditorTimelineIdentity,
): EditorDocumentSnapshot {
  const synchronized = cloneEditorDocumentSnapshot(document, true);
  if (editorDocumentMatchesTimeline(synchronized, timeline)) {
    // Preserve the document clock, including clip/selection/subtitle timing.
    // Snapping just the bounds can make an otherwise valid edit inconsistent.
    return synchronized;
  }

  const previousStart = synchronized.video.timelineStartSeconds;
  const previousEnd = synchronized.video.timelineEndSeconds;
  const nextStart = timeline.timelineStartSeconds;
  const nextEnd = timeline.timelineEndSeconds;
  const expansionOnly = (
    nextStart <= previousStart + RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS
    && nextEnd >= previousEnd - RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS
  );
  if (!expansionOnly) {
    throw new Error("편집용 영상 범위가 변경되었습니다. 편집 화면을 다시 열어 주세요.");
  }

  const offsetSeconds = previousStart - nextStart;
  const nextDuration = nextEnd - nextStart;
  synchronized.video.timelineStartSeconds = nextStart;
  synchronized.video.timelineEndSeconds = nextEnd;
  synchronized.video.clips = synchronized.video.clips.map((clip) => ({
    ...clip,
    sourceStartSeconds: roundedTimelineSecond(
      clip.sourceStartSeconds + offsetSeconds,
    ),
    sourceEndSeconds: roundedTimelineSecond(
      clip.sourceEndSeconds + offsetSeconds,
    ),
  }));
  synchronized.subtitles.segments = synchronized.subtitles.segments.map(
    (segment) => ({
      ...segment,
      start: roundedTimelineSecond(segment.start + offsetSeconds),
      end: roundedTimelineSecond(segment.end + offsetSeconds),
    }),
  );
  // A first-output cut document initially references only the clean clip.
  // Add subtitles from newly retained handles without overwriting edited text
  // inside the old source range.
  if (timeline.subtitleSegments) {
    const oldStart = previousStart - nextStart;
    const oldEnd = previousEnd - nextStart;
    const added = timeline.subtitleSegments.flatMap((segment) => {
      const parts = [];
      if (segment.start < oldStart) {
        parts.push({ ...segment, start: Math.max(0, segment.start), end: Math.min(oldStart, segment.end) });
      }
      if (segment.end > oldEnd) {
        parts.push({ ...segment, start: Math.max(oldEnd, segment.start), end: Math.min(nextDuration, segment.end) });
      }
      return parts.filter(part => part.end > part.start);
    });
    synchronized.subtitles.segments = [...synchronized.subtitles.segments, ...added]
      .sort((a, b) => a.start - b.start);
  }
  if (synchronized.video.clips.some((clip) => (
    clip.sourceStartSeconds < -RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS
    || clip.sourceEndSeconds > nextDuration + RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS
  )) || synchronized.subtitles.segments.some((segment) => (
    segment.start < -RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS
    || segment.end > nextDuration + RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS
  ))) {
    throw new Error("편집용 영상 범위가 변경되었습니다. 편집 화면을 다시 열어 주세요.");
  }
  return synchronized;
}

/** Save exact bounds for projects pinned to older workers (51 ms tolerance).
 * Preserve absolute source time, clipping only bounded container metadata drift.
 */
export function canonicalizeEditorDocumentTimelineForSave(
  document: EditorDocumentSnapshot, timeline: EditorTimelineIdentity,
): EditorDocumentSnapshot {
  const next = synchronizeEditorDocumentTimeline(document, timeline);
  const offset = next.video.timelineStartSeconds - timeline.timelineStartSeconds;
  const duration = timeline.timelineEndSeconds - timeline.timelineStartSeconds;
  next.video.clips = next.video.clips.map((clip) => ({ ...clip,
    sourceStartSeconds: Math.max(0, roundedTimelineSecond(clip.sourceStartSeconds + offset)),
    sourceEndSeconds: Math.min(duration, roundedTimelineSecond(clip.sourceEndSeconds + offset)),
  }));
  if (next.video.clips.some((clip) => clip.sourceEndSeconds <= clip.sourceStartSeconds)) {
    throw new Error("편집용 영상 범위가 변경되었습니다. 영상 구간을 다시 확인해 주세요.");
  }
  next.subtitles.segments = next.subtitles.segments.flatMap((segment) => {
    const start = Math.max(0, roundedTimelineSecond(segment.start + offset));
    const end = Math.min(duration, roundedTimelineSecond(segment.end + offset));
    return end > start ? [{ ...segment, start, end }] : [];
  });
  next.video.timelineStartSeconds = timeline.timelineStartSeconds;
  next.video.timelineEndSeconds = timeline.timelineEndSeconds;
  next.video.selectionStartSeconds = timeline.timelineStartSeconds + next.video.clips[0].sourceStartSeconds;
  next.video.selectionEndSeconds = timeline.timelineStartSeconds + next.video.clips.at(-1)!.sourceEndSeconds;
  return next;
}
