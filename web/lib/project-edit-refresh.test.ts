import { describe, expect, it } from "vitest";
import {
  createProjectEditRefreshSignal,
  parseProjectEditRefreshSignal,
} from "./project-edit-refresh";

describe("project edit refresh signal", () => {
  it("round-trips a valid applied edit", () => {
    expect(parseProjectEditRefreshSignal(
      createProjectEditRefreshSignal(42, "short-7", 1234),
    )).toEqual({
      projectNumber: 42,
      shortId: "short-7",
      appliedAt: 1234,
    });
  });

  it.each([
    null,
    "",
    "{",
    JSON.stringify({ projectNumber: 0, shortId: "short-7", appliedAt: 1234 }),
    JSON.stringify({ projectNumber: 42, shortId: "", appliedAt: 1234 }),
    JSON.stringify({ projectNumber: 42, shortId: "short-7", appliedAt: "now" }),
  ])("rejects invalid signals", (value) => {
    expect(parseProjectEditRefreshSignal(value)).toBeNull();
  });
});
