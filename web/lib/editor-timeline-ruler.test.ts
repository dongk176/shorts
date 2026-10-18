import { describe, expect, it } from "vitest";
import { editorTimelineRulerTicks, formatEditorTimelineTime } from "./editor-timeline-ruler";

describe("readable timeline ruler", () => {
  it("uses sparse labels on the reported 367px mobile screen", () => {
    const ticks = editorTimelineRulerTicks(0, 12, 351);
    expect(ticks.map((tick) => tick.label)).toEqual(["0:00", "0:03", "0:06", "0:09", "0:12"]);
  });
  it("reduces labels further on small screens and adds detail when zooming", () => {
    expect(editorTimelineRulerTicks(0, 12, 280)).toHaveLength(3);
    expect(editorTimelineRulerTicks(0, 12, 1053).length).toBeGreaterThan(5);
  });
  it("keeps trimmed offsets and long labels within the same density budget", () => {
    const ticks = editorTimelineRulerTicks(-600.5, 1200, 351);
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toEqual({ position: 0, label: "−10:00.5" });
    expect(ticks.at(-1)).toEqual({ position: 100, label: "9:59.5" });
  });
  it("rounds across minute boundaries without positive prefixes or empty decimals", () => {
    expect(formatEditorTimelineTime(59.99)).toBe("1:00");
    expect(formatEditorTimelineTime(-0.01)).toBe("0:00");
    expect(formatEditorTimelineTime(1.5)).toBe("0:01.5");
  });
});
