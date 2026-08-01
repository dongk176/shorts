import { describe, expect, it } from "vitest";
import { discoveryPeriodAfterTypeSelection } from "./popular-filter-selection";

describe("popular filter selection", () => {
  it("defaults reusable videos to those discovered today", () => {
    expect(discoveryPeriodAfterTypeSelection("reusable", "all")).toBe("today");
    expect(discoveryPeriodAfterTypeSelection("reusable", "week")).toBe("today");
  });

  it("preserves the selected period for other ranking types", () => {
    expect(discoveryPeriodAfterTypeSelection("trending", "week")).toBe("week");
    expect(discoveryPeriodAfterTypeSelection("views", "all")).toBe("all");
  });
});
