import { describe, expect, it } from "vitest";
import {
  createPlan,
  isComplete,
  planText,
  questions,
  type Answers,
} from "./monetization-model";

const base: Answers = {
  category: "products",
  goal: "affiliate",
  stage: "starting",
  source: "own",
  format: "hands",
  time: "short",
};

describe("monetization guidance", () => {
  it("requires a valid answer for all six questions before producing a completed assessment", () => {
    expect(isComplete(base)).toBe(true);
    for (const question of questions) {
      expect(isComplete({ ...base, [question.key]: undefined })).toBe(false);
      expect(isComplete({ ...base, [question.key]: "invalid" })).toBe(false);
    }
  });
  it("keeps the requested sponsorship goal while giving a beginner a preparation task", () => {
    const result = createPlan({ ...base, goal: "sponsor", stage: "none" });
    expect(result.route).toBe("sponsor");
    expect(result.label).toContain("준비");
    expect(result.first).toContain("샘플 콘텐츠");
  });
  it("does not send missing or unverified source material straight to editing", () => {
    for (const source of ["none", "film", "unknown"]) {
      expect(createPlan({ ...base, source }).ready).toBe(false);
    }
    expect(createPlan({ ...base, source: "unknown" }).preparation).toContain(
      "상업적 이용 범위",
    );
    expect(createPlan({ ...base, source: "licensed" }).ready).toBe(true);
  });
  it("gives undecided beginners useful exploration rather than claiming monetization eligibility", () => {
    const result = createPlan({
      category: "unsure",
      goal: "unsure",
      stage: "none",
      source: "none",
      format: "unsure",
      time: "unsure",
    });
    expect(result.route).toBe("explore");
    expect(result.ideas).toHaveLength(3);
    expect(result.time.steps).toHaveLength(4);
    expect(result.time.pace).toContain("소요 시간");
  });
  it("treats weekend availability as a different schedule instead of daily time", () => {
    const result = createPlan({ ...base, time: "weekend" });
    expect(result.time.label).toBe("주말 집중형");
    expect(result.time.steps.map(([day]) => day)).toContain("토요일");
    expect(result.time.steps.at(-1)?.[2]).toContain("유튜브 예약 기능");
    expect(result.time.steps).not.toEqual(createPlan(base).time.steps);
  });
  it("uses the category, presentation preference, and time in a copyable plan", () => {
    const result = planText({
      ...base,
      category: "gaming",
      goal: "ads",
      format: "voice",
      time: "weekend",
    });
    expect(result).toContain("플레이");
    expect(result).toContain("내 목소리");
    expect(result).toContain("주말 집중형");
    expect(result).toContain("승인을 보장하지");
  });
});

import { getQuestions, answerLabel } from "./monetization-model";
import { monetizationMessages } from "./monetization-copy";
import { siteLocales } from "@/lib/i18n/config";

describe("localized monetization guidance", () => {
  it("keeps question and answer IDs stable across languages", () => {
    const ids = (locale: (typeof siteLocales)[number]) =>
      getQuestions(locale).map((q) => [q.key, q.options.map((o) => o.value)]);
    for (const locale of siteLocales) expect(ids(locale)).toEqual(ids("ko"));
  });
  it("translates every message without leaving Korean in English or Japanese", () => {
    for (const translations of Object.values(monetizationMessages)) {
      for (const locale of ["en", "ja"] as const) {
        expect(translations[locale].trim()).not.toBe("");
        expect(translations[locale]).not.toMatch(/[가-힣]/);
      }
    }
  });
  it("localizes question and recommendation branches, including copied plans", () => {
    for (const locale of ["en", "ja"] as const) {
      expect(JSON.stringify(getQuestions(locale))).not.toMatch(/[가-힣]/);
      expect(answerLabel("category", "invalid", locale)).not.toMatch(/[가-힣]/);
      for (const question of questions) {
        for (const option of question.options) {
          const answers = { ...base, [question.key]: option.value };
          const translated = createPlan(answers, locale);
          expect(translated.route).toBe(createPlan(answers).route);
          expect(translated.ready).toBe(createPlan(answers).ready);
          expect(translated.ideas).toHaveLength(3);
          expect(translated.time.steps).toHaveLength(4);
          expect(JSON.stringify(translated)).not.toMatch(
            /[가-힣]|\{(?:goal|category|time)\}/,
          );
          expect(planText(answers, locale)).not.toMatch(/[가-힣]/);
        }
      }
      const undecided = {
        category: "unsure",
        goal: "unsure",
        stage: "none",
        source: "unknown",
        format: "unsure",
        time: "unsure",
      };
      expect(createPlan(undecided, locale).route).toBe("explore");
      expect(planText(undecided, locale)).not.toMatch(/[가-힣]/);
      expect(
        createPlan({ ...base, goal: "sponsor", stage: "none" }, locale).label,
      ).not.toBe(
        createPlan({ ...base, goal: "sponsor", stage: "growing" }, locale)
          .label,
      );
    }
  });
});
