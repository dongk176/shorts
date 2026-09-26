import { it, expect } from "vitest";
import { paddleMonthlyPeriods } from "./periods";
import { paddlePlan, paddleAmount, formatPaddlePrice, paddleDisplayPlans } from "./catalog";
it("clamps leap-month anniversaries without drifting subsequent months", () => {
 const periods=paddleMonthlyPeriods(new Date("2028-01-31T12:30:00Z"),new Date("2029-01-31T12:30:00Z"),12);
 expect(periods[0].end.toISOString()).toBe("2028-02-29T12:30:00.000Z");
 expect(periods[1].end.toISOString()).toBe("2028-03-31T12:30:00.000Z");
 expect(periods[11].end.toISOString()).toBe("2029-01-31T12:30:00.000Z");
 for(let i=1;i<periods.length;i++) expect(+periods[i].start).toBe(+periods[i-1].end);
});
it("uses the existing monthly prices as the six-month equivalent and preserves legacy plans", () => {
 for(const tier of ["creator","pro"]) for(const currency of ["USD","JPY"] as const) {
 expect(paddleAmount(`paddle_${tier}_6m`,currency)).toBe(paddleAmount(`paddle_${tier}`,currency)*6);
 }
 expect(formatPaddlePrice("paddle_creator_6m","USD",true)).toBe("$11.99");
 expect(formatPaddlePrice("paddle_creator_6m","USD")).toBe("$71.94");
 expect(paddlePlan("paddle_creator").billingMonths).toBe(1);
 expect(paddleDisplayPlans(6).map(p=>p.billingMonths)).toEqual([1,6,6]);
});
