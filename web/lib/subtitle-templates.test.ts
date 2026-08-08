import { describe, expect, it } from "vitest";
import {
  SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID,
  SUBTITLE_TEMPLATE_BRAND_COLOR,
  subtitleTemplateStyleSnapshot,
} from "./subtitle-templates";

describe("subtitle template snapshot", () => {
  it("keeps the complete template on the isolated dark-minimal shell", () => {
    const snapshot = subtitleTemplateStyleSnapshot("highlight", "9:16");
    expect(snapshot.baseTemplateId).toBe(SUBTITLE_TEMPLATE_BASE_TEMPLATE_ID);
    expect(snapshot.color.active).toBe(SUBTITLE_TEMPLATE_BRAND_COLOR);
    expect(snapshot.safeArea).toEqual({ x: 120, y: 1220, width: 840, height: 290 });
  });

  it("uses a larger outline and bounded scale for the pop template", () => {
    const snapshot = subtitleTemplateStyleSnapshot("pop", "16:9");
    expect(snapshot.outlinePx).toBe(8);
    expect(snapshot.font).toMatchObject({ sizePx: 92, minSizePx: 64 });
    expect(snapshot.popScale).toBe(1.12);
  });
});
