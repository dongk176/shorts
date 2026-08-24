import { describe, expect, it } from "vitest";
import {
  clearCompletedProjectViewedForFeedback,
  hasCompletedProjectViewedForFeedback,
  isProjectFeedbackProjectRoute,
  markCompletedProjectViewedForFeedback,
  PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY,
} from "./project-feedback-client";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("project feedback client trigger", () => {
  it("marks a completed project view until feedback eligibility is handled", () => {
    const storage = createStorage();
    expect(hasCompletedProjectViewedForFeedback(storage)).toBe(false);

    markCompletedProjectViewedForFeedback(1531, storage);

    expect(hasCompletedProjectViewedForFeedback(storage)).toBe(true);
    expect(storage.getItem(PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY)).toContain(
      '"projectNumber":1531',
    );

    clearCompletedProjectViewedForFeedback(storage);
    expect(hasCompletedProjectViewedForFeedback(storage)).toBe(false);
  });

  it("ignores invalid project numbers and malformed markers", () => {
    const storage = createStorage();
    markCompletedProjectViewedForFeedback(0, storage);
    expect(hasCompletedProjectViewedForFeedback(storage)).toBe(false);

    storage.setItem(PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY, "not-json");
    expect(hasCompletedProjectViewedForFeedback(storage)).toBe(false);
  });

  it("blocks feedback on project details and editors, but not after returning", () => {
    expect(isProjectFeedbackProjectRoute("/projects/1531")).toBe(true);
    expect(isProjectFeedbackProjectRoute("/projects/1531/edit/short-id")).toBe(true);
    expect(isProjectFeedbackProjectRoute("/projects")).toBe(false);
    expect(isProjectFeedbackProjectRoute("/")).toBe(false);
  });
});
