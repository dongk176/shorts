import { describe, expect, it } from "vitest";
import { creationActionDisabled, creationNeedsUpgrade, initialSourceRangeEnd } from "./creation-upgrade";
import { billableSelectedSourceSeconds, selectedSourceRange } from "./source-range";

const action = { creationBlocked: false, busy: false, stateReady: true };
describe("exhausted-credit creation recovery", () => {
  it.each([0, 60, 180, 239, 240, 600])("keeps the plan action reachable with %i seconds left", (remaining) => {
    const end = initialSourceRangeEnd(600, remaining);
    expect(() => selectedSourceRange(600, 0, end)).not.toThrow();
    const exceeds = billableSelectedSourceSeconds(end) > remaining;
    const needsUpgrade = creationNeedsUpgrade({ authenticated: true, enforcementEnabled: true, canCreateJobs: remaining > 0, rewardAvailable: false, selectionExceedsUsage: exceeds });
    expect(needsUpgrade).toBe(remaining < 240);
    expect(creationActionDisabled({ ...action, needsUpgrade, rangeValid: !exceeds })).toBe(false);
  });
  it("offers a plan when a selected range exceeds available credit", () => {
    expect(creationNeedsUpgrade({ authenticated: true, enforcementEnabled: true, canCreateJobs: true, rewardAvailable: false, selectionExceedsUsage: true })).toBe(true);
  });
  it("preserves login, unenforced access and available event rewards", () => {
    const input = { authenticated: true, enforcementEnabled: true, canCreateJobs: false, rewardAvailable: false, selectionExceedsUsage: false };
    expect(creationNeedsUpgrade(input)).toBe(true);
    expect(creationNeedsUpgrade({ ...input, authenticated: false })).toBe(false);
    expect(creationNeedsUpgrade({ ...input, enforcementEnabled: false })).toBe(false);
    expect(creationNeedsUpgrade({ ...input, rewardAvailable: true })).toBe(false);
  });
  it("still disables restricted sources, busy jobs and unverified state", () => {
    const upgrade = { ...action, needsUpgrade: true, rangeValid: false };
    expect(creationActionDisabled({ ...upgrade, creationBlocked: true })).toBe(true);
    expect(creationActionDisabled({ ...upgrade, busy: true })).toBe(true);
    expect(creationActionDisabled({ ...upgrade, stateReady: false })).toBe(true);
    expect(creationActionDisabled({ ...upgrade, needsUpgrade: false })).toBe(true);
  });
  it("keeps the source duration and 60-minute ceiling", () => {
    expect(initialSourceRangeEnd(180, 0)).toBe(180);
    expect(initialSourceRangeEnd(14400, 99999)).toBe(3600);
    expect(() => selectedSourceRange(600, 0, 180)).toThrow();
    expect(() => selectedSourceRange(14400, 0, 3601)).toThrow();
  });
});
