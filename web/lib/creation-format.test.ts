import { describe, expect, it } from "vitest";
import { creationRequest, midformSourceRangeError } from "./creation-format";

describe("shared creation format", () => {
  it.each(["link", "upload"])("keeps the inspected %s source and exact range when choosing midform", (source) => {
    const input = { analysisId: "already-inspected", file: { name: "source.mp4", sizeBytes: 100 },
      requestId: "same-retry", rangeStartSeconds: 120, rangeEndSeconds: 900, rightsConfirmed: true,
      templateId: "white-yellow", snsTemplate: true, communityTemplate: true,
      customTemplateId: "previous-style", customTemplateVersion: 3, subtitleTemplateId: "bold",
      brandColor: "red", outputLanguage: "en", languageTest: true, sourceLanguage: "en", silenceRemoval: { version: 1, preset: "aggressive" }, source };
    const result = creationRequest(input, "midform");
    expect(result).toMatchObject({ analysisId: input.analysisId, file: input.file, requestId: input.requestId,
      rangeStartSeconds: 120, rangeEndSeconds: 900, rightsConfirmed: true, source,
      templateId: "dark-minimal", videoAspectRatio: "16:9", outputLanguage: "ko",
      customTemplateId: null, midform: { version: 1, targetSeconds: 0 } });
    for (const key of ["snsTemplate", "communityTemplate", "customTemplateVersion", "subtitleTemplateId", "brandColor", "languageTest", "sourceLanguage", "silenceRemoval"]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(input.customTemplateId).toBe("previous-style");
  });
  it("retains Shorts settings and never adds a midform request for the normal flow", () => {
    const input = { templateId: "white-yellow", outputLanguage: "ja", rangeStartSeconds: 60, rangeEndSeconds: 420, silenceRemoval: { version: 1, preset: "aggressive" } };
    expect(creationRequest(input, "shorts")).toEqual(input);
    expect(creationRequest(input, "shorts")).not.toHaveProperty("midform");
  });
  it.each([[1800, 120, 900], [3600, 600, 3600], [600, 0, 600]])("accepts the selected source range %j", (duration, start, end) => {
    expect(midformSourceRangeError(duration, start, end)).toBeNull();
  });
  it.each([[1800, 60, 659], [1800, -1, 900], [1800, 600, 1900], [7200, 0, 3600], [1800, 900, 900], [1800, Number.NaN, 900]])("rejects unsupported source selection %j", (duration, start, end) => {
    expect(midformSourceRangeError(duration, start, end)).not.toBeNull();
  });
});
