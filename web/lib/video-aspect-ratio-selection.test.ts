import { describe, expect, it } from "vitest";
import { videoAspectRatioForTemplate, videoAspectRatioSelection } from "@/lib/video-aspect-ratio-selection";

describe("video aspect ratio selection", () => {
  it.each(["16:9", "5:4", "1:1"] as const)("keeps supported %s when switching to comments", (ratio) => {
    expect(videoAspectRatioForTemplate(ratio, "comment-capture")).toBe(ratio);
  });
  it.each(["4:5", "9:16"] as const)("falls back only for unsupported comment ratio %s", (ratio) => {
    expect(videoAspectRatioForTemplate(ratio, "comment-capture")).toBe("16:9");
    expect(videoAspectRatioForTemplate(ratio, "dark-minimal")).toBe(ratio);
  });
  it("always displays the saved custom-template ratio while locked", () => {
    expect(videoAspectRatioSelection("16:9", "4:5")).toEqual({
      locked: true,
      displayedValue: "4:5",
    });
  });

  it("uses the selected ratio for recommended templates", () => {
    expect(videoAspectRatioSelection("1:1")).toEqual({
      locked: false,
      displayedValue: "1:1",
    });
  });
});
