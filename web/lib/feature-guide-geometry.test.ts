import { describe, expect, it } from "vitest";
import { resolveGuideSpotlightGeometry } from "@/lib/feature-guide-geometry";

describe("feature guide spotlight geometry", () => {
  it("keeps equal padding around a target", () => {
    expect(resolveGuideSpotlightGeometry({
      target: {
        top: 100,
        right: 240,
        bottom: 160,
        left: 120,
        width: 120,
        height: 60,
        borderRadius: 10,
      },
      viewportWidth: 1280,
      viewportHeight: 720,
      requestedPadding: 8,
      viewportMargin: 2,
      devicePixelRatio: 1,
    })).toEqual({
      top: 92,
      left: 112,
      width: 136,
      height: 76,
      borderRadius: 18,
    });
  });

  it("shrinks padding evenly when a target is close to an edge", () => {
    const geometry = resolveGuideSpotlightGeometry({
      target: {
        top: 40,
        right: 80,
        bottom: 120,
        left: 8,
        width: 72,
        height: 80,
        borderRadius: 12,
      },
      viewportWidth: 1280,
      viewportHeight: 720,
      requestedPadding: 9,
      viewportMargin: 2,
      devicePixelRatio: 1,
    });

    expect(geometry.left).toBe(2);
    expect(8 - geometry.left).toBe(geometry.left + geometry.width - 80);
    expect(geometry.top).toBe(34);
    expect(geometry.height).toBe(92);
  });

  it("snaps fractional coordinates to physical pixels", () => {
    expect(resolveGuideSpotlightGeometry({
      target: {
        top: 10.2,
        right: 110.7,
        bottom: 60.8,
        left: 10.2,
        width: 100.5,
        height: 50.6,
        borderRadius: 9,
      },
      viewportWidth: 1280,
      viewportHeight: 720,
      requestedPadding: 0,
      viewportMargin: 2,
      devicePixelRatio: 2,
    })).toMatchObject({
      top: 10,
      left: 10,
      width: 100.5,
      height: 51,
    });
  });
});
