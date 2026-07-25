import { afterEach, describe, expect, it, vi } from "vitest";
import { billableSourceSeconds, currentKstPeriod, isPlanEnforcementEnabled } from "./usage";

afterEach(() => vi.unstubAllEnvs());

describe("plan enforcement", () => {
  it("fails closed by default so usage is always charged", () => {
    vi.stubEnv("MVP_PLAN_ENFORCEMENT", "");
    expect(isPlanEnforcementEnabled()).toBe(true);
  });

  it("can only be disabled explicitly", () => {
    vi.stubEnv("MVP_PLAN_ENFORCEMENT", "false");
    expect(isPlanEnforcementEnabled()).toBe(false);
  });
});

describe("billable source duration", () => {
  it.each([
    [29 * 60 + 7, 29 * 60],
    [29 * 60 + 30, 29 * 60],
    [29 * 60 + 31, 30 * 60],
  ])("rounds %s source seconds to %s billable seconds at the 30-second boundary", (source, billable) => {
    expect(billableSourceSeconds(source)).toBe(billable);
  });

  it("discards fractional seconds before applying the minute boundary", () => {
    expect(billableSourceSeconds(90.999)).toBe(60);
  });

  it("charges at least one minute for a valid positive duration", () => {
    expect(billableSourceSeconds(0.75)).toBe(60);
  });

  it("rejects invalid durations", () => {
    expect(() => billableSourceSeconds(Number.NaN)).toThrow();
    expect(() => billableSourceSeconds(0)).toThrow();
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
