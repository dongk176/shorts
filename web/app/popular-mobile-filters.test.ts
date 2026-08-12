import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./실시간인기/popular-videos-explorer.tsx", import.meta.url),
  "utf8",
);

describe("popular mobile filters", () => {
  it("keeps the mobile ranking compact and removes horizontal scrolling", () => {
    expect(source).toContain('className="grid grid-cols-3 rounded-xl');
    expect(source).toContain('trending: "인기 급상승"');
    expect(source).toContain('text-[14px] font-black');
    expect(source).toContain('reusableRanking: "재사용 허용"');
    expect(source).toContain("const mobileRankingButtonTone");
    expect(source).toContain('bg-[#ff715e]');
    expect(source).toContain('bg-[#ffb4a8]');
    expect(source).toContain('bg-[#a078ff]');
    expect(source).not.toContain('bg-[#78dcb8]');
    expect(source).not.toContain("overflow-x-auto");
  });

  it("moves category and additional conditions into a mobile bottom sheet", () => {
    expect(source).toContain("function MobilePopularFiltersSheet");
    expect(source).toContain('className="grid grid-cols-2 gap-2.5"');
    expect(source).toContain('role="switch"');
    expect(source).toContain('reusable: "재사용 허용 영상만"');
    expect(source).toContain('title: "세부 설정"');
    expect(source).toContain('truncate text-right text-sm font-bold');
    expect(source).toContain('reset: "초기화"');
    expect(source).toContain('apply: "적용"');
  });

  it("retains reusable-license confirmation when filters are applied", () => {
    expect(source).toContain("requestReusableFilter(commitMobileFilters)");
    expect(source).toContain('if (dataType === "reusable" && !nextFilters.reusableOnly) setDataType("views")');
  });

  it("does not render the removed subscription promotion copy", () => {
    expect(source).not.toContain("활성 구독 또는 기간 패키지로 원하는 영상만 빠르게 찾아보세요.");
    expect(source).not.toContain("지금 떠오르는 영상을 놓치지 마세요.");
  });
});
