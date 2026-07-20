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
    baseUsedSeconds: 0,
    baseReservedSeconds: 0,
    baseLimitSeconds: 6000,
    baseRemainingSeconds: 6000,
    addonRemainingSeconds: 0,
    periodStart: "2026-06-30T15:00:00.000Z",
    nextResetAt: "2026-07-31T15:00:00.000Z",
    enforcementEnabled: true as const,
  },
};

describe("job abuse and plan limits", () => {
  it("allows one job when no abuse limit is reached", () => {
    expect(() => assertJobCreationAllowed(base)).not.toThrow();
  });

  it("enforces the per-session active job limit", () => {
    expect(() => assertJobCreationAllowed({ ...base, activeJobs: 1 })).toThrow("처리 중");
  });

  it("always rejects work larger than the provider-backed remaining grant", () => {
    const over = { ...base, sourceDurationSeconds: 3600, usage: { ...base.usage, remainingSeconds: 3599 } };
    expect(() => assertJobCreationAllowed(over)).toThrow("처리 시간");
  });

  it("allows usage overage while temporary plan enforcement is disabled", () => {
    const unrestricted = {
      ...base,
      sourceDurationSeconds: 3600,
      usage: { ...base.usage, remainingSeconds: 0, enforcementEnabled: false },
    };
    expect(() => assertJobCreationAllowed(unrestricted)).not.toThrow();
  });
});
