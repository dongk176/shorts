export const RANGE_EDIT_MIN_SECONDS = 1;
export const RANGE_EDIT_HANDLE_SECONDS = 30;

export function rangeEditingEnabled() {
  return process.env.RANGE_EDITING_ENABLED?.trim().toLowerCase() === "true";
}

export type TimelineSubtitle = { start: number; end: number; text: string };

export function subtitlesForTimelineSelection(
  timelineSegments: TimelineSubtitle[],
  timelineStartSeconds: number,
  selectionStartSeconds: number,
  selectionEndSeconds: number,
) {
  const relativeStart = selectionStartSeconds - timelineStartSeconds;
  const relativeEnd = selectionEndSeconds - timelineStartSeconds;
  return timelineSegments.flatMap((segment) => {
    const start = Math.max(segment.start, relativeStart);
    const end = Math.min(segment.end, relativeEnd);
    const sourceDuration = segment.end - segment.start;
    const overlap = end - start;
    if (overlap <= 0 || (sourceDuration > 0 && overlap / sourceDuration < 0.5)) return [];
    return [{
      start: Math.round((start - relativeStart) * 1_000) / 1_000,
      end: Math.round((end - relativeStart) * 1_000) / 1_000,
      text: segment.text,
    }];
  });
}

export function scaleTimedRanges<T extends { startSeconds: number; endSeconds: number }>(
  values: T[],
  fromDurationSeconds: number,
  toDurationSeconds: number,
) {
  if (!Number.isFinite(fromDurationSeconds) || fromDurationSeconds <= 0) return values;
  const ratio = toDurationSeconds / fromDurationSeconds;
  return values.map((value) => ({
    ...value,
    startSeconds: Math.round(value.startSeconds * ratio * 1_000) / 1_000,
    endSeconds: Math.round(value.endSeconds * ratio * 1_000) / 1_000,
  }));
}
