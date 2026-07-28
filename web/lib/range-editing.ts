export const RANGE_EDIT_MIN_SECONDS = 1;
export const RANGE_EDIT_HANDLE_SECONDS = 30;
export const COMMENT_RANGE_MIN_SECONDS = 0.3;

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

export type TimedRangeAdjustment = "move" | "start" | "end";

export function adjustTimedRange(
  value: { startSeconds: number; endSeconds: number },
  adjustment: TimedRangeAdjustment,
  deltaSeconds: number,
  durationSeconds: number,
  previousEndSeconds = 0,
  nextStartSeconds = durationSeconds,
  minimumDurationSeconds = COMMENT_RANGE_MIN_SECONDS,
) {
  const duration = Math.max(minimumDurationSeconds, durationSeconds);
  const previousEnd = Math.max(0, Math.min(duration, previousEndSeconds));
  const nextStart = Math.max(previousEnd, Math.min(duration, nextStartSeconds));
  const initialStart = Math.max(previousEnd, Math.min(nextStart, value.startSeconds));
  const initialEnd = Math.max(initialStart, Math.min(nextStart, value.endSeconds));
  const round = (seconds: number) => Math.round(seconds * 10) / 10;
  const clampRounded = (seconds: number, minimum: number, maximum: number) => (
    Math.max(minimum, Math.min(maximum, round(seconds)))
  );

  if (adjustment === "start") {
    const maximumStart = Math.max(previousEnd, initialEnd - minimumDurationSeconds);
    return {
      startSeconds: clampRounded(initialStart + deltaSeconds, previousEnd, maximumStart),
      endSeconds: initialEnd,
    };
  }

  if (adjustment === "end") {
    const minimumEnd = Math.min(nextStart, initialStart + minimumDurationSeconds);
    return {
      startSeconds: initialStart,
      endSeconds: clampRounded(initialEnd + deltaSeconds, minimumEnd, nextStart),
    };
  }

  const rangeDuration = initialEnd - initialStart;
  const maximumStart = Math.max(previousEnd, nextStart - rangeDuration);
  const startSeconds = clampRounded(
    initialStart + deltaSeconds,
    previousEnd,
    maximumStart,
  );
  return {
    startSeconds,
    endSeconds: Math.min(nextStart, startSeconds + rangeDuration),
  };
}
