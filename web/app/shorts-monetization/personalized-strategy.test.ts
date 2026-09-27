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
  it("keeps actionable plans for unverified footage while separating the rights note", () => {
    for (const goal of ["affiliate", "sponsor", "sales"]) {
      const p = personalizedStrategy(
        { ...base, goal, source: "unknown" },
        "ko",
      );
      expect(p.priority).not.toContain("권한");
      expect(p.sourceNote).toContain("권한");
      expect(p.today[1].body).toContain("직접 촬영하거나 녹화");
      expect(p.scripts[0].beats).toHaveLength(5);
      expect(p.revenueSteps).toHaveLength(3);
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
    ).toContain("판매 페이지부터 만들기보다");
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
            expect(p.faqs).toHaveLength(9);
            expect(p.scripts).toHaveLength(3);
            expect(JSON.stringify(p)).not.toMatch(/[가-힣]/);
            expect(personalizedPlanText(answers, locale)).not.toMatch(
              /[가-힣]/,
            );
          }
  });
});

describe("detailed execution plans", () => {
  it("adapts all eight answer dimensions beyond the profile label", () => {
    const p = personalizedStrategy(base, "ko");
    const cases = [
      ["category", "gaming", "scripts"],
      ["goal", "ads", "revenueSteps"],
      ["stage", "earning", "positioning"],
      ["source", "unknown", "workflow"],
      ["format", "voice", "scripts"],
      ["time", "weekend", "schedule"],
      ["readiness", "notyet", "today"],
      ["obstacle", "conversion", "focus"],
    ] as const;
    for (const [key, value, field] of cases) {
      expect(
        personalizedStrategy({ ...base, [key]: value }, "ko")[field],
        key,
      ).not.toEqual(p[field]);
    }
  });
  it("keeps a short session under 30 minutes and treats uncertain time as a trial", () => {
    const p = personalizedStrategy(base, "en");
    expect(p.todayMinutes).toBeLessThan(30);
    expect(p.today.reduce((sum, task) => sum + task.minutes, 0)).toBe(
      p.todayMinutes,
    );
    expect(
      personalizedStrategy({ ...base, time: "unsure" }, "en").timeTip,
    ).toContain("trial");
  });
  it("does not pitch a nonexistent offer and gives beginners a sample task", () => {
    const p = personalizedStrategy(
      { ...base, goal: "sales", readiness: "notyet" },
      "en",
    );
    expect(p.scripts.every((s) => !s.ending.includes("profile"))).toBe(true);
    expect(p.revenueSteps[2]).toContain("questions");
    expect(
      personalizedStrategy({ ...base, goal: "sponsor", stage: "none" }, "en")
        .priority,
    ).toContain("two samples");
  });
  it("provides distinct demonstrations for all categories and all three scripts", () => {
    const categories = [
      "products",
      "knowledge",
      "food",
      "beauty",
      "gaming",
      "life",
      "talk",
      "unsure",
    ];
    const openings = new Set();
    for (const category of categories) {
      const p = personalizedStrategy({ ...base, category }, "en");
      openings.add(p.scripts[0].hook);
      expect(new Set(p.scripts.map((s) => s.body)).size).toBe(3);
      expect(p.scripts.every((s) => s.shot.length > 80)).toBe(true);
    }
    expect(openings.size).toBe(categories.length);
  });
  it("fully localizes all categories, stages, formats and time budgets", () => {
    for (const locale of ["ko", "en", "ja"] as const)
      for (const category of [
        "products",
        "knowledge",
        "food",
        "beauty",
        "gaming",
        "life",
        "talk",
        "unsure",
      ])
        for (const stage of ["none", "starting", "growing", "earning"])
          for (const time of [
            "short",
            "medium",
            "long",
            "full",
            "weekend",
            "unsure",
          ])
            for (const format of ["face", "hands", "voice", "unsure"]) {
              const text = JSON.stringify(
                personalizedStrategy(
                  { ...base, category, stage, time, format },
                  locale,
                ),
              );
              expect(text).not.toContain("undefined");
              if (locale !== "ko") expect(text).not.toMatch(/[가-힣]/);
              if (locale !== "ja") expect(text).not.toMatch(/[ぁ-ゖァ-ヺ]/);
            }
  });
  it("includes the full on-screen plan in copied text and ends with the workbook", () => {
    for (const locale of ["ko", "en", "ja"] as const) {
      const p = personalizedStrategy(base, locale),
        text = personalizedPlanText(base, locale);
      for (const task of p.today) expect(text).toContain(task.done);
      for (const step of p.schedule) expect(text).toContain(step.output);
      for (const action of p.review) expect(text).toContain(action.action);
      expect(text.indexOf(p.bookIntro)).toBeGreaterThan(
        text.indexOf(p.faqs.at(-1)!.a),
      );
      expect(text.endsWith("#guide-library")).toBe(true);
    }
  });
});
