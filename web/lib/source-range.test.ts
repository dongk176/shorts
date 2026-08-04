import { describe, expect, it } from "vitest";
import {
  billableSelectedSourceSeconds,
  selectedSourceRange,
} from "./source-range";

describe("selected source range", () => {
  it("accepts exact four and sixty minute ranges", () => {
    expect(selectedSourceRange(20_000, 120, 360)).toEqual({
      startSeconds: 120,
      endSeconds: 360,
      durationSeconds: 240,
    });
    expect(selectedSourceRange(20_000, 120, 3_720).durationSeconds).toBe(3_600);
  });

  it("rejects ranges outside the source or outside four to sixty minutes", () => {
    expect(() => selectedSourceRange(1_000, -1, 400)).toThrow("원본 영상 안");
    expect(() => selectedSourceRange(1_000, 0, 239.999)).toThrow("최소 4분");
    expect(() => selectedSourceRange(10_000, 0, 3_600.001)).toThrow("최대 60분");
  });

  it("uses the existing nearest-minute billing rule", () => {
    expect(billableSelectedSourceSeconds(1_200)).toBe(1_200);
    expect(billableSelectedSourceSeconds(1_230)).toBe(1_200);
    expect(billableSelectedSourceSeconds(1_231)).toBe(1_260);
  });
});
