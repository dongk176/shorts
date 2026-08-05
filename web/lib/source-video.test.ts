import { describe, expect, it } from "vitest";
import {
  assertSupportedSourceVideoDuration,
  MAX_SOURCE_RANGE_VIDEO_SECONDS,
  MAX_SOURCE_VIDEO_SECONDS,
  shouldShowLongSourceNotice,
} from "./source-video";

describe("source video duration policy", () => {
  it("keeps the stable path capped at sixty minutes", () => {
    expect(() => assertSupportedSourceVideoDuration(MAX_SOURCE_VIDEO_SECONDS)).not.toThrow();
    expect(() => assertSupportedSourceVideoDuration(MAX_SOURCE_VIDEO_SECONDS + 1)).toThrow(
      "최대 60분",
    );
  });

  it("allows only the guarded range path up to four hours", () => {
    expect(() => assertSupportedSourceVideoDuration(MAX_SOURCE_VIDEO_SECONDS + 1, {
      sourceRangeSelectionEnabled: true,
    })).not.toThrow();
    expect(() => assertSupportedSourceVideoDuration(MAX_SOURCE_RANGE_VIDEO_SECONDS, {
      sourceRangeSelectionEnabled: true,
    })).not.toThrow();
    expect(() => assertSupportedSourceVideoDuration(MAX_SOURCE_RANGE_VIDEO_SECONDS + 1, {
      sourceRangeSelectionEnabled: true,
    })).toThrow("최대 4시간");
  });

  it("shows the long-source notice only inside the allowed range release", () => {
    expect(shouldShowLongSourceNotice(3601, true, true)).toBe(true);
    expect(shouldShowLongSourceNotice(3600, true, true)).toBe(false);
    expect(shouldShowLongSourceNotice(3601, false, true)).toBe(false);
    expect(shouldShowLongSourceNotice(3601, true, false)).toBe(false);
  });
});
