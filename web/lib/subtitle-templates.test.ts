import { describe, expect, it } from "vitest";
import {
  SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID,
  SUBTITLE_TEMPLATE_BRAND_COLOR,
  SUBTITLE_TEMPLATE_POP_WORD_GAP_PX,
  SUBTITLE_TEMPLATE_TITLE_FONT_SIZE_PX,
  SUBTITLE_TEMPLATE_TITLE_SECOND_LINE_COLOR,
  SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES,
  subtitleTemplateLayout,
  subtitleTemplateStyleSnapshot,
} from "./subtitle-templates";

describe("subtitle template snapshot", () => {
  it("keeps the complete template on the isolated dark-minimal shell", () => {
    const snapshot = subtitleTemplateStyleSnapshot("highlight", "9:16");
    expect(snapshot.baseTemplateId).toBe(SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID);
    expect(snapshot.color.active).toBe(SUBTITLE_TEMPLATE_BRAND_COLOR);
    expect(snapshot.schemaVersion).toBe(3);
    expect(snapshot.maxLines).toBe(1);
    expect(snapshot.timingLeadFrames).toBe(SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES);
    expect(snapshot.safeArea).toEqual({ x: 120, y: 1430, width: 840, height: 140 });
    expect(snapshot.layout.title).toEqual({ x: 0, y: 96, width: 1080, height: 300 });
    expect(snapshot.layout).toEqual(subtitleTemplateLayout("9:16"));
    expect(snapshot.title).toEqual({
      fontSizePx: SUBTITLE_TEMPLATE_TITLE_FONT_SIZE_PX,
      lineGapPx: 18,
      bottomMarginPx: 32,
      firstLineColor: "#FFFFFF",
      secondLineColor: SUBTITLE_TEMPLATE_TITLE_SECOND_LINE_COLOR,
    });
    expect(snapshot.title.secondLineColor).toBe("#35E6E3");
  });

  it("uses a larger outline and bounded scale for the pop template", () => {
    const snapshot = subtitleTemplateStyleSnapshot("pop", "16:9");
    expect(snapshot.outlinePx).toBe(8);
    expect(snapshot.font).toMatchObject({ sizePx: 92, minSizePx: 64 });
    expect(snapshot.popScale).toBe(1.12);
    expect(SUBTITLE_TEMPLATE_POP_WORD_GAP_PX).toBe(6);
    expect(snapshot.wordGapPx).toBe(6);
    expect(snapshot.layout.video.y).toBe(432);
    expect(snapshot.layout.caption.y).toBe(1088);
    expect(snapshot.layout.caption.y).toBe(
      snapshot.layout.video.y + snapshot.layout.video.height + 48,
    );
    expect(snapshot.title.fontSizePx).toBe(84);
    expect(snapshot.title.bottomMarginPx).toBe(44);
    expect(snapshot.channel).toEqual({ fontSizePx: 48, iconSizePx: 64, gapPx: 26 });
  });

  it("uses the ratio-specific title, video, and caption positions", () => {
    expect(subtitleTemplateLayout("16:9")).toMatchObject({
      title: { y: 0, height: 432 },
      video: { y: 432, height: 608 },
      caption: { y: 1088, height: 140 },
    });
    expect(subtitleTemplateLayout("5:4")).toMatchObject({
      title: { y: 0, height: 528 },
      video: { y: 528, height: 864 },
      caption: { y: 1183, height: 140 },
    });
    expect(subtitleTemplateLayout("1:1")).toMatchObject({
      title: { y: 0, height: 420 },
      video: { y: 420, height: 1080 },
      caption: { y: 1274, height: 140 },
    });
    expect(subtitleTemplateLayout("4:5")).toMatchObject({
      title: { y: 96, height: 300 },
      video: { y: 285, height: 1350 },
      caption: { y: 1387, height: 140 },
    });
    expect(subtitleTemplateLayout("9:16")).toMatchObject({
      title: { y: 96, height: 300 },
      video: { y: 0, height: 1920 },
      caption: { y: 1430, height: 140 },
    });
  });

  it.each(["5:4", "1:1", "4:5", "9:16"] as const)(
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
