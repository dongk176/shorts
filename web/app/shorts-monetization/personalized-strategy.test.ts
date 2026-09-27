import { describe, it, expect } from "vitest";
import {
  getStrategyQuestions,
  personalizedStrategy,
  personalizedPlanText,
} from "./personalized-strategy";
import { createPlan, type Answers } from "./monetization-model";
const base: Answers = {
  category: "products",
  goal: "affiliate",
  stage: "starting",
  source: "own",
  format: "hands",
  time: "short",
  readiness: "ready",
  obstacle: "ideas",
};
describe("personalized strategy", () => {
  it("changes the preparation question with the goal and keeps stable answer IDs", () => {
    for (const locale of ["ko", "en", "ja"] as const) {
      const a = getStrategyQuestions(base, locale);
      const b = getStrategyQuestions({ ...base, goal: "sales" }, locale);
      expect(a[0].title).not.toBe(b[0].title);
      expect(a.map((q) => q.options.map((o) => o.value))).toEqual(
        b.map((q) => q.options.map((o) => o.value)),
      );
    }
  });
  it("prioritizes unverified footage over a sales or sponsorship goal", () => {
    for (const goal of ["affiliate", "sponsor", "sales"]) {
      const p = personalizedStrategy(
        { ...base, goal, source: "unknown" },
        "ko",
      );
      expect(p.priority).toContain("확인 전에는");
      expect(createPlan({ ...base, goal, source: "unknown" }).ready).toBe(
        false,
      );
    }
  });
  it("prepares samples for sponsorship beginners and validates demand before selling a missing product", () => {
    expect(
      personalizedStrategy(
        { ...base, goal: "sponsor", readiness: "notyet" },
        "ko",
      ).priority,
    ).toContain("샘플 두 편");
    expect(
      personalizedStrategy(
        { ...base, goal: "sales", readiness: "notyet" },
        "ko",
      ).priority,
    ).toContain("판매 페이지부터 만들지");
  });
  it("changes workflow, storyboard, schedule and bottleneck advice independently", () => {
    const p = personalizedStrategy(base, "en");
    expect(
      personalizedStrategy({ ...base, source: "none" }, "en").workflow[0],
    ).not.toEqual(p.workflow[0]);
    expect(
      personalizedStrategy({ ...base, format: "voice" }, "en").scripts[0].shot,
    ).not.toBe(p.scripts[0].shot);
    expect(
      personalizedStrategy({ ...base, time: "weekend" }, "en").timeTip,
    ).not.toBe(p.timeTip);
    expect(
      personalizedStrategy({ ...base, obstacle: "conversion" }, "en").focus,
    ).not.toEqual(p.focus);
  });
  it("keeps new strategies and copied text localized across combinations", () => {
    for (const locale of ["en", "ja"] as const)
      for (const goal of ["affiliate", "ads", "sponsor", "sales", "unsure"])
        for (const source of ["own", "none", "unknown"])
          for (const obstacle of [
            "ideas",
            "production",
            "retention",
            "conversion",
          ]) {
            const answers = {
              ...base,
              goal,
              source,
              obstacle,
              readiness: "notyet",
            };
            const p = personalizedStrategy(answers, locale);
            expect(p.faqs).toHaveLength(5);
            expect(p.scripts).toHaveLength(3);
            expect(JSON.stringify(p)).not.toMatch(/[가-힣]/);
            expect(personalizedPlanText(answers, locale)).not.toMatch(
              /[가-힣]/,
            );
          }
  });
});
