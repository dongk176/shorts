import { describe, expect, it } from "vitest";
import { publicProjectAdmissionOpen } from "./project-admission-readiness";
describe("public project handoff readiness", () => {
  it.each([null, { version: 1, phase: "active", outcome: "cancel" },
    { version: 1, phase: "active", outcome: "complete" }])("allows inactive handoff %j", (state) => {
    expect(publicProjectAdmissionOpen(state)).toBe(true);
  });
  it.each([undefined, {}, [], "active", { version: 1, phase: "fenced" },
    { version: 1, phase: "admin_ready" }, { version: 2, phase: "active" },
    { version: "1", phase: "active" }])("rejects blocked or unverified handoff %j", (state) => {
    expect(publicProjectAdmissionOpen(state)).toBe(false);
  });
});
