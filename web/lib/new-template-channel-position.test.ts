import { describe, expect, it } from "vitest";
import { withNewTemplateChannelPosition } from "./new-template-channel-position";
import { createDefaultTemplateConfig, createUnifiedSubtitleTemplateConfig, templateConfigSchema } from "./template-config";
import { templateIds, videoAspectRatios } from "./contracts";

describe("new template channel seed matches the creation presets", () => {
  const general = [1400, 1520, 1620, 1520, 1520];
  const comment = [1464, 1752, 1824, 1840, 1840];
  const subtitle = [1368, 1508, 1620, 1690, 1674];
  it.each(templateIds)("%s changes only the channel y coordinate", (id) => {
    videoAspectRatios.forEach((ratio, index) => {
      const original = createDefaultTemplateConfig(id);
      original.video.aspectRatio = ratio;
      const before = structuredClone(original);
      const next = withNewTemplateChannelPosition(original, id);
      expect(next.channel.y).toBe((id === "comment-capture" ? comment : general)[index]);
      expect(next.channel.x).toBe(540);
      expect(original).toEqual(before);
      expect({ ...next, channel: { ...next.channel, y: original.channel.y } }).toEqual(before);
    });
  });
  it.each(["pop", "highlight"] as const)("%s library and new editor share the approved channel anchor", (variant) => {
    videoAspectRatios.forEach((ratio, index) => {
      const original = createUnifiedSubtitleTemplateConfig(variant);
      original.video.aspectRatio = ratio;
      const next = withNewTemplateChannelPosition(original, "dark-minimal", variant);
      expect(next.channel.y).toBe(subtitle[index]);
      expect(next.channel.x).toBe(540);
      expect({ ...next, channel: { ...next.channel, y: original.channel.y } }).toEqual(original);
    });
  });
  it("keeps legacy factories and saved custom positions unchanged", () => {
    expect(createDefaultTemplateConfig().channel.y).toBe(1580);
    expect(createUnifiedSubtitleTemplateConfig("pop").channel.y).toBe(1790);
    const saved = createDefaultTemplateConfig();
    saved.channel = { ...saved.channel, x: 415, y: 1712 };
    expect(templateConfigSchema.parse(saved).channel).toEqual(saved.channel);
  });
});
