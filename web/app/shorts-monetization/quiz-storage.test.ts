import { describe, expect, it } from "vitest";
import { readQuizDraft } from "./quiz-storage";
const now = 1780000000000;
const answers = {
  category: "products",
  goal: "affiliate",
  stage: "starting",
  source: "own",
  format: "hands",
  time: "short",
  readiness: "ready",
  obstacle: "ideas",
};
const draft = (extra = {}) =>
  JSON.stringify({
    version: 1,
    savedAt: now,
    answers,
    step: 7,
    finished: true,
    ...extra,
  });
describe("saved monetization questionnaire", () => {
  it("restores all eight answers and completed results", () => {
    expect(readQuizDraft(draft(), now)).toEqual({
      answers,
      step: 7,
      finished: true,
    });
  });
  it("rejects corrupt, incompatible, future, and expired drafts", () => {
    for (const raw of [
      null,
      "broken",
      "null",
      draft({ version: 2 }),
      draft({ savedAt: now + 1 }),
      draft({ savedAt: now - 31 * 86400000 }),
    ])
      expect(readQuizDraft(raw, now)).toBeNull();
  });
  it("drops unknown answers and resumes at the first missing question", () => {
    const restored = readQuizDraft(
      draft({
        answers: { ...answers, goal: "tampered", injected: "data" },
        step: 99,
      }),
      now,
    );
    expect(restored?.answers).not.toHaveProperty("goal");
    expect(restored?.answers).not.toHaveProperty("injected");
    expect(restored?.finished).toBe(false);
    expect(restored?.step).toBe(1);
  });
  it("does not turn a partial draft into a completed result", () => {
    expect(
      readQuizDraft(draft({ answers: { category: "products" }, step: 7 }), now),
    ).toEqual({ answers: { category: "products" }, step: 1, finished: false });
  });
  it("retains valid dependent choices after changing the goal", () => {
    expect(
      readQuizDraft(draft({ answers: { ...answers, goal: "sales" } }), now)
        ?.finished,
    ).toBe(true);
  });
  it("clamps invalid step values without discarding valid answers", () => {
    for (const step of [-5, "7", 1.5])
      expect(readQuizDraft(draft({ step }), now)?.step).toBe(0);
  });
});
