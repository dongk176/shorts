import { describe, expect, it } from "vitest";
import { presetChannelCenterY } from "./preset-channel-position";
import { builtInSubtitlePresentation } from "./built-in-subtitle-presentation";
import { resolveBuiltInSubtitleTemplateSnapshot } from "./editor-built-in-subtitle-template";
import { resolveEditedTemplateSelection } from "./edit-template-selection";
import type { VideoAspectRatio } from "./contracts";

const cases = [
  ["16:9", 1400, 1464, 1368], ["5:4", 1520, 1752, 1508],
  ["1:1", 1620, 1824, 1620], ["4:5", 1520, 1840, 1690], ["9:16", 1520, 1840, 1674],
] as const;
describe("approved channel-only preset positions", () => {
  it.each(cases)("%s keeps all other subtitle layout and style unchanged", (ratio, general, comment, subtitle) => {
    for (const id of ["dark-minimal", "dark-red", "white-yellow", "paper"] as const) {
      expect(presetChannelCenterY(id, ratio)).toBe(general);
      expect(presetChannelCenterY(id, ratio, 3)).toBe(1580);
    }
    expect(presetChannelCenterY("comment-capture", ratio)).toBe(comment);
    expect(presetChannelCenterY("comment-capture", ratio, 3)).toBe(1840);
    for (const id of ["pop", "highlight"] as const) {
      const previous = builtInSubtitlePresentation({ id, videoAspectRatio: ratio, legacyChannelPosition: true, legacyLayout: true });
      const next = builtInSubtitlePresentation({ id, videoAspectRatio: ratio, legacyLayout: true });
      expect(next.config.channel.y).toBe(subtitle);
      const restored = structuredClone(next);
      restored.config.channel.y = previous.config.channel.y;
      restored.style.layout.channel.y = previous.style.layout.channel.y;
      expect(restored).toEqual(previous);
      expect(resolveBuiltInSubtitleTemplateSnapshot({ templateId: "dark-minimal", subtitleTemplateId: id,
        videoAspectRatio: ratio, templateSnapshot: { presetVersion: 4 } })?.config).toEqual(next.config);
      const snapshot = { presetVersion: 4, config: next.config };
      expect(resolveBuiltInSubtitleTemplateSnapshot({ templateId: "dark-minimal", subtitleTemplateId: id,
        videoAspectRatio: ratio as VideoAspectRatio, templateSnapshot: snapshot })).toEqual(snapshot);
    }
  });
  it.each([3, 4])("preserves version %s through template switches and reopening", (presetVersion) => {
    const existing = { templateId: "dark-red" as const, customTemplateId: null, templateSnapshot: { presetVersion } };
    expect(resolveEditedTemplateSelection({ existing, requestedTemplateId: "paper" })?.templateSnapshot)
      .toEqual({ presetVersion });
    expect(resolveEditedTemplateSelection({ existing, requestedTemplateId: "dark-red" })?.templateSnapshot)
      .toBe(existing.templateSnapshot);
  });
});
