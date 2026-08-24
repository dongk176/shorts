import { describe, expect, it } from "vitest";

import { homeAnalysisHeaderOffset } from "@/lib/home-analysis-scroll";

describe("homeAnalysisHeaderOffset", () => {
  it("does not treat the desktop sidebar height as a top header offset", () => {
    expect(homeAnalysisHeaderOffset({ isDesktop: true, headerHeight: 720 })).toBe(0);
  });

  it("keeps the mobile top header clear", () => {
    expect(homeAnalysisHeaderOffset({ isDesktop: false, headerHeight: 64 })).toBe(64);
  });
});
