import { describe, expect, it } from "vitest";
import { stateRetryDelayMs } from "@/lib/state-loading";

describe("stateRetryDelayMs", () => {
  it("backs off from one second and caps retries at thirty seconds", () => {
    expect(stateRetryDelayMs(0)).toBe(1_000);
    expect(stateRetryDelayMs(1)).toBe(2_000);
    expect(stateRetryDelayMs(4)).toBe(16_000);
    expect(stateRetryDelayMs(5)).toBe(30_000);
    expect(stateRetryDelayMs(20)).toBe(30_000);
  });

  it("normalizes invalid attempts", () => {
    expect(stateRetryDelayMs(-1)).toBe(1_000);
    expect(stateRetryDelayMs(Number.NaN)).toBe(1_000);
  });
});
