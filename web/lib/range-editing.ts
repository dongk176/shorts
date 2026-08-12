export const RANGE_EDIT_MIN_SECONDS = 1;
export const RANGE_EDIT_HANDLE_SECONDS = 30;
export const RANGE_EDIT_BOUNDARY_TOLERANCE_SECONDS = 0.051;
export const COMMENT_RANGE_MIN_SECONDS = 0.3;
export const TIMED_RANGE_SNAP_THRESHOLD_PX = 6;

export function rangeEditingEnabled() {
  return process.env.RANGE_EDITING_ENABLED?.trim().toLowerCase() === "true";
}

export type TimelineSubtitle = { start: number; end: number; text: string };

export function clampTimelineSeconds(value: number, minimum: number, maximum: number) {
  return Math.round(Math.max(minimum, Math.min(maximum, value)) * 1_000) / 1_000;
}

export function roundTimelineHandleSeconds(value: number, minimum: number, maximum: number) {
  return clampTimelineSeconds(Math.round(value * 10) / 10, minimum, maximum);
}

export function timelinePointerDeltaSeconds(
  distancePixels: number,
  trackWidthPixels: number,
  timelineDurationSeconds: number,
) {
  if (
    !Number.isFinite(distancePixels)
    || !Number.isFinite(trackWidthPixels)
    || trackWidthPixels <= 0
    || !Number.isFinite(timelineDurationSeconds)
  ) {
    return 0;
  }
  return distancePixels / trackWidthPixels * timelineDurationSeconds;
}

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

/**
 * Keep timed overlays inside a shortened output while preserving a valid
 * half-open frame window. Ranges that start after the new output are removed;
 * a partially retained range is extended backwards by at most one frame when
 * decimal seconds would otherwise round both edges onto the same frame.
 */
export function fitTimedRangesToDurationFrames<
  T extends { startSeconds: number; endSeconds: number },
>(
  values: T[],
  durationSeconds: number,
  framesPerSecond: number,
) {
  if (
    !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || !Number.isFinite(framesPerSecond)
    || framesPerSecond <= 0
  ) {
    return [];
  }
  const frameAt = (seconds: number) => Math.max(
    0,
    Math.round(seconds * framesPerSecond),
  );
  return values.flatMap((value) => {
    if (value.startSeconds >= durationSeconds) return [];
    const endSeconds = Math.min(durationSeconds, value.endSeconds);
    const endFrame = frameAt(endSeconds);
    if (endFrame <= 0) return [];
    let startSeconds = Math.max(0, Math.min(endSeconds, value.startSeconds));
    if (frameAt(startSeconds) >= endFrame) {
      startSeconds = (endFrame - 1) / framesPerSecond;
    }
    return [{
      ...value,
      startSeconds,
      endSeconds,
    }];
  });
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

export function snapTimedRangeHandle(
  range: { startSeconds: number; endSeconds: number },
  adjustment: TimedRangeAdjustment,
  snapPointsSeconds: number[],
  thresholdSeconds: number,
  previousEndSeconds = 0,
  nextStartSeconds = Number.POSITIVE_INFINITY,
  minimumDurationSeconds = COMMENT_RANGE_MIN_SECONDS,
) {
  if (
    adjustment === "move"
    || snapPointsSeconds.length === 0
    || !Number.isFinite(thresholdSeconds)
    || thresholdSeconds <= 0
  ) {
    return range;
  }
  const handleSeconds = adjustment === "start"
    ? range.startSeconds
    : range.endSeconds;
  const minimum = adjustment === "start"
    ? previousEndSeconds
    : range.startSeconds + minimumDurationSeconds;
  const maximum = adjustment === "start"
    ? range.endSeconds - minimumDurationSeconds
    : nextStartSeconds;
  const nearestPoint = snapPointsSeconds.reduce<number | null>(
    (nearest, point) => {
      if (
        !Number.isFinite(point)
        || point < minimum
        || point > maximum
        || Math.abs(point - handleSeconds) > thresholdSeconds
      ) {
        return nearest;
      }
      if (
        nearest === null
        || Math.abs(point - handleSeconds) < Math.abs(nearest - handleSeconds)
      ) {
        return point;
      }
      return nearest;
    },
    null,
  );
  if (nearestPoint === null) return range;
  const snappedSeconds = Math.round(nearestPoint * 1_000) / 1_000;
  return adjustment === "start"
    ? { ...range, startSeconds: snappedSeconds }
    : { ...range, endSeconds: snappedSeconds };
}
