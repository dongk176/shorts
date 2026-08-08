import { describe, expect, it } from "vitest";
import {
  SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID,
  SUBTITLE_TEMPLATE_BRAND_COLOR,
  SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  subtitleTemplateLayout,
  subtitleTemplateStyleSnapshot,
} from "./subtitle-templates";

describe("subtitle template snapshot", () => {
  it("keeps the complete template on the isolated dark-minimal shell", () => {
    const snapshot = subtitleTemplateStyleSnapshot("highlight", "9:16");
    expect(snapshot.baseTemplateId).toBe(SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID);
    expect(snapshot.color.active).toBe(SUBTITLE_TEMPLATE_BRAND_COLOR);
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.maxLines).toBe(1);
    expect(snapshot.timingLeadFrames).toBe(SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES);
    expect(snapshot.safeArea).toEqual({ x: 120, y: 1430, width: 840, height: 140 });
    expect(snapshot.layout).toEqual(subtitleTemplateLayout("9:16"));
  });

  it("uses a larger outline and bounded scale for the pop template", () => {
    const snapshot = subtitleTemplateStyleSnapshot("pop", "16:9");
    expect(snapshot.outlinePx).toBe(8);
    expect(snapshot.font).toMatchObject({ sizePx: 92, minSizePx: 64 });
    expect(snapshot.popScale).toBe(1.12);
    expect(snapshot.layout.video.y).toBe(496);
    expect(snapshot.layout.caption.y).toBe(900);
  });

  it.each(["16:9", "5:4", "1:1", "4:5", "9:16"] as const)(
    "keeps the one-line caption inside the %s video rect",
    (ratio) => {
      const layout = subtitleTemplateLayout(ratio);
      expect(layout.caption.y).toBeGreaterThanOrEqual(layout.video.y);
      expect(layout.caption.y + layout.caption.height).toBeLessThanOrEqual(
        layout.video.y + layout.video.height,
      );
      expect(layout.caption.height).toBe(140);
    },
  );
});
