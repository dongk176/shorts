import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCompletedProjectViewedForFeedback,
  createProjectFeedbackPlaybackTracker,
  deferProjectFeedback,
  hasCompletedProjectViewedForFeedback,
  isProjectFeedbackProjectRoute,
  markCompletedProjectViewedForFeedback,
  PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY as KEY,
  PROJECT_FEEDBACK_VIEW_TTL_MS,
} from "./project-feedback-client";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

afterEach(() => vi.useRealTimers());

describe("project feedback view eligibility", () => {
  it("requires a result view for the current account", () => {
    const storage = createStorage();
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(false);
    markCompletedProjectViewedForFeedback("a", 1531, storage);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(true);
    expect(JSON.parse(storage.getItem(KEY)!)).toMatchObject({ accountId: "a", projectNumber: 1531 });
    expect(hasCompletedProjectViewedForFeedback("b", storage)).toBe(false);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(false);
  });

  it("expires the view after 30 minutes", () => {
    vi.useFakeTimers();
    const storage = createStorage();
    markCompletedProjectViewedForFeedback("a", 1, storage);
    vi.advanceTimersByTime(PROJECT_FEEDBACK_VIEW_TTL_MS - 1);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(false);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it.each([
    "not-json", "null", "[]",
    JSON.stringify({ version: 1, projectNumber: 1, viewedAt: new Date().toISOString() }),
    JSON.stringify({ version: 2, accountId: "a", projectNumber: 1, viewedAt: "not-a-date" }),
    JSON.stringify({ version: 2, accountId: "a", projectNumber: 1, viewedAt: "2999-01-01T00:00:00Z" }),
  ])("rejects legacy or invalid records: %s", (record) => {
    const storage = createStorage();
    storage.setItem(KEY, record);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(false);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("does not mark an anonymous or invalid project", () => {
    const storage = createStorage();
    markCompletedProjectViewedForFeedback("", 1, storage);
    markCompletedProjectViewedForFeedback("a", 0, storage);
    markCompletedProjectViewedForFeedback("a", Number.NaN, storage);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(false);
  });

  it("dismisses without a response and suppresses repeat prompts for 24 hours in this tab", () => {
    vi.useFakeTimers();
    const storage = createStorage();
    markCompletedProjectViewedForFeedback("a", 1, storage);
    deferProjectFeedback("a", storage);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(false);
    markCompletedProjectViewedForFeedback("a", 2, storage);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(false);
    markCompletedProjectViewedForFeedback("b", 2, storage);
    expect(hasCompletedProjectViewedForFeedback("b", storage)).toBe(true);
    clearCompletedProjectViewedForFeedback(storage);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    markCompletedProjectViewedForFeedback("a", 2, storage);
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(true);
  });

  it("fails closed when browser storage is unavailable", () => {
    const storage = {
      getItem() { throw new Error("storage denied"); },
      setItem() { throw new Error("storage denied"); },
      removeItem() { throw new Error("storage denied"); },
    };
    expect(() => markCompletedProjectViewedForFeedback("a", 1, storage)).not.toThrow();
    expect(() => deferProjectFeedback("a", storage)).not.toThrow();
    expect(hasCompletedProjectViewedForFeedback("a", storage)).toBe(false);
    expect(hasCompletedProjectViewedForFeedback("a", null)).toBe(false);
  });

  it("blocks feedback on project details and editors", () => {
    expect(isProjectFeedbackProjectRoute("/projects/1531")).toBe(true);
    expect(isProjectFeedbackProjectRoute("/projects/1531/edit/short-id")).toBe(true);
    expect(isProjectFeedbackProjectRoute("/projects")).toBe(false);
    expect(isProjectFeedbackProjectRoute("/")).toBe(false);
  });
});

describe("actual result playback", () => {
  it("requires three seconds of observed playback progress", () => {
    const observe = createProjectFeedbackPlaybackTracker();
    expect(observe(0, true)).toBe(false);
    expect(observe(1, true)).toBe(false);
    expect(observe(2, true)).toBe(false);
    expect(observe(3, true)).toBe(true);
  });

  it("does not count hidden, paused, seeking or unavailable playback", () => {
    const observe = createProjectFeedbackPlaybackTracker();
    for (const time of [0, 1, 2, 3, 4, 5]) expect(observe(time, false)).toBe(false);
    expect(observe(6, true)).toBe(false);
    expect(observe(7, true)).toBe(false);
  });

  it("does not count seeks or time spent in the background as playback", () => {
    const observe = createProjectFeedbackPlaybackTracker();
    expect(observe(0, true)).toBe(false);
    expect(observe(30, true)).toBe(false);
    expect(observe(31, true)).toBe(false);
    expect(observe(31, false)).toBe(false);
    expect(observe(40, true)).toBe(false);
    expect(observe(41, true)).toBe(false);
    expect(observe(42, true)).toBe(true);
  });

  it("does not count a loaded poster or repeated timestamps", () => {
    const observe = createProjectFeedbackPlaybackTracker();
    for (let i = 0; i < 20; i++) expect(observe(0, true)).toBe(false);
    expect(observe(Number.NaN, true)).toBe(false);
  });
});
