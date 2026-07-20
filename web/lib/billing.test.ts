import { describe, expect, it } from "vitest";
import { addKstMonths, createProviderOrderId } from "./billing";

describe("billing periods", () => {
  it("clamps a KST month-end anniversary without changing local time", () => {
    const start = new Date("2026-01-31T03:30:00.000Z"); // Jan 31 12:30 KST
    expect(addKstMonths(start, 1).toISOString()).toBe("2026-02-28T03:30:00.000Z");
  });

  it("preserves the original billing anchor after a short month", () => {
    const februaryEnd = new Date("2026-02-27T15:00:00.000Z");
    expect(addKstMonths(februaryEnd, 1, 31).toISOString()).toBe("2026-03-30T15:00:00.000Z");
  });

  it("creates Toss-compatible unique order identifiers", () => {
    const orderId = createProviderOrderId("SUB");
    expect(orderId).toMatch(/^EC-SUB-[a-f0-9]{32}$/);
    expect(orderId.length).toBeLessThanOrEqual(64);
  });
});
