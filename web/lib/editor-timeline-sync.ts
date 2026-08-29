import {
  cloneEditorDocumentSnapshot,
  type EditorDocumentSnapshot,
} from "@/lib/editor-document-snapshot";
import { RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS } from "@/lib/range-editing";

export type EditorTimelineIdentity = {
  timelineStartSeconds: number;
  timelineEndSeconds: number;
  version: number;
};

function sameTimelineSecond(left: number, right: number) {
  return Math.abs(left - right) <= RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS;
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
    synchronized.video.timelineStartSeconds = timeline.timelineStartSeconds;
    synchronized.video.timelineEndSeconds = timeline.timelineEndSeconds;
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
