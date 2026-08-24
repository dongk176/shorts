import { describe, expect, it } from "vitest";
import { videoAspectRatioSelection } from "@/lib/video-aspect-ratio-selection";

describe("video aspect ratio selection", () => {
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
