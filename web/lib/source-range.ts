export const MIN_SELECTED_SOURCE_SECONDS = 4 * 60;
export const MAX_SELECTED_SOURCE_SECONDS = 60 * 60;

export type SelectedSourceRange = {
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

function roundMilliseconds(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

export function parseSourceTimestampInput(value: string) {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => part.trim() === "")) {
    return null;
  }
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length >= 2 && numbers.at(-1)! >= 60) return null;
  if (parts.length === 3 && numbers[1] >= 60) return null;
  const seconds = parts.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : parts.length === 2
      ? numbers[0] * 60 + numbers[1]
      : numbers[0];
  return roundMilliseconds(seconds);
}

export function selectedSourceRange(
  sourceDurationSeconds: number,
  startSeconds: number,
  endSeconds: number,
): SelectedSourceRange {
  const sourceDuration = roundMilliseconds(sourceDurationSeconds);
  const start = roundMilliseconds(startSeconds);
  const end = roundMilliseconds(endSeconds);
  if (
    !Number.isFinite(sourceDuration)
    || !Number.isFinite(start)
    || !Number.isFinite(end)
    || sourceDuration <= 0
    || start < 0
    || end <= start
    || end > sourceDuration
  ) {
    throw new Error("선택 구간은 원본 영상 안에 있어야 합니다.");
  }
  const duration = roundMilliseconds(end - start);
  if (duration < MIN_SELECTED_SOURCE_SECONDS) {
    throw new Error("영상 구간은 최소 4분 이상 선택해 주세요.");
  }
  if (duration > MAX_SELECTED_SOURCE_SECONDS) {
    throw new Error("한 작업에서 영상 구간은 최대 60분까지 선택할 수 있습니다.");
  }
  return { startSeconds: start, endSeconds: end, durationSeconds: duration };
}

export function billableSelectedSourceSeconds(durationSeconds: number) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("차감할 원본 영상 길이가 올바르지 않습니다.");
  }
  const wholeSeconds = Math.floor(durationSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainderSeconds = wholeSeconds % 60;
  const billableMinutes = minutes + (remainderSeconds > 30 ? 1 : 0);
  return Math.max(60, billableMinutes * 60);
}
