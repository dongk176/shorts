import { describe, expect, it } from "vitest";
import { currentKstPeriod } from "./usage";

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
