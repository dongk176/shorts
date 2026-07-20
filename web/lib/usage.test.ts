import { afterEach, describe, expect, it, vi } from "vitest";
import { currentKstPeriod, isPlanEnforcementEnabled } from "./usage";

afterEach(() => vi.unstubAllEnvs());

describe("temporary plan enforcement", () => {
  it("is disabled by default so signed-in users can create without a plan", () => {
    vi.stubEnv("MVP_PLAN_ENFORCEMENT", "");
    expect(isPlanEnforcementEnabled()).toBe(false);
  });

  it("can be restored explicitly", () => {
    vi.stubEnv("MVP_PLAN_ENFORCEMENT", "true");
    expect(isPlanEnforcementEnabled()).toBe(true);
  });
});

describe("KST billing period", () => {
  it("starts at midnight on the first day in Asia/Seoul", () => {
    const period = currentKstPeriod(new Date("2026-07-31T20:00:00.000Z"));
    expect(period.start.toISOString()).toBe("2026-07-31T15:00:00.000Z");
    expect(period.next.toISOString()).toBe("2026-08-31T15:00:00.000Z");
  });

  it("stays in July immediately before the KST boundary", () => {
    const period = currentKstPeriod(new Date("2026-07-31T14:59:59.000Z"));
    expect(period.start.toISOString()).toBe("2026-06-30T15:00:00.000Z");
    expect(period.next.toISOString()).toBe("2026-07-31T15:00:00.000Z");
  });
});
