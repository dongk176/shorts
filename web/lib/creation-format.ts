export type CreationFormat = "shorts" | "midform";

export const MIDFORM_MIN_SOURCE_SECONDS = 600;
export const MIDFORM_MAX_SOURCE_SECONDS = 3600;

export function midformSourceRangeError(sourceSeconds: number, startSeconds: number, endSeconds: number): string | null {
  if (![sourceSeconds, startSeconds, endSeconds].every(Number.isFinite)
    || startSeconds < 0 || endSeconds > sourceSeconds || endSeconds <= startSeconds) {
    return "사용할 영상의 시작과 끝 구간을 확인해 주세요.";
  }
  if (sourceSeconds > MIDFORM_MAX_SOURCE_SECONDS) return "미들폼은 현재 60분 이하의 원본 영상으로 만들 수 있어요.";
  const selectedSeconds = endSeconds - startSeconds;
  if (selectedSeconds < MIDFORM_MIN_SOURCE_SECONDS || selectedSeconds > MIDFORM_MAX_SOURCE_SECONDS) {
    return "미들폼으로 만들 원본 구간을 10분부터 60분까지 선택해 주세요.";
  }
  return null;
}

/** Keep source, range, rights and retry identity while selecting a pipeline. */
export function creationRequest(payload: Record<string, unknown>, format: CreationFormat): Record<string, unknown> {
  if (format === "shorts") return payload;
  const result = { ...payload };
  for (const key of ["snsTemplate", "communityTemplate", "customTemplateVersion", "subtitleTemplateId",
    "subtitleCaptionPlacement", "brandColor", "languageTest", "sourceLanguage", "silenceRemoval"]) delete result[key];
  return { ...result, templateId: "dark-minimal", customTemplateId: null,
    videoAspectRatio: "16:9", outputLanguage: "ko", midform: { version: 1, targetSeconds: 0 } };
}
