import { describe, expect, it } from "vitest";
import { assertJobCreationAllowed } from "./job-policy";

const base = {
  activeJobs: 0,
  maxActiveJobs: 1,
  sourceDurationSeconds: 900,
  usage: {
    usedSeconds: 0,
    reservedSeconds: 0,
    limitSeconds: 6000,
    remainingSeconds: 6000,
    periodStart: "2026-06-30T15:00:00.000Z",
    nextResetAt: "2026-07-31T15:00:00.000Z",
    enforcementEnabled: false,
  },
};

describe("job abuse and plan limits", () => {
  it("allows one job when no abuse limit is reached", () => {
    expect(() => assertJobCreationAllowed(base)).not.toThrow();
  });

  it("enforces the per-session active job limit", () => {
    expect(() => assertJobCreationAllowed({ ...base, activeJobs: 1 })).toThrow("처리 중");
  });

  it("allows MVP plan overage unless enforcement is enabled", () => {
    const over = { ...base, sourceDurationSeconds: 3600, usage: { ...base.usage, usedSeconds: 5000 } };
    expect(() => assertJobCreationAllowed(over)).not.toThrow();
    expect(() => assertJobCreationAllowed({
      ...over,
      usage: { ...over.usage, enforcementEnabled: true },
    })).toThrow("플랜");
  });
});
