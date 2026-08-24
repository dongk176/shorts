import { describe, expect, it } from "vitest";
import { snapAxisToCenter } from "@/lib/template-editor-snap";

describe("template editor center snapping", () => {
  it("snaps to the canvas center inside the threshold", () => {
    expect(snapAxisToCenter(534, 540, 8)).toEqual({ value: 540, snapped: true });
    expect(snapAxisToCenter(548, 540, 8)).toEqual({ value: 540, snapped: true });
  });

  it("keeps free movement outside the threshold", () => {
    expect(snapAxisToCenter(531, 540, 8)).toEqual({ value: 531, snapped: false });
    expect(snapAxisToCenter(549, 540, 8)).toEqual({ value: 549, snapped: false });
  });

  it("snaps horizontal and vertical axes independently", () => {
    const horizontal = snapAxisToCenter(538, 540, 8);
    const vertical = snapAxisToCenter(940, 960, 8);

    expect(horizontal.snapped).toBe(true);
    expect(vertical.snapped).toBe(false);
  });
});
