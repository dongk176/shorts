import { describe, expect, it } from "vitest";
import { billingCalendarCells, billingRange, shiftBillingMonth } from "./admin-billing-calendar";

describe("billing month boundaries", () => {
  it("covers leap February and pads weeks Sunday through Saturday", () => {
    const cells = billingCalendarCells("2024-02");
    expect(cells[0]).toBe("2024-01-28");
    expect(cells.at(-1)).toBe("2024-03-02");
    expect(cells.filter(day => day.startsWith("2024-02"))).toHaveLength(29);
    expect(billingCalendarCells("2026-08")).toHaveLength(42);
  });
  it("uses exclusive KST bounds across year and month changes", () => {
    expect(shiftBillingMonth("2026-01",-1)).toBe("2025-12");
    expect(billingRange("2026-12")).toEqual({start:"2026-12-01T00:00:00+09:00",end:"2027-01-01T00:00:00+09:00"});
    expect(billingRange("2024-02","2024-02-29").end).toBe("2024-03-01T00:00:00+09:00");
  });
});
