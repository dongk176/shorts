import { HttpError } from "@/lib/http";
import { MIN_SELECTED_SOURCE_SECONDS } from "@/lib/source-range";

export const MIN_SOURCE_VIDEO_SECONDS = 3 * 60;
export const MAX_SOURCE_VIDEO_SECONDS = 60 * 60;
export const SOURCE_VIDEO_TOO_SHORT_MESSAGE =
  "롱폼 영상만 사용할 수 있어요. 쇼츠를 만들려면 3분 이상의 영상을 입력해 주세요.";

export function assertSupportedSourceVideoDuration(
  durationSeconds: number,
  options: { sourceRangeSelectionEnabled?: boolean } = {},
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("영상 길이를 확인하지 못했습니다.");
  }
  if (durationSeconds < MIN_SOURCE_VIDEO_SECONDS) {
    throw new HttpError(400, SOURCE_VIDEO_TOO_SHORT_MESSAGE, "SOURCE_VIDEO_TOO_SHORT");
  }
  if (!options.sourceRangeSelectionEnabled && durationSeconds > MAX_SOURCE_VIDEO_SECONDS) {
    throw new Error("최대 60분 길이의 영상까지만 만들 수 있습니다.");
  }
}

export function sourceRangeSelectionForDuration(
  durationSeconds: number,
  releaseEnabled: boolean,
) {
  assertSupportedSourceVideoDuration(durationSeconds, {
    sourceRangeSelectionEnabled: releaseEnabled,
  });
  return releaseEnabled && durationSeconds >= MIN_SELECTED_SOURCE_SECONDS;
}
