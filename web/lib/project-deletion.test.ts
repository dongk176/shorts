import { describe, expect, it } from "vitest";
import { projectCanBeDeleted } from "./project-deletion";

describe("project deletion availability", () => {
  it("allows terminal owned projects", () => {
    expect(projectCanBeDeleted({ isExample: false, status: "completed", shorts: [] })).toBe(true);
    expect(projectCanBeDeleted({ isExample: false, status: "failed", shorts: [] })).toBe(true);
    expect(projectCanBeDeleted({ isExample: false, status: "expired", shorts: [] })).toBe(true);
  });

  it("protects examples and active jobs or outputs", () => {
    expect(projectCanBeDeleted({ isExample: true, status: "completed", shorts: [] })).toBe(false);
    expect(projectCanBeDeleted({ isExample: false, status: "rendering", shorts: [] })).toBe(false);
    expect(projectCanBeDeleted({
      isExample: false,
      status: "completed",
      shorts: [{ status: "rerendering" }],
    })).toBe(false);
  });
});
